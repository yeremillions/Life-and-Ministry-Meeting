import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { db, ensureSettings, addLog } from "../db";
import {
  Assignee,
  Assignment,
  DEFAULT_SETTINGS,
  PartType,
  SegmentId,
  Week,
} from "../types";

import { autoAssignWeek } from "../scheduler";
import { nextMondayIso, uid, weekRangeLabel, workbookPeriod } from "../utils";
import { ensureRequiredParts, byOrder } from "../meeting";
import WeekEditor from "../components/WeekEditor";
import WorkbookImportModal from "../components/WorkbookImportModal";
import S140ImportModal from "../components/S140ImportModal";
import ExportPdfModal from "../components/ExportPdfModal";
import CompletionModal from "../components/CompletionModal";
import { ensureSettings as getSettings } from "../db";

function buildEmptyWeek(weekOf: string): Week {
  const now = Date.now();
  // Start with common defaults for ministry demos
  const ministryDefaults: Assignment[] = [
    { uid: uid(), segment: "ministry", order: 4, partType: "Starting a Conversation", title: "" },
    { uid: uid(), segment: "ministry", order: 5, partType: "Following Up", title: "" },
    { uid: uid(), segment: "ministry", order: 6, partType: "Making Disciples", title: "" },
  ];
  return {
    weekOf,
    assignments: ensureRequiredParts(ministryDefaults, uid),
    createdAt: now,
    updatedAt: now,
  };
}

export default function SchedulePage({
  initialWeekId,
  onConsumeInitialWeek,
  onNavigateToProfile,
}: {
  initialWeekId?: number | null;
  onConsumeInitialWeek?: () => void;
  onNavigateToProfile: (id: number) => void;
} = {} as any) {
  const weeks =
    useLiveQuery(() => db.weeks.orderBy("weekOf").reverse().toArray(), []) ??
    [];
  const assignees =
    useLiveQuery(() => db.assignees.orderBy("name").toArray(), []) ?? [];
  const households =
    useLiveQuery(() => db.households.orderBy("name").toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.get("app"), []) || null;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [importingWorkbook, setImportingWorkbook] = useState(false);
  const [importingS140, setImportingS140] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [lastImportCount, setLastImportCount] = useState<number | null>(null);
  const [congregationName, setCongregationName] = useState("");

  // Load congregation name once (needed for PDF header).
  useEffect(() => {
    getSettings().then((s) => setCongregationName(s.congregationName ?? ""));
  }, []);

  useEffect(() => {
    if (initialWeekId != null) {
      setSelectedId(initialWeekId);
      onConsumeInitialWeek?.();
    }
  }, [initialWeekId]);

  const selected = useMemo(
    () => weeks.find((w) => w.id === selectedId) ?? null,
    [weeks, selectedId]
  );

  // Workbook period of the currently-selected week (used as default in export modal).
  const currentPeriodKey = selected
    ? workbookPeriod(selected.weekOf).key
    : weeks.length > 0
    ? workbookPeriod(weeks[0].weekOf).key
    : undefined;

  async function createWeek(weekOf: string) {
    const existing = await db.weeks.where("weekOf").equals(weekOf).first();
    if (existing) {
      setSelectedId(existing.id ?? null);
      setCreatingOpen(false);
      return;
    }
    const id = await db.weeks.add(buildEmptyWeek(weekOf));
    setSelectedId(id);
    setCreatingOpen(false);
  }

  async function saveWeek(updated: Week) {
    if (updated.id == null) return;
    await db.weeks.put(updated);
  }

  async function deleteWeek(id: number) {
    if (!confirm("Delete this week's schedule?")) return;
    await db.weeks.delete(id);
    if (selectedId === id) setSelectedId(null);
  }

  async function autoFill(week: Week, preserveExisting: boolean) {
    const settings = await ensureSettings();
    const allWeeks = await db.weeks.toArray();
    const updated = autoAssignWeek(week, assignees, allWeeks, {
      privilegedMinistryShare: settings.privilegedMinistryShare,
      preserveExisting,
      minGapWeeks: settings.minGapWeeks ?? 2,
      chairmanGapWeeks: settings.chairmanGapWeeks ?? 3,
      catchUpIntensity: settings.catchUpIntensity ?? 1,
      maxAssignmentsPerMonth: settings.maxAssignmentsPerMonth ?? 2,
      assignmentRules: settings.assignmentRules,
    });
    await saveWeek(updated);
    await addLog(
      "schedule",
      preserveExisting ? "Auto-fill empty slots" : "Auto-assign all parts",
      `Week of ${week.weekOf}`
    );
  }

  async function clearAssignments(week: Week) {
    const cleared = {
      ...week,
      assignments: week.assignments.map((a) => ({
        ...a,
        assigneeId: undefined,
        assistantId: undefined,
      })),
    };
    await saveWeek(cleared);
    await addLog("schedule", "Cleared all assignments", `Week of ${week.weekOf}`);
  }

  function addPart(week: Week, segment: SegmentId, partType: PartType) {
    const lastOrder = week.assignments.reduce((m, a) => Math.max(m, a.order), 0);
    const updated: Week = {
      ...week,
      assignments: [
        ...week.assignments,
        {
          uid: uid(),
          segment,
          order: lastOrder + 1,
          partType,
          title: "",
        },
      ],
    };
    // Re-sort by segment then order
    updated.assignments.sort(byOrder);
    saveWeek(updated);
  }

  function removePart(week: Week, assignmentUid: string) {
    const updated: Week = {
      ...week,
      assignments: week.assignments.filter((a) => a.uid !== assignmentUid),
    };
    saveWeek(updated);
  }

  function updateAssignment(week: Week, next: Assignment) {
    const updated: Week = {
      ...week,
      assignments: week.assignments.map((a) =>
        a.uid === next.uid ? next : a
      ),
    };
    saveWeek(updated);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px,1fr] gap-6">
      <aside className="space-y-3">
        <div className="flex flex-col gap-2">
          <button
            className="btn w-full"
            onClick={() => setCreatingOpen(true)}
          >
            + New week
          </button>
          <button
            className="btn-secondary w-full"
            onClick={() => {
              setLastImportCount(null);
              setImportingWorkbook(true);
            }}
            title="Upload a workbook PDF to extract every week"
          >
            Import workbook PDF
          </button>
          <button
            className="btn-secondary w-full"
            onClick={() => {
              setLastImportCount(null);
              setImportingS140(true);
            }}
            title="Upload a filled S-140 schedule to import parts and assignees"
          >
            Import S-140 schedule
          </button>
          <button
            className="btn w-full flex items-center justify-center gap-2 relative overflow-hidden group"
            onClick={() => setExportingPdf(true)}
            title="Download the official S-140 Meeting Schedule PDF"
            disabled={weeks.length === 0}
          >
            <span>Download S-140 Meeting Schedule</span>
            <svg
              className="w-4 h-4 text-white/80 group-hover:text-white transition-colors"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
              {/* PDF-like icon */}
              <path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3.5h-3V10h2v1.5h-2v1.5H19v-5zM9 8.5V10h1v-.5H9v-1zm5 4h1V8.5h-1v4z" />
            </svg>
          </button>
          {lastImportCount != null && (
            <p className="text-xs text-emerald-700">
              Imported {lastImportCount} week{lastImportCount === 1 ? "" : "s"}.
            </p>
          )}
        </div>
        <div className="card p-0 overflow-hidden">
          <div className="px-3 py-2 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
            Weeks
          </div>
          {weeks.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">No weeks yet.</p>
          ) : (
            <WeekListGrouped
              weeks={weeks}
              selectedId={selectedId}
              onSelect={(id) => setSelectedId(id)}
              assignees={assignees}
              congregationName={congregationName}
            />
          )}
        </div>
      </aside>

      <section>
        {selected ? (
          <WeekEditor
            week={selected}
            assignees={assignees}
            households={households}
            onSave={saveWeek}
            onDelete={() => selected.id != null && deleteWeek(selected.id)}
            onAutoFill={(preserve) => autoFill(selected, preserve)}
            onClear={() => clearAssignments(selected)}
            onAddPart={(segment, partType) => addPart(selected, segment, partType)}
            onRemovePart={(uid) => removePart(selected, uid)}
            onUpdateAssignment={(a) => updateAssignment(selected, a)}
            onNavigateToProfile={onNavigateToProfile}
            allWeeks={weeks}
            settings={
              settings
                ? { ...DEFAULT_SETTINGS, ...settings }
                : DEFAULT_SETTINGS
            }
            onSelectWeek={(id) => setSelectedId(id)}
          />
        ) : (
          <div className="card">
            <p className="text-sm text-slate-500">
              Select a week on the left, or create a new one.
            </p>
          </div>
        )}
      </section>

      {creatingOpen && (
        <NewWeekModal
          onClose={() => setCreatingOpen(false)}
          existingWeeks={weeks.map((w) => w.weekOf)}
          onCreate={createWeek}
        />
      )}

      {importingWorkbook && (
        <WorkbookImportModal
          onClose={() => setImportingWorkbook(false)}
          existingWeekOfs={weeks.map((w) => w.weekOf)}
          onImported={(n) => setLastImportCount(n)}
        />
      )}

      {importingS140 && (
        <S140ImportModal
          onClose={() => setImportingS140(false)}
          existingWeekOfs={weeks.map((w) => w.weekOf)}
          assignees={assignees}
          onImported={(n) => setLastImportCount(n)}
        />
      )}

      {exportingPdf && (
        <ExportPdfModal
          weeks={weeks}
          assignees={assignees}
          congregationName={congregationName}
          currentPeriodKey={currentPeriodKey}
          onClose={() => setExportingPdf(false)}
        />
      )}
    </div>
  );
}


function NewWeekModal({
  onClose,
  onCreate,
  existingWeeks,
}: {
  onClose: () => void;
  onCreate: (weekOf: string) => void;
  existingWeeks: string[];
}) {
  const lastWeek = existingWeeks.sort().slice(-1)[0];
  const [date, setDate] = useState(nextMondayIso(lastWeek));

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold mb-3">Create meeting week</h3>
        <label className="label">Week of (Monday)</label>
        <input
          type="date"
          className="input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={() => onCreate(date)}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Week list grouped by workbook period ────────────────────────────────────

function WeekListGrouped({
  weeks,
  selectedId,
  onSelect,
  assignees,
  congregationName,
}: {
  weeks: Week[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  assignees: Assignee[];
  congregationName: string;
}) {
  const [completionPeriod, setCompletionPeriod] = useState<{key: string, label: string, weeks: Week[]} | null>(null);
  const [notifiedPeriods, setNotifiedPeriods] = useState<Set<string>>(new Set());
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayKey = workbookPeriod(todayIso).key;

  // ── Year selector ────────────────────────────────────────────────────
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const w of weeks) {
      // Use the year from the workbook period key (not raw weekOf),
      // so a late-December week that belongs to a Jan–Feb workbook
      // goes into the correct bucket.
      const periodYear = parseInt(workbookPeriod(w.weekOf).key.slice(0, 4), 10);
      years.add(periodYear);
      // Also add the calendar year of weekOf in case it differs
      years.add(new Date(w.weekOf + "T00:00:00").getFullYear());
    }
    return [...years].sort((a, b) => b - a); // newest first
  }, [weeks]);

  const currentYear = new Date().getFullYear();
  const [activeYear, setActiveYear] = useState<number>(
    availableYears.includes(currentYear)
      ? currentYear
      : availableYears[0] ?? currentYear
  );

  // Keep activeYear in sync when new weeks are imported
  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(activeYear)) {
      setActiveYear(availableYears[0]);
    }
  }, [availableYears]);

  // Filter weeks to the active year using the workbook period's year,
  // which is the canonical year for grouping (handles year-boundary weeks).
  const filteredWeeks = useMemo(() => {
    return weeks.filter((w) => {
      const periodYear = parseInt(workbookPeriod(w.weekOf).key.slice(0, 4), 10);
      return periodYear === activeYear;
    });
  }, [weeks, activeYear]);

  // Group filtered weeks by bi-monthly workbook period
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; weeks: Week[] }>();
    for (const w of filteredWeeks) {
      const { key, label } = workbookPeriod(w.weekOf);
      if (!map.has(key)) map.set(key, { key, label, weeks: [] });
      map.get(key)!.weeks.push(w);
    }
    return [...map.values()];
  }, [filteredWeeks]);

  // Which group does the selected week belong to?
  const selectedGroupKey = useMemo(() => {
    if (selectedId == null) return null;
    const w = weeks.find((x) => x.id === selectedId);
    return w ? workbookPeriod(w.weekOf).key : null;
  }, [selectedId, weeks]);

  // Accordion: only one group open at a time.
  // Default: open the group containing the CURRENT calendar month.
  const defaultOpenKey = useMemo(() => {
    // If a week is already selected, open its group.
    if (selectedGroupKey && groups.some((g) => g.key === selectedGroupKey)) {
      return selectedGroupKey;
    }
    // Open the group that contains today's date.
    const todayGroup = groups.find((g) => g.key === todayKey);
    if (todayGroup) return todayGroup.key;
    // Fall back to the first current/future group.
    for (const g of groups) {
      if (g.key >= todayKey) return g.key;
    }
    // Last resort: last group in the list.
    return groups.length > 0 ? groups[groups.length - 1].key : null;
  }, [groups, todayKey, selectedGroupKey]);

  const [openGroup, setOpenGroup] = useState<string | null>(defaultOpenKey);

  // Sync openGroup when defaultOpenKey changes (e.g. on first load).
  useEffect(() => {
    if (openGroup == null && defaultOpenKey != null) {
      setOpenGroup(defaultOpenKey);
    }
  }, [defaultOpenKey]);

  // Congratulations detection: Check if any period just became 100% full
  useEffect(() => {
    if (weeks.length === 0) return;
    
    // Group all weeks by period
    const periodMap = new Map<string, {key: string, label: string, weeks: Week[]}>();
    for (const w of weeks) {
      const { key, label } = workbookPeriod(w.weekOf);
      if (!periodMap.has(key)) periodMap.set(key, { key, label, weeks: [] });
      periodMap.get(key)!.weeks.push(w);
    }

    for (const group of periodMap.values()) {
      const totalParts = group.weeks.reduce((s, w) => s + w.assignments.length, 0);
      const filledParts = group.weeks.reduce((s, w) => s + w.assignments.filter(a => a.assigneeId).length, 0);
      
      const isFull = totalParts > 0 && filledParts === totalParts;
      
      if (isFull && !notifiedPeriods.has(group.key)) {
        // This period is full and we haven't notified yet.
        // But only trigger if it's the current or a future period to avoid spamming old history.
        if (group.key >= todayKey) {
          setCompletionPeriod(group);
          setNotifiedPeriods(prev => new Set(prev).add(group.key));
        }
      } else if (!isFull && notifiedPeriods.has(group.key)) {
        // If it was full but now isn't (unassigned), remove from notified set so it can trigger again.
        setNotifiedPeriods(prev => {
          const next = new Set(prev);
          next.delete(group.key);
          return next;
        });
      }
    }
  }, [weeks, notifiedPeriods, todayKey]);

  // If the selected week changes to a different group, switch to it.
  useEffect(() => {
    if (selectedGroupKey) {
      setOpenGroup(selectedGroupKey);
    }
  }, [selectedGroupKey]);

  // When year changes, auto-open the best group for that year.
  useEffect(() => {
    if (groups.length > 0) {
      // If viewing the current year, open the current period.
      if (activeYear === currentYear) {
        const current = groups.find((g) => g.key === todayKey);
        setOpenGroup(current ? current.key : groups[0].key);
      } else {
        // For other years, open the first group.
        setOpenGroup(groups[0].key);
      }
    } else {
      setOpenGroup(null);
    }
  }, [activeYear, groups.length]);

  async function moveGroupToYear(group: { key: string; label: string; weeks: Week[] }) {
    const currentYear = group.key.slice(0, 4);
    const targetYear = window.prompt(
      `Move "${group.label}" to a different year?\n\n` +
      `Currently assigned to: ${currentYear}\n` +
      `This will update all weeks in this period to the year you enter below.`,
      currentYear
    );

    if (!targetYear || targetYear === currentYear) return;
    const yearNum = parseInt(targetYear, 10);
    if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
      alert("Please enter a valid 4-digit year.");
      return;
    }

    if (!window.confirm(`Are you sure you want to move these ${group.weeks.length} weeks to ${targetYear}?`)) {
      return;
    }

    try {
      for (const w of group.weeks) {
        // Construct new date string by replacing the year part
        const newWeekOf = targetYear + w.weekOf.slice(4);
        // Note: we don't strictly re-snap to Monday here because we assume
        // the relative month/day structure of the workbook is what matters,
        // and replacing the year is the most direct "fix" for a wrong-year import.
        await db.weeks.update(w.id!, { weekOf: newWeekOf });
      }
      // Refreshing the page is the simplest way to reload the complex grouped state
      window.location.reload();
    } catch (err) {
      console.error(err);
      alert("Failed to move weeks. See console for details.");
    }
  }

  function toggleGroup(key: string) {
    setOpenGroup((prev) => (prev === key ? null : key));
  }

  return (
    <div>
      {/* ── Year selector ── */}
      {availableYears.length > 1 && (
        <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
          <button
            className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1"
            onClick={() => {
              const idx = availableYears.indexOf(activeYear);
              if (idx < availableYears.length - 1) setActiveYear(availableYears[idx + 1]);
            }}
            disabled={availableYears.indexOf(activeYear) === availableYears.length - 1}
            title="Previous year"
          >
            ◀
          </button>
          <span className="flex-1 text-center text-sm font-semibold text-slate-700 tabular-nums">
            {activeYear}
          </span>
          <button
            className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1"
            onClick={() => {
              const idx = availableYears.indexOf(activeYear);
              if (idx > 0) setActiveYear(availableYears[idx - 1]);
            }}
            disabled={availableYears.indexOf(activeYear) === 0}
            title="Next year"
          >
            ▶
          </button>
        </div>
      )}

      {/* ── Groups ── */}
      {groups.length === 0 && (
        <p className="p-3 text-sm text-slate-500">No weeks in {activeYear}.</p>
      )}
      {groups.map((group) => {
        const isOpen = openGroup === group.key;
        const isPast = group.key < todayKey;

        // Period-level fill stats
        const totalParts = group.weeks.reduce(
          (s, w) => s + w.assignments.length, 0
        );
        const filledParts = group.weeks.reduce(
          (s, w) => s + w.assignments.filter((a) => a.assigneeId).length, 0
        );
        const fillPct = totalParts > 0 ? (filledParts / totalParts) * 100 : 0;
        const allFilled = totalParts > 0 && filledParts === totalParts;

        return (
          <div key={group.key}>
            {/* ── Period heading (collapsible) ── */}
            <button
              onClick={() => toggleGroup(group.key)}
              className="w-full text-left px-3 py-2 bg-slate-50 border-b border-slate-100 hover:bg-slate-100 transition-colors"
              aria-expanded={isOpen}
            >
              <div className="flex items-center gap-1.5">
                {/* Chevron */}
                <span
                  className="text-slate-400 text-[10px] transition-transform duration-150"
                  style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                >
                  ▶
                </span>
                {/* Label — strip the year since the year selector handles it */}
                <span
                  className={
                    "flex-1 text-[11px] font-semibold uppercase tracking-widest " +
                    (isPast ? "text-slate-400" : "text-slate-600")
                  }
                >
                  {group.label.replace(/ \d{4}$/, "")}
                </span>

                {/* Fix Year action (only shown if group is open) */}
                {isOpen && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      moveGroupToYear(group);
                    }}
                    className="px-1.5 py-0.5 text-[9px] font-bold text-indigo-600 hover:bg-indigo-50 border border-indigo-200 rounded uppercase tracking-tighter"
                    title="Change year for this period"
                  >
                    Move
                  </button>
                )}

                {/* Fill fraction badge */}
                <span
                  className={
                    "text-[10px] font-medium tabular-nums " +
                    (allFilled ? "text-emerald-600" : "text-slate-400")
                  }
                  title={`${filledParts} of ${totalParts} parts filled`}
                >
                  {filledParts}/{totalParts}
                </span>
              </div>
              {/* Progress bar */}
              <div className="mt-1.5 h-1 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className={
                    "h-full rounded-full transition-all duration-300 " +
                    (allFilled ? "bg-emerald-400" : "bg-indigo-400")
                  }
                  style={{ width: `${fillPct}%` }}
                />
              </div>
            </button>

            {/* ── Weeks within this period ── */}
            {isOpen && (
              <ul>
                {group.weeks.map((w) => {
                  const filled = w.assignments.filter((a) => a.assigneeId).length;
                  const total  = w.assignments.length;
                  const complete = filled === total && total > 0;
                  const active   = selectedId === w.id;
                  return (
                    <li
                      key={w.id}
                      className={
                        "px-3 py-1.5 border-b border-slate-100 cursor-pointer hover:bg-slate-50 " +
                        (active ? "bg-indigo-50 border-l-2 border-l-indigo-400" : "")
                      }
                      onClick={() => onSelect(w.id ?? null)}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium flex-1">
                          {weekRangeLabel(w.weekOf)}
                        </span>
                        {/* Only show fraction when incomplete */}
                        {!complete && (
                          <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                            {filled}/{total}
                          </span>
                        )}
                        {complete && (
                          <span className="text-[10px] text-emerald-500 shrink-0" title="Fully assigned">
                            ✓
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
      {completionPeriod && (
        <CompletionModal
          period={completionPeriod}
          assignees={assignees}
          congregationName={congregationName}
          onClose={() => setCompletionPeriod(null)}
        />
      )}
    </div>
  );
}
