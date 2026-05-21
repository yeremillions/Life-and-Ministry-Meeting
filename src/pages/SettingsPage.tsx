import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState, useRef } from "react";
import { db, ensureSettings } from "../db";
import {
  DEFAULT_ASSIGNMENT_RULES,
  DEFAULT_SETTINGS,
  type AppSettings,
  type AssignmentRule,
  type Gender,
  type Privilege,
} from "../types";
import { addLog } from "../db";
import { isPrivileged } from "../meeting";

export default function SettingsPage({
  onNavigateToAdmin,
}: {
  onNavigateToAdmin?: () => void;
}) {
  const settings = useLiveQuery(() => db.settings.get("app"), []);
  const logs = useLiveQuery(() => db.logs.orderBy("timestamp").reverse().toArray(), []) ?? [];
  const assignees = useLiveQuery(() => db.assignees.orderBy("name").toArray(), []) ?? [];
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  // Prayer overrides states
  const [excludeSearch, setExcludeSearch] = useState("");
  const [includeSearch, setIncludeSearch] = useState("");
  const [excludeDropdownOpen, setExcludeDropdownOpen] = useState(false);
  const [includeDropdownOpen, setIncludeDropdownOpen] = useState(false);

  const excludeRef = useRef<HTMLDivElement>(null);
  const includeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (excludeRef.current && !excludeRef.current.contains(event.target as Node)) {
        setExcludeDropdownOpen(false);
      }
      if (includeRef.current && !includeRef.current.contains(event.target as Node)) {
        setIncludeDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    ensureSettings().then((s) => setDraft(s));
  }, []);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  async function save() {
    if (!draft) return;
    await db.settings.put(draft);
    await addLog("settings", "Saved settings changes");
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function wipeAll() {
    if (
      !confirm(
        "Erase ALL enrollees, weeks, and settings? This cannot be undone."
      )
    )
      return;
    await db.transaction("rw", db.assignees, db.weeks, db.settings, async () => {
      await db.assignees.clear();
      await db.weeks.clear();
      await db.settings.clear();
    });
    await ensureSettings();
    window.location.reload();
  }

  async function restoreDefaults() {
    if (!confirm("Reset all settings to defaults? Rules will be restored.")) return;
    setDraft(DEFAULT_SETTINGS);
    await db.settings.put(DEFAULT_SETTINGS);
    await addLog("settings", "Restored default settings");
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function exportBackup() {
    const [assignees, weeks, s] = await Promise.all([
      db.assignees.toArray(),
      db.weeks.toArray(),
      db.settings.toArray(),
    ]);
    const blob = new Blob(
      [JSON.stringify({ assignees, weeks, settings: s }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting-scheduler-backup-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function restoreBackup(file: File) {
    const text = await file.text();
    let parsed: { assignees: unknown[]; weeks: unknown[]; settings: unknown[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      alert("Invalid backup file.");
      return;
    }
    if (!confirm("Replace all current data with contents of this backup?")) return;
    await db.transaction("rw", db.assignees, db.weeks, db.settings, async () => {
      await db.assignees.clear();
      await db.weeks.clear();
      await db.settings.clear();
      if (Array.isArray(parsed.assignees))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.assignees.bulkAdd(parsed.assignees as any[]);
      if (Array.isArray(parsed.weeks))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.weeks.bulkAdd(parsed.weeks as any[]);
      if (Array.isArray(parsed.settings))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.settings.bulkAdd(parsed.settings as any[]);
    });
    await ensureSettings();
    window.location.reload();
  }

  if (!draft) return null;

  // Prayer overrides lists and candidates
  const excludedBrothers = assignees.filter((a) => a.gender === "M" && a.excludeFromPrayers);
  const includedBrothers = assignees.filter((a) => a.gender === "M" && a.includeInPrayers);

  const excludeCandidates = assignees.filter((a) => {
    if (a.gender !== "M" || !a.active) return false;
    const hasPriv = isPrivileged(a) || a.privileges?.includes("CBSR");
    if (!hasPriv) return false;
    if (a.excludeFromPrayers) return false;
    if (!excludeSearch.trim()) return true;
    return a.name.toLowerCase().includes(excludeSearch.toLowerCase());
  });

  const includeCandidates = assignees.filter((a) => {
    if (a.gender !== "M" || !a.active) return false;
    const hasPriv = isPrivileged(a) || a.privileges?.includes("CBSR");
    if (hasPriv) return false;
    if (a.includeInPrayers) return false;
    if (!includeSearch.trim()) return true;
    return a.name.toLowerCase().includes(includeSearch.toLowerCase());
  });

  // Pagination calculations
  const totalItems = logs.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedLogs = logs.slice(startIndex, endIndex);

  const pageNumbers: number[] = [];
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }
  for (let i = startPage; i <= endPage; i++) {
    pageNumbers.push(i);
  }

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-800">General Settings</h2>
          <button className="btn-secondary text-xs" onClick={restoreDefaults}>
            Restore Defaults
          </button>
        </div>
        <div>
          <label className="label">Congregation name</label>
          <input
            className="input max-w-md"
            value={draft.congregationName ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, congregationName: e.target.value })
            }
          />
        </div>
        <div>
          <label className="label">
            Share of Field Ministry parts that may go to E / QE / MS / QMS (%)
          </label>
          <input
            type="number"
            min={0}
            max={100}
            className="input max-w-xs"
            value={draft.privilegedMinistryShare}
            onChange={(e) =>
              setDraft({
                ...draft,
                privilegedMinistryShare: clamp(
                  parseInt(e.target.value || "0", 10),
                  0,
                  100
                ),
              })
            }
          />
          <p className="text-xs text-slate-500 mt-1">
            Default is 10%. Elders and ministerial servants are normally
            assigned to Treasures and Living-as-Christians; this cap limits how
            often they take Ministry demos.
          </p>
        </div>

        <hr className="border-slate-200" />
        <h3 className="font-semibold text-slate-700">Scheduler Fairness</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Minimum gap between assignments (weeks)</label>
            <input
              type="number"
              min={0}
              max={8}
              className="input max-w-xs"
              value={draft.minGapWeeks ?? 2}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  minGapWeeks: clamp(parseInt(e.target.value || "0", 10), 0, 8),
                })
              }
            />
            <p className="text-xs text-slate-500 mt-1">
              The scheduler will not assign the same person a main part
              until at least this many weeks have passed. Set to 0 to disable.
            </p>
          </div>

          <div>
            <label className="label">Chairman rotation gap (weeks)</label>
            <input
              type="number"
              min={1}
              max={8}
              className="input max-w-xs"
              value={draft.chairmanGapWeeks ?? 3}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  chairmanGapWeeks: clamp(parseInt(e.target.value || "1", 10), 1, 8),
                })
              }
            />
            <p className="text-xs text-slate-500 mt-1">
              Minimum weeks before the same elder can chair again.
            </p>
          </div>

          <div>
            <label className="label">Catch-up priority for overlooked publishers</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={5}
                className="flex-1"
                value={draft.catchUpIntensity ?? 1}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    catchUpIntensity: parseInt(e.target.value, 10),
                  })
                }
              />
              <span className="text-sm font-mono w-6 text-center">
                {draft.catchUpIntensity ?? 1}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              <strong>1 = equal rotation</strong> (default) — overlooked
              publishers simply join the normal pool alongside everyone
              else.{" "}
              <strong>3 = moderate</strong> — gives them a noticeable
              boost.{" "}
              <strong>5 = aggressive</strong> — fast-tracks them to the
              front of the queue. Increase only if you deliberately want
              to prioritise members who haven't had a part in a while.
            </p>
          </div>

          <div>
            <label className="label">Max assignments per month</label>
            <input
              type="number"
              min={0}
              max={8}
              className="input max-w-xs"
              value={draft.maxAssignmentsPerMonth ?? 2}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  maxAssignmentsPerMonth: clamp(
                    parseInt(e.target.value || "0", 10),
                    0,
                    8
                  ),
                })
              }
            />
            <p className="text-xs text-slate-500 mt-1">
              Limits the total main assignments any one person can receive in a
              rolling 4-week window. Set to 0 to disable.
            </p>
          </div>

          <div>
            <label className="label">Optimization Threshold (Main Role)</label>
            <input
              type="number"
              min={0}
              max={100}
              className="input max-w-xs"
              value={draft.optimizationThresholdMain ?? 50}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  optimizationThresholdMain: clamp(
                    parseInt(e.target.value || "50", 10),
                    0,
                    100
                  ),
                })
              }
            />
            <p className="text-xs text-slate-500 mt-1">
              Minimum score difference required for the system to suggest replacing a main assignee. Higher values mean fewer, more impactful suggestions. Default is 50.
            </p>
          </div>

          <div>
            <label className="label">Optimization Threshold (Assistant Role)</label>
            <input
              type="number"
              min={0}
              max={100}
              className="input max-w-xs"
              value={draft.optimizationThresholdAssistant ?? 40}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  optimizationThresholdAssistant: clamp(
                    parseInt(e.target.value || "40", 10),
                    0,
                    100
                  ),
                })
              }
            />
            <p className="text-xs text-slate-500 mt-1">
              Minimum score difference required for the system to suggest replacing an assistant. Default is 40.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-4">
            <input
              type="checkbox"
              id="preventMinorAssistantToAdult"
              className="checkbox w-5 h-5"
              checked={draft.preventMinorAssistantToAdult}
              onChange={(e) =>
                setDraft({ ...draft, preventMinorAssistantToAdult: e.target.checked })
              }
            />
            <label htmlFor="preventMinorAssistantToAdult" className="font-semibold text-slate-700 cursor-pointer">
              Prevent minors from assisting adults
            </label>
          </div>
          <p className="text-xs text-slate-500 col-span-full">
            If enabled, the scheduler will never assign a minor as an assistant to an adult main participant in the field ministry section. Adults will also be strongly preferred as assistants for minors.
          </p>
        </div>

        <div>
          <button className="btn" onClick={save}>
            Save settings
          </button>
          {saved && (
            <span
              className="inline-flex items-center gap-1 text-sm font-medium ml-3 animate-fade-in"
              style={{ color: 'var(--treasures)' }}
            >
              ✓ Settings saved
            </span>
          )}
        </div>
      </div>

      {/* ── Prayer Overrides Section ── */}
      <div className="card space-y-4 relative">
        <h2 className="text-xl font-bold text-slate-800">Manual Prayer Qualifications</h2>
        <p className="text-sm text-slate-500">
          Only Elders, Ministerial Servants, and Congregation Bible Study Readers (CBSR) are qualified to offer Opening and Closing Prayer by default. You can manually exclude privileged brothers, or manually include non-privileged brothers.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {/* Exclude List */}
          <div className="space-y-3 p-4 bg-slate-50/50 rounded-xl border border-slate-100 flex flex-col">
            <h3 className="font-semibold text-slate-800 flex items-center justify-between">
              <span>Manually Excluded (Privileged)</span>
              <span className="pill bg-rose-50 text-rose-700 text-xs font-bold border border-rose-100">
                {excludedBrothers.length} Excluded
              </span>
            </h3>
            
            {/* Search and Add */}
            <div ref={excludeRef} className="relative">
              <input
                type="text"
                placeholder="Search privileged brothers to exclude..."
                className="input text-sm"
                value={excludeSearch}
                onChange={(e) => {
                  setExcludeSearch(e.target.value);
                  setExcludeDropdownOpen(true);
                }}
                onFocus={() => setExcludeDropdownOpen(true)}
              />
              {excludeDropdownOpen && excludeSearch.trim() && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {excludeCandidates.length === 0 ? (
                    <div className="p-3 text-xs text-slate-400">No eligible brothers found.</div>
                  ) : (
                    excludeCandidates.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between"
                        onClick={async () => {
                          if (a.id != null) {
                            await db.assignees.update(a.id, { excludeFromPrayers: true, includeInPrayers: false });
                            await addLog("settings", `Manually excluded ${a.name} from prayers`);
                          }
                          setExcludeSearch("");
                          setExcludeDropdownOpen(false);
                        }}
                      >
                        <span className="font-medium text-slate-700">{a.name}</span>
                        <div className="flex gap-1">
                          {(a.privileges ?? []).map((p) => (
                            <span key={p} className="pill bg-slate-100 text-slate-600 text-[10px] font-semibold border border-slate-200">
                              {p}
                            </span>
                          ))}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* List of currently excluded */}
            <div className="min-h-[100px] max-h-56 overflow-y-auto border border-slate-200 rounded-lg bg-white divide-y divide-slate-100 custom-scrollbar flex-1">
              {excludedBrothers.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400 italic">No manual exclusions.</div>
              ) : (
                excludedBrothers.map((a) => (
                  <div key={a.id} className="flex items-center justify-between p-2.5 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-700">{a.name}</span>
                      <div className="flex gap-0.5">
                        {(a.privileges ?? []).map((p) => (
                          <span key={p} className="pill bg-amber-50 text-amber-700 text-[9px] font-bold border border-amber-100">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-rose-500 hover:text-rose-700 font-semibold px-2 py-1 rounded hover:bg-rose-50 transition-colors"
                      onClick={async () => {
                        if (a.id != null) {
                          await db.assignees.update(a.id, { excludeFromPrayers: false });
                          await addLog("settings", `Removed prayer exclusion for ${a.name}`);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Include List */}
          <div className="space-y-3 p-4 bg-slate-50/50 rounded-xl border border-slate-100 flex flex-col">
            <h3 className="font-semibold text-slate-800 flex items-center justify-between">
              <span>Manually Included (Non-Privileged)</span>
              <span className="pill bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-100">
                {includedBrothers.length} Included
              </span>
            </h3>
            
            {/* Search and Add */}
            <div ref={includeRef} className="relative">
              <input
                type="text"
                placeholder="Search non-privileged brothers to include..."
                className="input text-sm"
                value={includeSearch}
                onChange={(e) => {
                  setIncludeSearch(e.target.value);
                  setIncludeDropdownOpen(true);
                }}
                onFocus={() => setIncludeDropdownOpen(true)}
              />
              {includeDropdownOpen && includeSearch.trim() && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {includeCandidates.length === 0 ? (
                    <div className="p-3 text-xs text-slate-400">No eligible brothers found.</div>
                  ) : (
                    includeCandidates.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between"
                        onClick={async () => {
                          if (a.id != null) {
                            await db.assignees.update(a.id, { includeInPrayers: true, excludeFromPrayers: false });
                            await addLog("settings", `Manually included ${a.name} in prayers`);
                          }
                          setIncludeSearch("");
                          setIncludeDropdownOpen(false);
                        }}
                      >
                        <span className="font-medium text-slate-700">{a.name}</span>
                        <span className="text-[10px] text-slate-400">Publisher</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* List of currently included */}
            <div className="min-h-[100px] max-h-56 overflow-y-auto border border-slate-200 rounded-lg bg-white divide-y divide-slate-100 custom-scrollbar flex-1">
              {includedBrothers.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400 italic">No manual inclusions.</div>
              ) : (
                includedBrothers.map((a) => (
                  <div key={a.id} className="flex items-center justify-between p-2.5 hover:bg-slate-50 transition-colors">
                    <span className="text-sm font-medium text-slate-700">{a.name}</span>
                    <button
                      type="button"
                      className="text-xs text-rose-500 hover:text-rose-700 font-semibold px-2 py-1 rounded hover:bg-rose-50 transition-colors"
                      onClick={async () => {
                        if (a.id != null) {
                          await db.assignees.update(a.id, { includeInPrayers: false });
                          await addLog("settings", `Removed prayer inclusion for ${a.name}`);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="text-xl font-bold text-slate-800">Assignment Eligibility Rules</h2>
        <p className="text-sm text-slate-500">
          Configure who can be assigned to each part type. "Main" refers to the primary person (e.g. Conductor, Speaker), and "Assistant" refers to the secondary person (e.g. Reader, Householder).
        </p>

        <div className="overflow-x-auto -mx-6 sm:mx-0">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase font-bold border-y border-slate-100">
                <th className="py-2 px-6">Part Type</th>
                <th className="py-2 px-6">Role</th>
                <th className="py-2 px-6">Allowed Genders</th>
                <th className="py-2 px-6">Must be Baptized</th>
                <th className="py-2 px-6">Required Privileges</th>
              </tr>
            </thead>
            <tbody className="text-sm divide-y divide-slate-50">
              {Object.keys(DEFAULT_ASSIGNMENT_RULES).map((partType) => (
                <RuleRows
                  key={partType}
                  partType={partType}
                  rule={draft.assignmentRules?.[partType] || DEFAULT_ASSIGNMENT_RULES[partType]}
                  onChange={(r) => {
                    setDraft({
                      ...draft,
                      assignmentRules: { ...draft.assignmentRules, [partType]: r },
                    });
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Backup &amp; restore</h2>
        <p className="text-sm text-slate-600">
          All data lives in your browser. Use backup + restore to move between
          devices or keep a safety copy.
        </p>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary" onClick={exportBackup}>
            Download backup (.json)
          </button>
          <label className="btn-secondary cursor-pointer">
            Restore from backup
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) restoreBackup(f);
              }}
            />
          </label>
          <button className="btn-danger ml-auto" onClick={wipeAll}>
            Erase all data
          </button>
        </div>
      </div>

      <section id="changelog" className="mt-12 mb-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-slate-800">Change Log</h2>
          <span className="pill bg-slate-100 text-slate-600 text-xs font-semibold">
            Page {currentPage} of {totalPages} ({logs.length} entries)
          </span>
        </div>

        <div className="card p-0 overflow-hidden border-slate-200 shadow-sm">
          {logs.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-slate-500">No activity logged yet.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="py-3 px-5 text-left font-semibold text-slate-600 w-48">Date & Time</th>
                      <th className="py-3 px-5 text-left font-semibold text-slate-600 w-32">Category</th>
                      <th className="py-3 px-5 text-left font-semibold text-slate-600">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-3 px-5 text-slate-500 font-mono text-[13px]">
                          {new Date(log.timestamp).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-3 px-5">
                          <span className={`pill text-[10px] font-bold uppercase tracking-wider ${
                            log.category === "settings" ? "bg-amber-50 text-amber-700 border border-amber-100" :
                            log.category === "schedule" ? "bg-indigo-50 text-indigo-700 border border-indigo-100" :
                            log.category === "enrollees" ? "bg-emerald-50 text-emerald-700 border border-emerald-100" :
                            "bg-slate-50 text-slate-600 border border-slate-200"
                          }`}>
                            {log.category}
                          </span>
                        </td>
                        <td className="py-3 px-5">
                          <div className="font-medium text-slate-800">{log.action}</div>
                          {log.details && (
                            <div className="text-xs text-slate-500 mt-0.5">{log.details}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Clean and beautiful pagination footer */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-4 py-3 sm:px-6">
                  <div className="flex flex-1 justify-between sm:hidden">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                      disabled={currentPage === 1}
                      className="btn-secondary text-xs py-1"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      className="btn-secondary text-xs py-1"
                    >
                      Next
                    </button>
                  </div>
                  <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs text-slate-500">
                        Showing <span className="font-semibold text-slate-700">{startIndex + 1}</span> to{" "}
                        <span className="font-semibold text-slate-700">
                          {Math.min(endIndex, totalItems)}
                        </span>{" "}
                        of <span className="font-semibold text-slate-700">{totalItems}</span> entries
                      </p>
                    </div>
                    <div>
                      <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm bg-white" aria-label="Pagination">
                        <button
                          onClick={() => setCurrentPage(1)}
                          disabled={currentPage === 1}
                          className="relative inline-flex items-center rounded-l-md px-2 py-1.5 text-xs font-semibold text-slate-500 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed bg-white"
                        >
                          « First
                        </button>
                        <button
                          onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                          disabled={currentPage === 1}
                          className="relative inline-flex items-center px-2 py-1.5 text-xs font-semibold text-slate-500 border-y border-r border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed bg-white"
                        >
                          ‹ Prev
                        </button>
                        {pageNumbers.map((page) => (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            style={page === currentPage ? { backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)' } : undefined}
                            className={`relative inline-flex items-center px-3 py-1.5 text-xs font-semibold border-y border-r ${
                              page === currentPage
                                ? "z-10 text-white"
                                : "text-slate-700 border-slate-200 hover:bg-slate-50 bg-white"
                            }`}
                          >
                            {page}
                          </button>
                        ))}
                        <button
                          onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                          disabled={currentPage === totalPages}
                          className="relative inline-flex items-center px-2 py-1.5 text-xs font-semibold text-slate-500 border-y border-r border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed bg-white"
                        >
                          Next ›
                        </button>
                        <button
                          onClick={() => setCurrentPage(totalPages)}
                          disabled={currentPage === totalPages}
                          className="relative inline-flex items-center rounded-r-md px-2 py-1.5 text-xs font-semibold text-slate-500 border-y border-r border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed bg-white"
                        >
                          Last »
                        </button>
                      </nav>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <p className="text-center text-[10px] text-slate-400 mt-4 italic">
          The change log automatically prunes old entries beyond 500 records.
        </p>
      </section>

      {onNavigateToAdmin && (
        <div className="text-right">
          <button
            className="text-xs text-gray-400 hover:text-gray-600 hover:underline transition-colors"
            onClick={onNavigateToAdmin}
          >
            Admin
          </button>
        </div>
      )}
    </div>
  );
}

function RuleRows({
  partType,
  rule,
  onChange,
}: {
  partType: string;
  rule: AssignmentRule;
  onChange: (r: AssignmentRule) => void;
}) {
  const ALL_PRIVILEGES: Privilege[] = ["QE", "E", "QMS", "MS", "RP", "CBSR"];

  const renderRow = (
    label: string,
    target: {
      allowedGenders: Gender[];
      mustBeBaptized: boolean;
      requiredPrivileges: Privilege[];
    },
    update: (fields: Partial<typeof target>) => void
  ) => (
    <tr>
      <td className="py-2 px-6 font-medium text-slate-700">{label === "Talk" ? "Treasures Talk" : label === "Congregation Bible Study-assistant" ? "Congregation Bible Study Reader" : label}</td>
      <td className="py-2 px-6 text-slate-500 italic">
        {label === partType ? "Main" : "Assistant"}
      </td>
      <td className="py-2 px-6">
        <div className="flex gap-3">
          {["M", "F"].map((g) => (
            <label
              key={g}
              className="inline-flex items-center gap-1.5 cursor-pointer"
            >
              <input
                type="checkbox"
                className="checkbox"
                checked={(target?.allowedGenders ?? []).includes(g as Gender)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...(target?.allowedGenders ?? []), g as Gender]
                    : (target?.allowedGenders ?? []).filter((x) => x !== g);
                  update({ allowedGenders: next });
                }}
              />
              <span className="text-xs font-bold">{g}</span>
            </label>
          ))}
        </div>
      </td>
      <td className="py-2 px-6">
        <input
          type="checkbox"
          className="checkbox"
          checked={target?.mustBeBaptized ?? false}
          onChange={(e) => update({ mustBeBaptized: e.target.checked })}
        />
      </td>
      <td className="py-2 px-6">
        <div className="flex flex-wrap gap-2">
          {ALL_PRIVILEGES.map((p) => (
            <label
              key={p}
              className="inline-flex items-center gap-1 cursor-pointer"
            >
              <input
                type="checkbox"
                className="checkbox w-3 h-3"
                checked={(target?.requiredPrivileges ?? []).includes(p)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...(target?.requiredPrivileges ?? []), p]
                    : (target?.requiredPrivileges ?? []).filter((x) => x !== p);
                  update({ requiredPrivileges: next });
                }}
              />
              <span className="text-[10px] font-mono">{p}</span>
            </label>
          ))}
        </div>
      </td>
    </tr>
  );

  return (
    <>
      {renderRow(partType, rule, (fields) => onChange({ ...rule, ...fields }))}
      {rule?.assistant &&
        renderRow(partType + "-assistant", rule.assistant, (fields) =>
          onChange({
            ...rule,
            assistant: { ...rule.assistant!, ...fields },
          })
        )}
    </>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
