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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <h2 className="text-lg font-semibold mr-auto">Reports</h2>
        <select
          className="input max-w-xs"
          value={range}
          onChange={(e) => setRange(e.target.value as "all" | "6m" | "1y")}
        >
          <option value="all">All time</option>
          <option value="1y">Last 12 months</option>
          <option value="6m">Last 6 months</option>
        </select>
        <select
          className="input max-w-xs"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
        >
          <option value="last">Sort: oldest last assignment</option>
          <option value="total">Sort: most assignments</option>
          <option value="name">Sort: name (A→Z)</option>
        </select>
        <button className="btn-secondary" onClick={exportCsv}>
          Export enrollee report
        </button>
        <button className="btn-secondary" onClick={exportSchedule}>
          Export full schedule
        </button>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 px-3 text-left">Name</th>
              <th className="py-2 px-3 text-left">Priv.</th>
              <th className="py-2 px-3 text-right">Total</th>
              <th className="py-2 px-3 text-right">Opening</th>
              <th className="py-2 px-3 text-right">Treasures</th>
              <th className="py-2 px-3 text-right">Ministry</th>
              <th className="py-2 px-3 text-right">Living</th>
              <th className="py-2 px-3 text-left">Last</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.assignee.id}
                className={
                  "border-t border-slate-100 " +
                  (r.assignee.active ? "" : "text-slate-400 italic")
                }
              >
                <td className="py-2 px-3">{r.assignee.name}</td>
                <td className="py-2 px-3">
                  {privilegeLabel(r.assignee) ?? (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="py-2 px-3 text-right font-medium">
                  {r.stats.totalMain}
                </td>
                <td className="py-2 px-3 text-right">
                  {r.stats.bySegmentMain.opening}
                </td>
                <td className="py-2 px-3 text-right">
                  {r.stats.bySegmentMain.treasures}
                </td>
                <td className="py-2 px-3 text-right">
                  {r.stats.bySegmentMain.ministry}
                </td>
                <td className="py-2 px-3 text-right">
                  {r.stats.bySegmentMain.living}
                </td>
                <td className="py-2 px-3">{fmtLastAssigned(r.stats)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
