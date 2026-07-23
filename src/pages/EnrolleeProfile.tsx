import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, addLog } from "../db";
import { AppSettings, Assignee, Week, Assignment, PartType } from "../types";
import { segmentOf, isEligible } from "../meeting";
import { todayIso, toIso, mondayOf } from "../utils";
import { buildStats, AssigneeStats } from "../scheduler";
import ConfirmationModal from "../components/ConfirmationModal";
import { EnrolleeModal } from "./EnrolleesPage";

export default function EnrolleeProfile({
  id,
  onBack,
  onNavigateToProfile,
  onNavigateToSchedule,
}: {
  id: number;
  onBack: () => void;
  onNavigateToProfile: (id: number) => void;
  onNavigateToSchedule: (weekId: number) => void;
}) {
  const enrollee = useLiveQuery(() => db.assignees.get(id), [id]);
  const allAssignees = useLiveQuery(() => db.assignees.toArray(), []);
  const weeks = useLiveQuery(() => db.weeks.orderBy("weekOf").toArray(), []);
  const households = useLiveQuery(() => db.households.toArray(), []);
  const settings = useLiveQuery(() => db.settings.get("app"), []) || null;
  const isAvailableMode = settings?.availabilityMode === "available";

  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newReason, setNewReason] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [historyFilter, setHistoryFilter] = useState<"all" | "upcoming" | "past">("all");

  function handleStartChange(val: string) {
    setNewStart(val);
    if (!val) return;
    const startYear = val.split("-")[0];
    if (!startYear || startYear.length !== 4) return;
    if (newEnd) {
      const parts = newEnd.split("-");
      if (parts.length === 3) {
        const updatedEnd = `${startYear}-${parts[1]}-${parts[2]}`;
        if (updatedEnd < val) {
          setNewEnd(val);
        } else {
          setNewEnd(updatedEnd);
        }
      }
    } else {
      setNewEnd(val);
    }
  }

  useEffect(() => {
    setCurrentPage(1);
  }, [id, historyFilter]);

  async function handleSaveEnrollee(updatedFields: Omit<Assignee, "id" | "createdAt">) {
    if (!enrollee) return;
    await db.assignees.update(id, updatedFields);
    await addLog("enrollees", `Updated enrollee profile: ${updatedFields.name}`);
    setEditOpen(false);
  }

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    type?: "danger" | "warning" | "info";
    showCancel?: boolean;
    onConfirm: () => void | Promise<void>;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  if (!enrollee || enrollee.id !== id || !weeks || !allAssignees || !households) return <div className="p-8 text-center text-slate-500">Loading...</div>;

  async function handleAddTravel() {
    if (!enrollee) return;
    if (!newStart || !newEnd) return;
    if (newStart > newEnd) {
      setConfirmState({
        isOpen: true,
        title: "Invalid Dates",
        message: "Start date must be before or equal to end date.",
        confirmText: "OK",
        showCancel: false,
        type: "warning",
        onConfirm: () => setConfirmState((prev) => ({ ...prev, isOpen: false })),
      });
      return;
    }
    const updatedRanges = [
      ...(enrollee.unavailableRanges ?? []),
      { start: newStart, end: newEnd, reason: newReason.trim() || undefined }
    ];
    await db.assignees.update(id, { unavailableRanges: updatedRanges });
    setNewStart("");
    setNewEnd("");
    setNewReason("");
  }

  async function handleRemoveTravel(idx: number) {
    if (!enrollee) return;
    const updatedRanges = (enrollee.unavailableRanges ?? []).filter((_, i) => i !== idx);
    await db.assignees.update(id, { 
      unavailableRanges: updatedRanges.length > 0 ? updatedRanges : undefined 
    });
  }

  const myHouseholds = households.filter((h) => h.memberIds.includes(enrollee.id!));
  const housemates = Array.from(new Set(myHouseholds.flatMap(h => h.memberIds))).filter(mid => mid !== enrollee.id);

  // Find all assignments
  const history: { week: Week; assignment: Assignment; role: "main" | "assistant" }[] = [];
  weeks.forEach((w) => {
    w.assignments.forEach((a) => {
      if (a.assigneeId === id) {
        history.push({ week: w, assignment: a, role: "main" });
      } else if (a.assistantId === id) {
        history.push({ week: w, assignment: a, role: "assistant" });
      }
    });
  });

  const currentWeekMonday = toIso(mondayOf(new Date()));
  const filteredHistory = history.filter((item) => {
    if (historyFilter === "upcoming") {
      return item.week.weekOf >= currentWeekMonday;
    }
    if (historyFilter === "past") {
      return item.week.weekOf < currentWeekMonday;
    }
    return true;
  });

  if (historyFilter === "upcoming") {
    // Sort upcoming ascending (soonest first)
    filteredHistory.sort((a, b) => a.week.weekOf.localeCompare(b.week.weekOf));
  } else {
    // Sort all/past descending (most recent first)
    filteredHistory.sort((a, b) => b.week.weekOf.localeCompare(a.week.weekOf));
  }

  const historyPageSize = 8;
  const totalHistoryItems = filteredHistory.length;
  const totalHistoryPages = Math.ceil(totalHistoryItems / historyPageSize) || 1;
  const activeHistoryPage = Math.min(currentPage, totalHistoryPages);
  const startHistoryIndex = (activeHistoryPage - 1) * historyPageSize;
  const endHistoryIndex = startHistoryIndex + historyPageSize;
  const paginatedHistory = filteredHistory.slice(startHistoryIndex, endHistoryIndex);

  const maxVisiblePages = 5;
  let startPage = Math.max(1, activeHistoryPage - 2);
  let endPage = Math.min(totalHistoryPages, startPage + maxVisiblePages - 1);
  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }
  const historyPageNumbers: number[] = [];
  for (let i = startPage; i <= endPage; i++) {
    historyPageNumbers.push(i);
  }

  const stats = buildStats([enrollee], weeks).get(id)!;

  // Calculate insights
  const insights = calculateInsights(enrollee, history, stats, settings);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={onBack} className="btn-secondary">
          &larr; Back
        </button>
        <h1 className="text-2xl font-bold text-slate-900">{enrollee.name}</h1>
        {enrollee.archived ? (
          <span className="pill bg-slate-200 text-slate-800 border border-slate-300 font-semibold select-none">
            ⚫ Archived
          </span>
        ) : (
          <button
            onClick={async () => {
              await db.assignees.update(id, { active: !enrollee.active });
            }}
            title="Click to toggle active status"
            className={
              "pill transition-all cursor-pointer font-semibold hover:scale-105 active:scale-95 select-none " +
              (enrollee.active
                ? "bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-200 hover:text-emerald-900"
                : "bg-slate-100 text-slate-800 border border-slate-200 hover:bg-slate-200 hover:text-slate-900")
            }
          >
            {enrollee.active ? "🟢 Active" : "⚫ Inactive"}
          </button>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          {enrollee.archived ? (
            <button
              onClick={() => {
                setConfirmState({
                  isOpen: true,
                  title: "Unarchive Publisher",
                  message: `Are you sure you want to unarchive and restore "${enrollee.name}" to active status?`,
                  confirmText: "Yes, Restore",
                  cancelText: "Cancel",
                  type: "info",
                  onConfirm: async () => {
                    await db.assignees.update(id, { archived: false, active: true });
                    await addLog("enrollees", `Unarchived enrollee: ${enrollee.name}`);
                    setConfirmState((prev) => ({ ...prev, isOpen: false }));
                  },
                });
              }}
              className="btn bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-1.5 h-9 rounded"
            >
              🔄 Unarchive Enrollee
            </button>
          ) : (
            <>
              <button
                onClick={() => setEditOpen(true)}
                className="btn font-semibold flex items-center gap-1.5 h-9 rounded"
              >
                ✏️ Edit Profile
              </button>
              <button
                onClick={() => {
                  if (history.length === 0) {
                    setConfirmState({
                      isOpen: true,
                      title: "Permanently Delete Publisher",
                      message: `Are you sure you want to permanently delete the publisher "${enrollee.name}"? This cannot be undone.`,
                      confirmText: "Permanently Delete",
                      cancelText: "Cancel",
                      type: "danger",
                      onConfirm: async () => {
                        await db.assignees.delete(id);
                        await addLog("enrollees", `Deleted enrollee: ${enrollee.name}`);
                        setConfirmState((prev) => ({ ...prev, isOpen: false }));
                        onBack();
                      },
                    });
                  } else {
                    setConfirmState({
                      isOpen: true,
                      title: "Archive Publisher",
                      message: `"${enrollee.name}" has past scheduled assignments. To preserve your historic schedules and reports, they will be archived instead of permanently deleted.\n\nDo you want to archive this publisher?`,
                      confirmText: "Yes, Archive",
                      cancelText: "Cancel",
                      type: "warning",
                      onConfirm: async () => {
                        await db.assignees.update(id, { archived: true, active: false });
                        await addLog("enrollees", `Archived enrollee: ${enrollee.name}`);
                        setConfirmState((prev) => ({ ...prev, isOpen: false }));
                        onBack();
                      },
                    });
                  }
                }}
                className="btn-danger"
              >
                🗑️ Delete Enrollee
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Basic Info */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-900 border-b border-slate-100 pb-2">Information</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Gender</span>
              <span className="font-medium">{enrollee.gender === "M" ? "Brother" : "Sister"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Baptised</span>
              <span className="font-medium">{enrollee.baptised ? "Yes" : "No"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Minor</span>
              <span className="font-medium">{enrollee.isMinor ? "Yes" : "No"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Privileges</span>
              <div className="flex flex-wrap justify-end gap-1">
                {(enrollee.privileges ?? []).length > 0 ? (
                    (enrollee.privileges ?? []).map(p => (
                        <span key={p} className="pill bg-blue-50 text-blue-700 text-[10px] border border-blue-100">{p}</span>
                    ))
                ) : <span className="text-slate-400">—</span>}
              </div>
            </div>
            {(enrollee.isSecretary || enrollee.isServiceOverseer || enrollee.isHlcMember || enrollee.isLmmOverseer || enrollee.isWtOverseer || enrollee.isOftenAway || enrollee.isFather || enrollee.isMother || enrollee.isHusband || enrollee.isWife) && (
              <div className="flex justify-between border-t border-slate-100 pt-2">
                <span className="text-slate-500">Special Roles</span>
                <div className="flex flex-wrap justify-end gap-1">
                  {enrollee.isSecretary && <span className="pill bg-indigo-50 text-indigo-700 text-[10px] border border-indigo-100">Secretary</span>}
                  {enrollee.isServiceOverseer && <span className="pill bg-indigo-50 text-indigo-700 text-[10px] border border-indigo-100">Service Overseer</span>}
                  {enrollee.isHlcMember && <span className="pill bg-indigo-50 text-indigo-700 text-[10px] border border-indigo-100">HLC Member</span>}
                  {enrollee.isLmmOverseer && <span className="pill bg-indigo-50 text-indigo-700 text-[10px] border border-indigo-100">LMM Overseer</span>}
                  {enrollee.isWtOverseer && <span className="pill bg-indigo-50 text-indigo-700 text-[10px] border border-indigo-100">WT Overseer</span>}
                  {enrollee.isOftenAway && <span className="pill bg-amber-50 text-amber-700 text-[10px] border border-amber-100">Often Away</span>}
                  {enrollee.isFather && <span className="pill bg-indigo-50 text-indigo-700 text-[10px] border border-indigo-100">Father</span>}
                  {enrollee.isMother && <span className="pill bg-indigo-50 text-indigo-700 text-[10px] border border-indigo-100">Mother</span>}
                  {enrollee.isHusband && <span className="pill bg-indigo-50 text-indigo-700 text-[10px] border border-indigo-100">Husband</span>}
                  {enrollee.isWife && <span className="pill bg-indigo-50 text-indigo-700 text-[10px] border border-indigo-100">Wife</span>}
                </div>
              </div>
            )}
            {myHouseholds.length > 0 && (
                <div className="pt-2">
                    <span className="text-slate-500 block mb-1">Housemates</span>
                    <div className="flex flex-wrap gap-1">
                        {housemates.map(mid => {
                            const person = allAssignees?.find(a => a.id === mid);
                            if (!person) return null;
                            return (
                                <button 
                                    key={mid}
                                    onClick={() => onNavigateToProfile(mid)}
                                    className="pill bg-indigo-50 text-indigo-700 text-[10px] border border-indigo-100 hover:bg-indigo-100 transition-colors"
                                >
                                    {person.name}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}
          </div>
          {enrollee.notes && (
            <div className="pt-4 border-t border-slate-100">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase mb-2 tracking-wider">Notes</h3>
              <p className="text-sm text-slate-600 italic leading-relaxed">"{enrollee.notes}"</p>
            </div>
          )}
        </div>

        {/* Availability & Travel */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-900 border-b border-slate-100 pb-2">Availability & Travel</h2>
          
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              {isAvailableMode ? "Available Periods" : "Out of Town Periods"}
            </span>
            {(!enrollee.unavailableRanges || enrollee.unavailableRanges.length === 0) ? (
              <p className="text-xs text-slate-500 italic">
                {isAvailableMode ? "No available dates recorded." : "No travel dates recorded."}
              </p>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto custom-scrollbar">
                {enrollee.unavailableRanges.map((range, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-slate-50 px-2 py-1 rounded border border-slate-200/50 text-[11px]">
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-700">
                        {isAvailableMode ? "✅" : "✈️"} {range.start} to {range.end}
                      </span>
                      {range.reason && <span className="text-[9px] text-slate-500 font-medium">{range.reason}</span>}
                    </div>
                    <button
                      onClick={() => handleRemoveTravel(idx)}
                      className="text-rose-500 hover:text-rose-700 font-bold hover:bg-rose-50 px-1 py-0.5 rounded transition-colors text-[10px]"
                      title={isAvailableMode ? "Delete available period" : "Delete travel period"}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {/* Inline Quick Add form */}
            <div className="pt-2 border-t border-slate-100 space-y-1.5 bg-slate-50/20 p-2 rounded-lg border border-slate-200/40">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide block">
                {isAvailableMode ? "Quick Add Available Period" : "Quick Add Travel"}
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="text-[8px] uppercase font-bold text-slate-400">Start</label>
                  <input
                    type="date"
                    className="input text-[10px] py-0.5 px-1.5 h-6"
                    value={newStart}
                    onChange={(e) => handleStartChange(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[8px] uppercase font-bold text-slate-400">End</label>
                  <input
                    type="date"
                    className="input text-[10px] py-0.5 px-1.5 h-6"
                    value={newEnd}
                    onChange={(e) => setNewEnd(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="text-[8px] uppercase font-bold text-slate-400 block">
                  {isAvailableMode ? "Description (optional)" : "Reason (optional)"}
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder={isAvailableMode ? "In town, etc." : "Vacation, etc."}
                    className="input text-[10px] py-0.5 px-1.5 h-6"
                    value={newReason}
                    onChange={(e) => setNewReason(e.target.value)}
                  />
                  <button
                    disabled={!newStart || !newEnd}
                    onClick={handleAddTravel}
                    className={`btn text-[10px] px-2 py-0.5 shrink-0 h-6 flex items-center justify-center ${
                      (!newStart || !newEnd) ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Statistics */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-900 border-b border-slate-100 pb-2">Summary</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-slate-50 rounded-xl text-center border border-slate-100">
              <div className="text-2xl font-bold text-indigo-600">{stats.totalMain}</div>
              <div className="text-[10px] uppercase text-slate-400 font-bold tracking-tight">Main Parts</div>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl text-center border border-slate-100">
              <div className="text-2xl font-bold text-slate-600">{stats.totalAssistant}</div>
              <div className="text-[10px] uppercase text-slate-400 font-bold tracking-tight">Assistant</div>
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">By Segment</h3>
            <div className="space-y-1.5">
                {Object.entries(stats.bySegmentMain).map(([seg, count]) => {
                    const s = segmentOf(seg as any);
                    return (
                        <div key={seg} className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }}></div>
                            <span className="text-xs text-slate-600 flex-1">{s.label}</span>
                            <span className="text-xs font-bold text-slate-900">{count}</span>
                        </div>
                    )
                })}
            </div>
          </div>
        </div>

        {/* Insights */}
        <div className="card space-y-4 border-amber-200 bg-amber-50/20">
          <h2 className="font-semibold text-amber-900 border-b border-amber-100 pb-2">Utilization Insights</h2>
          <div className="space-y-3">
            {insights.map((insight, idx) => (
                <div key={idx} className="flex gap-2.5 text-sm">
                    <span className="text-amber-500 font-bold text-lg leading-none">✦</span>
                    <p className="text-slate-700 leading-snug">{insight}</p>
                </div>
            ))}
            {insights.length === 0 && <p className="text-sm text-slate-500 italic">No specific insights at this time.</p>}
          </div>
        </div>
      </div>

      <div className="card shadow-sm border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-slate-800">Activity History</h2>
            <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200/50">
              {(["all", "upcoming", "past"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setHistoryFilter(f)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                    historyFilter === f
                      ? "bg-white text-indigo-600 shadow-xs border border-slate-200/20"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {f === "all" ? "All" : f === "upcoming" ? "Upcoming" : "Past"}
                </button>
              ))}
            </div>
        </div>
        {filteredHistory.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-slate-400 italic">
              {history.length === 0 ? "No activity recorded yet." : "No matching activity."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Week</th>
                  <th className="px-4 py-3 text-left">Part</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left">Segment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedHistory.map(({ week, assignment, role }, idx) => {
                  const seg = segmentOf(assignment.segment);
                  return (
                    <tr 
                      key={idx} 
                      className={`transition-colors ${week.id ? 'hover:bg-indigo-50/50 cursor-pointer' : 'hover:bg-indigo-50/30'}`}
                      onClick={() => week.id && onNavigateToSchedule(week.id)}
                    >
                      <td className="px-4 py-4 whitespace-nowrap font-medium text-indigo-600">
                        {week.weekOf}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col">
                            <span className="font-bold text-slate-900">{assignment.partType}</span>
                            <span className="text-[11px] text-slate-500 truncate max-w-[250px]">{assignment.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`pill text-[11px] px-2 py-0.5 font-bold ${role === 'main' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'bg-slate-50 text-slate-600 border border-slate-100'}`}>
                            {role === 'main' ? 'MAIN' : 'ASSISTANT'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: seg.color }}></div>
                            <span className="text-slate-600 font-medium">{seg.label}</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalHistoryPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-4 py-3 sm:px-6">
              <div className="flex flex-1 justify-between sm:hidden">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  disabled={activeHistoryPage === 1}
                  className="btn-secondary text-xs py-1"
                >
                  Previous
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalHistoryPages))}
                  disabled={activeHistoryPage === totalHistoryPages}
                  className="btn-secondary text-xs py-1"
                >
                  Next
                </button>
              </div>
              <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs text-slate-500">
                    Showing <span className="font-semibold text-slate-700">{startHistoryIndex + 1}</span> to{" "}
                    <span className="font-semibold text-slate-700">
                      {Math.min(endHistoryIndex, totalHistoryItems)}
                    </span>{" "}
                    of <span className="font-semibold text-slate-700">{totalHistoryItems}</span> entries
                  </p>
                </div>
                <div>
                  <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm bg-white" aria-label="Pagination">
                    <button
                      onClick={() => setCurrentPage(1)}
                      disabled={activeHistoryPage === 1}
                      className="relative inline-flex items-center rounded-l-md px-2 py-1.5 text-xs font-semibold text-slate-500 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed bg-white"
                    >
                      « First
                    </button>
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                      disabled={activeHistoryPage === 1}
                      className="relative inline-flex items-center px-2 py-1.5 text-xs font-semibold text-slate-500 border-y border-r border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed bg-white"
                    >
                      ‹ Prev
                    </button>
                    {historyPageNumbers.map((page) => (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        style={page === activeHistoryPage ? { backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)' } : undefined}
                        className={`relative inline-flex items-center px-3 py-1.5 text-xs font-semibold border-y border-r ${
                          page === activeHistoryPage
                            ? "z-10 text-white font-bold"
                            : "text-slate-700 border-slate-200 hover:bg-slate-50 bg-white"
                        }`}
                      >
                        {page}
                      </button>
                    ))}
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(p + 1, totalHistoryPages))}
                      disabled={activeHistoryPage === totalHistoryPages}
                      className="relative inline-flex items-center px-2 py-1.5 text-xs font-semibold text-slate-500 border-y border-r border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed bg-white"
                    >
                      Next ›
                    </button>
                    <button
                      onClick={() => setCurrentPage(totalHistoryPages)}
                      disabled={activeHistoryPage === totalHistoryPages}
                      className="relative inline-flex items-center rounded-r-md px-2 py-1.5 text-xs font-semibold text-slate-500 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed bg-white"
                    >
                      Last »
                    </button>
                  </nav>
                </div>
              </div>
            </div>
          )}
          </>
        )}
      </div>
      <ConfirmationModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText={confirmState.cancelText}
        type={confirmState.type}
        showCancel={confirmState.showCancel}
        onConfirm={async () => {
          await confirmState.onConfirm();
        }}
        onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
      />
      {editOpen && (
        <EnrolleeModal
          initial={enrollee}
          onClose={() => setEditOpen(false)}
          onSave={handleSaveEnrollee}
        />
      )}
    </div>
  );
}

function calculateInsights(enrollee: Assignee, history: any[], stats: AssigneeStats, settings: AppSettings | null): string[] {
    const insights: string[] = [];
    const today = todayIso();

    // 0. Availability & Travel Alerts
    const ranges = enrollee.unavailableRanges ?? [];
    const mode = settings?.availabilityMode || "unavailable";
    
    if (mode === "available") {
        if (ranges.length > 0) {
            const currentRange = ranges.find((r) => today >= r.start && today <= r.end);
            if (currentRange) {
                insights.push(`✅ Currently available (scheduled in town from ${currentRange.start} to ${currentRange.end}${currentRange.reason ? `: ${currentRange.reason}` : ""}).`);
            } else {
                insights.push(`⚠️ Currently away/unavailable (not in any scheduled available ranges).`);
                const activeRanges = ranges.filter((r) => today <= r.end);
                if (activeRanges.length > 0) {
                    const sortedUpcoming = [...activeRanges].sort((a, b) => a.start.localeCompare(b.start));
                    const nextRange = sortedUpcoming[0];
                    insights.push(`📅 Next scheduled available period: ${nextRange.start} to ${nextRange.end}${nextRange.reason ? ` (${nextRange.reason})` : ""}.`);
                }
            }
        }
    } else {
        const activeRanges = ranges.filter((r) => today <= r.end);
        const currentRange = ranges.find((r) => today >= r.start && today <= r.end);
        if (currentRange) {
            insights.push(`⚠️ Currently away on travel (${currentRange.start} to ${currentRange.end}${currentRange.reason ? `: ${currentRange.reason}` : ""}).`);
        } else if (activeRanges.length > 0) {
            const sortedUpcoming = [...activeRanges].sort((a, b) => a.start.localeCompare(b.start));
            const nextRange = sortedUpcoming[0];
            insights.push(`✈️ Scheduled to be out of town from ${nextRange.start} to ${nextRange.end}${nextRange.reason ? ` (${nextRange.reason})` : ""}.`);
        }
    }
    


    // 1. Last assigned
    if (!stats.lastWeekMain) {
        insights.push(`${enrollee.name} has never been assigned a main part. They should be considered for one soon.`);
    } else {
        const lastDate = new Date(stats.lastWeekMain);
        const diffMs = new Date(today).getTime() - lastDate.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays > 60) {
            insights.push(`It has been ${Math.floor(diffDays / 7)} weeks since their last main assignment.`);
        }
    }

    // 2. Suggestions based on eligibility
    const allParts: PartType[] = [
        "Chairman", "Opening Prayer", "Talk", "Spiritual Gems", "Bible Reading",
        "Starting a Conversation", "Following Up", "Making Disciples", "Explaining Your Beliefs",
        "Initial Call", "Talk (Ministry)", "Living Part", "Local Needs", "Governing Body Update",
        "Congregation Bible Study", "Closing Prayer"
    ];

    const eligibleFor = allParts.filter(p => isEligible(enrollee, p, "main", "manual", settings?.assignmentRules));
    
    // Find parts they haven't done
    const doneParts = new Set(history.filter(h => h.role === 'main').map(h => h.assignment.partType));
    const neverDone = eligibleFor.filter(p => !doneParts.has(p));

    if (neverDone.length > 0) {
        const sample = neverDone.slice(0, 3).join(", ");
        insights.push(`Eligible for but hasn't yet handled: ${sample}.`);
    }

    // 3. Specific suggestions
    if (enrollee.gender === 'M' && enrollee.baptised && !enrollee.privileges?.includes('MS')) {
        insights.push(`As a baptised brother, he could be encouraged toward Spiritual Gems or Bible Reading parts.`);
    }

    if (enrollee.isMinor) {
        insights.push(`As a minor, they should preferably be paired with experienced adult assistants.`);
    }

    // 4. Overutilization check
    if (stats.totalMain > 0) {
        // Simple heuristic: if they have more than 4 main parts and the average gap is small
        const totalWeeks = history.length > 0 ? (new Date(today).getTime() - new Date(history[history.length-1].week.weekOf).getTime()) / (1000 * 60 * 60 * 24 * 7) : 1;
        const freq = stats.totalMain / (totalWeeks || 1);
        if (freq > 0.4) {
            insights.push(`Being assigned frequently (approx. every ${Math.max(2, Math.round(1/freq))} weeks). Consider a longer break.`);
        }
    }

    return insights;
}
