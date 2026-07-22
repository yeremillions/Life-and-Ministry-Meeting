import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { db } from "../db";
import { buildStats } from "../scheduler";
import { findWeekConflicts } from "./Dashboard";
import type { Conflict } from "./Dashboard";
import { weekRangeLabel, toIso, mondayOf } from "../utils";
import type { Week, Assignee } from "../types";
import ConfirmationModal from "../components/ConfirmationModal";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function formatYearMonth(ym: string) {
  const [y, m] = ym.split("-");
  const monthIdx = parseInt(m, 10) - 1;
  const monthName = monthIdx >= 0 && monthIdx < 12 ? MONTH_NAMES[monthIdx] : m;
  return `${monthName} ${y}`;
}

export default function ConflictsPage({
  onBack,
  onNavigate,
  onNavigateToProfile,
}: {
  onBack: () => void;
  onNavigate: (tab: any, weekId?: number) => void;
  onNavigateToProfile: (id: number) => void;
}) {
  const rawAssignees = useLiveQuery(() => db.assignees.orderBy("name").toArray(), []) ?? [];
  const rawWeeks = useLiveQuery(() => db.weeks.orderBy("weekOf").toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.get("app"), []) ?? null;
  const households = useLiveQuery(() => db.households.toArray(), []) ?? [];
  const weekendMeetings = useLiveQuery(() => db.weekendMeetings.toArray(), []) ?? [];

  // Sanitise data as done in Dashboard
  const assignees = useMemo(() => {
    return rawAssignees
      .filter((a): a is Assignee => a != null && typeof a.name === "string")
      .map((a) => ({
        ...a,
        id: typeof a.id === "number" ? a.id : undefined,
        name: typeof a.name === "string" ? a.name : "Unknown Enrollee",
        gender: a.gender === "M" || a.gender === "F" ? a.gender : "M",
        baptised: typeof a.baptised === "boolean" ? a.baptised : false,
        privileges: Array.isArray(a.privileges) ? a.privileges : [],
        active: typeof a.active === "boolean" ? a.active : true,
      }));
  }, [rawAssignees]);

  const weeks = useMemo(() => {
    return rawWeeks
      .filter((w): w is Week => w != null && typeof w.weekOf === "string" && Array.isArray(w.assignments))
      .map((w) => {
        const sanitizedAssignments = w.assignments
          .filter((a): a is any => a != null && typeof a === "object")
          .map((a) => ({
            uid: typeof a.uid === "string" ? a.uid : String(Math.random()),
            segment: typeof a.segment === "string" ? a.segment : "opening",
            order: typeof a.order === "number" ? a.order : 1,
            partType: typeof a.partType === "string" ? a.partType : "Bible Reading",
            title: typeof a.title === "string" ? a.title : "",
            assigneeId: typeof a.assigneeId === "number" ? a.assigneeId : undefined,
            assistantId: typeof a.assistantId === "number" ? a.assistantId : undefined,
            note: typeof a.note === "string" ? a.note : undefined,
            minutes: typeof a.minutes === "number" ? a.minutes : undefined,
          }));
        return {
          ...w,
          assignments: sanitizedAssignments,
        };
      });
  }, [rawWeeks]);

  // Filters State
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("4w");
  const [status, setStatus] = useState<"all" | "pending" | "ignored">("pending");
  const [severity, setSeverity] = useState<"all" | "error" | "warning">("all");
  const [ruleType, setRuleType] = useState("all");

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    type?: "danger" | "warning" | "info";
    onConfirm: () => void | Promise<void>;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  // Calculate unique months in database for dropdown
  const uniqueMonths = useMemo(() => {
    const months = new Set<string>();
    for (const w of weeks) {
      if (w.weekOf) {
        months.add(w.weekOf.slice(0, 7)); // YYYY-MM
      }
    }
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [weeks]);

  // Get current Monday to filter periods
  const currentMonday = useMemo(() => toIso(mondayOf(new Date())), []);

  // Filter weeks by scheduling period
  const periodWeeks = useMemo(() => {
    let list = [...weeks];
    if (period === "4w") {
      list = list.filter((w) => w.weekOf >= currentMonday).slice(0, 4);
    } else if (period === "8w") {
      list = list.filter((w) => w.weekOf >= currentMonday).slice(0, 8);
    } else if (period === "upcoming") {
      list = list.filter((w) => w.weekOf >= currentMonday);
    } else if (period !== "all") {
      // It's a YYYY-MM string
      list = list.filter((w) => w.weekOf.startsWith(period));
    }
    return list;
  }, [weeks, period, currentMonday]);

  // Generate conflicts for the selected weeks
  const allPeriodConflicts = useMemo(() => {
    const stats = buildStats(assignees, weeks);
    return periodWeeks.flatMap((w) => findWeekConflicts(w, assignees, households, settings, stats, weeks, weekendMeetings));
  }, [periodWeeks, assignees, weeks, households, settings, weekendMeetings]);

  // Read ignored list from settings
  const ignoredList = useMemo(() => settings?.ignoredConflicts ?? [], [settings]);

  // Apply filters to conflicts
  const filteredConflicts = useMemo(() => {
    return allPeriodConflicts.filter((c) => {
      const isIgnored = ignoredList.includes(c.id);

      // Status Filter
      if (status === "pending" && isIgnored) return false;
      if (status === "ignored" && !isIgnored) return false;

      // Severity Filter
      if (severity !== "all" && c.severity !== severity) return false;

      // Rule Type Filter
      if (ruleType !== "all" && c.ruleName !== ruleType) return false;

      // Search Filter
      if (search.trim()) {
        const query = search.toLowerCase().trim();
        const assigneeName = c.assigneeId
          ? assignees.find((p) => p.id === c.assigneeId)?.name?.toLowerCase() ?? ""
          : "";
        const assistantName = c.assistantId
          ? assignees.find((p) => p.id === c.assistantId)?.name?.toLowerCase() ?? ""
          : "";
        const msg = c.message.toLowerCase();
        const rule = c.ruleName.toLowerCase();
        const title = c.partTitle?.toLowerCase() ?? "";
        const type = c.partType.toLowerCase();
        const week = weekRangeLabel(c.weekOf).toLowerCase();

        const matches = 
          assigneeName.includes(query) ||
          assistantName.includes(query) ||
          msg.includes(query) ||
          rule.includes(query) ||
          title.includes(query) ||
          type.includes(query) ||
          week.includes(query);

        if (!matches) return false;
      }

      return true;
    });
  }, [allPeriodConflicts, ignoredList, status, severity, ruleType, search, assignees]);

  // Extract unique rule types in current period conflicts for filter dropdown
  const uniqueRules = useMemo(() => {
    const rules = new Set<string>();
    for (const c of allPeriodConflicts) {
      rules.add(c.ruleName);
    }
    return Array.from(rules).sort();
  }, [allPeriodConflicts]);

  // Calculate statistics for metrics cards
  const statsSummary = useMemo(() => {
    let pending = 0;
    let ignored = 0;
    let errors = 0;
    let warnings = 0;

    for (const c of allPeriodConflicts) {
      const isIgnored = ignoredList.includes(c.id);
      if (isIgnored) {
        ignored++;
      } else {
        pending++;
        if (c.severity === "error") {
          errors++;
        } else {
          warnings++;
        }
      }
    }

    return {
      total: allPeriodConflicts.length,
      pending,
      ignored,
      errors,
      warnings,
    };
  }, [allPeriodConflicts, ignoredList]);

  // Conflicts grouped by week
  const groupedConflicts = useMemo(() => {
    const map = new Map<string, { weekId: number; weekOf: string; list: Conflict[] }>();
    
    // Sort chronologically
    const sorted = [...filteredConflicts].sort((a, b) => a.weekOf.localeCompare(b.weekOf));

    for (const c of sorted) {
      if (!map.has(c.weekOf)) {
        map.set(c.weekOf, { weekId: c.weekId, weekOf: c.weekOf, list: [] });
      }
      map.get(c.weekOf)!.list.push(c);
    }

    return Array.from(map.values());
  }, [filteredConflicts]);

  // Action: Toggle single ignore
  const handleToggleIgnore = async (conflict: Conflict) => {
    const isIgnored = ignoredList.includes(conflict.id);

    if (!isIgnored) {
      // Confirm ignore
      setConfirmState({
        isOpen: true,
        title: "Ignore Conflict Warning",
        message: `Are you sure you want to ignore this conflict? It will be hidden from the dashboard and default pending list.\n\n"${conflict.message}"`,
        confirmText: "Ignore",
        cancelText: "Cancel",
        type: "warning",
        onConfirm: async () => {
          const currentIgnored = settings?.ignoredConflicts ?? [];
          if (!currentIgnored.includes(conflict.id)) {
            await db.settings.update("app", {
              ignoredConflicts: [...currentIgnored, conflict.id],
            });
          }
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
        },
      });
    } else {
      // Restore immediately
      const currentIgnored = settings?.ignoredConflicts ?? [];
      const updated = currentIgnored.filter((id) => id !== conflict.id);
      await db.settings.update("app", {
        ignoredConflicts: updated,
      });
    }
  };

  // Bulk Actions
  const handleIgnoreAllFiltered = () => {
    const pendingFiltered = filteredConflicts.filter((c) => !ignoredList.includes(c.id));
    if (pendingFiltered.length === 0) return;

    setConfirmState({
      isOpen: true,
      title: `Ignore ${pendingFiltered.length} Conflicts`,
      message: `You are about to bulk-ignore ${pendingFiltered.length} conflict(s) currently shown. They will be hidden from the dashboard.`,
      confirmText: "Ignore All",
      cancelText: "Cancel",
      type: "warning",
      onConfirm: async () => {
        const idsToIgnore = pendingFiltered.map((c) => c.id);
        const currentIgnored = settings?.ignoredConflicts ?? [];
        const merged = Array.from(new Set([...currentIgnored, ...idsToIgnore]));
        await db.settings.update("app", {
          ignoredConflicts: merged,
        });
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  const handleRestoreAllFiltered = () => {
    const ignoredFiltered = filteredConflicts.filter((c) => ignoredList.includes(c.id));
    if (ignoredFiltered.length === 0) return;

    setConfirmState({
      isOpen: true,
      title: `Restore ${ignoredFiltered.length} Conflicts`,
      message: `You are about to restore ${ignoredFiltered.length} conflict(s) currently shown to "Pending Review" status.`,
      confirmText: "Restore All",
      cancelText: "Cancel",
      type: "info",
      onConfirm: async () => {
        const idsToRestore = new Set(ignoredFiltered.map((c) => c.id));
        const currentIgnored = settings?.ignoredConflicts ?? [];
        const updated = currentIgnored.filter((id) => !idsToRestore.has(id));
        await db.settings.update("app", {
          ignoredConflicts: updated,
        });
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  const handleRestoreAllIgnoredGlobal = () => {
    if (ignoredList.length === 0) return;

    setConfirmState({
      isOpen: true,
      title: "Restore All Ignored Conflicts",
      message: `Are you sure you want to restore all ${ignoredList.length} ignored conflict warnings across the entire database?`,
      confirmText: "Yes, Restore All",
      cancelText: "Cancel",
      type: "info",
      onConfirm: async () => {
        await db.settings.update("app", {
          ignoredConflicts: [],
        });
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  return (
    <div className="space-y-5">
      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText={confirmState.cancelText}
        type={confirmState.type}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* ── Breadcrumb ────────────────────────────────────────────── */}
      <div>
        <button
          onClick={onBack}
          className="text-xs font-semibold flex items-center gap-1 hover:underline text-slate-500 hover:text-slate-800 transition-colors"
        >
          <span>←</span> Back to Dashboard
        </button>
      </div>

      {/* ── Page Header ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 leading-tight">Conflicts &amp; Warnings Manager</h1>
          <p className="text-xs text-slate-500 mt-1">
            Review and resolve scheduling rule conflicts, pairing issues, and availability mismatches.
          </p>
        </div>
        {ignoredList.length > 0 && (
          <button
            onClick={handleRestoreAllIgnoredGlobal}
            className="btn bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 py-1.5 px-3 text-xs shadow-sm flex items-center gap-1.5 font-semibold shrink-0"
            title="Restore all ignored conflicts in settings"
          >
            <span>🔄 Restore All {ignoredList.length} Ignored</span>
          </button>
        )}
      </div>

      {/* ── Metrics Cards Summary ─────────────────────────────────── */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card bg-slate-50/50 p-4 border border-slate-200">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Scanned</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{statsSummary.total}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">detected in selected period</div>
        </div>
        <div className="card p-4 border border-slate-200">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pending Review</div>
          <div className={`text-2xl font-bold mt-1 ${statsSummary.pending > 0 ? "text-amber-600" : "text-emerald-600"}`}>
            {statsSummary.pending}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">active issues needing attention</div>
        </div>
        <div className="card p-4 border border-slate-200">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Ignored</div>
          <div className="text-2xl font-bold text-slate-600 mt-1">{statsSummary.ignored}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">archived / skipped warnings</div>
        </div>
        <div className="card p-4 border border-slate-200">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Critical Errors</div>
          <div className={`text-2xl font-bold mt-1 ${statsSummary.errors > 0 ? "text-rose-600" : "text-slate-500"}`}>
            {statsSummary.errors}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">must resolve rules ({statsSummary.warnings} warnings)</div>
        </div>
      </section>

      {/* ── Filter Controls Card ──────────────────────────────────── */}
      <div className="card p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {/* Search bar */}
          <div className="flex flex-col">
            <span className="label">Search</span>
            <input
              type="search"
              className="input py-1.5"
              placeholder="Search enrollees, parts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Period Selector */}
          <div className="flex flex-col">
            <span className="label">Scheduling Period</span>
            <select
              className="input py-1.5"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="4w">Next 4 Weeks</option>
              <option value="8w">Next 8 Weeks</option>
              <option value="upcoming">All Upcoming Weeks</option>
              <option value="all">All Weeks</option>
              {uniqueMonths.length > 0 && (
                <>
                  <option disabled style={{ borderTop: "1px solid #e2e8f0" }}>──────────</option>
                  {uniqueMonths.map((m) => (
                    <option key={m} value={m}>
                      {formatYearMonth(m)}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>

          {/* Severity Selector */}
          <div className="flex flex-col">
            <span className="label">Severity</span>
            <select
              className="input py-1.5"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as any)}
            >
              <option value="all">All Severities</option>
              <option value="error">Critical Errors Only</option>
              <option value="warning">Warnings Only</option>
            </select>
          </div>

          {/* Rule Type Filter */}
          <div className="flex flex-col">
            <span className="label">Rule Mismatch</span>
            <select
              className="input py-1.5"
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value)}
            >
              <option value="all">All Rules</option>
              {uniqueRules.map((rule) => (
                <option key={rule} value={rule}>
                  {rule}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status Tab buttons & Bulk actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between border-t border-slate-100 pt-4 gap-3 flex-wrap">
          {/* Status Tabs */}
          <div className="flex bg-slate-100 p-1 rounded-lg self-start">
            <button
              onClick={() => setStatus("pending")}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                status === "pending" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <span>Pending Review</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold leading-none ${
                status === "pending" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-600"
              }`}>
                {statsSummary.pending}
              </span>
            </button>
            <button
              onClick={() => setStatus("ignored")}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                status === "ignored" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <span>Ignored</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold leading-none ${
                status === "ignored" ? "bg-slate-200 text-slate-700" : "bg-slate-200 text-slate-600"
              }`}>
                {statsSummary.ignored}
              </span>
            </button>
            <button
              onClick={() => setStatus("all")}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                status === "all" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <span>All</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold leading-none ${
                status === "all" ? "bg-slate-200 text-slate-700" : "bg-slate-200 text-slate-600"
              }`}>
                {statsSummary.total}
              </span>
            </button>
          </div>

          {/* Bulk actions */}
          <div className="flex gap-2 items-center flex-wrap">
            {status === "pending" && filteredConflicts.length > 0 && (
              <button
                onClick={handleIgnoreAllFiltered}
                className="btn bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs border border-slate-200 py-1.5 px-3 font-semibold transition-colors flex items-center gap-1"
              >
                <span>🔕 Ignore Visible ({filteredConflicts.length})</span>
              </button>
            )}
            {status === "ignored" && filteredConflicts.length > 0 && (
              <button
                onClick={handleRestoreAllFiltered}
                className="btn bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs border border-indigo-200 py-1.5 px-3 font-semibold transition-colors flex items-center gap-1"
              >
                <span>🔄 Restore Visible ({filteredConflicts.length})</span>
              </button>
            )}
            <span className="text-xs text-slate-400 font-medium">
              Showing {filteredConflicts.length} of {allPeriodConflicts.length} detected issues
            </span>
          </div>
        </div>
      </div>

      {/* ── Conflicts Group List ──────────────────────────────────── */}
      {groupedConflicts.length === 0 ? (
        <div className="card p-8 text-center space-y-3 bg-white border border-slate-200">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-50 text-emerald-600">
            <span className="text-2xl">✅</span>
          </div>
          <h3 className="font-semibold text-base text-slate-800">All Clear!</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            No scheduling conflicts or warning issues match your current filters. Adjust your period or status filters to scan other records.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedConflicts.map((group) => (
            <div key={group.weekOf} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden animate-fade-in">
              {/* Group Header */}
              <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs text-slate-700 uppercase tracking-wider">
                    Week of {weekRangeLabel(group.weekOf)}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400 bg-slate-200/50 border border-slate-200/80 px-2 py-0.5 rounded-full">
                    {group.list.length} {group.list.length === 1 ? "issue" : "issues"}
                  </span>
                </div>
                <button
                  onClick={() => onNavigate("schedule", group.weekId)}
                  className="text-[11px] font-bold hover:underline transition-all flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded text-slate-700 shadow-xs"
                >
                  <span>Fix Schedule Editor</span>
                  <span className="text-xs">🗓️</span>
                </button>
              </div>

              {/* Group List */}
              <div className="divide-y divide-slate-100">
                {group.list.map((c) => {
                  const assigneeName = c.assigneeId
                    ? assignees.find((p) => p.id === c.assigneeId)?.name
                    : null;
                  const assistantName = c.assistantId
                    ? assignees.find((p) => p.id === c.assistantId)?.name
                    : null;
                  const isError = c.severity === "error";
                  const isIgnored = ignoredList.includes(c.id);

                  return (
                    <div key={c.id} className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                      {/* Severity Icon */}
                      <span className={`text-xl shrink-0 mt-0.5 ${isError ? "text-rose-500" : "text-amber-500"}`}>
                        {isError ? "🛑" : "⚠️"}
                      </span>

                      {/* Main Message Block */}
                      <div className="flex-1 space-y-2 min-w-0">
                        {/* Tags */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-800 text-xs shrink-0 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                            {c.partTitle || c.partType}
                          </span>
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                            isError 
                              ? "bg-rose-50 border-rose-200 text-rose-700" 
                              : "bg-amber-50 border-amber-200 text-amber-700"
                          }`}>
                            {c.ruleName}
                          </span>
                          {isIgnored && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border bg-slate-50 border-slate-200 text-slate-500 italic">
                              Ignored
                            </span>
                          )}
                        </div>

                        {/* Description */}
                        <p className="text-xs text-slate-700 font-medium leading-relaxed break-words pr-2">
                          {c.message}
                        </p>

                        {/* Action details & Enrollees */}
                        <div className="flex flex-wrap items-center gap-2 pt-0.5 w-full">
                          <div className="flex flex-wrap items-center gap-2">
                            {assigneeName && c.assigneeId && (
                              <button
                                onClick={() => onNavigateToProfile(c.assigneeId!)}
                                className="text-[10px] font-semibold bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded px-2.5 py-1 transition-all flex items-center gap-1 text-slate-700"
                              >
                                <span>👤 {assigneeName}</span>
                              </button>
                            )}
                            {assistantName && c.assistantId && (
                              <button
                                onClick={() => onNavigateToProfile(c.assistantId!)}
                                className="text-[10px] font-semibold bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded px-2.5 py-1 transition-all flex items-center gap-1 text-slate-700"
                              >
                                <span>👥 Assistant: {assistantName}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right Action buttons */}
                      <div className="shrink-0 flex items-center self-center pl-2">
                        <button
                          onClick={() => handleToggleIgnore(c)}
                          className={`text-xs font-semibold py-1.5 px-3 rounded-lg border transition-all flex items-center gap-1 cursor-pointer ${
                            isIgnored
                              ? "bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-700"
                              : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-500 hover:text-slate-700"
                          }`}
                          title={isIgnored ? "Restore this conflict to Pending Review" : "Ignore this conflict warning"}
                        >
                          {isIgnored ? (
                            <>
                              <span>🔄 Restore</span>
                            </>
                          ) : (
                            <>
                              <span>🔕 Ignore</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
