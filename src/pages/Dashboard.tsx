import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { buildStats, dueSoon } from "../scheduler";
import { segmentOf } from "../meeting";
import { todayIso, weekRangeLabel } from "../utils";

export default function Dashboard({
  onNavigate,
}: {
  onNavigate: (t: "enrollees" | "schedule" | "reports", weekId?: number) => void;
}) {
  const assignees =
    useLiveQuery(() => db.assignees.orderBy("name").toArray(), []) ?? [];
  const weeks =
    useLiveQuery(() => db.weeks.orderBy("weekOf").toArray(), []) ?? [];

  const today = todayIso();
  const upcoming = weeks.filter((w) => w.weekOf >= today).slice(0, 4);
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

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Enrollees"
          value={activeAssignees.length}
          sub={`${assignees.length} total`}
          onClick={() => onNavigate("enrollees")}
        />
        <StatCard
          label="Scheduled weeks"
          value={weeks.length}
          sub={`${upcoming.length} upcoming`}
          onClick={() => onNavigate("schedule")}
        />
        <StatCard
          label="Assignments given"
          value={totalAssignments}
          sub="across all weeks"
          onClick={() => onNavigate("reports")}
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Upcoming weeks</h2>
            <button
              className="btn-secondary"
              onClick={() => onNavigate("schedule")}
            >
              Open schedule
            </button>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-slate-500">
              No upcoming weeks planned yet. Head to <b>Schedule</b> to create
              one.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((w) => {
                const filled = w.assignments.filter((a) => a.assigneeId).length;
                return (
                  <li
                    key={w.id}
                    className="py-2 flex items-center justify-between text-sm cursor-pointer rounded hover:bg-slate-50 px-2 -mx-2 even:bg-slate-50/50"
                    onClick={() => onNavigate("schedule", w.id)}
                  >
                    <div>
                      <div className="font-medium">{weekRangeLabel(w.weekOf)}</div>
                      <div className="text-xs text-slate-500">
                        {w.weeklyBibleReading ?? "—"}
                      </div>
                    </div>
                    <span className="pill bg-slate-100 text-slate-700">
                      {filled}/{w.assignments.length} filled
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card">
          <h2 className="font-semibold mb-3">Who should be assigned soon</h2>
          {soon.length === 0 ? (
            <p className="text-sm text-slate-500">
              Add enrollees to see rotation suggestions.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {soon.map(({ assignee, stats }) => (
                <li
                  key={assignee.id}
                  className="py-2 flex items-center justify-between text-sm px-2 -mx-2 even:bg-slate-50/50 rounded"
                >
                  <span className="font-medium">{assignee.name}</span>
                  <span className="text-xs text-slate-500">
                    {stats.totalMain} past •{" "}
                    {stats.lastWeekMain ? `last ${stats.lastWeekMain}` : "never"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {recent.length > 0 && (
        <section className="card">
          <h2 className="font-semibold mb-3">Recent weeks</h2>
          <div className="space-y-3">
            {recent.map((w) => (
              <div
                key={w.id}
                className="border-l-4 border-slate-200 pl-3 cursor-pointer rounded hover:bg-slate-50 py-1 -my-1"
                onClick={() => onNavigate("schedule", w.id)}
              >
                <div className="text-sm font-medium">Week of {w.weekOf}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {w.assignments.slice(0, 6).map((a) => {
                    const person = assignees.find(
                      (p) => p.id === a.assigneeId
                    );
                    const seg = segmentOf(a.segment);
                    return (
                      <span
                        key={a.uid}
                        className="pill text-white"
                        style={{ backgroundColor: seg.color }}
                      >
                        {a.partType}: {person?.name ?? "—"}
                      </span>
                    );
                  })}
                  {w.assignments.length > 6 && (
                    <span className="text-xs text-slate-500">
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

function StatCard({
  label,
  value,
  sub,
  onClick,
}: {
  label: string;
  value: number;
  sub?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="card text-left hover:border-slate-400 transition-colors"
    >
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="text-3xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </button>
  );
}
