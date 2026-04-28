import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
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

export default function SettingsPage({
  onNavigateToAdmin,
}: {
  onNavigateToAdmin?: () => void;
}) {
  const settings = useLiveQuery(() => db.settings.get("app"), []);
  const logs = useLiveQuery(() => db.logs.orderBy("timestamp").reverse().toArray(), []) ?? [];
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);

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
            Last {logs.length} entries
          </span>
        </div>

        <div className="card p-0 overflow-hidden border-slate-200 shadow-sm">
          {logs.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-slate-500">No activity logged yet.</p>
            </div>
          ) : (
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
                  {logs.map((log) => (
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
                checked={target.allowedGenders.includes(g as Gender)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...target.allowedGenders, g as Gender]
                    : target.allowedGenders.filter((x) => x !== g);
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
          checked={target.mustBeBaptized}
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
                checked={target.requiredPrivileges.includes(p)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...target.requiredPrivileges, p]
                    : target.requiredPrivileges.filter((x) => x !== p);
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
      {rule.assistant &&
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
