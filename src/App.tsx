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
      <header style={{ backgroundColor: '#222' }} className="text-white">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
          <button
            onClick={() => setTab("dashboard")}
            className="py-3 text-left hover:opacity-80 transition-opacity focus:outline-none"
          >
            <h1 className="font-semibold text-base leading-tight text-white">
              Life &amp; Ministry Meeting
            </h1>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Midweek Meeting Assignment Scheduler
            </p>
          </button>
          <nav className="hidden md:flex items-center">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  "px-3 py-2 text-sm font-medium transition-colors duration-150 " +
                  (tab === t.id
                    ? "text-white border-b-2 border-white"
                    : "text-gray-400 hover:text-white border-b-2 border-transparent")
                }
              >
                {t.label}
              </button>
            ))}
          </nav>
          {/* Mobile nav */}
          <select
            className="md:hidden text-white text-sm px-2 py-1.5 border border-gray-600 focus:outline-none"
            style={{ backgroundColor: '#333', borderRadius: '3px' }}
            value={tab === "profile" ? "enrollees" : tab}
            onChange={(e) => setTab(e.target.value as Tab)}
          >
            {TABS.map((t) => (
              <option key={t.id} value={t.id}>
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
