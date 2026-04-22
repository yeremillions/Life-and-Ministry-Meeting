import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db, ensureSettings } from "../db";
import type { AppSettings } from "../types";
import { testGeminiKey } from "../aiService";

export default function SettingsPage() {
  const settings = useLiveQuery(() => db.settings.get("app"), []);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    ensureSettings().then((s) => setDraft(s));
  }, []);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  async function testKey() {
    if (!draft?.geminiApiKey?.trim()) return;
    setTestStatus("testing");
    setTestError(null);
    try {
      await testGeminiKey(draft.geminiApiKey.trim());
      setTestStatus("ok");
    } catch (e) {
      setTestStatus("error");
      setTestError(e instanceof Error ? e.message : "Connection failed.");
    }
  }

  async function save() {
    if (!draft) return;
    await db.settings.put(draft);
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
        <div>
          <button className="btn" onClick={save}>
            Save settings
          </button>
        </div>
      </div>

      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold">AI integration</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Powered by Google Gemini. Your key is stored only in this browser and sent
            exclusively to Google's API.{" "}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-slate-700"
            >
              Get a free key at Google AI Studio
            </a>
            .
          </p>
        </div>
        <div>
          <label className="label">Gemini API key</label>
          <div className="flex gap-2 max-w-md">
            <div className="relative flex-1">
              <input
                className="input pr-16"
                type={showKey ? "text" : "password"}
                value={draft?.geminiApiKey ?? ""}
                placeholder="AIza..."
                onChange={(e) => {
                  setTestStatus("idle");
                  setDraft(draft ? { ...draft, geminiApiKey: e.target.value } : null);
                }}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-700"
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
            <button
              className="btn-secondary"
              onClick={testKey}
              disabled={!draft?.geminiApiKey?.trim() || testStatus === "testing"}
            >
              {testStatus === "testing" ? "Testing…" : "Test"}
            </button>
          </div>
          {testStatus === "ok" && (
            <p className="text-xs text-emerald-600 mt-1">Connected successfully.</p>
          )}
          {testStatus === "error" && (
            <p className="text-xs text-red-600 mt-1">{testError}</p>
          )}
          <p className="text-xs text-slate-500 mt-1">
            Unlocks: <b>schedule explanations</b> (why each person was auto-assigned)
            and <b>AI-enhanced import</b> (parse any roster format automatically).
          </p>
        </div>
        <div>
          <button className="btn" onClick={save}>
            Save settings
          </button>
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
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
