import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { db } from "../db";
import { buildStats, fmtLastAssigned } from "../scheduler";
import { privilegeLabel, segmentOf } from "../meeting";
import type { Assignment, Week } from "../types";

type SortBy = "name" | "total" | "last";

export default function ReportsPage() {
  const assignees =
    useLiveQuery(() => db.assignees.orderBy("name").toArray(), []) ?? [];
  const weeks =
    useLiveQuery(() => db.weeks.orderBy("weekOf").toArray(), []) ?? [];

  const [sortBy, setSortBy] = useState<SortBy>("last");
  const [range, setRange] = useState<"all" | "6m" | "1y">("all");

  const filteredWeeks = useMemo(() => {
    if (range === "all") return weeks;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - (range === "6m" ? 6 : 12));
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    return weeks.filter((w) => w.weekOf >= cutoffIso);
  }, [weeks, range]);

  const stats = useMemo(
    () => buildStats(assignees, filteredWeeks),
    [assignees, filteredWeeks]
  );

  const rows = useMemo(() => {
    const arr = assignees.map((a) => ({
      assignee: a,
      stats: stats.get(a.id!) ?? {
        totalMain: 0,
        bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
        totalAssistant: 0,
      },
    }));
    arr.sort((a, b) => {
      if (sortBy === "name") return a.assignee.name.localeCompare(b.assignee.name);
      if (sortBy === "total") return b.stats.totalMain - a.stats.totalMain;
      // Sort by last-assigned ascending (oldest first, never-assigned pinned to top).
      const la = a.stats.lastWeekMain ?? "0000-00-00";
      const lb = b.stats.lastWeekMain ?? "0000-00-00";
      return la.localeCompare(lb);
    });
    return arr;
  }, [assignees, stats, sortBy]);

  function exportCsv() {
    const header = [
      "name",
      "gender",
      "baptised",
      "privileges",
      "active",
      "totalMain",
      "lastAssigned",
      "opening",
      "treasures",
      "ministry",
      "living",
    ];
    const rowsCsv = rows.map((r) => [
      r.assignee.name,
      r.assignee.gender,
      r.assignee.baptised ? "yes" : "no",
      r.assignee.privileges.join("|"),
      r.assignee.active ? "yes" : "no",
      String(r.stats.totalMain),
      fmtLastAssigned(r.stats),
      String(r.stats.bySegmentMain.opening),
      String(r.stats.bySegmentMain.treasures),
      String(r.stats.bySegmentMain.ministry),
      String(r.stats.bySegmentMain.living),
    ]);
    downloadCsv(
      "enrollee-assignment-report.csv",
      [header, ...rowsCsv]
    );
  }

  function exportSchedule() {
    const header = [
      "weekOf",
      "segment",
      "partType",
      "title",
      "assignee",
      "assistant",
      "note",
    ];
    const out: string[][] = [];
    for (const w of weeks) {
      for (const a of sortedAssignments(w)) {
        out.push([
          w.weekOf,
          segmentOf(a.segment).label,
          a.partType,
          a.title,
          nameOf(a.assigneeId),
          nameOf(a.assistantId),
          a.note ?? "",
        ]);
      }
    }
    downloadCsv("meeting-schedule.csv", [header, ...out]);
  }

  function nameOf(id?: number): string {
    if (id == null) return "";
    return assignees.find((a) => a.id === id)?.name ?? "";
  }

  const maxAssignments = useMemo(() => {
    let max = 1;
    for (const r of rows) {
      if (r.stats.totalMain > max) max = r.stats.totalMain;
    }
    return max;
  }, [rows]);

  const insights = useMemo(() => {
    const activeBrothers = rows.filter(
      (r) => r.assignee.active && r.assignee.gender === "M" && r.assignee.baptised
    );
    const neverAssigned = activeBrothers.filter((r) => !r.stats.lastWeekMain);
    const longestGaps = [...activeBrothers]
      .filter((r) => r.stats.lastWeekMain)
      .sort((a, b) =>
        (a.stats.lastWeekMain ?? "").localeCompare(b.stats.lastWeekMain ?? "")
      )
      .slice(0, 3);

    return {
      neverAssigned,
      longestGaps,
      totalActive: assignees.filter((a) => a.active).length,
      averageAssignments: rows.length
        ? (
            rows.reduce((sum, r) => sum + r.stats.totalMain, 0) / rows.length
          ).toFixed(1)
        : 0,
    };
  }, [rows, assignees]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-center">
        <h2 className="text-xl font-bold mr-auto">Decision Insights</h2>
        <div className="flex gap-2">
          <select
            className="input w-32"
            value={range}
            onChange={(e) => setRange(e.target.value as "all" | "6m" | "1y")}
          >
            <option value="all">All time</option>
            <option value="1y">Last 12m</option>
            <option value="6m">Last 6m</option>
          </select>
          <button className="btn-secondary" onClick={exportCsv}>
            Export CSV
          </button>
          <button className="btn-secondary" onClick={exportSchedule}>
            Export Schedule
          </button>
        </div>
      </div>

      {/* Insight Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card border-l-4 border-l-amber-500">
          <div className="text-xs uppercase font-bold text-slate-500 mb-1">
            Fairness Gap
          </div>
          <div className="text-2xl font-bold">
            {insights.neverAssigned.length} never assigned
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Active baptised brothers with 0 main assignments in this range.
          </p>
        </div>
        <div className="card border-l-4 border-l-rose-700">
          <div className="text-xs uppercase font-bold text-slate-500 mb-1">
            Longest Gaps
          </div>
          <div className="flex flex-col gap-1 mt-1">
            {insights.longestGaps.map((r) => (
              <div key={r.assignee.id} className="text-sm flex justify-between">
                <span>{r.assignee.name}</span>
                <span className="text-slate-400 font-mono">
                  {r.stats.lastWeekMain}
                </span>
              </div>
            ))}
            {insights.longestGaps.length === 0 && (
              <span className="text-sm text-slate-400">No data available</span>
            )}
          </div>
        </div>
        <div className="card border-l-4 border-l-slate-800">
          <div className="text-xs uppercase font-bold text-slate-500 mb-1">
            Activity Level
          </div>
          <div className="text-2xl font-bold">
            {insights.averageAssignments} avg.
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Average assignments per enrollee in this period.
          </p>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between bg-slate-50/50">
          <h3 className="font-semibold">Assignment Distribution</h3>
          <select
            className="input w-48 py-1 text-xs"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
          >
            <option value="last">Sort: Oldest assignment</option>
            <option value="total">Sort: Most assignments</option>
            <option value="name">Sort: Name (A→Z)</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm table-zebra">
            <thead className="bg-slate-50/80 text-xs uppercase tracking-wide text-slate-500 font-bold">
              <tr>
                <th className="py-3 px-4 text-left">Enrollee</th>
                <th className="py-3 px-4 text-left">Privileges</th>
                <th className="py-3 px-4 text-left w-64">Volume & Mix</th>
                <th className="py-3 px-4 text-right">Total</th>
                <th className="py-3 px-4 text-left">Last Assigned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const total = r.stats.totalMain;
                const widthPercent =
                  total > 0 ? (total / maxAssignments) * 100 : 0;

                // Segment percentages for the stacked bar
                const s = r.stats.bySegmentMain;
                const pOpening = total > 0 ? (s.opening / total) * 100 : 0;
                const pTreasures = total > 0 ? (s.treasures / total) * 100 : 0;
                const pMinistry = total > 0 ? (s.ministry / total) * 100 : 0;
                const pLiving = total > 0 ? (s.living / total) * 100 : 0;

                return (
                  <tr
                    key={r.assignee.id}
                    className={
                      "border-t border-slate-100 " +
                      (r.assignee.active ? "" : "opacity-50 grayscale")
                    }
                  >
                    <td className="py-3 px-4 font-semibold text-slate-800">
                      {r.assignee.name}
                    </td>
                    <td className="py-3 px-4">
                      {privilegeLabel(r.assignee) ?? (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden flex">
                          <div
                            style={{
                              width: `${widthPercent}%`,
                              display: "flex",
                            }}
                            className="h-full"
                          >
                            <div
                              style={{ width: `${pOpening}%` }}
                              className="h-full bg-slate-400"
                              title="Opening"
                            />
                            <div
                              style={{ width: `${pTreasures}%` }}
                              className="h-full bg-[var(--treasures)]"
                              title="Treasures"
                            />
                            <div
                              style={{ width: `${pMinistry}%` }}
                              className="h-full bg-[var(--ministry)]"
                              title="Ministry"
                            />
                            <div
                              style={{ width: `${pLiving}%` }}
                              className="h-full bg-[var(--living)]"
                              title="Living"
                            />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-bold tabular-nums">
                      {r.stats.totalMain}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600">
                      {fmtLastAssigned(r.stats)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function sortedAssignments(w: Week): Assignment[] {
  return [...w.assignments].sort((a, b) => a.order - b.order);
}

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows
    .map((r) =>
      r
        .map((cell) => {
          if (/[",\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
          return cell;
        })
        .join(",")
    )
    .join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
