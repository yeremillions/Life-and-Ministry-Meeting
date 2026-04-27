import mammoth from "mammoth";
import type { PartType, SegmentId } from "./types";
import { extractPdfText } from "./workbookParser";
import { detectYear as inferYear } from "./utils";

/* -------------------------------------------------------------------- *
 * S-140 "Life and Ministry Meeting Schedule" template parser.
 *
 * Accepts a Word (.docx) or PDF file that has been filled out with
 * part titles and assignee names, then extracts each weekly block.
 *
 * Document layout (repeated per week, ~1 page each):
 *
 *   MAY 4-10 | ISAIAH 58-59          Chairman: Name
 *   Song XX                           Prayer:   Name
 *   Opening Comments (1 min.)
 *
 *   TREASURES FROM GOD'S WORD         Main Hall
 *     1. Title  (10 min.)             Name
 *     2. Spiritual Gems  (10 min.)    Name
 *     3. Bible Reading  (4 min.)      Name
 *
 *   APPLY YOURSELF TO THE FIELD MINISTRY  Main Hall
 *     4. Title  (X min.)              Name/Name
 *     5. Title  (X min.)              Name/Name
 *     6. Title  (X min.)              Name/Name
 *
 *   LIVING AS CHRISTIANS
 *     Song XX
 *     7. Title  (XX min.)             Name
 *     8. Title  (XX min.)             Name
 *     9. Congregation Bible Study (30 min.)  Conductor/Reader: Name/Name
 *     Concluding Comments (3 min.)
 *     Song XX                         Prayer: Name
 *
 * When mammoth extracts DOCX text, tab characters separate left-column
 * content (part info) from right-column content (assigned names).
 * -------------------------------------------------------------------- */

// ─── Public types ─────────────────────────────────────────────────────

export interface S140NameRef {
  /** Exactly as written in the document (before any name-matching). */
  raw: string;
}

export interface S140Part {
  number: number;
  title: string;
  segment: SegmentId;
  partType: PartType;
  minutes?: number;
  main?: S140NameRef;
  assistant?: S140NameRef;
}

export interface S140Week {
  /** ISO date of the Monday that starts this meeting week. */
  weekOf: string;
  /** Human-readable banner, e.g. "MAY 4-10". */
  banner: string;
  bibleReading?: string;
  parts: S140Part[];
}

// ─── Internal constants ───────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4,
  MAY: 5, JUNE: 6, JULY: 7, AUGUST: 8,
  SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
};
const MONTHS_RE = Object.keys(MONTHS).join("|");

/**
 * Week date-range banner: "May 4-10", "MAY 11 - 17", "April 28 – May 4".
 * Captures: [1]=startMonth [2]=startDay [3]=optional endMonth [4]=endDay
 */
const BANNER_RE = new RegExp(
  `(${MONTHS_RE})\\s+(\\d{1,2})\\s*[-\\u2010-\\u2015\\u2212~]\\s*(?:(${MONTHS_RE})\\s+)?(\\d{1,2})`,
  "i"
);

/** Bible-reading reference after the "|" separator in the banner line. */
const BIBLE_RE = /\|\s*([A-Z][A-Za-z .]+?\s+\d+(?:[:\-–—]\d+)*(?:\s*[-–—]\s*\d+)?)/i;

const SEG_RE: [SegmentId, RegExp][] = [
  ["treasures", /TREASURES\s*FROM\s*GOD[''\u2019]?S?\s*WORD/i],
  ["ministry",  /APPLY\s*YOURSELF\s*TO\s*THE\s*FIELD\s*MINISTRY/i],
  ["living",    /LIVING\s*AS\s*CHRISTIANS/i],
];

/**
 * Numbered part line. Groups: [1]=num [2]=title [3]=minutes [4]=trailing text.
 * An optional start-time prefix (e.g. "5:36") is tolerated and ignored.
 */
const PART_RE =
  /^\s*(?:\d{1,2}:\d{2}\s+)?(\d{1,2})\.\s+(.+?)\s+\((\d{1,3})\s*min\.?\)\s*(.*)?$/i;

/** Strips the "Conductor/Reader:" label from CBS name cells. */
const CONDUCTOR_RE = /^Conductor\s*\/\s*Reader\s*:?\s*/i;

/**
 * A string that looks like a person's name (or a "Name/Name" pair).
 * Used to detect names that land on a separate line from their part.
 */
const NAME_LIKE_RE =
  /^[A-Z][a-záéíóúàèìòùăâêîôûçñ'-]+(?:\s+[A-Za-záéíóúàèìòùăâêîôûçñ'-]+)+(?:\s*\/\s*[A-Z][a-záéíóúàèìòùăâêîôûçñ'-]+(?:\s+[A-Za-záéíóúàèìòùăâêîôûçñ'-]+)*)?$/;

// ─── Public entry points ──────────────────────────────────────────────

/** Parse a filled-out S-140 Word (.docx) file. */
export async function parseS140Docx(
  file: File,
  forcedYear?: number
): Promise<S140Week[]> {
  const buf = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return parseS140Text(value, forcedYear, file.name);
}

/** Parse a filled-out S-140 PDF file (uses the existing pdf.js extractor). */
export async function parseS140Pdf(
  file: File,
  forcedYear?: number
): Promise<S140Week[]> {
  const result = await extractPdfText(file);
  return parseS140Text(result.fullText, forcedYear, file.name);
}

// ─── Core text parser ─────────────────────────────────────────────────

export function parseS140Text(
  raw: string,
  forcedYear?: number,
  filename?: string
): S140Week[] {
  const text = normalise(raw);
  const lines = text.split("\n");
  const year = forcedYear ?? inferYear(text, filename);

  const result: S140Week[] = [];
  let week: S140Week | null = null;
  let seg: SegmentId | null = null;
  /** Index into week.parts of the last part that still awaits a name. */
  let pendingIdx = -1;

  function commitWeek() {
    if (week && week.parts.length > 0) result.push(week);
    week = null;
    seg = null;
    pendingIdx = -1;
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) { pendingIdx = -1; continue; }

    // Split on the FIRST tab — left column has part info, right has names.
    const tabPos = rawLine.indexOf("\t");
    const leftCol  = (tabPos >= 0 ? rawLine.slice(0, tabPos) : rawLine).trim();
    const rightCol = (tabPos >= 0 ? rawLine.slice(tabPos + 1) : "").trim();

    // ── 1. Numbered meeting part (highest priority) ──────────────────
    {
      const m = PART_RE.exec(leftCol || line);
      if (m && week && seg) {
        const number  = parseInt(m[1], 10);
        const title   = cleanTitle(m[2]);
        const minutes = parseInt(m[3], 10);

        // Name: trailing text on the part line > right tab column.
        let nameStr = (m[4] ?? "").trim() || rightCol;
        nameStr = nameStr.replace(CONDUCTOR_RE, "").trim();

        const { main, assistant } = splitNamePair(nameStr);
        week.parts.push({
          number,
          title,
          segment: seg,
          partType: inferPartType(seg, title, number),
          minutes: isNaN(minutes) ? undefined : minutes,
          main:      main      ? { raw: main }      : undefined,
          assistant: assistant ? { raw: assistant } : undefined,
        });
        pendingIdx = week.parts.length - 1;
        continue;
      }
    }

    // ── 2. Week date-range banner ────────────────────────────────────
    {
      const m = BANNER_RE.exec(line);
      // Guard: real banners don't start with a numbered part pattern.
      if (m && !/^\s*\d{1,2}\.\s/.test(line)) {
        const startDay = parseInt(m[2], 10);
        const endDay   = parseInt(m[4], 10);
        if (startDay >= 1 && startDay <= 31 && endDay >= 1 && endDay <= 31) {
          commitWeek();
          const startMonth = m[1].toUpperCase();
          const endMonth   = m[3] ? m[3].toUpperCase() : startMonth;
          const weekOf = toIsoDate(year, startMonth, startDay);
          if (weekOf) {
            week = {
              weekOf,
              banner:
                startMonth === endMonth
                  ? `${startMonth} ${startDay}-${endDay}`
                  : `${startMonth} ${startDay}-${endMonth} ${endDay}`,
              bibleReading: extractBibleRef(line),
              parts: [],
            };
          }
          continue;
        }
      }
    }

    if (!week) continue;

    // ── 3. Segment banner ────────────────────────────────────────────
    {
      const SEG_RANK: Record<string, number> = { treasures: 0, ministry: 1, living: 2 };
      let isSegLine = false;
      for (const [id, re] of SEG_RE) {
        if (re.test(line)) {
          isSegLine = true;
          // Only advance to a segment that comes *after* the current one in
          // canonical order (T→M→L).  A heading for an earlier segment is a
          // repeated running header / page footer — skip without resetting seg.
          const curRank = seg != null ? (SEG_RANK[seg] ?? -1) : -1;
          if ((SEG_RANK[id] ?? -1) > curRank) {
            seg = id;
            pendingIdx = -1;
          }
          break;
        }
      }
      if (isSegLine) continue;
    }

    if (!seg) continue;

    // ── 4. Standalone name line for a part that had no right-column ──
    if (
      pendingIdx >= 0 &&
      week.parts[pendingIdx] &&
      !week.parts[pendingIdx].main
    ) {
      const candidate = (rightCol || line).replace(CONDUCTOR_RE, "").trim();
      if (NAME_LIKE_RE.test(candidate)) {
        const { main, assistant } = splitNamePair(candidate);
        const part = week.parts[pendingIdx];
        if (main)      part.main      = { raw: main };
        if (assistant) part.assistant = { raw: assistant };
        pendingIdx = -1;
      }
    }
  }

  commitWeek();

  // Deduplicate by weekOf — prefer the entry with the most parts.
  const byDate = new Map<string, S140Week>();
  for (const w of result) {
    const ex = byDate.get(w.weekOf);
    if (!ex || w.parts.length > ex.parts.length) byDate.set(w.weekOf, w);
  }
  return [...byDate.values()].sort((a, b) => a.weekOf.localeCompare(b.weekOf));
}

// ─── Private helpers ──────────────────────────────────────────────────

function normalise(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-");
}


function toIsoDate(year: number, monthName: string, day: number): string | null {
  const mn = MONTHS[monthName.toUpperCase()];
  if (!mn) return null;
  const d = new Date(Date.UTC(year, mn - 1, day));
  if (isNaN(d.getTime())) return null;
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function extractBibleRef(line: string): string | undefined {
  const m = BIBLE_RE.exec(line);
  return m ? m[1].trim() : undefined;
}

/**
 * Split a "Name1/Name2" pair into main and assistant.
 * Strips placeholder text like "[Name]" or "[Name/Name]".
 */
function splitNamePair(raw: string): { main?: string; assistant?: string } {
  let s = raw.replace(/\[Name(?:\/Name)?\]/gi, "").trim();
  if (!s) return {};
  const slash = s.indexOf("/");
  if (slash < 0) return { main: s || undefined };
  return {
    main:      s.slice(0, slash).trim() || undefined,
    assistant: s.slice(slash + 1).trim() || undefined,
  };
}

function cleanTitle(raw: string): string {
  return raw.replace(/^["""]|["""]$/g, "").trim();
}

function inferPartType(seg: SegmentId, title: string, num: number): PartType {
  const t = title.toLowerCase();
  if (seg === "treasures") {
    if (num === 2 || /spiritual\s+gems/.test(t))  return "Spiritual Gems";
    if (num === 3 || /bible\s+reading/.test(t))   return "Bible Reading";
    return "Talk";
  }
  if (seg === "ministry") {
    if (/starting\s+a\s+conversation/.test(t))   return "Starting a Conversation";
    if (/following\s+up/.test(t))                return "Following Up";
    if (/making\s+disciples/.test(t))            return "Making Disciples";
    if (/explaining\s+your\s+beliefs/.test(t))   return "Explaining Your Beliefs";
    if (/initial\s+call/.test(t))                return "Initial Call";
    if (/^talk\b/.test(t))                       return "Talk (Ministry)";
    return "Starting a Conversation";
  }
  // living
  if (/congregation\s+bible\s+study/.test(t))  return "Congregation Bible Study";
  if (/local\s+needs/.test(t))                 return "Local Needs";
  if (/governing\s+body\s+update/.test(t))     return "Governing Body Update";
  return "Living Part";
}
