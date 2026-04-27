import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../db";
import type { Assignment, Week } from "../types";
import { uid } from "../utils";
import {
  extractPdfText,
  parseWorkbookText,
  type ParsedMeeting,
} from "../workbookParser";
import type { SegmentId } from "../types";
import { ensureRequiredParts, SEGMENT_PART_TYPES } from "../meeting";

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
  const [forcedYear, setForcedYear] = useState<string>("");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  
  // Review state
  const [reviewing, setReviewing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pdfDoc, setPdfDoc] = useState<any>(null);

  // Active week is the one that starts on or before the current page.
  const selectedReviewIdx = useMemo(() => {
    if (!parsed) return 0;
    // Find the last week that starts on or before the current page
    let bestIdx = 0;
    for (let i = 0; i < parsed.length; i++) {
      if (parsed[i].pageNumber && parsed[i].pageNumber! <= currentPage) {
        bestIdx = i;
      }
    }
    return bestIdx;
  }, [parsed, currentPage]);

  const meeting = (reviewing && parsed) ? parsed[selectedReviewIdx] : null;

  // Review edit handlers
  const handleAddPart = (segment: SegmentId) => {
    if (!parsed || !meeting) return;
    const newParsed = [...parsed];
    const week = { ...meeting };
    const newPart = {
      uid: uid(),
      number: week.parts.length,
      segment,
      partType: segment === "ministry" ? "Starting a Conversation" : "Living Part",
      title: "New Part",
    };
    week.parts = [...week.parts, newPart as any].sort((a, b) => {
      const SEG_ORDER: SegmentId[] = ["opening", "treasures", "ministry", "living"];
      const sd = SEG_ORDER.indexOf(a.segment) - SEG_ORDER.indexOf(b.segment);
      if (sd !== 0) return sd;
      return a.number - b.number;
    }).map((p, i) => ({ ...p, number: i }));
    newParsed[selectedReviewIdx] = week;
    setParsed(newParsed);
  };

  const handleMovePart = (partIdx: number, direction: 'up' | 'down') => {
    if (!parsed || !meeting) return;
    const newParsed = [...parsed];
    const week = { ...meeting };
    const parts = [...week.parts];
    const targetIdx = direction === 'up' ? partIdx - 1 : partIdx + 1;
    
    if (targetIdx < 0 || targetIdx >= parts.length) return;

    // Cross-segment movement: automatically update the segment of the moved part
    // to match its new neighbors if it crosses a boundary.
    const SEG_ORDER: SegmentId[] = ["opening", "treasures", "ministry", "living"];
    const movingPart = parts[partIdx];
    const targetNeighbor = parts[targetIdx];
    
    if (movingPart.segment !== targetNeighbor.segment) {
      movingPart.segment = targetNeighbor.segment;
    }

    [parts[partIdx], parts[targetIdx]] = [parts[targetIdx], parts[partIdx]];
    
    // Sort to ensure segments stay grouped, then re-index
    week.parts = parts.sort((a, b) => {
      const sd = SEG_ORDER.indexOf(a.segment) - SEG_ORDER.indexOf(b.segment);
      if (sd !== 0) return sd;
      return a.number - b.number;
    }).map((p, i) => ({ ...p, number: i }));
    
    newParsed[selectedReviewIdx] = week;
    setParsed(newParsed);
  };

  const handleUpdatePart = (partIdx: number, updates: Partial<any>) => {
    if (!parsed || !meeting) return;
    const newParsed = [...parsed];
    const week = { ...meeting };
    const parts = [...week.parts];
    parts[partIdx] = { ...parts[partIdx], ...updates };
    week.parts = parts;
    newParsed[selectedReviewIdx] = week;
    setParsed(newParsed);
  };

  const handleDeletePart = (partIdx: number) => {
    if (!parsed || !meeting) return;
    const newParsed = [...parsed];
    const week = { ...meeting };
    week.parts = week.parts.filter((_, i) => i !== partIdx).map((p, i) => ({ ...p, number: i }));
    newParsed[selectedReviewIdx] = week;
    setParsed(newParsed);
  };

  // When starting review, jump to the first week's page
  useEffect(() => {
    if (reviewing && parsed?.[0]?.pageNumber) {
      setCurrentPage(parsed[0].pageNumber);
    }
  }, [reviewing]);

  const existingSet = useMemo(
    () => new Set(existingWeekOfs),
    [existingWeekOfs]
  );

  async function handleParse() {
    if (!file) return;
    setParsing(true);
    setError(null);
    setParsed(null);
    try {
      const result = await extractPdfText(file);
      
      const yearNum = forcedYear.trim() ? parseInt(forcedYear, 10) : undefined;
      const rawMeetings = parseWorkbookText(
        result,
        Number.isFinite(yearNum) ? yearNum : undefined,
        file.name
      );

      // Normalize meetings immediately to have stable UIDs and required parts
      const meetings = rawMeetings.map(m => {
        const parsedAssignments: Assignment[] = m.parts.map((p) => ({
          uid: uid(),
          segment: p.segment,
          order: p.number,
          partType: p.partType,
          title: p.title,
        }));
        const assignments = ensureRequiredParts(parsedAssignments, uid);
        return {
          ...m,
          parts: assignments.map(a => ({
            number: a.order,
            segment: a.segment,
            partType: a.partType,
            title: a.title,
            uid: a.uid, // Add UID to the part for stable rendering
          } as any))
        };
      });

      // Load PDF for rendering
      const pdfjsLib = await import("pdfjs-dist");
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      setPdfDoc(doc);
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
        const assignments: Assignment[] = meeting.parts.map((p: any) => ({
          uid: p.uid || uid(),
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



  if (reviewing && parsed && meeting) {

    return (
      <div
        className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-[100]"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div>
              <h3 className="font-bold text-xl text-slate-800">Verify Workbook Parts</h3>
              <p className="text-sm text-slate-500">
                Compare the detected parts on the right with the original workbook page on the left.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-slate-400">
                Week {selectedReviewIdx + 1} of {parsed.length}
              </span>
              <button
                className="text-slate-400 hover:text-slate-600 text-2xl"
                onClick={onClose}
              >
                ×
              </button>
            </div>
          </div>

          {/* Main content: Side-by-Side */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left: PDF Preview */}
            <div className="flex-1 bg-slate-800 overflow-hidden flex flex-col">
              {/* PDF Toolbar */}
              <div className="px-4 py-2 bg-slate-900 border-b border-slate-700 flex items-center justify-between text-white">
                <div className="flex items-center gap-2">
                  <button 
                    className="p-1 hover:bg-slate-700 rounded disabled:opacity-30"
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage <= 1}
                  >
                    ◀
                  </button>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-tighter">Page</span>
                    <input 
                      type="number"
                      className="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-xs w-12 text-center"
                      value={currentPage}
                      onChange={(e) => setCurrentPage(parseInt(e.target.value, 10) || 1)}
                    />
                    <span className="text-xs text-slate-500">/ {pdfDoc?.numPages}</span>
                  </div>
                  <button 
                    className="p-1 hover:bg-slate-700 rounded disabled:opacity-30"
                    onClick={() => setCurrentPage(Math.min(pdfDoc?.numPages || 1, currentPage + 1))}
                    disabled={currentPage >= (pdfDoc?.numPages || 1)}
                  >
                    ▶
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4 flex justify-center">
                <div className="bg-white shadow-2xl h-fit">
                  <PdfPageRenderer
                    doc={pdfDoc}
                    pageNumber={currentPage}
                  />
                </div>
              </div>
            </div>

            {/* Right: Parsed Data */}
            <div className="w-[400px] border-l border-slate-100 bg-white flex flex-col">
              <div className="p-6 flex-1 overflow-auto">
                <div className="mb-6">
                  <div className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-1">
                    Detected Date
                  </div>
                  <h4 className="text-xl font-bold text-slate-800">{meeting.banner}</h4>
                  <div className="text-sm text-slate-500">{meeting.bibleReading}</div>
                </div>

                <div className="space-y-6">
                  {["opening", "treasures", "ministry", "living"].map((segId) => {
                    const segmentParts = meeting.parts
                      .map((p, originalIdx) => ({ ...p, originalIdx }))
                      .filter(p => p.segment === segId);
                    
                    if (segmentParts.length === 0 && segId !== "ministry") return null;
                    
                    // Parts for numbering: exclude Opening segment
                    const numberedParts = meeting.parts.filter(p => p.segment !== 'opening');

                    return (
                      <div key={segId}>
                        <div className="flex items-center justify-between mb-3 border-b border-indigo-50 pb-1">
                          <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-[0.2em]">
                            {segId.replace(/s$/, "")}
                          </div>
                          <button 
                            className="text-indigo-400 hover:text-indigo-600 p-1"
                            title="Add part to this section"
                            onClick={() => handleAddPart(segId as SegmentId)}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                            </svg>
                          </button>
                        </div>
                        <ul className="space-y-1">
                          {segmentParts.map((p, idx) => {
                            const isNumbered = segId !== 'opening';
                            const displayNum = isNumbered 
                              ? numberedParts.findIndex(np => (np as any).uid === (p as any).uid) + 1 
                              : null;

                            return (
                              <li key={(p as any).uid || idx} className="group flex items-center gap-3 p-1.5 hover:bg-slate-50 rounded-lg transition-colors">
                                <span className="text-[10px] font-bold text-slate-300 tabular-nums w-4 text-center">
                                  {displayNum || "•"}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <input 
                                    className="w-full text-sm font-semibold text-slate-700 leading-tight bg-transparent border-none p-0 focus:ring-0 focus:outline-none placeholder:text-slate-300"
                                    value={p.title}
                                    placeholder="Click to edit title..."
                                    onChange={(e) => handleUpdatePart(p.originalIdx, { title: e.target.value })}
                                  />
                                  <div className="relative inline-block group/select">
                                    <select 
                                      className="appearance-none text-[10px] text-slate-400 font-medium bg-transparent border-none p-0 pr-4 leading-none focus:ring-0 focus:outline-none cursor-pointer hover:text-indigo-600"
                                      value={p.partType}
                                      onChange={(e) => handleUpdatePart(p.originalIdx, { partType: e.target.value })}
                                    >
                                      {SEGMENT_PART_TYPES[segId as SegmentId].map(type => (
                                        <option key={type} value={type}>{type}</option>
                                      ))}
                                      {/* Allow choosing any part type even if it belongs to another segment */}
                                      <optgroup label="Other Segments">
                                        {Object.entries(SEGMENT_PART_TYPES)
                                          .filter(([id]) => id !== segId)
                                          .map(([_, types]) => types.map(type => (
                                            <option key={type} value={type}>{type}</option>
                                          )))}
                                      </optgroup>
                                    </select>
                                    <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300 group-hover/select:text-indigo-400">
                                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </div>
                                  </div>
                                </div>
                                
                                {/* Actions */}
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                    className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-20"
                                    disabled={p.originalIdx === 0}
                                    onClick={() => handleMovePart(p.originalIdx, 'up')}
                                    title="Move up"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                                    </svg>
                                  </button>
                                  <button 
                                    className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-20"
                                    disabled={p.originalIdx === meeting.parts.length - 1}
                                    onClick={() => handleMovePart(p.originalIdx, 'down')}
                                    title="Move down"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </button>
                                  <button 
                                    className="p-1 text-slate-400 hover:text-red-500"
                                    onClick={() => handleDeletePart(p.originalIdx)}
                                    title="Delete part"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-8 p-4 bg-amber-50 rounded-xl border border-amber-100">
                  <div className="flex gap-3">
                    <span className="text-xl">⚠️</span>
                    <p className="text-xs text-amber-800 leading-relaxed">
                      <strong>Reminder:</strong> Please ensure the parts match the workbook exactly. You can manually adjust any errors in the week editor after importing.
                    </p>
                  </div>
                </div>
              </div>

              {/* Navigation within Review */}
              <div className="p-4 border-t border-slate-50 bg-slate-50/30 flex gap-2">
                <button
                  className="btn-secondary flex-1"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(prev => prev - 1)}
                >
                  Previous Page
                </button>
                <button
                  className="btn-secondary flex-1"
                  disabled={currentPage >= (pdfDoc?.numPages || 1)}
                  onClick={() => setCurrentPage(prev => prev + 1)}
                >
                  Next Page
                </button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-100 bg-white flex justify-between items-center">
            <button className="text-sm font-medium text-slate-400 hover:text-slate-600" onClick={() => setReviewing(false)}>
              ← Back to list
            </button>
            <div className="flex gap-3">
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn px-8" onClick={handleImport} disabled={importing}>
                {importing ? "Importing..." : `Import ${parsed.length} Weeks`}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-lg text-slate-800">
              Import Workbook PDF
            </h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Select a Life and Ministry Meeting Workbook (MWB) file to extract
              meeting parts.
            </p>
          </div>
          <button
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-6">
          {!parsed ? (
            <>
              <div className="space-y-4">
                <label className="block">
                  <span className="label">Select PDF file</span>
                  <input
                    type="file"
                    accept=".pdf"
                    className="input mt-1"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    <span className="label">Force Year (Optional)</span>
                    <input
                      type="number"
                      placeholder="e.g. 2026"
                      className="input mt-1"
                      value={forcedYear}
                      onChange={(e) => setForcedYear(e.target.value)}
                    />
                  </label>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 text-red-700 text-sm p-4 rounded-lg border border-red-100">
                  {error}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-emerald-50 text-emerald-700 px-4 py-3 rounded-lg border border-emerald-100">
                <div className="flex items-center gap-2">
                  <span className="text-xl">✓</span>
                  <span className="font-medium">
                    Successfully parsed {parsed.length} weeks
                  </span>
                </div>
                <button
                  className="text-emerald-800 text-xs font-bold uppercase hover:underline"
                  onClick={() => setParsed(null)}
                >
                  Reset
                </button>
              </div>

              <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 flex gap-3">
                <span className="text-xl">💡</span>
                <p className="text-sm text-amber-800 leading-relaxed">
                  <strong>Recommendation:</strong> Always verify that the extracted parts match your physical workbook before assigning brothers.
                </p>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-slate-600">
                        Date
                      </th>
                      <th className="px-4 py-2 text-left font-semibold text-slate-600">
                        Bible Reading
                      </th>
                      <th className="px-4 py-2 text-center font-semibold text-slate-600 w-20">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsed.map((m) => {
                      const exists = existingSet.has(m.weekOf);
                      return (
                        <tr key={m.weekOf}>
                          <td className="px-4 py-2 font-medium">
                            {m.banner}
                          </td>
                          <td className="px-4 py-2 text-slate-500">
                            {m.bibleReading}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {exists ? (
                              <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-bold uppercase">
                                Skip
                              </span>
                            ) : (
                              <span className="text-[10px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded font-bold uppercase">
                                New
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="accent-indigo-600"
                />
                <span className="text-sm text-slate-600">
                  Replace existing weeks if dates overlap
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {!parsed ? (
            <button
              className="btn px-8"
              onClick={handleParse}
              disabled={!file || parsing}
            >
              {parsing ? "Parsing PDF..." : "Extract Parts"}
            </button>
          ) : (
            <>
              <button
                className="btn-secondary flex items-center gap-2"
                onClick={() => setReviewing(true)}
              >
                🔍 Visual Review
              </button>
              <button
                className="btn px-8"
                onClick={handleImport}
                disabled={importing}
              >
                {importing ? "Importing..." : "Commit All"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Component to render a specific PDF page onto a canvas. */
function PdfPageRenderer({ doc, pageNumber }: { doc: any; pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!doc || !canvasRef.current) return;

    let active = true;
    const renderPage = async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (!active) return;

        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current!;
        const context = canvas.getContext("2d");
        if (!context) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        await page.render(renderContext).promise;
      } catch (err) {
        console.error("PDF render error:", err);
      }
    };

    renderPage();
    return () => {
      active = false;
    };
  }, [doc, pageNumber]);

  return <canvas ref={canvasRef} className="max-w-full h-auto" />;
}
