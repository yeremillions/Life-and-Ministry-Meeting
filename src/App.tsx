import { useEffect, useState } from "react";
import { ensureSettings } from "./db";
import Dashboard from "./pages/Dashboard";
import EnrolleesPage from "./pages/EnrolleesPage";
import SchedulePage from "./pages/SchedulePage";
import ReportsPage from "./pages/ReportsPage";
import SettingsPage from "./pages/SettingsPage";
import EnrolleeProfile from "./pages/EnrolleeProfile";

type Tab = "dashboard" | "enrollees" | "schedule" | "reports" | "settings" | "profile";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "enrollees", label: "Enrollees" },
  { id: "schedule", label: "Schedule" },
  { id: "reports", label: "Reports" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [scheduleWeekId, setScheduleWeekId] = useState<number | null>(null);
  const [profileEnrolleeId, setProfileEnrolleeId] = useState<number | null>(null);

  useEffect(() => {
    ensureSettings().catch((e) => console.error("settings init", e));
  }, []);

  function navigate(t: Tab, weekId?: number) {
    setTab(t);
    if (t === "schedule" && weekId != null) {
      setScheduleWeekId(weekId);
    }
  }

  function navigateToProfile(id: number) {
    setProfileEnrolleeId(id);
    setTab("profile");
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-lg">
        <div className="max-w-6xl mx-auto px-4 py-0 flex items-center justify-between">
          <button
            onClick={() => setTab("dashboard")}
            className="py-3 text-left hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-white/30 rounded-md group"
          >
            <h1 className="font-bold text-lg leading-tight tracking-tight">
              Life &amp; Ministry Meeting
            </h1>
            <p className="text-[11px] text-slate-400 font-medium tracking-wide group-hover:text-slate-300 transition-colors">
              Midweek Meeting Assignment Scheduler
            </p>
          </button>
          <nav className="hidden md:flex items-center gap-0.5 bg-white/[0.06] rounded-lg p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  "px-3.5 py-1.5 rounded-md text-sm font-medium transition-all duration-150 " +
                  (tab === t.id
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-300 hover:text-white hover:bg-white/10")
                }
              >
                {t.label}
              </button>
            ))}
          </nav>
          {/* Mobile nav */}
          <select
            className="md:hidden bg-white/10 text-white text-sm rounded-lg px-2 py-1.5 border border-white/20 focus:outline-none"
            value={tab === "profile" ? "enrollees" : tab}
            onChange={(e) => setTab(e.target.value as Tab)}
          >
            {TABS.map((t) => (
              <option key={t.id} value={t.id} className="text-slate-900">
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        {tab === "dashboard" && (
          <Dashboard onNavigate={navigate} onNavigateToProfile={navigateToProfile} />
        )}
        {tab === "enrollees" && (
          <EnrolleesPage onNavigateToProfile={navigateToProfile} />
        )}
        {tab === "schedule" && (
          <SchedulePage
            initialWeekId={scheduleWeekId}
            onConsumeInitialWeek={() => setScheduleWeekId(null)}
            onNavigateToProfile={navigateToProfile}
          />
        )}
        {tab === "reports" && <ReportsPage onNavigateToProfile={navigateToProfile} />}
        {tab === "settings" && <SettingsPage />}
        {tab === "profile" && profileEnrolleeId !== null && (
          <EnrolleeProfile 
            id={profileEnrolleeId} 
            onBack={() => setTab("enrollees")} 
            onNavigateToProfile={navigateToProfile}
          />
        )}
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="text-center text-xs text-slate-400 py-4 border-t border-slate-200">
        <p>All data is stored locally in your browser.</p>
      </footer>
    </div>
  );
}
