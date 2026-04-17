import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { db, ensureSettings } from "../db";
import type { Assignment, PartType, SegmentId, Week } from "../types";
import { SEGMENTS } from "../meeting";
import { autoAssignWeek } from "../scheduler";
import { nextMondayIso, uid, weekRangeLabel, workbookPeriod } from "../utils";
import WeekEditor from "../components/WeekEditor";
import WorkbookImportModal from "../components/WorkbookImportModal";
import S140ImportModal from "../components/S140ImportModal";

function buildEmptyWeek(weekOf: string): Week {
  const now = Date.now();
  const defaults: Assignment[] = [
    // Treasures (fixed order 1-3)
    {
      uid: uid(),
      segment: "treasures",
      order: 1,
      partType: "Talk",
      title: "",
    },
    {
      uid: uid(),
      segment: "treasures",
      order: 2,
      partType: "Spiritual Gems",
      title: "",
    },
    {
      uid: uid(),
      segment: "treasures",
      order: 3,
      partType: "Bible Reading",
      title: "",
    },
    // Ministry (start with the three commonest parts; user can add more)
    {
      uid: uid(),
      segment: "ministry",
      order: 4,
      partType: "Starting a Conversation",
      title: "",
    },
    {
      uid: uid(),
      segment: "ministry",
      order: 5,
      partType: "Following Up",
      title: "",
    },
    {
      uid: uid(),
      segment: "ministry",
      order: 6,
      partType: "Making Disciples",
      title: "",
    },
    // Living-as-Christians (min two; last = Congregation Bible Study)
    {
      uid: uid(),
      segment: "living",
      order: 7,
      partType: "Living Part",
      title: "",
    },
    {
      uid: uid(),
      segment: "living",
      order: 8,
      partType: "Congregation Bible Study",
      title: "",
    },
  ];
  return {
    weekOf,
    assignments: defaults,
    createdAt: now,
    updatedAt: now,
  };
}

export default function SchedulePage({
  initialWeekId,
  onConsumeInitialWeek,
}: {
  initialWeekId?: number | null;
  onConsumeInitialWeek?: () => void;
} = {}) {
  const weeks =
    useLiveQuery(() => db.weeks.orderBy("weekOf").reverse().toArray(), []) ??
    [];
  const assignees =
    useLiveQuery(() => db.assignees.orderBy("name").toArray(), []) ?? [];
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [importingWorkbook, setImportingWorkbook] = useState(false);
  const [importingS140, setImportingS140] = useState(false);
  const [lastImportCount, setLastImportCount] = useState<number | null>(null);

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
    await db.weeks.update(updated.id, {
      ...updated,
      updatedAt: Date.now(),
    });
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
    });
    await saveWeek(updated);
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
            />
          )}
        </div>
      </aside>

      <section>
        {selected ? (
          <WeekEditor
            week={selected}
            assignees={assignees}
            onSave={saveWeek}
            onDelete={() => selected.id != null && deleteWeek(selected.id)}
            onAutoFill={(preserve) => autoFill(selected, preserve)}
            onClear={() => clearAssignments(selected)}
            onAddPart={(segment, partType) => addPart(selected, segment, partType)}
            onRemovePart={(uid) => removePart(selected, uid)}
            onUpdateAssignment={(a) => updateAssignment(selected, a)}
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
    </div>
  );
}

function byOrder(a: Assignment, b: Assignment) {
  const seg = (s: SegmentId) =>
    SEGMENTS.findIndex((x) => x.id === s);
  const sd = seg(a.segment) - seg(b.segment);
  if (sd !== 0) return sd;
  return a.order - b.order;
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
}: {
  weeks: Week[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  // Group weeks by bi-monthly workbook period, preserving sort order.
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; weeks: Week[] }>();
    for (const w of weeks) {
      const { key, label } = workbookPeriod(w.weekOf);
      if (!map.has(key)) map.set(key, { label, weeks: [] });
      map.get(key)!.weeks.push(w);
    }
    return [...map.values()];
  }, [weeks]);

  return (
    <div>
      {groups.map((group) => (
        <div key={group.label}>
          {/* Period heading */}
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400 bg-slate-50 border-b border-slate-100">
            {group.label}
          </div>
          {/* Weeks within this period */}
          <ul>
            {group.weeks.map((w) => {
              const filled = w.assignments.filter((a) => a.assigneeId).length;
              const total  = w.assignments.length;
              const active = selectedId === w.id;
              return (
                <li
                  key={w.id}
                  className={
                    "px-3 py-2 border-b border-slate-100 cursor-pointer hover:bg-slate-50 " +
                    (active ? "bg-indigo-50 border-l-2 border-l-indigo-400" : "")
                  }
                  onClick={() => onSelect(w.id ?? null)}
                >
                  <div className="text-sm font-medium">
                    {weekRangeLabel(w.weekOf)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {filled}/{total} filled
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
