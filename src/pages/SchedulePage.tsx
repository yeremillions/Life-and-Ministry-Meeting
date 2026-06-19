import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState, useRef } from "react";
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
import ConfirmationModal from "../components/ConfirmationModal";

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
  initialPeriodKey,
  onPeriodKeyChange,
  onNavigateToProfile,
}: {
  initialWeekId?: number | null;
  onConsumeInitialWeek?: () => void;
  initialPeriodKey?: string | null;
  onPeriodKeyChange?: (key: string | null) => void;
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
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    if (initialWeekId != null) return initialWeekId;
    const saved = localStorage.getItem("schedule_week_id");
    return saved ? parseInt(saved, 10) : null;
  });
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string | null>(() => {
    if (initialPeriodKey !== undefined) return initialPeriodKey;
    const saved = localStorage.getItem("schedule_period_key");
    return saved || null;
  });

  useEffect(() => {
    if (initialWeekId !== undefined) {
      setSelectedId(initialWeekId);
    }
  }, [initialWeekId]);

  useEffect(() => {
    if (initialPeriodKey !== undefined) {
      setSelectedPeriodKey(initialPeriodKey);
    }
  }, [initialPeriodKey]);

  useEffect(() => {
    if (selectedId != null) {
      localStorage.setItem("schedule_week_id", String(selectedId));
      const w = weeks.find((x) => x.id === selectedId);
      if (w) {
        const pKey = workbookPeriod(w.weekOf).key;
        setSelectedPeriodKey(pKey);
      }
    } else {
      localStorage.removeItem("schedule_week_id");
    }
  }, [selectedId, weeks]);

  useEffect(() => {
    if (selectedPeriodKey !== null) {
      localStorage.setItem("schedule_period_key", selectedPeriodKey);
      onPeriodKeyChange?.(selectedPeriodKey);
    } else {
      localStorage.removeItem("schedule_period_key");
      onPeriodKeyChange?.(null);
    }
  }, [selectedPeriodKey, onPeriodKeyChange]);
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [importingWorkbook, setImportingWorkbook] = useState(false);
  const [importingS140, setImportingS140] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [lastImportCount, setLastImportCount] = useState<number | null>(null);
  const [congregationName, setCongregationName] = useState("");

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


  // Load congregation name once (needed for PDF header).
  useEffect(() => {
    ensureSettings().then((s) => setCongregationName(s.congregationName ?? ""));
  }, []);

  useEffect(() => {
    if (initialWeekId != null) {
      setSelectedId(initialWeekId);
      onConsumeInitialWeek?.();
    }
  }, [initialWeekId]);

  useEffect(() => {
    if (selectedId != null) {
      localStorage.setItem("schedule_week_id", String(selectedId));
    } else {
      localStorage.removeItem("schedule_week_id");
    }
  }, [selectedId]);

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
    setConfirmState({
      isOpen: true,
      title: "Delete Week's Schedule",
      message: "Are you sure you want to delete this week's schedule? This action cannot be undone.",
      confirmText: "Delete",
      cancelText: "Cancel",
      type: "danger",
      onConfirm: async () => {
        await db.weeks.delete(id);
        if (selectedId === id) setSelectedId(null);
        setConfirmState((prev: any) => ({ ...prev, isOpen: false }));
      },
    });
  }

  async function autoFill(week: Week, preserveExisting: boolean) {
    const settings = await ensureSettings();
    const allWeeks = await db.weeks.toArray();
    const updated = autoAssignWeek(week, assignees, allWeeks, {
      households,
      shareMinistryQE: settings.shareMinistryQE ?? 2,
      shareMinistryE: settings.shareMinistryE ?? 2,
      shareMinistryMS: settings.shareMinistryMS ?? 2,
      shareMinistryQMS: settings.shareMinistryQMS ?? 2,
      shareMinistryBrothers: settings.shareMinistryBrothers ?? 2,
      preserveExisting,
      minGapWeeks: settings.minGapWeeks ?? 2,
      chairmanGapWeeks: settings.chairmanGapWeeks ?? 3,
      catchUpIntensity: settings.catchUpIntensity ?? 1,
      maxAssignmentsPerMonth: settings.maxAssignmentsPerMonth ?? 2,
      assignmentRules: settings.assignmentRules,
      preventMinorAssistantToAdult: settings.preventMinorAssistantToAdult,
      msTreasuresRatio: settings.msTreasuresRatio,
      qmsTreasuresRatio: settings.qmsTreasuresRatio,
      qeLivingRatio: settings.qeLivingRatio,
      eLivingRatio: settings.eLivingRatio,
      qmsLivingRatio: settings.qmsLivingRatio,
      privilegedBibleReadingRatio: settings.privilegedBibleReadingRatio,
      midweekMeetingDay: settings.midweekMeetingDay ?? "Thursday",
      availabilityMode: settings.availabilityMode,
      customPartTypes: settings.customPartTypes,
    });
    await saveWeek(updated);
    await addLog(
      "schedule",
      preserveExisting ? "Auto-fill empty slots" : "Auto-assign all parts",
      `Week of ${week.weekOf}`
    );
  }

  async function bulkAssignPeriod(group: { key: string; label: string; weeks: Week[] }, preserveExisting: boolean) {
    const settings = await ensureSettings();
    // Sort weeks in the period chronologically
    const sortedPeriodWeeks = [...group.weeks].sort((a, b) => a.weekOf.localeCompare(b.weekOf));

    for (const w of sortedPeriodWeeks) {
      if (w.specialEvent) continue;
      
      const allWeeks = await db.weeks.toArray();
      const latestWeek = allWeeks.find((x) => x.id === w.id) || w;
      
      let targetWeek = latestWeek;
      if (!preserveExisting) {
        targetWeek = {
          ...latestWeek,
          assignments: latestWeek.assignments.map((a) => ({
            ...a,
            assigneeId: undefined,
            assistantId: undefined,
          })),
        };
      }

      const updated = autoAssignWeek(targetWeek, assignees, allWeeks, {
        households,
        shareMinistryQE: settings.shareMinistryQE ?? 2,
        shareMinistryE: settings.shareMinistryE ?? 2,
        shareMinistryMS: settings.shareMinistryMS ?? 2,
        shareMinistryQMS: settings.shareMinistryQMS ?? 2,
        shareMinistryBrothers: settings.shareMinistryBrothers ?? 2,
        preserveExisting,
        minGapWeeks: settings.minGapWeeks ?? 2,
        chairmanGapWeeks: settings.chairmanGapWeeks ?? 3,
        catchUpIntensity: settings.catchUpIntensity ?? 1,
        maxAssignmentsPerMonth: settings.maxAssignmentsPerMonth ?? 2,
        assignmentRules: settings.assignmentRules,
        preventMinorAssistantToAdult: settings.preventMinorAssistantToAdult,
        msTreasuresRatio: settings.msTreasuresRatio,
        qmsTreasuresRatio: settings.qmsTreasuresRatio,
        qeLivingRatio: settings.qeLivingRatio,
        eLivingRatio: settings.eLivingRatio,
        qmsLivingRatio: settings.qmsLivingRatio,
        privilegedBibleReadingRatio: settings.privilegedBibleReadingRatio,
        midweekMeetingDay: settings.midweekMeetingDay ?? "Thursday",
        availabilityMode: settings.availabilityMode,
        customPartTypes: settings.customPartTypes,
      });

      await saveWeek(updated);
      await addLog(
        "schedule",
        preserveExisting ? "Bulk auto-fill empty slots" : "Bulk auto-assign all parts",
        `Week of ${w.weekOf} (Period: ${group.label})`
      );
    }
  }

  async function clearPeriodAssignments(groupWeeks: Week[]) {
    setConfirmState({
      isOpen: true,
      title: "Clear Period Assignments",
      message: `Are you sure you want to clear all assignments for all ${groupWeeks.length} weeks in this period? This action cannot be undone.`,
      confirmText: "Clear All",
      cancelText: "Cancel",
      type: "danger",
      onConfirm: async () => {
        setConfirmState((prev: any) => ({ ...prev, isOpen: false }));
        for (const w of groupWeeks) {
          if (w.specialEvent) continue;
          const cleared = {
            ...w,
            assignments: w.assignments.map((a) => ({
              ...a,
              assigneeId: undefined,
              assistantId: undefined,
            })),
          };
          await db.weeks.put(cleared);
        }
        await addLog("schedule", "Cleared bulk assignments for period", `${groupWeeks.length} weeks`);
      }
    });
  }

  async function runBulkAssign(group: { key: string; label: string; weeks: Week[] }) {
    setConfirmState({
      isOpen: true,
      title: "Bulk Assign Period",
      message: (
        <div className="space-y-4 text-left">
          <p className="text-slate-600 text-sm">
            Bulk assign will run the auto-scheduler for all weeks in <strong>"{group.label}"</strong> ({group.weeks.length} weeks) sequentially.
          </p>
          <p className="text-xs text-slate-500">
            This ensures sequential rules like gap constraints and assignment balancing build chronologically and cleanly.
          </p>
          <div className="flex flex-col gap-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
              <input type="radio" name="bulkMode" id="bulk-preserve" defaultChecked />
              <span>Auto-fill empty slots (preserve existing)</span>
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
              <input type="radio" name="bulkMode" id="bulk-overwrite" />
              <span>Reassign all slots (overwrite existing)</span>
            </label>
          </div>
        </div>
      ),
      confirmText: "Run Bulk Assign",
      cancelText: "Cancel",
      type: "info",
      onConfirm: async () => {
        const preserve = (document.getElementById("bulk-preserve") as HTMLInputElement)?.checked ?? true;
        setConfirmState((prev: any) => ({ ...prev, isOpen: false }));
        try {
          await bulkAssignPeriod(group, preserve);
        } catch (err) {
          console.error("Bulk assign failed", err);
        }
      }
    });
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
              onSelect={setSelectedId}
              assignees={assignees}
              congregationName={settings?.congregationName ?? "Congregation"}
              onSelectPeriod={setSelectedPeriodKey}
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
            onBackToOverview={() => setSelectedId(null)}
            periodLabel={workbookPeriod(selected.weekOf).label}
          />
        ) : selectedPeriodKey ? (
          <PeriodOverview
            periodKey={selectedPeriodKey}
            weeks={weeks}
            assignees={assignees}
            onSelectWeek={(id) => setSelectedId(id)}
            onBulkAssign={runBulkAssign}
            onClearAssignments={clearPeriodAssignments}
          />
        ) : (
          <div className="card">
            <p className="text-sm text-slate-500">
              Select a workbook period or a week on the left, or create a new week.
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
      <ConfirmationModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText={confirmState.cancelText}
        type={confirmState.type}
        showCancel={confirmState.showCancel}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((prev: any) => ({ ...prev, isOpen: false }))}
      />
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
  onSelectPeriod,
}: {
  weeks: Week[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  assignees: Assignee[];
  congregationName: string;
  onSelectPeriod: (key: string | null) => void;
}) {
  const [completionPeriod, setCompletionPeriod] = useState<{key: string, label: string, weeks: Week[]} | null>(null);
  const [notifiedPeriods, setNotifiedPeriods] = useState<Set<string>>(new Set());
  const isInitializedRef = useRef(false);
  const lastActiveYearRef = useRef<number | null>(null);
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayKey = workbookPeriod(todayIso).key;

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

    const currentlyFullPeriods = new Set<string>();
    for (const group of periodMap.values()) {
      const totalParts = group.weeks.reduce((s, w) => s + w.assignments.length, 0);
      const filledParts = group.weeks.reduce((s, w) => s + w.assignments.filter(a => a.assigneeId).length, 0);
      
      const isFull = totalParts > 0 && filledParts === totalParts;
      if (isFull) {
        currentlyFullPeriods.add(group.key);
      }
    }

    if (!isInitializedRef.current) {
      // Initialize notifiedPeriods with all currently full periods so they don't trigger the modal on load
      setNotifiedPeriods(currentlyFullPeriods);
      isInitializedRef.current = true;
      return;
    }

    for (const group of periodMap.values()) {
      const isFull = currentlyFullPeriods.has(group.key);
      const wasNotified = notifiedPeriods.has(group.key);
      
      if (isFull && !wasNotified) {
        // This period is full and we haven't notified yet.
        // But only trigger if it's the current or a future period to avoid spamming old history.
        if (group.key >= todayKey) {
          setCompletionPeriod(group);
          setNotifiedPeriods(prev => {
            const next = new Set(prev);
            next.add(group.key);
            return next;
          });
        }
      } else if (!isFull && wasNotified) {
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
    if (selectedId != null) {
      const w = weeks.find((x) => x.id === selectedId);
      if (w) {
        const periodYear = parseInt(workbookPeriod(w.weekOf).key.slice(0, 4), 10);
        setActiveYear((prev) => (prev !== periodYear ? periodYear : prev));
        setOpenGroup(workbookPeriod(w.weekOf).key);
      }
    }
  }, [selectedId, weeks]);

  // When year changes, auto-open the best group for that year and sync selected week.
  useEffect(() => {
    if (lastActiveYearRef.current !== activeYear) {
      lastActiveYearRef.current = activeYear;

      if (groups.length > 0) {
        // Only auto-open today's or the first group if no week is selected.
        // If a week is selected, Hook 1 handles expanding its correct group.
        if (selectedId == null) {
          if (activeYear === currentYear) {
            const current = groups.find((g) => g.key === todayKey);
            setOpenGroup(current ? current.key : groups[0].key);
          } else {
            setOpenGroup(groups[0].key);
          }
        }

        // Sync selected week to match the new activeYear
        if (selectedId != null) {
          const w = weeks.find((x) => x.id === selectedId);
          if (w) {
            const periodYear = parseInt(workbookPeriod(w.weekOf).key.slice(0, 4), 10);
            if (periodYear !== activeYear) {
              // Find the weeks of the new activeYear
              const yearWeeks = weeks.filter(
                (x) => parseInt(workbookPeriod(x.weekOf).key.slice(0, 4), 10) === activeYear
              );
              if (yearWeeks.length > 0) {
                onSelect(yearWeeks[0].id ?? null);
              } else {
                onSelect(null);
              }
            }
          }
        }
      } else {
        setOpenGroup(null);
        if (selectedId != null) {
          onSelect(null);
        }
      }
    }
  }, [activeYear, groups.length, weeks, selectedId, onSelect, currentYear, todayKey]);

  async function moveGroupToYear(group: { key: string; label: string; weeks: Week[] }) {
    const currentYear = group.key.slice(0, 4);

    const showMoveModal = (initialVal: string) => {
      setConfirmState({
        isOpen: true,
        title: "Change Schedule Year",
        message: (
          <div className="space-y-4">
            <p className="text-slate-600 text-sm">
              Move <strong>"{group.label}"</strong> to a different year?
              This will shift all <strong>{group.weeks.length} weeks</strong> in this period to the year you enter below.
            </p>
            <div className="flex flex-col items-center">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Target Year</label>
              <input
                type="text"
                id="move-year-input"
                className="input text-center max-w-[120px] font-bold text-lg h-10 border-2 focus:border-indigo-500 rounded-xl"
                defaultValue={initialVal}
                maxLength={4}
              />
            </div>
          </div>
        ),
        confirmText: "Move Weeks",
        cancelText: "Cancel",
        type: "warning",
        onConfirm: async () => {
          const targetYearVal = (document.getElementById("move-year-input") as HTMLInputElement)?.value || initialVal;
          const targetYear = targetYearVal.trim();
          if (!targetYear || targetYear === currentYear) {
            setConfirmState((prev: any) => ({ ...prev, isOpen: false }));
            return;
          }
          const yearNum = parseInt(targetYear, 10);
          if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
            setConfirmState({
              isOpen: true,
              title: "Invalid Year",
              message: "Please enter a valid 4-digit year between 2000 and 2100.",
              confirmText: "OK",
              showCancel: false,
              type: "warning",
              onConfirm: () => showMoveModal(targetYear),
            });
            return;
          }

          setConfirmState({
            isOpen: true,
            title: "Confirm Year Shift",
            message: `Are you sure you want to move these ${group.weeks.length} weeks to ${targetYear}?`,
            confirmText: "Yes, Move",
            cancelText: "Cancel",
            type: "danger",
            onConfirm: async () => {
              try {
                for (const w of group.weeks) {
                  const newWeekOf = targetYear + w.weekOf.slice(4);
                  await db.weeks.update(w.id!, { weekOf: newWeekOf });
                }
                window.location.reload();
              } catch (err) {
                console.error(err);
                setConfirmState({
                  isOpen: true,
                  title: "Shift Failed",
                  message: "Failed to move weeks. See console for details.",
                  confirmText: "OK",
                  showCancel: false,
                  type: "danger",
                  onConfirm: () => setConfirmState((prev: any) => ({ ...prev, isOpen: false })),
                });
              }
            }
          });
        }
      });
    };

    showMoveModal(currentYear);
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

        // Period-level fill stats (ignore special weeks)
        const regularWeeks = group.weeks.filter(w => !w.specialEvent);
        const totalParts = regularWeeks.reduce(
          (s, w) => s + w.assignments.length, 0
        );
        const filledParts = regularWeeks.reduce(
          (s, w) => s + w.assignments.filter((a) => a.assigneeId).length, 0
        );
        const fillPct = totalParts > 0 ? (filledParts / totalParts) * 100 : 0;
        const allFilled = totalParts > 0 && filledParts === totalParts;

        return (
          <div key={group.key}>
            {/* ── Period heading (collapsible) ── */}
            <button
              onClick={() => {
                toggleGroup(group.key);
                onSelectPeriod(group.key);
                onSelect(null);
              }}
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

                {/* Actions (only shown if group is open) */}
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
                        {w.specialEvent ? (
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1 rounded uppercase tracking-tighter shrink-0">
                            {w.specialEvent}
                          </span>
                        ) : (
                          <>
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
                          </>
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

      <ConfirmationModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText={confirmState.cancelText}
        type={confirmState.type}
        showCancel={confirmState.showCancel}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((prev: any) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}

// ── PeriodOverview dashboard component ───────────────────────────────
function PeriodOverview({
  periodKey,
  weeks,
  assignees,
  onSelectWeek,
  onBulkAssign,
  onClearAssignments,
}: {
  periodKey: string;
  weeks: Week[];
  assignees: Assignee[];
  onSelectWeek: (id: number) => void;
  onBulkAssign: (group: { key: string; label: string; weeks: Week[] }) => Promise<void>;
  onClearAssignments: (groupWeeks: Week[]) => Promise<void>;
}) {
  const label = useMemo(() => {
    const matchingWeek = weeks.find((w) => workbookPeriod(w.weekOf).key === periodKey);
    if (matchingWeek) {
      return workbookPeriod(matchingWeek.weekOf).label;
    }
    const [yearStr, monthStr] = periodKey.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (isNaN(year) || isNaN(month)) return periodKey;
    const monthNames = ["", "January–February", "", "March–April", "", "May–June", "", "July–August", "", "September–October", "", "November–December"];
    return `${monthNames[month] || ""} ${year}`;
  }, [periodKey, weeks]);

  const periodWeeks = useMemo(() => {
    return weeks
      .filter((w) => workbookPeriod(w.weekOf).key === periodKey)
      .sort((a, b) => a.weekOf.localeCompare(b.weekOf));
  }, [weeks, periodKey]);

  const regularWeeks = periodWeeks.filter((w) => !w.specialEvent);
  const totalSlots = regularWeeks.reduce((acc, w) => acc + w.assignments.length, 0);
  const filledSlots = regularWeeks.reduce((acc, w) => acc + w.assignments.filter((a) => a.assigneeId).length, 0);
  const progress = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;
  const fullyScheduledCount = regularWeeks.filter((w) => w.assignments.length > 0 && w.assignments.every((a) => a.assigneeId)).length;

  return (
    <div className="card p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b pb-4 gap-4">
        <div>
          <span className="text-xs font-bold text-indigo-500 uppercase tracking-widest">Workbook Period</span>
          <h2 className="text-2xl font-extrabold text-slate-800">{label}</h2>
          <p className="text-xs text-slate-500 mt-1">Manage schedules and run bulk assignments for this bi-monthly block.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onBulkAssign({ key: periodKey, label, weeks: periodWeeks })}
            className="btn bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-md shadow-emerald-100 hover:shadow-lg transition-all cursor-pointer"
          >
            ⚡ Bulk Auto-Assign
          </button>
          <button
            onClick={() => onClearAssignments(periodWeeks)}
            className="btn bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 hover:border-rose-200 text-xs font-semibold px-4 py-2 rounded-xl border border-slate-200 transition-all cursor-pointer"
            disabled={filledSlots === 0}
          >
            🗑️ Clear Assignments
          </button>
        </div>
      </div>

      {/* Progress Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-slate-50 border rounded-2xl p-4 flex flex-col justify-between">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Assignment Fill Rate</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-800">{progress}%</span>
            <span className="text-xs text-slate-500">({filledSlots} / {totalSlots} filled)</span>
          </div>
          <div className="mt-3 h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${progress === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
              style={{ width: `${progress}%` }} 
            />
          </div>
        </div>

        <div className="bg-slate-50 border rounded-2xl p-4 flex flex-col justify-between">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Weeks Status</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-800">{fullyScheduledCount} <span className="text-lg font-normal text-slate-400">/ {regularWeeks.length}</span></span>
            <span className="text-xs text-slate-500">fully scheduled</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-3">Special weeks like Assemblies are ignored in statistics.</p>
        </div>

        <div className="bg-slate-50 border rounded-2xl p-4 flex flex-col justify-between">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Congregation Size</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-800">{assignees.filter(a => a.active && !a.archived).length}</span>
            <span className="text-xs text-slate-500">active publishers</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-3">Ensure rules/availability are set up under Settings.</p>
        </div>
      </div>

      {/* Weeks list inside period */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Schedules in this Period</h3>
        {periodWeeks.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No weeks found in this period. Import a workbook or add weeks manually.</p>
        ) : (
          <div className="divide-y border rounded-2xl overflow-hidden bg-white shadow-sm">
            {periodWeeks.map((w) => {
              const filled = w.assignments.filter((a) => a.assigneeId).length;
              const total = w.assignments.length;
              const isComplete = total > 0 && filled === total;
              
              const chairman = w.assignments.find(a => a.partType === "Chairman")?.assigneeId;
              const gems = w.assignments.find(a => a.partType === "Spiritual Gems")?.assigneeId;
              const cbsConductor = w.assignments.find(a => a.partType === "Bible Study")?.assigneeId;
              
              const pNames = (id?: number) => {
                if (id == null) return null;
                return assignees.find(a => a.id === id)?.name;
              };

              return (
                <div key={w.id} className="p-4 hover:bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800 text-sm">{weekRangeLabel(w.weekOf)}</span>
                      {w.specialEvent ? (
                        <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border uppercase tracking-wider shrink-0">
                          {w.specialEvent}
                        </span>
                      ) : isComplete ? (
                        <span className="text-[9px] font-bold bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200 uppercase tracking-wider shrink-0">
                          ✓ Fully Scheduled
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200 uppercase tracking-wider shrink-0">
                          Incomplete ({filled}/{total})
                        </span>
                      )}
                    </div>
                    {!w.specialEvent && total > 0 && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                        {chairman && <span><strong>Chairman:</strong> <span className="text-slate-600 font-medium">{pNames(chairman)}</span></span>}
                        {gems && <span><strong>Gems:</strong> <span className="text-slate-600 font-medium">{pNames(gems)}</span></span>}
                        {cbsConductor && <span><strong>CBS:</strong> <span className="text-slate-600 font-medium">{pNames(cbsConductor)}</span></span>}
                      </div>
                    )}
                  </div>
                  
                  <button
                    onClick={() => onSelectWeek(w.id!)}
                    className="btn bg-indigo-50 hover:bg-indigo-100 text-indigo-700 hover:text-indigo-800 text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-100 transition-all self-start sm:self-center cursor-pointer"
                  >
                    Edit Week
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
