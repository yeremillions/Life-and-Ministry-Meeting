import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { db } from "../db";
import { buildStats, fmtLastAssigned } from "../scheduler";
import { privilegeLabel, segmentOf } from "../meeting";
import type { Assignment, Week } from "../types";

type SortBy = "name" | "total" | "last";

export default function ReportsPage({
  onNavigateToProfile,
}: {
  onNavigateToProfile: (id: number) => void;
}) {
  const assignees =
    useLiveQuery(() => db.assignees.orderBy("name").toArray(), []) ?? [];
  const weeks =
    useLiveQuery(() => db.weeks.orderBy("weekOf").toArray(), []) ?? [];
  const settings =
    useLiveQuery(() => db.settings.get("app"), []);

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
    const arr = assignees
      .filter((a) => !a.archived)
      .map((a) => ({
        assignee: a,
      stats: stats.get(a.id!) ?? {
        totalMain: 0,
        bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
        totalAssistant: 0,
        recentMainDates: [],
        recentMainDatesBySegment: { opening: [], treasures: [], ministry: [], living: [] },
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
      (r.assignee.privileges ?? []).join("|"),
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
    const activeAssignees = assignees.filter((a) => a.active && !a.archived);
    
    // 1. Role Capacity & Bottlenecks
    const qualifiedChairmen = activeAssignees.filter(
      (a) => a.gender === "M" && (a.privileges.includes("E") || a.privileges.includes("QE"))
    ).length;

    const qualifiedPrayer = activeAssignees.filter(
      (a) =>
        a.gender === "M" &&
        (a.privileges.includes("E") ||
          a.privileges.includes("QE") ||
          a.privileges.includes("MS") ||
          a.privileges.includes("QMS") ||
          a.privileges.includes("CBSR") ||
          a.includeInPrayers) &&
        !a.excludeFromPrayers
    ).length;

    const qualifiedBibleReading = activeAssignees.filter(
      (a) => a.gender === "M"
    ).length;

    const qualifiedCbsReader = activeAssignees.filter(
      (a) => a.gender === "M" && (a.privileges.includes("CBSR") || a.baptised)
    ).length;

    const qualifiedTreasures = activeAssignees.filter(
      (a) =>
        a.gender === "M" &&
        (a.privileges.includes("E") ||
          a.privileges.includes("QE") ||
          a.privileges.includes("MS") ||
          a.privileges.includes("QMS"))
    ).length;

    // 2. Ministry Category Share Auditor
    const targetQE = settings?.shareMinistryQE ?? 2;
    const targetE = settings?.shareMinistryE ?? 2;
    const targetQMS = settings?.shareMinistryQMS ?? 2;
    const targetMS = settings?.shareMinistryMS ?? 2;
    const targetBrothers = settings?.shareMinistryBrothers ?? 2;
    const targetSisters = Math.max(0, 100 - (targetQE + targetE + targetQMS + targetMS + targetBrothers));

    let actualMinistryTotal = 0;
    const actualCounts = { QE: 0, E: 0, QMS: 0, MS: 0, Brothers: 0, Sisters: 0 };
    
    for (const w of filteredWeeks) {
      if (w.specialEvent) continue;
      for (const a of w.assignments) {
        if (a.segment === "ministry" && a.assigneeId != null) {
          const person = assignees.find((p) => p.id === a.assigneeId);
          if (person && !person.archived) {
            actualMinistryTotal += 1;
            if (person.privileges.includes("QE")) actualCounts.QE += 1;
            else if (person.privileges.includes("E")) actualCounts.E += 1;
            else if (person.privileges.includes("QMS")) actualCounts.QMS += 1;
            else if (person.privileges.includes("MS")) actualCounts.MS += 1;
            else if (person.gender === "M" && person.baptised) actualCounts.Brothers += 1;
            else actualCounts.Sisters += 1;
          }
        }
      }
    }

    const pctQE = actualMinistryTotal > 0 ? Math.round((actualCounts.QE / actualMinistryTotal) * 100) : 0;
    const pctE = actualMinistryTotal > 0 ? Math.round((actualCounts.E / actualMinistryTotal) * 100) : 0;
    const pctQMS = actualMinistryTotal > 0 ? Math.round((actualCounts.QMS / actualMinistryTotal) * 100) : 0;
    const pctMS = actualMinistryTotal > 0 ? Math.round((actualCounts.MS / actualMinistryTotal) * 100) : 0;
    const pctBrothers = actualMinistryTotal > 0 ? Math.round((actualCounts.Brothers / actualMinistryTotal) * 100) : 0;
    const pctSisters = actualMinistryTotal > 0 ? Math.round((actualCounts.Sisters / actualMinistryTotal) * 100) : 0;

    // 3. Publisher Rotation Diagnostics
    const overburdened = [...rows]
      .filter((r) => r.assignee.active && r.stats.totalMain > 0)
      .sort((a, b) => b.stats.totalMain - a.stats.totalMain)
      .slice(0, 3);

    const underutilized = [...rows]
      .filter((r) => r.assignee.active && r.stats.totalMain === 0)
      .sort((a, b) => {
        const la = a.stats.lastWeekMain ?? "0000-00-00";
        const lb = b.stats.lastWeekMain ?? "0000-00-00";
        return la.localeCompare(lb);
      })
      .slice(0, 3);

    return {
      averageAssignments: rows.length
        ? (
            rows.reduce((sum, r) => sum + r.stats.totalMain, 0) / rows.length
          ).toFixed(1)
        : 0,
      capacities: {
        qualifiedChairmen,
        qualifiedPrayer,
        qualifiedBibleReading,
        qualifiedCbsReader,
        qualifiedTreasures,
      },
      shares: {
        QE: { target: targetQE, actual: pctQE, count: actualCounts.QE },
        E: { target: targetE, actual: pctE, count: actualCounts.E },
        QMS: { target: targetQMS, actual: pctQMS, count: actualCounts.QMS },
        MS: { target: targetMS, actual: pctMS, count: actualCounts.MS },
        Brothers: { target: targetBrothers, actual: pctBrothers, count: actualCounts.Brothers },
        Sisters: { target: targetSisters, actual: pctSisters, count: actualCounts.Sisters },
        totalCount: actualMinistryTotal,
      },
      overburdened,
      underutilized,
    };
  }, [rows, assignees, filteredWeeks, settings]);

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

      {/* Insight Suite */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Card 1: Role Capacity & Bottlenecks */}
        <div className="card space-y-4">
          <div className="border-b border-slate-100 pb-2 flex justify-between items-center bg-slate-50/20 px-1 -mx-1">
            <h3 className="font-bold text-slate-800 text-sm">Role Capacity & Bottlenecks</h3>
            <span className="text-[10px] bg-slate-100 text-slate-500 font-semibold px-2 py-0.5 rounded shadow-sm border">Active Pools</span>
          </div>
          <div className="space-y-3.5">
            {[
              { label: "Meeting Chairman", count: insights.capacities.qualifiedChairmen, healthyMin: 6, warnMin: 3 },
              { label: "Treasures Talk / Gems", count: insights.capacities.qualifiedTreasures, healthyMin: 6, warnMin: 4 },
              { label: "Bible Reading Reader", count: insights.capacities.qualifiedBibleReading, healthyMin: 8, warnMin: 4 },
              { label: "Congregation Bible Study Reader", count: insights.capacities.qualifiedCbsReader, healthyMin: 6, warnMin: 3 },
              { label: "Opening & Closing Prayers", count: insights.capacities.qualifiedPrayer, healthyMin: 8, warnMin: 4 },
            ].map((role) => {
              const status = role.count >= role.healthyMin ? "healthy" : role.count >= role.warnMin ? "warning" : "critical";
              const pillColor = status === "healthy" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : status === "warning" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-rose-50 text-rose-700 border-rose-200";
              const dotColor = status === "healthy" ? "bg-emerald-500" : status === "warning" ? "bg-amber-500" : "bg-rose-500";
              const labelText = status === "healthy" ? "Healthy Coverage" : status === "warning" ? "Warning" : "Critical Bottleneck";

              return (
                <div key={role.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${dotColor}`}></span>
                    <span className="font-semibold text-slate-700">{role.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-800 tabular-nums">{role.count} qualified</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${pillColor}`} title={labelText}>
                      {status === "healthy" ? "Healthy" : status === "warning" ? "Warn" : "Critical"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400 leading-relaxed pt-1 border-t border-slate-50">
            A small qualified pool (Critical/Warning) results in rapid rotation, high fatigue, and scheduling conflicts.
          </p>
        </div>

        {/* Card 2: Ministry Category Share Auditor */}
        <div className="card space-y-4">
          <div className="border-b border-slate-100 pb-2 flex justify-between items-center bg-slate-50/20 px-1 -mx-1">
            <h3 className="font-bold text-slate-800 text-sm">Ministry Share Compliance</h3>
            <span className="text-[10px] bg-slate-100 text-slate-500 font-semibold px-2 py-0.5 rounded shadow-sm border">
              {insights.shares.totalCount} Demos Scheduled
            </span>
          </div>
          <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
            {[
              { key: "QE", label: "QE (Qualified Elders)", ...insights.shares.QE },
              { key: "E", label: "E (Elders)", ...insights.shares.E },
              { key: "QMS", label: "QMS (Qualified MS)", ...insights.shares.QMS },
              { key: "MS", label: "MS (Ministerial Servants)", ...insights.shares.MS },
              { key: "Brothers", label: "Baptised Brothers", ...insights.shares.Brothers },
              { key: "Sisters", label: "Sisters (Calculated)", ...insights.shares.Sisters },
            ].map((cat) => {
              const diff = cat.actual - cat.target;
              const isOver = diff > 5;
              const isUnder = diff < -5;
              const auditLabel = isOver ? `Over-assigned (+${diff}%)` : isUnder ? `Under-assigned (${diff}%)` : "Target Compliant";
              const auditColor = isOver ? "text-amber-600" : isUnder ? "text-indigo-600" : "text-emerald-600";

              return (
                <div key={cat.key} className="space-y-1 text-xs">
                  <div className="flex justify-between font-semibold text-slate-700">
                    <span>{cat.label}</span>
                    <span className="tabular-nums">
                      {cat.actual}% <span className="text-slate-400 font-normal">vs target {cat.target}%</span>
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex relative">
                    <div 
                      className="h-full bg-indigo-600 rounded-full transition-all duration-500" 
                      style={{ width: `${cat.actual}%` }}
                    />
                    <div 
                      className="absolute top-0 bottom-0 w-0.5 bg-rose-500/80 animate-pulse" 
                      style={{ left: `${cat.target}%` }}
                      title={`Target line: ${cat.target}%`}
                    />
                  </div>
                  <div className="flex justify-between items-center text-[9px]">
                    <span className="text-slate-400 font-medium">{cat.count} parts handled</span>
                    <span className={`font-bold uppercase tracking-wider ${auditColor}`}>{auditLabel}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Card 3: Publisher Rotation Diagnostics */}
        <div className="card space-y-4">
          <div className="border-b border-slate-100 pb-2 flex justify-between items-center bg-slate-50/20 px-1 -mx-1">
            <h3 className="font-bold text-slate-800 text-sm">Publisher Rotation Health</h3>
            <span className="text-[10px] bg-slate-100 text-slate-500 font-semibold px-2 py-0.5 rounded shadow-sm border">Active Rotation</span>
          </div>
          
          <div className="space-y-3 text-xs">
            {/* Overburdened Publishers */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-extrabold uppercase tracking-wide text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100/50">
                Overburdened (Workload Fatigue)
              </span>
              <div className="divide-y divide-slate-100 bg-slate-50/50 rounded border border-slate-200/50 p-2 space-y-1">
                {insights.overburdened.map((r, idx) => (
                  <div key={r.assignee.id} className="flex justify-between items-center py-1 first:pt-0 last:pb-0">
                    <button 
                      onClick={() => onNavigateToProfile(r.assignee.id!)}
                      className="font-semibold text-slate-700 hover:text-indigo-600 hover:underline text-left truncate max-w-[130px]"
                    >
                      {idx + 1}. {r.assignee.name}
                    </button>
                    <span className="font-bold text-slate-800 tabular-nums">{r.stats.totalMain} parts</span>
                  </div>
                ))}
                {insights.overburdened.length === 0 && (
                  <span className="text-slate-400 italic block py-0.5 text-center">No active workload records found.</span>
                )}
              </div>
            </div>

            {/* Underutilized / Neglected Publishers */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-extrabold uppercase tracking-wide text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100/50">
                Underutilized (Overlooked / Starved)
              </span>
              <div className="divide-y divide-slate-100 bg-slate-50/50 rounded border border-slate-200/50 p-2 space-y-1">
                {insights.underutilized.map((r, idx) => (
                  <div key={r.assignee.id} className="flex justify-between items-center py-1 first:pt-0 last:pb-0">
                    <button 
                      onClick={() => onNavigateToProfile(r.assignee.id!)}
                      className="font-semibold text-slate-700 hover:text-indigo-600 hover:underline text-left truncate max-w-[130px]"
                    >
                      {idx + 1}. {r.assignee.name}
                    </button>
                    <span className="text-slate-400 font-mono text-[10px]">
                      {r.stats.lastWeekMain ? r.stats.lastWeekMain : "never"}
                    </span>
                  </div>
                ))}
                {insights.underutilized.length === 0 && (
                  <span className="text-slate-400 italic block py-0.5 text-center">No underutilized enrollees found.</span>
                )}
              </div>
            </div>
          </div>
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
                        <button
                          onClick={() => onNavigateToProfile(r.assignee.id!)}
                          className="hover:text-indigo-600 hover:underline transition-colors text-left"
                        >
                          {r.assignee.name}
                        </button>
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
