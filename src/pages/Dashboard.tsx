import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "../db";
import { buildStats, dueSoon } from "../scheduler";
import { SEGMENTS, segmentOf } from "../meeting";
import { todayIso, weekRangeLabel } from "../utils";
import type { Week, Assignee } from "../types";

export default function Dashboard({
  onNavigate,
  onNavigateToProfile,
}: {
  onNavigate: (t: "enrollees" | "schedule" | "reports", weekId?: number) => void;
  onNavigateToProfile: (id: number) => void;
}) {
  const assignees =
    useLiveQuery(() => db.assignees.orderBy("name").toArray(), []) ?? [];
  const weeks =
    useLiveQuery(() => db.weeks.orderBy("weekOf").toArray(), []) ?? [];

  const today = todayIso();
  const upcoming = weeks.filter((w) => w.weekOf >= today).slice(0, 4);
  const thisWeek = upcoming.length > 0 ? upcoming[0] : null;
  const recent = [...weeks]
    .filter((w) => w.weekOf < today)
    .sort((a, b) => b.weekOf.localeCompare(a.weekOf))
    .slice(0, 3);
  const soon = dueSoon(assignees, weeks, today, 8);
  const stats = buildStats(assignees, weeks);

  const totalAssignments = [...stats.values()].reduce(
    (sum, s) => sum + s.totalMain,
    0
  );
  const activeAssignees = assignees.filter((a) => a.active);
  const activeBrothers = activeAssignees.filter(
    (a) => a.gender === "M" && a.baptised
  );
  const activeSisters = activeAssignees.filter((a) => a.gender === "F");
  const neverAssigned = activeAssignees.filter((a) => {
    const s = stats.get(a.id!);
    return !s || !s.lastWeekMain;
  });

  // Overall fill rate for upcoming weeks
  const upcomingFill = useMemo(() => {
    let filled = 0, total = 0;
    for (const w of upcoming) {
      total += w.assignments.length;
      filled += w.assignments.filter((a) => a.assigneeId).length;
    }
    return total > 0 ? Math.round((filled / total) * 100) : 0;
  }, [upcoming]);

  // Segment distribution across all weeks
  const segmentCounts = useMemo(() => {
    const counts: Record<string, number> = { opening: 0, treasures: 0, ministry: 0, living: 0 };
    for (const w of weeks) {
      for (const a of w.assignments) {
        if (a.assigneeId != null) counts[a.segment] = (counts[a.segment] || 0) + 1;
      }
    }
    return counts;
  }, [weeks]);
  const segmentTotal = Object.values(segmentCounts).reduce((a, b) => a + b, 0);

  // Weeks needing attention (upcoming and not fully filled)
  const needsAttention = upcoming.filter((w) => {
    const filled = w.assignments.filter((a) => a.assigneeId).length;
    return filled < w.assignments.length;
  });

  return (
    <div className="space-y-6">
      {/* ── Welcome / This Week Banner ──────────────────────────────── */}
      {thisWeek && (
        <ThisWeekBanner
          week={thisWeek}
          assignees={assignees}
          onOpen={() => onNavigate("schedule", thisWeek.id)}
          onNavigateToProfile={onNavigateToProfile}
        />
      )}

      {/* ── Stat Cards ──────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Active Enrollees"
          value={activeAssignees.length}
          sub={`${activeBrothers.length} brothers · ${activeSisters.length} sisters`}
          icon="👥"
          onClick={() => onNavigate("enrollees")}
        />
        <StatCard
          label="Scheduled Weeks"
          value={weeks.length}
          sub={`${upcoming.length} upcoming`}
          icon="📅"
          onClick={() => onNavigate("schedule")}
        />
        <StatCard
          label="Assignments Given"
          value={totalAssignments}
          sub="all time"
          icon="📋"
          onClick={() => onNavigate("reports")}
        />
        <StatCard
          label="Upcoming Fill Rate"
          value={upcomingFill}
          valueSuffix="%"
          sub={needsAttention.length > 0 ? `${needsAttention.length} need attention` : "all filled ✓"}
          icon="📊"
          highlight={upcomingFill === 100 ? "green" : upcomingFill > 50 ? "amber" : "red"}
          onClick={() => onNavigate("schedule")}
        />
      </section>

      {/* ── Main Content Grid ───────────────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming weeks column */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-800">Upcoming Weeks</h2>
              <button
                className="btn-secondary text-xs"
                onClick={() => onNavigate("schedule")}
              >
                View all →
              </button>
            </div>
            {upcoming.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-4xl mb-2">📅</p>
                <p className="text-sm text-slate-500">
                  No upcoming weeks planned yet.
                </p>
                <button
                  className="btn mt-3 text-xs"
                  onClick={() => onNavigate("schedule")}
                >
                  Create a week
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {upcoming.map((w) => {
                  const filled = w.assignments.filter((a) => a.assigneeId).length;
                  const total = w.assignments.length;
                  const pct = total > 0 ? (filled / total) * 100 : 0;
                  const isComplete = filled === total && total > 0;
                  const isThisWeek = w.id === thisWeek?.id;

                  return (
                    <div
                      key={w.id}
                      className={
                        "rounded-lg border p-3 cursor-pointer transition-all hover:shadow-md " +
                        (isThisWeek
                          ? "border-blue-200 bg-blue-50/50"
                          : "border-slate-200 hover:border-slate-300")
                      }
                      onClick={() => onNavigate("schedule", w.id)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{weekRangeLabel(w.weekOf)}</span>
                          {isThisWeek && (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full">
                              This week
                            </span>
                          )}
                        </div>
                        <span className={
                          "text-xs font-semibold tabular-nums " +
                          (isComplete ? "text-emerald-600" : "text-slate-500")
                        }>
                          {filled}/{total}
                          {isComplete && " ✓"}
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className={
                            "h-full rounded-full transition-all duration-500 " +
                            (isComplete ? "bg-emerald-400" : pct > 50 ? "bg-blue-400" : "bg-amber-400")
                          }
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {/* Segment summary pills */}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {SEGMENTS.map((seg) => {
                          const segParts = w.assignments.filter(
                            (a) => a.segment === seg.id
                          );
                          const segFilled = segParts.filter(
                            (a) => a.assigneeId
                          ).length;
                          if (segParts.length === 0) return null;
                          return (
                            <span
                              key={seg.id}
                              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white"
                              style={{
                                backgroundColor: seg.color,
                                opacity: segFilled === segParts.length ? 1 : 0.5,
                              }}
                            >
                              {seg.id === "opening" ? "Open" : seg.id === "treasures" ? "Gems" : seg.id === "ministry" ? "Ministry" : "Living"} {segFilled}/{segParts.length}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Segment Distribution */}
          {segmentTotal > 0 && (
            <div className="card">
              <h2 className="font-semibold text-slate-800 mb-4">Assignment Distribution</h2>
              <div className="space-y-3">
                {SEGMENTS.filter((s) => s.id !== "opening").map((seg) => {
                  const count = segmentCounts[seg.id] || 0;
                  const pct = segmentTotal > 0 ? (count / segmentTotal) * 100 : 0;
                  return (
                    <div key={seg.id}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold" style={{ color: seg.color }}>
                          {seg.label}
                        </span>
                        <span className="text-xs text-slate-500 tabular-nums">
                          {count} ({Math.round(pct)}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, backgroundColor: seg.color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Due Soon */}
          <div className="card">
            <h2 className="font-semibold text-slate-800 mb-3">Due for Assignment</h2>
            {soon.length === 0 ? (
              <p className="text-sm text-slate-500">
                Add enrollees to see rotation suggestions.
              </p>
            ) : (
              <ul className="space-y-2">
                {soon.map(({ assignee, stats: s }, idx) => {
                  const daysSinceLast = s.lastWeekMain
                    ? Math.round(
                        (new Date(today).getTime() -
                          new Date(s.lastWeekMain).getTime()) /
                          86400000
                      )
                    : null;

                  return (
                    <li key={assignee.id} className="flex items-center gap-2">
                      {/* Rank badge */}
                      <span className={
                        "flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold " +
                        (idx < 3 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500")
                      }>
                        {idx + 1}
                      </span>
                      <button
                        onClick={() => onNavigateToProfile(assignee.id!)}
                        className="flex-1 text-sm font-medium hover:text-blue-600 transition-colors text-left truncate"
                      >
                        {assignee.name}
                      </button>
                      <span className="text-[10px] text-slate-400 tabular-nums flex-shrink-0">
                        {daysSinceLast != null ? `${daysSinceLast}d ago` : "never"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Never Assigned Alert */}
          {neverAssigned.length > 0 && (
            <div className="card border-amber-200 bg-amber-50/50">
              <div className="flex items-start gap-2">
                <span className="text-lg">⚠️</span>
                <div>
                  <h3 className="text-sm font-semibold text-amber-800">
                    Never Assigned ({neverAssigned.length})
                  </h3>
                  <p className="text-xs text-amber-700 mt-1">
                    {neverAssigned.length === 1
                      ? "1 active enrollee has"
                      : `${neverAssigned.length} active enrollees have`}{" "}
                    never received any assignment.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {neverAssigned.slice(0, 5).map((a) => (
                      <button
                        key={a.id}
                        onClick={() => onNavigateToProfile(a.id!)}
                        className="text-[11px] font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded-full transition-colors"
                      >
                        {a.name}
                      </button>
                    ))}
                    {neverAssigned.length > 5 && (
                      <span className="text-[11px] text-amber-600 px-1 py-0.5">
                        +{neverAssigned.length - 5} more
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="card">
            <h2 className="font-semibold text-slate-800 mb-3">Quick Actions</h2>
            <div className="space-y-2">
              <button
                className="w-full btn-secondary text-left flex items-center gap-2"
                onClick={() => onNavigate("schedule")}
              >
                <span>📅</span>
                <span className="text-sm">Create new week</span>
              </button>
              <button
                className="w-full btn-secondary text-left flex items-center gap-2"
                onClick={() => onNavigate("enrollees")}
              >
                <span>👤</span>
                <span className="text-sm">Add enrollee</span>
              </button>
              <button
                className="w-full btn-secondary text-left flex items-center gap-2"
                onClick={() => onNavigate("reports")}
              >
                <span>📊</span>
                <span className="text-sm">View reports</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Recent weeks ────────────────────────────────────────────── */}
      {recent.length > 0 && (
        <section className="card">
          <h2 className="font-semibold text-slate-800 mb-3">Recent Weeks</h2>
          <div className="space-y-3">
            {recent.map((w) => (
              <div
                key={w.id}
                className="border-l-4 pl-3 cursor-pointer rounded hover:bg-slate-50 py-2 -my-1 transition-colors"
                style={{
                  borderLeftColor: w.assignments.every((a) => a.assigneeId) ? "#10b981" : "#cbd5e1"
                }}
                onClick={() => onNavigate("schedule", w.id)}
              >
                <div className="text-sm font-medium">{weekRangeLabel(w.weekOf)}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {w.assignments.slice(0, 6).map((a) => {
                    const person = assignees.find(
                      (p) => p.id === a.assigneeId
                    );
                    const seg = segmentOf(a.segment);
                    return (
                      <button
                        key={a.uid}
                        className="pill text-white hover:brightness-110 transition-all text-left"
                        style={{ backgroundColor: seg.color }}
                        onClick={(e) => {
                          if (person?.id) {
                            e.stopPropagation();
                            onNavigateToProfile(person.id);
                          }
                        }}
                      >
                        {a.partType}: {person?.name ?? "—"}
                      </button>
                    );
                  })}
                  {w.assignments.length > 6 && (
                    <span className="text-xs text-slate-500 self-center">
                      + {w.assignments.length - 6} more
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ── This Week Banner ──────────────────────────────────────────────── */

function ThisWeekBanner({
  week,
  assignees,
  onOpen,
  onNavigateToProfile,
}: {
  week: Week;
  assignees: Assignee[];
  onOpen: () => void;
  onNavigateToProfile: (id: number) => void;
}) {
  const filled = week.assignments.filter((a) => a.assigneeId).length;
  const total = week.assignments.length;
  const isComplete = filled === total && total > 0;
  const chairman = week.assignments.find((a) => a.partType === "Chairman");
  const chairmanName = chairman?.assigneeId
    ? assignees.find((p) => p.id === chairman.assigneeId)?.name
    : null;

  return (
    <div
      className="rounded-xl bg-gradient-to-r from-slate-800 to-slate-700 text-white p-5 cursor-pointer hover:shadow-xl transition-shadow"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 mb-1">
            This Week's Meeting
          </p>
          <h2 className="text-xl font-bold">{weekRangeLabel(week.weekOf)}</h2>
          {week.weeklyBibleReading && (
            <p className="text-sm text-slate-300 mt-0.5">
              📖 {week.weeklyBibleReading}
            </p>
          )}
          <div className="mt-3 flex items-center gap-3">
            {chairmanName && (
              <button
                className="flex items-center gap-1.5 text-sm text-slate-200 hover:text-white transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  if (chairman?.assigneeId) onNavigateToProfile(chairman.assigneeId);
                }}
              >
                <span className="text-xs">🎤</span>
                <span>Chairman: <strong>{chairmanName}</strong></span>
              </button>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className={
            "text-3xl font-bold tabular-nums " +
            (isComplete ? "text-emerald-400" : "text-amber-400")
          }>
            {filled}/{total}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {isComplete ? "Fully assigned" : "parts filled"}
          </p>
        </div>
      </div>
      {/* Segment summary */}
      <div className="mt-4 flex gap-2">
        {SEGMENTS.map((seg) => {
          const parts = week.assignments.filter((a) => a.segment === seg.id);
          const segFilled = parts.filter((a) => a.assigneeId).length;
          if (parts.length === 0) return null;
          return (
            <div
              key={seg.id}
              className="flex-1 rounded-lg px-2 py-1.5 text-center"
              style={{ backgroundColor: seg.color + "33" }}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
                {seg.id === "opening" ? "Open" : seg.id === "treasures" ? "Treasures" : seg.id === "ministry" ? "Ministry" : "Living"}
              </div>
              <div className="text-sm font-bold text-white tabular-nums">
                {segFilled}/{parts.length}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Stat Card ─────────────────────────────────────────────────────── */

function StatCard({
  label,
  value,
  valueSuffix,
  sub,
  icon,
  highlight,
  onClick,
}: {
  label: string;
  value: number;
  valueSuffix?: string;
  sub?: string;
  icon?: string;
  highlight?: "green" | "amber" | "red";
  onClick?: () => void;
}) {
  const highlightClass =
    highlight === "green"
      ? "border-emerald-200 bg-emerald-50/50"
      : highlight === "amber"
        ? "border-amber-200 bg-amber-50/50"
        : highlight === "red"
          ? "border-red-200 bg-red-50/50"
          : "";

  return (
    <button
      onClick={onClick}
      className={
        "card text-left hover:border-slate-300 transition-all group " +
        highlightClass
      }
    >
      <div className="flex items-start justify-between">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
          {label}
        </div>
        {icon && <span className="text-lg opacity-60 group-hover:opacity-100 transition-opacity">{icon}</span>}
      </div>
      <div className="text-2xl font-bold mt-1.5 tabular-nums text-slate-800">
        {value}{valueSuffix}
      </div>
      {sub && <div className="text-[11px] text-slate-500 mt-1">{sub}</div>}
    </button>
  );
}
