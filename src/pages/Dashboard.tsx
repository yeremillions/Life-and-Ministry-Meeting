import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { db } from "../db";
import { buildStats, dueSoon } from "../scheduler";
import { SEGMENTS, segmentOf } from "../meeting";
import { todayIso, weekRangeLabel } from "../utils";
import type { Week, Assignee } from "../types";
import QuickStartWizard from "../components/QuickStartWizard";

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

  const [showWizard, setShowWizard] = useState(false);
  const isBrandNew = assignees.length === 0 && weeks.length === 0;

  return (
    <div className="space-y-5">
      {/* ── Wizard Overlay ─────────────────────────────────────────── */}
      {showWizard && (
        <QuickStartWizard
          onClose={() => setShowWizard(false)}
          onNavigate={onNavigate}
        />
      )}

      {/* ── Welcome Banner for New Users ───────────────────────────── */}
      {isBrandNew && (
        <div className="card bg-indigo-50 border-indigo-200 shadow-sm flex flex-col sm:flex-row items-center gap-4 sm:justify-between p-6">
          <div>
            <h2 className="text-xl font-bold text-indigo-900">Welcome to Life & Ministry Meeting Scheduler!</h2>
            <p className="text-indigo-700 mt-1">
              It looks like your database is empty. Would you like us to guide you through setting up your first schedule?
            </p>
          </div>
          <button
            className="btn bg-indigo-600 hover:bg-indigo-700 text-white whitespace-nowrap shrink-0"
            onClick={() => setShowWizard(true)}
          >
            Start Guided Setup
          </button>
        </div>
      )}

      {/* ── This Week's Meeting ─────────────────────────────────────── */}
      {thisWeek && (
        <ThisWeekCard
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
          onClick={() => onNavigate("enrollees")}
        />
        <StatCard
          label="Scheduled Weeks"
          value={weeks.length}
          sub={`${upcoming.length} upcoming`}
          onClick={() => onNavigate("schedule")}
        />
        <StatCard
          label="Assignments Given"
          value={totalAssignments}
          sub="all time"
          onClick={() => onNavigate("reports")}
        />
        <StatCard
          label="Upcoming Fill Rate"
          value={upcomingFill}
          valueSuffix="%"
          sub={needsAttention.length > 0 ? `${needsAttention.length} need attention` : "all filled"}
          accent={upcomingFill === 100 ? "#006064" : upcomingFill > 50 ? "#c4952a" : "#7b1928"}
          onClick={() => onNavigate("schedule")}
        />
      </section>

      {/* ── Main Content Grid ───────────────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Upcoming weeks column */}
        <div className="lg:col-span-2 space-y-5">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Upcoming Weeks</h2>
              <button
                className="btn-secondary text-xs"
                onClick={() => onNavigate("schedule")}
              >
                View all
              </button>
            </div>
            {upcoming.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-gray-500 mb-3">
                  No upcoming weeks planned yet.
                </p>
                <button
                  className="btn text-xs"
                  onClick={() => onNavigate("schedule")}
                >
                  Create a week
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {upcoming.map((w) => {
                  const filled = w.assignments.filter((a) => a.assigneeId).length;
                  const total = w.assignments.length;
                  const pct = total > 0 ? (filled / total) * 100 : 0;
                  const isComplete = filled === total && total > 0;
                  const isThisWeek = w.id === thisWeek?.id;

                  return (
                    <div
                      key={w.id}
                      className="border p-3 cursor-pointer transition-colors hover:bg-gray-50"
                      style={{
                        borderColor: isThisWeek ? 'var(--color-primary)' : '#ddd',
                        borderRadius: '3px',
                      }}
                      onClick={() => onNavigate("schedule", w.id)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{weekRangeLabel(w.weekOf)}</span>
                          {isThisWeek && (
                            <span
                              className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 text-white"
                              style={{ backgroundColor: 'var(--color-primary)', borderRadius: '2px' }}
                            >
                              This week
                            </span>
                          )}
                        </div>
                        <span className={
                          "text-xs font-semibold tabular-nums " +
                          (isComplete ? "text-green-700" : "text-gray-500")
                        }>
                          {filled}/{total}
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div className="h-1.5 bg-gray-200 overflow-hidden" style={{ borderRadius: '1px' }}>
                        <div
                          className="h-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: isComplete ? '#006064' : 'var(--color-primary)',
                            borderRadius: '1px',
                          }}
                        />
                      </div>
                      {/* Segment pills */}
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
                              className="text-[10px] px-1.5 py-0.5 font-medium text-white"
                              style={{
                                backgroundColor: seg.color,
                                opacity: segFilled === segParts.length ? 1 : 0.45,
                                borderRadius: '2px',
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
              <h2 className="font-semibold mb-4">Assignment Distribution</h2>
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
                        <span className="text-xs text-gray-500 tabular-nums">
                          {count} ({Math.round(pct)}%)
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 overflow-hidden" style={{ borderRadius: '1px' }}>
                        <div
                          className="h-full transition-all duration-700"
                          style={{ width: `${pct}%`, backgroundColor: seg.color, borderRadius: '1px' }}
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
        <div className="space-y-5">
          {/* Due Soon */}
          <div className="card">
            <h2 className="font-semibold mb-3">Due for Assignment</h2>
            {soon.length === 0 ? (
              <p className="text-sm text-gray-500">
                Add enrollees to see rotation suggestions.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {soon.map(({ assignee, stats: s }, idx) => {
                  const daysSinceLast = s.lastWeekMain
                    ? Math.round(
                        (new Date(today).getTime() -
                          new Date(s.lastWeekMain).getTime()) /
                          86400000
                      )
                    : null;

                  return (
                    <li key={assignee.id} className="flex items-center gap-2 py-1 border-b border-gray-100 last:border-0">
                      <span className="flex-shrink-0 text-[11px] font-bold text-gray-400 w-4 text-right tabular-nums">
                        {idx + 1}
                      </span>
                      <button
                        onClick={() => onNavigateToProfile(assignee.id!)}
                        className="flex-1 text-sm font-medium text-left truncate hover:underline"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        {assignee.name}
                      </button>
                      <span className="text-[10px] text-gray-400 tabular-nums flex-shrink-0">
                        {daysSinceLast != null ? `${daysSinceLast}d` : "never"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Never Assigned */}
          {neverAssigned.length > 0 && (
            <div className="card" style={{ borderLeft: '3px solid var(--ministry)' }}>
              <h3 className="text-sm font-semibold mb-1">
                Never Assigned ({neverAssigned.length})
              </h3>
              <p className="text-xs text-gray-500 mb-2">
                {neverAssigned.length === 1
                  ? "1 active enrollee has"
                  : `${neverAssigned.length} active enrollees have`}{" "}
                never received any assignment.
              </p>
              <div className="flex flex-wrap gap-1">
                {neverAssigned.slice(0, 5).map((a) => (
                  <button
                    key={a.id}
                    onClick={() => onNavigateToProfile(a.id!)}
                    className="text-[11px] font-medium px-2 py-0.5 hover:underline"
                    style={{ color: 'var(--color-primary)', backgroundColor: '#f0f4f9', borderRadius: '2px' }}
                  >
                    {a.name}
                  </button>
                ))}
                {neverAssigned.length > 5 && (
                  <span className="text-[11px] text-gray-500 px-1 py-0.5">
                    +{neverAssigned.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="card">
            <h2 className="font-semibold mb-3">Quick Actions</h2>
            <div className="space-y-2">
              <button
                className="w-full btn-secondary text-left text-sm"
                onClick={() => onNavigate("schedule")}
              >
                Create new week
              </button>
              <button
                className="w-full btn-secondary text-left text-sm"
                onClick={() => onNavigate("enrollees")}
              >
                Add enrollee
              </button>
              <button
                className="w-full btn-secondary text-left text-sm flex justify-between"
                onClick={() => setShowWizard(true)}
              >
                <span>Guided Setup Wizard</span>
                <span className="text-indigo-500">✨</span>
              </button>
              <button
                className="w-full btn-secondary text-left text-sm"
                onClick={() => onNavigate("reports")}
              >
                View reports
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Recent weeks ────────────────────────────────────────────── */}
      {recent.length > 0 && (
        <section className="card">
          <h2 className="font-semibold mb-3">Recent Weeks</h2>
          <div className="space-y-3">
            {recent.map((w) => (
              <div
                key={w.id}
                className="border-l-3 pl-3 cursor-pointer hover:bg-gray-50 py-2 transition-colors"
                style={{
                  borderLeftWidth: '3px',
                  borderLeftColor: w.assignments.every((a) => a.assigneeId) ? '#006064' : '#ddd',
                  borderRadius: '2px',
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
                    <span className="text-xs text-gray-500 self-center">
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

/* ── This Week Card ────────────────────────────────────────────────── */

function ThisWeekCard({
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
      className="card cursor-pointer hover:bg-gray-50 transition-colors"
      style={{ borderLeft: '4px solid var(--color-primary)' }}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">
            This Week's Meeting
          </p>
          <h2 className="text-lg font-bold">{weekRangeLabel(week.weekOf)}</h2>
          {week.weeklyBibleReading && (
            <p className="text-sm text-gray-500 mt-0.5">
              {week.weeklyBibleReading}
            </p>
          )}
          {chairmanName && (
            <p className="text-sm text-gray-600 mt-2">
              Chairman:{" "}
              <button
                className="font-medium hover:underline"
                style={{ color: 'var(--color-primary)' }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (chairman?.assigneeId) onNavigateToProfile(chairman.assigneeId);
                }}
              >
                {chairmanName}
              </button>
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums" style={{ color: isComplete ? '#006064' : 'var(--color-primary)' }}>
            {filled}/{total}
          </div>
          <p className="text-[11px] text-gray-400">
            {isComplete ? "Fully assigned" : "parts filled"}
          </p>
        </div>
      </div>
      {/* Segment summary */}
      <div className="mt-3 flex gap-2">
        {SEGMENTS.map((seg) => {
          const parts = week.assignments.filter((a) => a.segment === seg.id);
          const segFilled = parts.filter((a) => a.assigneeId).length;
          if (parts.length === 0) return null;
          return (
            <div
              key={seg.id}
              className="flex-1 text-center py-1.5 px-2"
              style={{
                backgroundColor: seg.color + '12',
                borderBottom: `2px solid ${seg.color}`,
                borderRadius: '2px',
              }}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: seg.color }}>
                {seg.id === "opening" ? "Opening" : seg.id === "treasures" ? "Treasures" : seg.id === "ministry" ? "Ministry" : "Living"}
              </div>
              <div className="text-sm font-bold tabular-nums" style={{ color: seg.color }}>
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
  accent,
  onClick,
}: {
  label: string;
  value: number;
  valueSuffix?: string;
  sub?: string;
  accent?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="card text-left hover:bg-gray-50 transition-colors"
    >
      <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color: accent || '#333' }}>
        {value}{valueSuffix}
      </div>
      {sub && <div className="text-[11px] text-gray-500 mt-1">{sub}</div>}
    </button>
  );
}
