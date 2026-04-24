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
    <div className="min-h-screen flex flex-col">
      <header className="bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setTab("dashboard")}
            className="text-left hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-white/40 rounded-md"
          >
            <h1 className="font-semibold text-lg leading-tight">
              Life &amp; Ministry Meeting
            </h1>
            <p className="text-xs text-slate-300">
              Smart weekly assignment scheduler
            </p>
          </button>
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
      <footer className="text-center text-xs text-slate-400 pb-4">
        All data is stored locally in your browser (IndexedDB).
      </footer>
    </div>
  );
}
