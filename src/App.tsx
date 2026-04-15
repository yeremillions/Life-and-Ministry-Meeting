import { useEffect, useState } from "react";
import { ensureSettings } from "./db";
import Dashboard from "./pages/Dashboard";
import EnrolleesPage from "./pages/EnrolleesPage";
import SchedulePage from "./pages/SchedulePage";
import ReportsPage from "./pages/ReportsPage";
import SettingsPage from "./pages/SettingsPage";

type Tab = "dashboard" | "enrollees" | "schedule" | "reports" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "enrollees", label: "Enrollees" },
  { id: "schedule", label: "Schedule" },
  { id: "reports", label: "Reports" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");

  useEffect(() => {
    ensureSettings().catch((e) => console.error("settings init", e));
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-lg leading-tight">
              Life &amp; Ministry Meeting
            </h1>
            <p className="text-xs text-slate-300">
              Smart weekly assignment scheduler
            </p>
          </div>
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  "px-3 py-1.5 rounded-md text-sm font-medium " +
                  (tab === t.id
                    ? "bg-white text-slate-900"
                    : "text-slate-200 hover:bg-slate-800")
                }
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        {tab === "dashboard" && <Dashboard onNavigate={setTab} />}
        {tab === "enrollees" && <EnrolleesPage />}
        {tab === "schedule" && <SchedulePage />}
        {tab === "reports" && <ReportsPage />}
        {tab === "settings" && <SettingsPage />}
      </main>
      <footer className="text-center text-xs text-slate-400 pb-4">
        All data is stored locally in your browser (IndexedDB).
      </footer>
    </div>
  );
}
