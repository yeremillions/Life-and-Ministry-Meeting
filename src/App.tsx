import { useEffect, useState } from "react";
import { ensureSettings } from "./db";
import { sendHeartbeat } from "./telemetry";
import Dashboard from "./pages/Dashboard";
import EnrolleesPage from "./pages/EnrolleesPage";
import SchedulePage from "./pages/SchedulePage";
import ReportsPage from "./pages/ReportsPage";
import SettingsPage from "./pages/SettingsPage";
import EnrolleeProfile from "./pages/EnrolleeProfile";
import HelpPage from "./pages/HelpPage";
import AdminPage from "./pages/AdminPage";
import ConflictsPage from "./pages/ConflictsPage";
import WeekendPage from "./pages/WeekendPage";

type Tab = "dashboard" | "enrollees" | "schedule" | "weekend" | "reports" | "settings" | "help" | "admin" | "profile" | "conflicts";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "enrollees", label: "Enrollees" },
  { id: "schedule", label: "Schedule" },
  { id: "weekend", label: "Weekend" },
  { id: "reports", label: "Reports" },
  { id: "settings", label: "Settings" },
  { id: "help", label: "Help" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get("tab") as Tab | null;
    if (urlTab) return urlTab;
    const saved = localStorage.getItem("current_tab");
    return (saved as Tab) || "dashboard";
  });
  const [scheduleWeekId, setScheduleWeekId] = useState<number | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get("tab");
    if (urlTab === "schedule") {
      const wId = params.get("weekId");
      if (wId) return parseInt(wId, 10);
    }
    const saved = localStorage.getItem("schedule_week_id");
    return saved ? parseInt(saved, 10) : null;
  });
  const [schedulePeriodKey, setSchedulePeriodKey] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get("tab");
    if (urlTab === "schedule") {
      return params.get("periodKey");
    }
    const saved = localStorage.getItem("schedule_period_key");
    return saved || null;
  });
  const [profileEnrolleeId, setProfileEnrolleeId] = useState<number | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get("tab");
    if (urlTab === "profile") {
      const pId = params.get("profileId");
      if (pId) return parseInt(pId, 10);
    }
    const saved = localStorage.getItem("profile_enrollee_id");
    return saved ? parseInt(saved, 10) : null;
  });

  useEffect(() => {
    localStorage.setItem("current_tab", tab);
    if (scheduleWeekId !== null) {
      localStorage.setItem("schedule_week_id", String(scheduleWeekId));
    }
    if (schedulePeriodKey !== null) {
      localStorage.setItem("schedule_period_key", schedulePeriodKey);
    } else {
      localStorage.removeItem("schedule_period_key");
    }
    if (profileEnrolleeId !== null) {
      localStorage.setItem("profile_enrollee_id", String(profileEnrolleeId));
    } else {
      localStorage.removeItem("profile_enrollee_id");
    }
  }, [tab, scheduleWeekId, schedulePeriodKey, profileEnrolleeId]);

  // Sync state changes to URL query params
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (tab === "schedule") {
      if (scheduleWeekId !== null) {
        params.set("weekId", String(scheduleWeekId));
      }
      if (schedulePeriodKey !== null) {
        params.set("periodKey", schedulePeriodKey);
      }
    }
    if (tab === "profile" && profileEnrolleeId !== null) {
      params.set("profileId", String(profileEnrolleeId));
    }
    const newSearch = params.toString();
    const currentSearch = window.location.search.substring(1);
    if (newSearch !== currentSearch) {
      window.history.pushState(null, "", "?" + newSearch);
    }
  }, [tab, scheduleWeekId, schedulePeriodKey, profileEnrolleeId]);

  // Handle browser Back / Forward buttons
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const urlTab = params.get("tab") as Tab | null;
      if (urlTab) {
        setTab(urlTab);
        if (urlTab === "schedule") {
          const wId = params.get("weekId");
          setScheduleWeekId(wId ? parseInt(wId, 10) : null);
          const pKey = params.get("periodKey");
          setSchedulePeriodKey(pKey || null);
        } else if (urlTab === "profile") {
          const pId = params.get("profileId");
          setProfileEnrolleeId(pId ? parseInt(pId, 10) : null);
        }
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    ensureSettings().catch((e) => console.error("settings init", e));
    // Fire telemetry heartbeat (no-ops if Supabase is not configured)
    sendHeartbeat();
  }, []);

  function navigate(t: Tab, weekId?: number, periodKey?: string) {
    setTab(t);
    if (t === "schedule") {
      if (weekId != null) {
        setScheduleWeekId(weekId);
        setSchedulePeriodKey(null);
      } else if (periodKey != null) {
        setSchedulePeriodKey(periodKey);
        setScheduleWeekId(null);
      }
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
          <a
            href="?tab=dashboard"
            onClick={(e) => {
              if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                setTab("dashboard");
              }
            }}
            className="py-3 text-left hover:opacity-80 transition-opacity focus:outline-none"
          >
            <h1 className="font-semibold text-base leading-tight text-white">
              Life &amp; Ministry Meeting
            </h1>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Midweek Meeting Assignment Scheduler
            </p>
          </a>
          <nav className="hidden md:flex items-center">
            {TABS.map((t) => (
              <a
                key={t.id}
                href={`?tab=${t.id}`}
                onClick={(e) => {
                  if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
                    e.preventDefault();
                    setTab(t.id);
                  }
                }}
                className={
                  "px-3 py-2 text-sm font-medium transition-colors duration-150 " +
                  (tab === t.id
                    ? "text-white border-b-2 border-white"
                    : "text-gray-400 hover:text-white border-b-2 border-transparent")
                }
              >
                {t.label}
              </a>
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
            initialPeriodKey={schedulePeriodKey}
            onPeriodKeyChange={setSchedulePeriodKey}
            onNavigateToProfile={navigateToProfile}
          />
        )}
        {tab === "weekend" && (
          <WeekendPage />
        )}
        {tab === "reports" && (
          <ReportsPage
            onNavigateToProfile={navigateToProfile}
            onNavigateToSchedule={(weekId) => navigate("schedule", weekId)}
          />
        )}
        {tab === "settings" && <SettingsPage onNavigateToAdmin={() => setTab("admin")} />}
        {tab === "help" && <HelpPage />}
        {tab === "admin" && <AdminPage />}
        {tab === "conflicts" && (
          <ConflictsPage
            onBack={() => setTab("dashboard")}
            onNavigate={navigate}
            onNavigateToProfile={navigateToProfile}
          />
        )}
        {tab === "profile" && profileEnrolleeId !== null && (
          <EnrolleeProfile 
            id={profileEnrolleeId} 
            onBack={() => setTab("enrollees")} 
            onNavigateToProfile={navigateToProfile}
            onNavigateToSchedule={(weekId) => navigate("schedule", weekId)}
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
