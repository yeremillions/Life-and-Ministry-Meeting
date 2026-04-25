import { useEffect, useMemo, useState } from "react";
import { fetchHeartbeats, type HeartbeatRecord } from "../telemetry";

const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN as string | undefined;
const SESSION_KEY = "lm_admin_auth";

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [records, setRecords] = useState<HeartbeatRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if already authenticated this session
  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY) === "1") {
      setAuthenticated(true);
    }
  }, []);

  // Load data once authenticated
  useEffect(() => {
    if (!authenticated) return;
    setLoading(true);
    fetchHeartbeats()
      .then(setRecords)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [authenticated]);

  function handleLogin() {
    const expected = ADMIN_PIN || "admin123";
    if (pin === expected) {
      setAuthenticated(true);
      sessionStorage.setItem(SESSION_KEY, "1");
      setPinError(false);
    } else {
      setPinError(true);
    }
  }

  if (!authenticated) {
    return (
      <div className="max-w-sm mx-auto mt-12">
        <div className="card">
          <h2 className="font-semibold mb-3">Admin Access</h2>
          <p className="text-sm text-gray-500 mb-4">
            Enter the admin PIN to view usage statistics.
          </p>
          <div className="space-y-3">
            <input
              type="password"
              className="input"
              placeholder="Admin PIN"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setPinError(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
            {pinError && (
              <p className="text-xs text-red-600">Incorrect PIN. Try again.</p>
            )}
            <button className="btn w-full" onClick={handleLogin}>
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <AdminDashboard records={records} loading={loading} error={error} />;
}

/* ── Admin Dashboard ───────────────────────────────────────────────── */

function AdminDashboard({
  records,
  loading,
  error,
}: {
  records: HeartbeatRecord[];
  loading: boolean;
  error: string | null;
}) {
  const [timeRange, setTimeRange] = useState<"all" | "30d" | "7d">("30d");

  const filteredRecords = useMemo(() => {
    if (timeRange === "all") return records;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (timeRange === "7d" ? 7 : 30));
    return records.filter((r) => new Date(r.created_at) >= cutoff);
  }, [records, timeRange]);

  // Aggregate by congregation — take the latest heartbeat per congregation
  const congregations = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        lastSeen: string;
        enrollees: number;
        weeks: number;
        version: string;
        sessionCount: number;
      }
    >();

    for (const r of filteredRecords) {
      const key = r.congregation.toLowerCase().trim();
      const existing = map.get(key);
      if (!existing || new Date(r.created_at) > new Date(existing.lastSeen)) {
        map.set(key, {
          name: r.congregation,
          lastSeen: r.created_at,
          enrollees: r.enrollee_count,
          weeks: r.week_count,
          version: r.app_version,
          sessionCount: (existing?.sessionCount ?? 0) + 1,
        });
      } else {
        existing.sessionCount += 1;
      }
    }

    return [...map.values()].sort(
      (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
    );
  }, [filteredRecords]);

  // Stats
  const totalSessions = filteredRecords.length;
  const uniqueCongregations = congregations.length;
  const totalEnrollees = congregations.reduce((s, c) => s + c.enrollees, 0);

  // Active in last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const activeThisWeek = congregations.filter(
    (c) => new Date(c.lastSeen) >= sevenDaysAgo
  ).length;

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-gray-500">Loading usage data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ borderLeft: "3px solid #7b1928" }}>
        <h3 className="font-semibold text-sm mb-1">Error Loading Data</h3>
        <p className="text-sm text-gray-600">{error}</p>
        <p className="text-xs text-gray-400 mt-2">
          Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are configured
          and the heartbeats table exists.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Usage Statistics</h1>
        <div className="flex gap-1">
          {(["7d", "30d", "all"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={
                "px-3 py-1 text-xs font-medium transition-colors " +
                (timeRange === r
                  ? "text-white"
                  : "text-gray-600 hover:bg-gray-100")
              }
              style={
                timeRange === r
                  ? { backgroundColor: "var(--color-primary)", borderRadius: "2px" }
                  : { borderRadius: "2px" }
              }
            >
              {r === "7d" ? "7 days" : r === "30d" ? "30 days" : "All time"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Congregations" value={uniqueCongregations} />
        <StatCard label="Active This Week" value={activeThisWeek} />
        <StatCard label="Total Sessions" value={totalSessions} />
        <StatCard label="Total Enrollees" value={totalEnrollees} />
      </div>

      {/* ── Congregation Table ── */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b" style={{ borderColor: "#ddd" }}>
          <h2 className="font-semibold text-sm">
            Congregations ({uniqueCongregations})
          </h2>
        </div>
        {congregations.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">
            No heartbeat data received yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-2">Congregation</th>
                  <th className="px-4 py-2 text-right">Enrollees</th>
                  <th className="px-4 py-2 text-right">Weeks</th>
                  <th className="px-4 py-2 text-right">Sessions</th>
                  <th className="px-4 py-2">Last Active</th>
                  <th className="px-4 py-2">Version</th>
                </tr>
              </thead>
              <tbody>
                {congregations.map((c, i) => {
                  const isRecent = new Date(c.lastSeen) >= sevenDaysAgo;
                  return (
                    <tr
                      key={c.name + i}
                      className="border-t hover:bg-gray-50 transition-colors"
                      style={{ borderColor: "#eee" }}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{
                              backgroundColor: isRecent ? "#006064" : "#ccc",
                            }}
                            title={isRecent ? "Active this week" : "Inactive"}
                          />
                          <span className="font-medium">{c.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {c.enrollees}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {c.weeks}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {c.sessionCount}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">
                        {formatDate(c.lastSeen)}
                      </td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs font-mono">
                        {c.version}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Raw Sessions (last 20) ── */}
      <details className="card">
        <summary className="font-semibold text-sm cursor-pointer">
          Recent Sessions ({Math.min(filteredRecords.length, 20)} of {filteredRecords.length})
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left font-semibold uppercase tracking-wider text-gray-500">
                <th className="py-1.5 pr-4">Timestamp</th>
                <th className="py-1.5 pr-4">Congregation</th>
                <th className="py-1.5 pr-4 text-right">Enrollees</th>
                <th className="py-1.5 pr-4 text-right">Weeks</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.slice(0, 20).map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: "#eee" }}>
                  <td className="py-1.5 pr-4 text-gray-500 font-mono">
                    {formatDate(r.created_at)}
                  </td>
                  <td className="py-1.5 pr-4">{r.congregation}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{r.enrollee_count}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{r.week_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color: "#333" }}>
        {value}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
