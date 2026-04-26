import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db, ensureSettings } from "../db";
import type { AppSettings } from "../types";

export default function SettingsPage({
  onNavigateToAdmin,
}: {
  onNavigateToAdmin?: () => void;
}) {
  const settings = useLiveQuery(() => db.settings.get("app"), []);
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
      <div className="card space-y-3">
        <h2 className="font-semibold">App settings</h2>
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
                  maxAssignmentsPerMonth: clamp(parseInt(e.target.value || "0", 10), 0, 8),
                })
              }
            />
            <p className="text-xs text-slate-500 mt-1">
              Maximum main assignments a person can receive in any 4-week
              period. Set to 0 for no limit.
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

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
