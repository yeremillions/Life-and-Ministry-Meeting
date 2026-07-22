import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { parseWeekendPdf, parseWeekendDocx, type ParsedWeekendMeeting } from "../weekendParser";
import type { WeekendMeeting, Assignee } from "../types";

export default function WeekendImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const assignees = useLiveQuery(() => db.assignees.orderBy("name").toArray(), []) ?? [];
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedWeekendMeeting[] | null>(null);

  // Custom matched mappings for the preview step before saving
  const [resolvedAssignments, setResolvedAssignments] = useState<
    Record<
      string, // weekOf
      {
        publicTalkSpeakerType: "local" | "visiting";
        publicTalkSpeakerId?: number;
        rawSpeaker?: string;
        rawSpeakerCongregation?: string;
        publicTalkChairmanId?: number;
        watchtowerConductorId?: number;
        watchtowerReaderId?: number;
      }
    >
  >({});

  const matchPerson = (rawName?: string): Assignee | undefined => {
    if (!rawName) return undefined;
    const clean = rawName.trim().toLowerCase();
    // Try exact
    let found = assignees.find(a => a.name.toLowerCase() === clean);
    if (found) return found;
    // Try contains
    found = assignees.find(a => a.name.toLowerCase().includes(clean) || clean.includes(a.name.toLowerCase()));
    return found;
  };

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setParsing(true);
    setParsed(null);
    try {
      let results: ParsedWeekendMeeting[] = [];
      if (f.name.endsWith(".docx")) {
        results = await parseWeekendDocx(f);
      } else if (f.name.endsWith(".pdf")) {
        results = await parseWeekendPdf(f);
      } else {
        throw new Error("Unsupported file format. Please upload a PDF or DOCX file.");
      }

      if (results.length === 0) {
        throw new Error("No weekend meeting schedules were found in the document. Please verify the format.");
      }

      setParsed(results);

      // Auto-resolve names
      const mappings: typeof resolvedAssignments = {};
      for (const m of results) {
        const isGuest = !!m.rawSpeakerCongregation || !matchPerson(m.rawSpeaker);
        mappings[m.weekOf] = {
          publicTalkSpeakerType: isGuest ? "visiting" : "local",
          publicTalkSpeakerId: !isGuest ? matchPerson(m.rawSpeaker)?.id : undefined,
          rawSpeaker: m.rawSpeaker,
          rawSpeakerCongregation: m.rawSpeakerCongregation,
          publicTalkChairmanId: matchPerson(m.rawChairman)?.id,
          watchtowerConductorId: matchPerson(m.rawConductor)?.id,
          watchtowerReaderId: matchPerson(m.rawReader)?.id,
        };
      }
      setResolvedAssignments(mappings);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to parse schedule file.");
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!parsed) return;
    try {
      let count = 0;
      for (const m of parsed) {
        const resolved = resolvedAssignments[m.weekOf];
        // Check if there is already a weekend meeting for this week
        const existing = await db.weekendMeetings.where("weekOf").equals(m.weekOf).first();
        const data: Omit<WeekendMeeting, "id"> = {
          weekOf: m.weekOf,
          banner: m.banner,
          meetingDate: m.meetingDate,
          publicTalkSpeakerType: resolved?.publicTalkSpeakerType || "local",
          publicTalkSpeakerId: resolved?.publicTalkSpeakerId,
          rawSpeaker: resolved?.rawSpeaker,
          rawSpeakerCongregation: resolved?.rawSpeakerCongregation,
          publicTalkTitle: m.publicTalkTitle,
          publicTalkNumber: m.publicTalkNumber,
          publicTalkChairmanId: resolved?.publicTalkChairmanId,
          watchtowerConductorId: resolved?.watchtowerConductorId,
          watchtowerReaderId: resolved?.watchtowerReaderId,
          createdAt: Date.now(),
        };

        if (existing) {
          await db.weekendMeetings.update(existing.id!, data);
        } else {
          await db.weekendMeetings.add(data as WeekendMeeting);
        }
        count++;
      }
      onImported(count);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to import weekend meetings.");
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-4xl max-h-[85vh] flex flex-col p-6 rounded-lg shadow-xl bg-white border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <h3 className="text-lg font-bold text-slate-800">Import Weekend Schedule</h3>
          <button className="text-slate-400 hover:text-slate-600 font-bold" onClick={onClose}>
            ✕
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded text-xs mb-4">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0 space-y-4">
          {!parsed ? (
            <div className="border-2 border-dashed border-slate-300 hover:border-indigo-400 rounded-lg p-10 text-center transition-all cursor-pointer relative bg-slate-50">
              <input
                type="file"
                accept=".pdf,.docx"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={handleFileChange}
                disabled={parsing}
              />
              <div className="flex flex-col items-center gap-2">
                <span className="text-4xl">📄</span>
                <span className="font-semibold text-slate-700">
                  {parsing ? "Parsing schedule document..." : "Click or drag to upload schedule"}
                </span>
                <span className="text-xs text-slate-400">Supports PDF and Word (DOCX) formats</span>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 font-medium">
                We found {parsed.length} weeks. Please verify and match the raw parsed names to the local enrollees:
              </p>
              <div className="space-y-3">
                {parsed.map((m) => {
                  const resolved = resolvedAssignments[m.weekOf] || {};
                  return (
                    <div key={m.weekOf} className="border border-slate-200 rounded p-3 bg-slate-50 space-y-2">
                      <div className="flex justify-between border-b border-slate-200 pb-1.5 items-center">
                        <span className="font-bold text-xs text-slate-800">{m.banner}</span>
                        {m.publicTalkTitle && (
                          <span className="text-[11px] text-slate-500 italic max-w-[70%] truncate">
                            #{m.publicTalkNumber}: {m.publicTalkTitle}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                        {/* Speaker */}
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">
                            Speaker
                          </label>
                          <div className="flex flex-col gap-1">
                            <select
                              className="text-xs p-1 border border-slate-300 rounded bg-white w-full"
                              value={resolved.publicTalkSpeakerType}
                              onChange={(e) => {
                                const val = e.target.value as "local" | "visiting";
                                setResolvedAssignments(prev => ({
                                  ...prev,
                                  [m.weekOf]: {
                                    ...prev[m.weekOf],
                                    publicTalkSpeakerType: val,
                                    publicTalkSpeakerId: val === "local" ? (prev[m.weekOf]?.publicTalkSpeakerId || assignees[0]?.id) : undefined,
                                  }
                                }));
                              }}
                            >
                              <option value="local">Local Brother</option>
                              <option value="visiting">Guest Speaker</option>
                            </select>
                            {resolved.publicTalkSpeakerType === "local" ? (
                              <select
                                className="text-xs p-1 border border-slate-300 rounded bg-white w-full"
                                value={resolved.publicTalkSpeakerId || ""}
                                onChange={(e) => {
                                  const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                                  setResolvedAssignments(prev => ({
                                    ...prev,
                                    [m.weekOf]: {
                                      ...prev[m.weekOf],
                                      publicTalkSpeakerId: val,
                                    }
                                  }));
                                }}
                              >
                                <option value="">-- Unassigned --</option>
                                {assignees.map(a => (
                                  <option key={a.id} value={a.id}>{a.name}</option>
                                ))}
                              </select>
                            ) : (
                              <div className="space-y-1">
                                <input
                                  type="text"
                                  className="text-xs p-1 border border-slate-300 rounded w-full"
                                  placeholder="Speaker Name"
                                  value={resolved.rawSpeaker || ""}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setResolvedAssignments(prev => ({
                                      ...prev,
                                      [m.weekOf]: {
                                        ...prev[m.weekOf],
                                        rawSpeaker: val,
                                      }
                                    }));
                                  }}
                                />
                                <input
                                  type="text"
                                  className="text-[10px] p-1 border border-slate-300 rounded w-full"
                                  placeholder="Congregation"
                                  value={resolved.rawSpeakerCongregation || ""}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setResolvedAssignments(prev => ({
                                      ...prev,
                                      [m.weekOf]: {
                                        ...prev[m.weekOf],
                                        rawSpeakerCongregation: val,
                                      }
                                    }));
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Chairman */}
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">
                            Chairman
                          </label>
                          <select
                            className="text-xs p-1 border border-slate-300 rounded bg-white w-full"
                            value={resolved.publicTalkChairmanId || ""}
                            onChange={(e) => {
                              const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                              setResolvedAssignments(prev => ({
                                ...prev,
                                [m.weekOf]: {
                                  ...prev[m.weekOf],
                                  publicTalkChairmanId: val,
                                }
                              }));
                            }}
                          >
                            <option value="">-- Unassigned --</option>
                            {assignees.map(a => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                          <span className="text-[10px] text-slate-400 italic block mt-0.5">
                            Parsed: {m.rawChairman || "none"}
                          </span>
                        </div>

                        {/* Conductor */}
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">
                            WT Conductor
                          </label>
                          <select
                            className="text-xs p-1 border border-slate-300 rounded bg-white w-full"
                            value={resolved.watchtowerConductorId || ""}
                            onChange={(e) => {
                              const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                              setResolvedAssignments(prev => ({
                                ...prev,
                                [m.weekOf]: {
                                  ...prev[m.weekOf],
                                  watchtowerConductorId: val,
                                }
                              }));
                            }}
                          >
                            <option value="">-- Unassigned --</option>
                            {assignees.map(a => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                          <span className="text-[10px] text-slate-400 italic block mt-0.5">
                            Parsed: {m.rawConductor || "none"}
                          </span>
                        </div>

                        {/* Reader */}
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">
                            WT Reader
                          </label>
                          <select
                            className="text-xs p-1 border border-slate-300 rounded bg-white w-full"
                            value={resolved.watchtowerReaderId || ""}
                            onChange={(e) => {
                              const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                              setResolvedAssignments(prev => ({
                                ...prev,
                                [m.weekOf]: {
                                  ...prev[m.weekOf],
                                  watchtowerReaderId: val,
                                }
                              }));
                            }}
                          >
                            <option value="">-- Unassigned --</option>
                            {assignees.map(a => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                          <span className="text-[10px] text-slate-400 italic block mt-0.5">
                            Parsed: {m.rawReader || "none"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 mt-4">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {parsed && (
            <button className="btn" onClick={handleImport}>
              Import {parsed.length} Weeks
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
