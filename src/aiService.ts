import mammoth from "mammoth";
import * as XLSX from "xlsx";
import type { Assignee, Week, Privilege, Gender } from "./types";
import type { ParsedAssignee } from "./importers";
import { buildStats } from "./scheduler";
import { isPrivileged, normalizePrivileges } from "./meeting";

const GEMINI_MODEL = "gemini-2.0-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let msg = `Gemini API error (HTTP ${res.status})`;
    try {
      const j = JSON.parse(body);
      if (j?.error?.message) msg = j.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const json = await res.json();
  return (json.candidates?.[0]?.content?.parts?.[0]?.text as string) ?? "";
}

export async function testGeminiKey(apiKey: string): Promise<void> {
  const result = await callGemini(apiKey, 'Reply with only the word "ok".');
  if (!result.toLowerCase().includes("ok")) {
    throw new Error("Unexpected response — key may be invalid.");
  }
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) /
      86_400_000
  );
}

export async function explainWeekAssignments(
  apiKey: string,
  week: Week,
  assignees: Assignee[],
  historicalWeeks: Week[]
): Promise<Map<string, string>> {
  const stats = buildStats(assignees, historicalWeeks);

  const items = week.assignments
    .filter((a) => a.assigneeId != null)
    .map((a) => {
      const person = assignees.find((p) => p.id === a.assigneeId);
      if (!person) return null;
      const s = stats.get(person.id!) ?? {
        totalMain: 0,
        bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
        totalAssistant: 0,
      };
      return {
        uid: a.uid,
        partType: a.partType,
        segment: a.segment,
        name: person.name,
        privileges: person.privileges.join(", ") || "none",
        neverAssigned: !s.lastWeekMain,
        daysSinceLastMain: s.lastWeekMain
          ? daysBetween(s.lastWeekMain, week.weekOf)
          : null,
        totalMain: s.totalMain,
        segmentCount: s.bySegmentMain[a.segment],
        isPrivileged: isPrivileged(person),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (items.length === 0) return new Map();

  const prompt = `You explain why each person was auto-assigned to their part in a Jehovah's Witnesses midweek meeting schedule.

For each assignment write ONE concise sentence (max 20 words) stating the key reason they were chosen.
Focus on the single strongest factor: never assigned before, most overdue by days, fewest total assignments, or privilege fit.

Scoring context:
- neverAssigned=true → strongest driver (+365 points)
- daysSinceLastMain → days since last main part (higher = more overdue)
- totalMain → lower = less used overall
- Field Ministry (segment "ministry") → non-privileged publishers preferred
- Treasures Talk → Elders/MS preferred; Bible Reading → non-privileged brothers preferred
- Local Needs, Governing Body Update → Elders preferred

Data:
${JSON.stringify(items, null, 2)}

Respond ONLY with a valid JSON array — no markdown fences, no extra text:
[{"uid":"...","explanation":"..."},...]`;

  const raw = await callGemini(apiKey, prompt);
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return new Map();

  const out = new Map<string, string>();
  try {
    const parsed = JSON.parse(match[0]) as { uid: string; explanation: string }[];
    for (const item of parsed) out.set(item.uid, item.explanation);
  } catch {
    /* ignore parse errors */
  }
  return out;
}

async function fileToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    return wb.SheetNames.map((s) => XLSX.utils.sheet_to_csv(wb.Sheets[s])).join("\n");
  }
  if (name.endsWith(".docx")) {
    const buf = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
    return value;
  }
  return file.text();
}

export async function parseImportWithAI(
  apiKey: string,
  file: File
): Promise<ParsedAssignee[]> {
  const rawText = await fileToText(file);
  const truncated = rawText.slice(0, 8000);

  const prompt = `Parse the following text into congregation members for a Jehovah's Witnesses meeting scheduler.

Return a JSON array. Each object must have:
- name: string (full name only, no titles or numbers)
- gender: "M" (brother) or "F" (sister)
- baptised: boolean (default true)
- privileges: string[] — values from ["E","QE","MS","QMS","RP","CBSR"]
  E=Elder, QE=Qualified Elder, MS=Ministerial Servant, QMS=Qualified MS
  RP=Regular Pioneer (any gender), CBSR=Congregation Bible Study Reader
- active: boolean (default true)
- notes: string (optional, omit if empty)

Rules:
- Skip rows that look like headers, serial numbers, titles, or are blank
- If someone has QE they also have E; QMS implies MS — include both
- Default to gender "M" unless the row clearly indicates female/sister

Text to parse:
${truncated}

Respond ONLY with a valid JSON array:`;

  const raw = await callGemini(apiKey, prompt);
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("AI returned no usable JSON. Try a different file format.");

  const rows = JSON.parse(match[0]) as Array<Record<string, unknown>>;
  const VALID_PRIVS = new Set(["E", "QE", "MS", "QMS", "RP", "CBSR"]);

  return rows
    .map((r): ParsedAssignee | null => {
      const name = String(r.name ?? "").trim();
      if (name.length < 2) return null;
      const gender: Gender = String(r.gender ?? "M")
        .toUpperCase()
        .startsWith("F")
        ? "F"
        : "M";
      const rawPrivs = Array.isArray(r.privileges) ? r.privileges : [];
      const privs = normalizePrivileges(
        rawPrivs
          .map((p) => String(p).toUpperCase().trim())
          .filter((p): p is Privilege => VALID_PRIVS.has(p))
      );
      return {
        name,
        gender,
        baptised: r.baptised !== false,
        privileges: privs,
        active: r.active !== false,
        notes: r.notes ? String(r.notes) : undefined,
      };
    })
    .filter((r): r is ParsedAssignee => r !== null);
}
