import { useMemo, useState } from "react";
import { db } from "../db";
import type { Assignee, Assignment, Week } from "../types";
import { SEGMENTS, segmentOf } from "../meeting";
import { uid } from "../utils";
import {
  parseS140Docx,
  parseS140Pdf,
  type S140NameRef,
  type S140Part,
  type S140Week,
} from "../s140Parser";

/* -------------------------------------------------------------------- *
 * Modal for importing a filled-out S-140 schedule template.
 *
 * Flow:
 *   1. User picks a .docx or .pdf file and optionally sets the year.
 *   2. We parse the document and match each name against existing enrollees.
 *   3. A preview table shows every part with match confidence; the user
 *      can override any auto-match via a dropdown.
 *   4. On confirm we write Week + Assignment rows to Dexie.
 * -------------------------------------------------------------------- */

// ─── Types ────────────────────────────────────────────────────────────

type MatchConf = "exact" | "partial" | "none";

interface NameMatch {
  conf: MatchConf;
  assigneeId?: number;
}

interface ResolvedPart extends S140Part {
  mainMatch: NameMatch;
  assistantMatch?: NameMatch;
}

interface ResolvedWeek {
  source: S140Week;
  parts: ResolvedPart[];
  existsInDb: boolean;
}

/** Key format: `${weekOf}:${partNumber}:main` or `…:assistant` */
type OverrideKey = string;

// ─── Name matching ────────────────────────────────────────────────────

function matchName(ref: S140NameRef | undefined, enrollees: Assignee[]): NameMatch {
  if (!ref || !ref.raw.trim()) return { conf: "none" };

  const norm = (s: string) =>
    s.trim().toLowerCase().replace(/\s+/g, " ");
  const target = norm(ref.raw);

  // 1. Exact full-name match.
  let found = enrollees.find((a) => norm(a.name) === target);
  if (found) return { conf: "exact", assigneeId: found.id };

  // 2. First-name-only match (partial).
  const firstName = target.split(" ")[0];
  if (firstName.length >= 2) {
    found = enrollees.find((a) => norm(a.name).split(" ")[0] === firstName);
    if (found) return { conf: "partial", assigneeId: found.id };
  }

  // 3. Last-name-only match (partial).
  const lastName = target.split(" ").at(-1) ?? "";
  if (lastName.length >= 3) {
    found = enrollees.find((a) => norm(a.name).split(" ").at(-1) === lastName);
    if (found) return { conf: "partial", assigneeId: found.id };
  }

  return { conf: "none" };
}

function resolveWeeks(
  weeks: S140Week[],
  enrollees: Assignee[],
  existingWeekOfs: string[]
): ResolvedWeek[] {
  const existingSet = new Set(existingWeekOfs);
  return weeks.map((w) => ({
    source: w,
    existsInDb: existingSet.has(w.weekOf),
    parts: w.parts.map((p) => ({
      ...p,
      mainMatch: matchName(p.main, enrollees),
      assistantMatch: p.assistant ? matchName(p.assistant, enrollees) : undefined,
    })),
  }));
}

// ─── Component ────────────────────────────────────────────────────────

export default function S140ImportModal({
  onClose,
  existingWeekOfs,
  assignees,
  onImported,
}: {
  onClose: () => void;
  existingWeekOfs: string[];
  assignees: Assignee[];
  onImported: (count: number) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [forcedYear, setForcedYear] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedWeek[] | null>(null);
  const [overrides, setOverrides] = useState<Map<OverrideKey, number | undefined>>(
    new Map()
  );
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const yearNum = useMemo(() => {
    const n = parseInt(forcedYear, 10);
    return Number.isFinite(n) ? n : undefined;
  }, [forcedYear]);

  // ── counts for the Import button label ──────────────────────────────
  const importCounts = useMemo(() => {
    if (!resolved) return { weeks: 0, assigned: 0, total: 0 };
    const toImport = replaceExisting
      ? resolved
      : resolved.filter((rw) => !rw.existsInDb);
    let assigned = 0;
    let total = 0;
    for (const rw of toImport) {
      for (const p of rw.parts) {
        total++;
        const mainId =
          overrides.has(`${rw.source.weekOf}:${p.number}:main`)
            ? overrides.get(`${rw.source.weekOf}:${p.number}:main`)
            : p.mainMatch.assigneeId;
        if (mainId != null) assigned++;
      }
    }
    return { weeks: toImport.length, assigned, total };
  }, [resolved, replaceExisting, overrides]);

  // ── parse ────────────────────────────────────────────────────────────
  async function handleParse() {
    if (!file) return;
    setParsing(true);
    setError(null);
    setResolved(null);
    setOverrides(new Map());
    setExpanded(new Set());
    try {
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      const weeks = isPdf
        ? await parseS140Pdf(file, yearNum)
        : await parseS140Docx(file, yearNum);
      if (weeks.length === 0) {
        setError(
          "No meeting weeks were recognised. Make sure this is a filled S-140 schedule (DOCX or PDF). You can also set the year manually if it's missing from the document."
        );
        return;
      }
      const rv = resolveWeeks(weeks, assignees, existingWeekOfs);
      setResolved(rv);
      // Expand all weeks by default.
      setExpanded(new Set(rv.map((rw) => rw.source.weekOf)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read file.");
    } finally {
      setParsing(false);
    }
  }

  // ── override a single name slot ──────────────────────────────────────
  function setOverride(key: OverrideKey, id: number | undefined) {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(key, id);
      return next;
    });
  }

  function toggleExpand(weekOf: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(weekOf)) next.delete(weekOf);
      else next.add(weekOf);
      return next;
    });
  }

  // ── import ────────────────────────────────────────────────────────────
  async function handleImport() {
    if (!resolved) return;
    setImporting(true);
    try {
      const now = Date.now();
      let added = 0;
      let updated = 0;

      for (const rw of resolved) {
        const { source } = rw;

        // Build assignments, resolving names via override → auto-match.
        const assignments: Assignment[] = rw.parts.map((p) => {
          const mainKey  = `${source.weekOf}:${p.number}:main`;
          const assistKey = `${source.weekOf}:${p.number}:assistant`;

          const assigneeId = overrides.has(mainKey)
            ? overrides.get(mainKey)
            : p.mainMatch.assigneeId;
          const assistantId =
            p.assistant || p.assistantMatch
              ? overrides.has(assistKey)
                ? overrides.get(assistKey)
                : p.assistantMatch?.assigneeId
              : undefined;

          return {
            uid: uid(),
            segment: p.segment,
            order: p.number,
            partType: p.partType,
            title: p.title,
            assigneeId,
            assistantId,
          };
        });

        const weekData: Omit<Week, "id"> = {
          weekOf: source.weekOf,
          weeklyBibleReading: source.bibleReading,
          assignments,
          createdAt: now,
          updatedAt: now,
        };

        const existing = await db.weeks
          .where("weekOf")
          .equals(source.weekOf)
          .first();

        if (existing) {
          if (!replaceExisting) continue;
          await db.weeks.update(existing.id!, {
            weeklyBibleReading: source.bibleReading,
            assignments,
            updatedAt: now,
          });
          updated++;
        } else {
          await db.weeks.add(weekData as Week);
          added++;
        }
      }

      onImported(added + updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  const allExist =
    resolved != null && resolved.every((rw) => rw.existsInDb) && !replaceExisting;

  // ── render ────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-5xl w-full p-5 max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h3 className="font-semibold text-lg">Import S-140 schedule</h3>
          <button
            className="text-slate-500 hover:text-slate-800"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Description */}
        <p className="text-sm text-slate-600 mb-3 shrink-0">
          Upload a filled-out <strong>S-140 Midweek Meeting Schedule</strong> (
          <code>.docx</code> or <code>.pdf</code>). The app will extract each
          week's parts and automatically match assignee names to your enrolled
          publishers. Review the matches below, then confirm to import.
        </p>

        {/* Controls */}
        <div className="flex flex-wrap gap-3 items-end mb-3 shrink-0">
          <div className="flex-1 min-w-[220px]">
            <label className="label">S-140 file</label>
            <input
              type="file"
              accept=".docx,.pdf"
              className="input"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setResolved(null);
                setError(null);
              }}
            />
          </div>
          <div>
            <label className="label">Year (optional)</label>
            <input
              type="number"
              placeholder="auto"
              className="input w-28"
              value={forcedYear}
              onChange={(e) => setForcedYear(e.target.value)}
            />
          </div>
          <button
            className="btn"
            onClick={handleParse}
            disabled={!file || parsing}
          >
            {parsing ? "Reading…" : "Read file"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 shrink-0">
            {error}
          </div>
        )}

        {/* Preview */}
        <div className="flex-1 overflow-auto border border-slate-200 rounded min-h-0">
          {!resolved ? (
            <p className="p-4 text-sm text-slate-500">
              Pick a filled S-140 file and click <strong>Read file</strong> to
              preview the parsed schedule.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {resolved.map((rw) => (
                <WeekSection
                  key={rw.source.weekOf}
                  rw={rw}
                  assignees={assignees}
                  expanded={expanded.has(rw.source.weekOf)}
                  overrides={overrides}
                  onToggle={() => toggleExpand(rw.source.weekOf)}
                  onOverride={setOverride}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {resolved && resolved.length > 0 && (
          <div className="shrink-0 mt-3 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(e) => setReplaceExisting(e.target.checked)}
              />
              Also update weeks already in my schedule (re-imports parts and
              replaces existing assignments).
            </label>

            <div className="flex justify-between items-center">
              <p className="text-xs text-slate-500">
                {importCounts.weeks} week{importCounts.weeks !== 1 ? "s" : ""} to
                import • {importCounts.assigned}/{importCounts.total} parts
                matched to an enrollee
              </p>
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="btn"
                  onClick={handleImport}
                  disabled={importing || importCounts.weeks === 0 || allExist}
                >
                  {importing
                    ? "Importing…"
                    : `Import ${importCounts.weeks} week${importCounts.weeks !== 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {!resolved && (
          <div className="mt-4 flex justify-end shrink-0">
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Week section ─────────────────────────────────────────────────────

function WeekSection({
  rw,
  assignees,
  expanded,
  overrides,
  onToggle,
  onOverride,
}: {
  rw: ResolvedWeek;
  assignees: Assignee[];
  expanded: boolean;
  overrides: Map<OverrideKey, number | undefined>;
  onToggle: () => void;
  onOverride: (key: OverrideKey, id: number | undefined) => void;
}) {
  const { source, existsInDb, parts } = rw;
  const matched = parts.filter(
    (p) => p.mainMatch.conf !== "none" || !p.main
  ).length;
  const unmatched = parts.filter(
    (p) => p.main && p.mainMatch.conf === "none"
  ).length;

  return (
    <div>
      {/* Week header row */}
      <button
        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium bg-slate-50 hover:bg-slate-100 text-left"
        onClick={onToggle}
      >
        <span className="text-slate-400 text-xs">{expanded ? "▼" : "▶"}</span>
        <span className="font-semibold">{source.banner}</span>
        {source.bibleReading && (
          <span className="text-slate-500 font-normal">{source.bibleReading}</span>
        )}
        <span className="text-slate-400 font-mono text-xs">{source.weekOf}</span>
        {existsInDb && (
          <span className="pill bg-amber-100 text-amber-700 ml-1">
            already in schedule
          </span>
        )}
        <span className="ml-auto flex gap-2">
          {unmatched > 0 && (
            <span className="pill bg-red-100 text-red-700">
              {unmatched} unmatched
            </span>
          )}
          <span className="pill bg-slate-100 text-slate-600">
            {matched}/{parts.length} resolved
          </span>
        </span>
      </button>

      {/* Parts table */}
      {expanded && (
        <table className="w-full text-xs">
          <thead className="bg-white text-slate-400 uppercase tracking-wide border-b border-slate-100">
            <tr>
              <th className="px-3 py-1.5 text-left w-8">#</th>
              <th className="px-3 py-1.5 text-left">Segment</th>
              <th className="px-3 py-1.5 text-left">Title</th>
              <th className="px-3 py-1.5 text-left min-w-[200px]">Assignee</th>
              <th className="px-3 py-1.5 text-left min-w-[200px]">
                Assistant
              </th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => {
              const seg = segmentOf(p.segment);
              const mainKey  = `${source.weekOf}:${p.number}:main`;
              const assistKey = `${source.weekOf}:${p.number}:assistant`;
              const hasAssist = !!p.assistant || !!p.assistantMatch;
              return (
                <tr
                  key={p.number}
                  className="border-t border-slate-50 hover:bg-slate-50"
                >
                  <td className="px-3 py-1.5 text-slate-400">{p.number}</td>
                  <td className="px-3 py-1.5">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1"
                      style={{ backgroundColor: seg.color }}
                    />
                    <span className="text-slate-600">{p.partType}</span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-700">{p.title}</td>
                  <td className="px-3 py-1.5">
                    <NameCell
                      raw={p.main?.raw}
                      match={p.mainMatch}
                      overrideId={overrides.get(mainKey)}
                      assignees={assignees}
                      onChange={(id) => onOverride(mainKey, id)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    {hasAssist ? (
                      <NameCell
                        raw={p.assistant?.raw}
                        match={p.assistantMatch ?? { conf: "none" }}
                        overrideId={overrides.get(assistKey)}
                        assignees={assignees}
                        onChange={(id) => onOverride(assistKey, id)}
                      />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Name cell with confidence badge + override dropdown ──────────────

const CONF_STYLES: Record<MatchConf, string> = {
  exact:   "bg-emerald-100 text-emerald-700",
  partial: "bg-amber-100  text-amber-700",
  none:    "bg-red-100    text-red-700",
};
const CONF_LABELS: Record<MatchConf, string> = {
  exact:   "✓",
  partial: "≈",
  none:    "✗",
};

function NameCell({
  raw,
  match,
  overrideId,
  assignees,
  onChange,
}: {
  raw?: string;
  match: NameMatch;
  overrideId?: number;
  assignees: Assignee[];
  onChange: (id: number | undefined) => void;
}) {
  // No name in the document at all — blank slot.
  if (!raw) return <span className="text-slate-300 text-xs">blank</span>;

  const resolvedId =
    overrideId !== undefined ? overrideId : match.assigneeId;
  const effectiveConf: MatchConf =
    overrideId !== undefined
      ? overrideId != null
        ? "exact"
        : "none"
      : match.conf;

  return (
    <div className="flex flex-col gap-0.5">
      {/* Raw document name + confidence badge */}
      <div className="flex items-center gap-1">
        <span
          className={`pill text-[10px] py-0 px-1 ${CONF_STYLES[effectiveConf]}`}
        >
          {CONF_LABELS[effectiveConf]}
        </span>
        <span className="text-slate-400 italic truncate max-w-[120px]" title={raw}>
          {raw}
        </span>
      </div>
      {/* Dropdown override */}
      <select
        className="input text-xs py-0.5"
        value={resolvedId ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
      >
        <option value="">— unassigned —</option>
        {assignees.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}
