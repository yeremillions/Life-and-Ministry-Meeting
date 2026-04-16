import { useMemo, useState } from "react";
import { db } from "../db";
import type { Assignment, Week } from "../types";
import { uid } from "../utils";
import {
  extractPdfText,
  parseWorkbookText,
  type ParsedMeeting,
} from "../workbookParser";

/**
 * Modal for importing a Life and Ministry Meeting workbook PDF.
 *
 * The user selects a .pdf file; we extract text with pdf.js, parse it
 * into week objects, and show a preview. On confirm, each parsed week
 * becomes a Week row (with its assignments) in Dexie — skipping any
 * week whose `weekOf` date is already in the database.
 */
export default function WorkbookImportModal({
  onClose,
  existingWeekOfs,
  onImported,
}: {
  onClose: () => void;
  existingWeekOfs: string[];
  onImported: (count: number) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedMeeting[] | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [forcedYear, setForcedYear] = useState<string>("");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importing, setImporting] = useState(false);

  const existingSet = useMemo(
    () => new Set(existingWeekOfs),
    [existingWeekOfs]
  );

  async function handleParse() {
    if (!file) return;
    setParsing(true);
    setError(null);
    setParsed(null);
    setRawText(null);
    setShowRaw(false);
    try {
      const text = await extractPdfText(file);
      setRawText(text);
      const yearNum = forcedYear.trim() ? parseInt(forcedYear, 10) : undefined;
      const meetings = parseWorkbookText(
        text,
        Number.isFinite(yearNum) ? yearNum : undefined
      );
      if (meetings.length === 0) {
        setError(
          "No meeting weeks were recognised. " +
            "Double-check that this is a recent MWB PDF, or try setting the year manually. " +
            "Use 'Show extracted text' below to inspect what was read from the file."
        );
      }
      setParsed(meetings);
    } catch (e) {
      console.error(e);
      setError(
        e instanceof Error ? e.message : "Failed to read PDF. Is the file valid?"
      );
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!parsed || parsed.length === 0) return;
    setImporting(true);
    try {
      const now = Date.now();
      let added = 0;
      let updated = 0;
      for (const meeting of parsed) {
        const existing = await db.weeks
          .where("weekOf")
          .equals(meeting.weekOf)
          .first();
        const assignments: Assignment[] = meeting.parts.map((p) => ({
          uid: uid(),
          segment: p.segment,
          order: p.number,
          partType: p.partType,
          title: p.title,
        }));
        const week: Omit<Week, "id"> = {
          weekOf: meeting.weekOf,
          weeklyBibleReading: meeting.bibleReading,
          assignments,
          createdAt: now,
          updatedAt: now,
        };
        if (existing) {
          if (!replaceExisting) continue;
          // Preserve any manual assignee/assistant selections that map to
          // an assignment with the same (segment, partType, order).
          const keyed = new Map<string, Assignment>();
          for (const a of existing.assignments) {
            keyed.set(`${a.segment}|${a.order}|${a.partType}`, a);
          }
          const merged = assignments.map((a) => {
            const prev = keyed.get(`${a.segment}|${a.order}|${a.partType}`);
            return prev
              ? {
                  ...a,
                  assigneeId: prev.assigneeId,
                  assistantId: prev.assistantId,
                  note: prev.note,
                  title: a.title || prev.title,
                }
              : a;
          });
          await db.weeks.update(existing.id!, {
            weeklyBibleReading: meeting.bibleReading,
            assignments: merged,
            updatedAt: now,
          });
          updated += 1;
        } else {
          await db.weeks.add({ ...week } as Week);
          added += 1;
        }
      }
      onImported(added + updated);
      onClose();
    } catch (e) {
      console.error(e);
      setError(
        e instanceof Error ? e.message : "Failed to import the parsed weeks."
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full p-5 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-lg">Import workbook PDF</h3>
          <button
            className="text-slate-500 hover:text-slate-800"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <p className="text-sm text-slate-600 mb-3">
          Upload the Life and Ministry Meeting workbook PDF (e.g.{" "}
          <code>mwb_E_202601.pdf</code>). Weeks and parts will be extracted
          and added to the schedule.
        </p>

        <div className="flex flex-wrap gap-3 items-end mb-3">
          <div className="flex-1 min-w-[220px]">
            <label className="label">PDF file</label>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="input"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setParsed(null);
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
            {parsing ? "Reading…" : "Read PDF"}
          </button>
        </div>

        {error && (
          <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-auto border border-slate-200 rounded">
          {!parsed ? (
            <p className="p-4 text-sm text-slate-500">
              Pick a PDF and click “Read PDF” to preview the parsed weeks.
            </p>
          ) : parsed.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">
              No weeks parsed.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">Week of</th>
                  <th className="text-left px-3 py-2">Banner</th>
                  <th className="text-left px-3 py-2">Bible reading</th>
                  <th className="text-right px-3 py-2">Parts</th>
                  <th className="text-right px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((m) => {
                  const exists = existingSet.has(m.weekOf);
                  return (
                    <tr
                      key={m.weekOf}
                      className="border-t border-slate-100 align-top"
                    >
                      <td className="px-3 py-2 font-mono text-xs">
                        {m.weekOf}
                      </td>
                      <td className="px-3 py-2">{m.banner}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {m.bibleReading ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {m.parts.length}
                      </td>
                      <td className="px-3 py-2 text-right text-xs">
                        {exists ? (
                          <span className="text-amber-700">
                            already in schedule
                          </span>
                        ) : (
                          <span className="text-emerald-700">new</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {parsed && parsed.length > 0 && (
          <label className="flex items-center gap-2 text-sm mt-3">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(e) => setReplaceExisting(e.target.checked)}
            />
            Also update weeks that are already in my schedule (preserves
            existing assignee selections where the part matches).
          </label>
        )}

        {rawText && (
          <div className="mt-3">
            <button
              className="text-xs text-slate-500 underline"
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? "Hide" : "Show"} extracted text (for debugging)
            </button>
            {showRaw && (
              <textarea
                readOnly
                className="mt-1 w-full h-40 text-xs font-mono border border-slate-200 rounded p-2 bg-slate-50 resize-y"
                value={rawText}
              />
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={handleImport}
            disabled={
              importing ||
              !parsed ||
              parsed.length === 0 ||
              (!replaceExisting &&
                parsed.every((m) => existingSet.has(m.weekOf)))
            }
          >
            {importing
              ? "Importing…"
              : parsed
                ? `Import ${
                    replaceExisting
                      ? parsed.length
                      : parsed.filter((m) => !existingSet.has(m.weekOf)).length
                  } week(s)`
                : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
