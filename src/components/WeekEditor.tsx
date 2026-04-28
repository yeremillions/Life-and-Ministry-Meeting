import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Assignee,
  Assignment,
  Household,
  PartType,
  SegmentId,
  Week,
} from "../types";
import {
  SEGMENTS,
  SEGMENT_PART_TYPES,
  isEligible,
  needsAssistant,
  privilegeLabel,
  segmentOf,
  byOrder,
} from "../meeting";
import { weekRangeLabel } from "../utils";
import {
  buildStats,
  buildTalkSplit,
  scoreCandidate,
  analyzeWeekOptimization,
  type AssigneeStats,
  type TalkSplit,
  type OptimizationSuggestion,
} from "../scheduler";
import type { AppSettings } from "../types";
export interface WeekEditorProps {
  week: Week;
  assignees: Assignee[];
  households: Household[];
  onSave: (w: Week) => void | Promise<void>;
  onDelete: () => void;
  onAutoFill: (preserveExisting: boolean) => void;
  onClear: () => void;
  onAddPart: (segment: SegmentId, partType: PartType) => void;
  onRemovePart: (uid: string) => void;
  onUpdateAssignment: (a: Assignment) => void;
  onNavigateToProfile: (id: number) => void;
  allWeeks: Week[];
  settings: AppSettings;
  onSelectWeek?: (id: number) => void;
}

export default function WeekEditor(props: WeekEditorProps) {
  const { week, assignees, households } = props;
  const [optimizations, setOptimizations] = useState<OptimizationSuggestion[] | null>(null);

  const bySegment = useMemo(() => {
    const map: Record<SegmentId, Assignment[]> = {
      opening: [],
      treasures: [],
      ministry: [],
      living: [],
    };
    for (const a of week.assignments) map[a.segment].push(a);
    for (const id of Object.keys(map) as SegmentId[]) {
      map[id].sort((a, b) => a.order - b.order);
    }
    return map;
  }, [week.assignments]);

  // Compute stats and talkSplit based on weeks BEFORE this one.
  const { stats, talkSplit } = useMemo(() => {
    const before = props.allWeeks.filter((w) => w.weekOf < week.weekOf);
    return {
      stats: buildStats(assignees, before),
      talkSplit: buildTalkSplit(assignees, before),
    };
  }, [props.allWeeks, week.weekOf, assignees]);

  const partNumbers = useMemo(() => {
    const numbers = new Map<string, number>();
    let counter = 1;
    const sorted = [...week.assignments].sort(byOrder);
    let pastCBS = false;
    for (const a of sorted) {
      if (a.segment === "opening") continue;
      if (a.partType === "Closing Prayer") continue;
      if (pastCBS) continue;
      
      numbers.set(a.uid, counter++);
      
      if (a.partType === "Congregation Bible Study") {
        pastCBS = true;
      }
    }
    return numbers;
  }, [week.assignments]);

  const { prevWeek, nextWeek } = useMemo(() => {
    const sorted = [...props.allWeeks].sort((a, b) => a.weekOf.localeCompare(b.weekOf));
    const idx = sorted.findIndex(w => w.id === week.id);
    return {
      prevWeek: idx > 0 ? sorted[idx - 1] : null,
      nextWeek: idx !== -1 && idx < sorted.length - 1 ? sorted[idx + 1] : null,
    };
  }, [props.allWeeks, week.id]);

  function handleReviewOptimization() {
    const suggestions = analyzeWeekOptimization(
      week,
      assignees,
      props.allWeeks,
      { 
        ...props.settings, 
        preserveExisting: true,
        minGapWeeks: props.settings.minGapWeeks ?? 2,
        chairmanGapWeeks: props.settings.chairmanGapWeeks ?? 3,
        catchUpIntensity: props.settings.catchUpIntensity ?? 3,
        maxAssignmentsPerMonth: props.settings.maxAssignmentsPerMonth ?? 2,
      }
    );
    setOptimizations(suggestions);
  }

  function applyOptimization(opt: OptimizationSuggestion) {
    const nextAssignments = week.assignments.map(a => {
      if (a.uid === opt.uid) {
        if (opt.role === "main") {
          return { ...a, assigneeId: opt.suggestedAssigneeId };
        } else {
          return { ...a, assistantId: opt.suggestedAssigneeId };
        }
      }
      return a;
    });
    props.onSave({ ...week, assignments: nextAssignments });
    setOptimizations(prev => prev ? prev.filter(o => o !== opt) : null);
  }

  return (
    <div className="space-y-5">
      <header className="card">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="font-semibold text-lg">{weekRangeLabel(week.weekOf)}</h2>
            <div className="text-xs text-slate-500">
              {week.weeklyBibleReading
                ? <span className="font-medium text-slate-600">{week.weeklyBibleReading} &middot; </span>
                : null}
              {week.assignments.length} parts &middot;{" "}
              {week.assignments.filter((a) => a.assigneeId).length} assigned
            </div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              onClick={() => props.onClear()}
            >
              Clear all
            </button>
            <button
              className="btn-secondary"
              onClick={() => props.onAutoFill(true)}
              title="Fill empty slots only"
            >
              Auto-fill empty
            </button>
            <button
              className="btn-secondary"
              onClick={handleReviewOptimization}
              title="Review for compliance optimizations"
            >
              Review Optimization
            </button>
            <button
              className="btn"
              onClick={() => props.onAutoFill(false)}
              title="Reassign everything from scratch"
            >
              Auto-assign all
            </button>
            <button className="btn-danger" onClick={() => props.onDelete()}>
              Delete
            </button>
          </div>
        </div>
        <div className="mt-3">
          <label className="label">Weekly Bible reading (optional)</label>
          <input
            className="input max-w-md"
            value={week.weeklyBibleReading ?? ""}
            onChange={(e) =>
              props.onSave({
                ...week,
                weeklyBibleReading: e.target.value,
              })
            }
            placeholder="e.g. Matthew 5-7"
          />
        </div>
      </header>

      {/* Opening segment — always first, single Chairman slot */}
      <SegmentCard
        key="opening"
        segment="opening"
        title="Opening"
        accent="#64748b"
        assignments={bySegment.opening}
        assignees={assignees}
        households={households}
        week={week}
        onAddPart={(t) => props.onAddPart("opening", t)}
        onRemovePart={props.onRemovePart}
        onUpdateAssignment={props.onUpdateAssignment}
        onNavigateToProfile={props.onNavigateToProfile}
        onReorder={(dragged, onto) => {
          const d = week.assignments.find(a => a.uid === dragged);
          if (!d) return;
          const remaining = week.assignments.filter(a => a.uid !== dragged);
          const others = remaining.filter(a => a.segment !== "opening");
          const thisSeg = remaining.filter(a => a.segment === "opening").sort((a,b) => a.order - b.order);
          
          let next: Assignment[];
          if (onto) {
            const idx = thisSeg.findIndex(a => a.uid === onto);
            next = [...thisSeg];
            next.splice(idx, 0, { ...d, segment: "opening" });
          } else {
            next = [...thisSeg, { ...d, segment: "opening" }];
          }
          props.onSave({ ...week, assignments: [...others, ...next.map((a,i) => ({...a, order: i+1}))] });
        }}
        stats={stats}
        talkSplit={talkSplit}
        settings={props.settings}
        allWeeks={props.allWeeks}
        partNumbers={partNumbers}
      />
      {SEGMENTS.filter((s) => s.id !== "opening").map((seg) => (
        <SegmentCard
          key={seg.id}
          segment={seg.id}
          title={seg.label}
          accent={seg.color}
          assignments={bySegment[seg.id]}
          assignees={assignees}
          households={households}
          week={week}
          onAddPart={(t) => props.onAddPart(seg.id, t)}
          onRemovePart={props.onRemovePart}
          onUpdateAssignment={props.onUpdateAssignment}
          onNavigateToProfile={props.onNavigateToProfile}
          onReorder={(dragged, onto) => {
            const d = week.assignments.find(a => a.uid === dragged);
            if (!d) return;
            const remaining = week.assignments.filter(a => a.uid !== dragged);
            const others = remaining.filter(a => a.segment !== seg.id);
            const thisSeg = remaining.filter(a => a.segment === seg.id).sort((a,b) => a.order - b.order);
            
            let next: Assignment[];
            if (onto) {
              const idx = thisSeg.findIndex(a => a.uid === onto);
              next = [...thisSeg];
              next.splice(idx, 0, { ...d, segment: seg.id });
            } else {
              next = [...thisSeg, { ...d, segment: seg.id }];
            }
            props.onSave({ ...week, assignments: [...others, ...next.map((a,i) => ({...a, order: i+1}))] });
          }}
          stats={stats}
          talkSplit={talkSplit}
          settings={props.settings}
          allWeeks={props.allWeeks}
          partNumbers={partNumbers}
        />
      ))}

      {/* Navigation Footer */}
      <footer className="card flex items-center justify-between">
        <div className="flex-1">
          {prevWeek && (
            <button
              onClick={() => props.onSelectWeek?.(prevWeek.id!)}
              className="text-indigo-600 hover:text-indigo-800 font-medium text-sm flex items-center gap-1"
            >
              <span>«</span> {weekRangeLabel(prevWeek.weekOf)}
            </button>
          )}
        </div>
        <div className="flex-1 text-center text-slate-400 text-xs uppercase tracking-widest font-semibold">
          Navigation
        </div>
        <div className="flex-1 text-right flex justify-end">
          {nextWeek && (
            <button
              onClick={() => props.onSelectWeek?.(nextWeek.id!)}
              className="text-indigo-600 hover:text-indigo-800 font-medium text-sm flex items-center gap-1"
            >
              {weekRangeLabel(nextWeek.weekOf)} <span>»</span>
            </button>
          )}
        </div>
      </footer>

      {/* Optimization Modal */}
      {optimizations !== null && (
        <div
          className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50"
          onClick={() => setOptimizations(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4 shrink-0">
              <div>
                <h3 className="font-semibold text-lg text-slate-800">
                  Review Optimization
                </h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  The system found {optimizations.length} suggestion{optimizations.length !== 1 ? "s" : ""} to improve fairness and compliance based on your settings.
                </p>
              </div>
              <button
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
                onClick={() => setOptimizations(null)}
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 space-y-3 custom-scrollbar pr-2 -mr-2">
              {optimizations.length === 0 ? (
                <div className="text-center py-8 text-emerald-600 font-medium">
                  Looking good! No significant optimizations found.
                </div>
              ) : (
                optimizations.map((opt, idx) => {
                  const part = week.assignments.find((a) => a.uid === opt.uid);
                  const currentPerson = assignees.find((a) => a.id === opt.currentAssigneeId);
                  const newPerson = assignees.find((a) => a.id === opt.suggestedAssigneeId);
                  return (
                    <div key={idx} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <h4 className="font-semibold text-sm text-slate-800">
                          {part?.title || part?.partType}
                          <span className="text-xs font-normal text-slate-500 ml-2 italic">({opt.role})</span>
                        </h4>
                        <button
                          className="btn text-xs py-1 px-3 shadow-none"
                          onClick={() => applyOptimization(opt)}
                        >
                          Apply
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="text-slate-500 line-through">
                          {currentPerson?.name || "Unassigned"}
                        </div>
                        <div className="text-emerald-700 font-medium flex items-center gap-1.5">
                          <span>→</span> {newPerson?.name}
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 mt-2">
                        {opt.reason}
                      </p>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-5 flex justify-end shrink-0">
              <button className="btn-secondary" onClick={() => setOptimizations(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SegmentCard({
  segment,
  title,
  accent,
  assignments,
  assignees,
  households,
  week,
  onAddPart,
  onRemovePart,
  onUpdateAssignment,
  onNavigateToProfile,
  onReorder,
  stats,
  talkSplit,
  settings,
  allWeeks,
  partNumbers,
}: {
  segment: SegmentId;
  title: string;
  accent: string;
  assignments: Assignment[];
  assignees: Assignee[];
  households: Household[];
  week: Week;
  onAddPart: (t: PartType) => void;
  onRemovePart: (uid: string) => void;
  onUpdateAssignment: (a: Assignment) => void;
  onNavigateToProfile: (id: number) => void;
  onReorder: (draggedUid: string, ontoUid?: string) => void;
  stats: Map<number, AssigneeStats>;
  talkSplit: TalkSplit;
  settings: AppSettings;
  allWeeks: Week[];
  partNumbers: Map<string, number>;
}) {
  const [isOver, setIsOver] = useState(false);
  const [pickerType, setPickerType] = useState<PartType>(
    SEGMENT_PART_TYPES[segment][0]
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsOver(false);
    const uid = e.dataTransfer.getData("partUid");
    if (!uid) return;
    onReorder(uid);
  }

  const minGuard =
    segment === "ministry"
      ? assignments.length < 3
      : segment === "living"
      ? assignments.length < 2
      : false;

  return (
    <section 
      className={`card transition-all duration-200 ${isOver ? "border-indigo-400 bg-indigo-50/30 ring-2 ring-indigo-400/20" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: accent }}
          />
          {title}
        </h3>
        <div className="flex gap-2 items-center">
          <select
            className="input w-auto"
            value={pickerType}
            onChange={(e) => setPickerType(e.target.value as PartType)}
          >
            {SEGMENT_PART_TYPES[segment].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            className="btn-secondary"
            onClick={() => onAddPart(pickerType)}
          >
            + Part
          </button>
        </div>
      </div>
      {minGuard && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
          {segment === "ministry"
            ? "This segment should have at least 3 parts."
            : "This segment should have at least 2 parts."}
        </p>
      )}
      {assignments.length === 0 ? (
        <p className="text-sm text-slate-500">No parts added yet.</p>
      ) : (
        <ul className="space-y-3">
          {assignments.map((a) => (
            <PartRow
              key={a.uid}
              assignment={a}
              assignees={assignees}
              households={households}
              week={week}
              onRemove={() => onRemovePart(a.uid)}
              onUpdate={onUpdateAssignment}
              onNavigateToProfile={onNavigateToProfile}
              onDropOnto={(dragged) => onReorder(dragged, a.uid)}
              stats={stats}
              talkSplit={talkSplit}
              settings={settings}
              allWeeks={allWeeks}
              partNumber={partNumbers.get(a.uid)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PartRow({
  assignment,
  assignees,
  households,
  week,
  onRemove,
  onUpdate,
  onNavigateToProfile,
  onDropOnto,
  stats,
  talkSplit,
  settings,
  allWeeks,
  partNumber,
}: {
  assignment: Assignment;
  assignees: Assignee[];
  households: Household[];
  week: Week;
  onRemove: () => void;
  onUpdate: (a: Assignment) => void;
  onNavigateToProfile: (id: number) => void;
  onDropOnto: (draggedUid: string) => void;
  stats: Map<number, AssigneeStats>;
  talkSplit: TalkSplit;
  settings: AppSettings;
  allWeeks: Week[];
  partNumber?: number;
}) {
  const eligibleMain = useMemo(
    () => assignees.filter((a) => isEligible(a, assignment.partType, "main", "manual", settings.assignmentRules)),
    [assignees, assignment.partType, settings.assignmentRules]
  );
  const eligibleAssistant = useMemo(
    () =>
      assignees.filter((a) => isEligible(a, assignment.partType, "assistant", "manual", settings.assignmentRules)),
    [assignees, assignment.partType, settings.assignmentRules]
  );

  const seg = segmentOf(assignment.segment);
  const showAssistant = needsAssistant(assignment.partType);
  const mainPerson = assignees.find((a) => a.id === assignment.assigneeId);

  // Household of the currently-selected main person (if any).
  const mainHousehold = useMemo(
    () =>
      mainPerson?.id != null
        ? households.find((h) => h.memberIds.includes(mainPerson.id!))
        : undefined,
    [households, mainPerson]
  );

  // Flag if already used in this meeting (helpful hint)
  const usedIds = new Set(
    week.assignments
      .filter((a) => a.uid !== assignment.uid)
      .flatMap((a) =>
        [a.assigneeId, a.assistantId].filter((x): x is number => x != null)
      )
  );

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("partUid", assignment.uid);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.currentTarget.style.borderTop = "4px solid #6366f1";
      }}
      onDragLeave={(e) => {
        e.currentTarget.style.borderTop = "";
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.style.borderTop = "";
        const draggedUid = e.dataTransfer.getData("partUid");
        if (draggedUid && draggedUid !== assignment.uid) {
          onDropOnto(draggedUid);
        }
      }}
      className="border border-slate-200 rounded-md p-3 bg-white cursor-grab active:cursor-grabbing hover:border-slate-300 hover:shadow-sm transition-all"
      style={{ borderLeft: `4px solid ${seg.color}` }}
    >
      <div className="flex flex-wrap gap-2 items-start">
        {partNumber !== undefined && (
          <div className="pt-8 pr-1 font-bold text-slate-300 text-xl w-6 text-right">
            {partNumber}
          </div>
        )}
        <div className="flex-1 min-w-[160px]">
          <label className="label">Part type</label>
          <select
            className="input"
            value={assignment.partType}
            onChange={(e) =>
              onUpdate({
                ...assignment,
                partType: e.target.value as PartType,
              })
            }
          >
            {SEGMENT_PART_TYPES[assignment.segment].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-[2] min-w-[220px]">
          <label className="label">Title</label>
          <input
            className="input"
            value={assignment.title}
            placeholder={titlePlaceholder(assignment.partType)}
            onChange={(e) =>
              onUpdate({ ...assignment, title: e.target.value })
            }
          />
        </div>
        <div className="pt-5">
          <button
            className="text-slate-400 hover:text-red-600 text-sm"
            onClick={onRemove}
            title="Remove part"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        {assignment.partType === "Video" ? (
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-3 py-2 col-span-2 flex items-center gap-1.5">
            <span>📹</span>
            <span>Introduced by the <strong>chairman</strong> — no separate assignment needed.</span>
          </p>
        ) : (
          <>
            <AssigneePicker
              label={showAssistant ? "Main / publisher" : "Assigned to"}
              value={assignment.assigneeId}
              options={eligibleMain}
              usedIds={usedIds}
              onChange={(id) => onUpdate({ ...assignment, assigneeId: id })}
              onNavigateToProfile={onNavigateToProfile}
              stats={stats}
              talkSplit={talkSplit}
              settings={settings}
              assignment={assignment}
              role="main"
              weekOf={week.weekOf}
              allWeeks={allWeeks}
            />
            {showAssistant && (
              <AssigneePicker
                label={
                  assignment.partType === "Congregation Bible Study"
                    ? "Reader"
                    : "Householder / assistant"
                }
                value={assignment.assistantId}
                options={
                  (() => {
                    if (assignment.partType === "Congregation Bible Study") {
                      return eligibleAssistant;
                    }
                    // For demo parts: same-gender first, plus opposite-gender
                    // household members (family pairing).
                    const sameGender = eligibleAssistant.filter(
                      (a) =>
                        !mainPerson ||
                        a.gender === mainPerson.gender ||
                        mainPerson.gender == null
                    );
                    const householdCrossGender = mainHousehold
                      ? eligibleAssistant.filter(
                          (a) =>
                            a.gender !== mainPerson?.gender &&
                            mainHousehold.memberIds.includes(a.id!)
                        )
                      : [];
                    // Merge, deduplicating by id.
                    const seen = new Set(sameGender.map((a) => a.id));
                    return [
                      ...sameGender,
                      ...householdCrossGender.filter((a) => !seen.has(a.id)),
                    ];
                  })()
                }
                usedIds={usedIds}
                householdIds={mainHousehold?.memberIds}
                onChange={(id) => onUpdate({ ...assignment, assistantId: id })}
                onNavigateToProfile={onNavigateToProfile}
                stats={stats}
                talkSplit={talkSplit}
                settings={settings}
                assignment={assignment}
                role="assistant"
                weekOf={week.weekOf}
                allWeeks={allWeeks}
              />
            )}
          </>
        )}
      </div>
      <div className="mt-2">
        <input
          className="input"
          placeholder="Scheduler note (optional)"
          value={assignment.note ?? ""}
          onChange={(e) =>
            onUpdate({ ...assignment, note: e.target.value || undefined })
          }
        />
      </div>
    </li>
  );
}

function AssigneePicker({
  label,
  value,
  options,
  usedIds,
  householdIds,
  onChange,
  onNavigateToProfile,
  stats,
  talkSplit,
  settings,
  assignment,
  role,
  weekOf,
  allWeeks,
}: {
  label: string;
  value?: number;
  options: Assignee[];
  usedIds: Set<number>;
  /** IDs that belong to the main person's household — shown with a 🏠 tag. */
  householdIds?: number[];
  onChange: (id: number | undefined) => void;
  onNavigateToProfile: (id: number) => void;
  stats: Map<number, AssigneeStats>;
  talkSplit: TalkSplit;
  settings: AppSettings;
  assignment: Assignment;
  role: "main" | "assistant";
  weekOf: string;
  allWeeks: Week[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close when clicking outside
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const selected = options.find((a) => a.id === value);
  const displayValue = selected
    ? [selected.name, privilegeLabel(selected) ? `(${privilegeLabel(selected)})` : null]
        .filter(Boolean)
        .join(" ")
    : "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Pre-calculate scores for all options
    const scored = options.map((a) => {
      const s = stats.get(a.id!) || {
        totalMain: 0,
        bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
        totalAssistant: 0,
        recentMainDates: [],
      };
      const score = scoreCandidate(
        a,
        assignment,
        weekOf,
        s,
        0, // seed
        settings.privilegedMinistryShare,
        talkSplit,
        role,
        {
          minGapWeeks: settings.minGapWeeks ?? 2,
          catchUpIntensity: settings.catchUpIntensity ?? 1,
        }
      );

      // --- Human-readable indicators ---
      const lastDate = role === "main" ? s.lastWeekMain : s.lastWeekAssistant;
      let weeksAgo = "Never";
      if (lastDate) {
        const days = Math.round((new Date(weekOf + "T00:00:00").getTime() - new Date(lastDate + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24));
        const wks = Math.floor(days / 7);
        weeksAgo = wks === 0 ? "This week" : `${wks} wk${wks === 1 ? "" : "s"} ago`;
      }

      // Check for assignments in [weekOf - 2 weeks, weekOf + 2 weeks] excluding current week
      const currentT = new Date(weekOf + "T00:00:00").getTime();
      const windowMs = 15 * 24 * 60 * 60 * 1000; // ~2 weeks
      const hasNearby = allWeeks.some((w: Week) => {
        if (w.weekOf === weekOf) return false;
        const t = new Date(w.weekOf + "T00:00:00").getTime();
        if (Math.abs(t - currentT) > windowMs) return false;
        return w.assignments.some((ass: Assignment) => ass.assigneeId === a.id || ass.assistantId === a.id);
      });

      return { a, score, weeksAgo, hasNearby };
    });

    // Sort by score descending (highest score = most due)
    scored.sort((a, b) => b.score - a.score);

    if (!q) return scored;
    return scored.filter((item) =>
      item.a.name.toLowerCase().includes(q) ||
      (privilegeLabel(item.a) ?? "").toLowerCase().includes(q)
    );
  }, [options, query, stats, talkSplit, settings, assignment, weekOf, role, allWeeks]);

  function selectOption(id: number | undefined) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <label className="label">{label}</label>
      {/* Trigger input */}
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          className="input"
          style={{ paddingRight: "2rem", cursor: "text" }}
          placeholder="— unassigned —"
          value={open ? query : displayValue}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setOpen(false); setQuery(""); }
            if (e.key === "Enter" && filtered.length === 1) {
              selectOption(filtered[0].a.id);
            }
          }}
          autoComplete="off"
        />
        {/* Chevron and Profile icons */}
        <div 
          style={{
            position: "absolute",
            right: "0.5rem",
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            gap: "0.25rem"
          }}
        >
          {value && !open && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onNavigateToProfile(value);
              }}
              className="p-1 hover:bg-slate-100 rounded text-indigo-500 transition-colors"
              title="View Profile"
            >
              👤
            </button>
          )}
          <span
            style={{
              pointerEvents: "none",
              color: "#94a3b8",
              fontSize: "0.75rem",
            }}
          >
            ▾
          </span>
        </div>
      </div>

      {/* Dropdown list */}
      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 50,
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "2px",
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            maxHeight: "220px",
            overflowY: "auto",
          }}
        >
          {/* Unassigned option */}
          <div
            onMouseDown={(e) => { e.preventDefault(); selectOption(undefined); }}
            style={{
              padding: "0.45rem 0.75rem",
              cursor: "pointer",
              fontSize: "0.875rem",
              color: "#64748b",
              borderBottom: "1px solid #f1f5f9",
              background: value === undefined ? "#eef2ff" : undefined,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
            onMouseLeave={(e) => (e.currentTarget.style.background = value === undefined ? "#eef2ff" : "")}
          >
            — unassigned —
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: "0.5rem 0.75rem", fontSize: "0.8rem", color: "#94a3b8" }}>
              No matches
            </div>
          ) : (
            filtered.map(({ a, weeksAgo, hasNearby }) => {
              const optLabel = [
                a.name,
                privilegeLabel(a) ? `(${privilegeLabel(a)})` : null,
              ]
                .filter(Boolean)
                .join(" ");
              const alreadyUsed = a.id != null && usedIds.has(a.id);
              const isSelected = a.id === value;
              const isHousehold = a.id != null && householdIds?.includes(a.id);
              
              return (
                <div
                  key={a.id}
                  onMouseDown={(e) => { e.preventDefault(); selectOption(a.id); }}
                  style={{
                    padding: "0.45rem 0.75rem",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                    background: isSelected ? "#eef2ff" : undefined,
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = isSelected ? "#eef2ff" : "")}
                >
                  {alreadyUsed && (
                    <span title="Already assigned this week" style={{ fontSize: "0.85rem" }}>⚠️</span>
                  )}
                  {isHousehold && (
                    <span
                      title="Household member — cross-gender family pairing"
                      style={{ fontSize: "0.75rem", color: "#6366f1" }}
                    >
                      🏠
                    </span>
                  )}
                  <span style={{ color: isSelected ? "#4f46e5" : undefined }} className="flex-1">
                    {optLabel}
                  </span>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="text-[9px] font-medium text-slate-400 leading-none">
                      {weeksAgo}
                    </span>
                    {hasNearby && (
                      <span className="text-[8px] font-bold text-amber-600 bg-amber-50 px-1 rounded leading-tight border border-amber-100">
                        NEARBY
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {options.length === 0 && (
        <p className="text-xs text-amber-700 mt-1">
          No eligible enrollees for this part. Check privileges / baptism /
          active status.
        </p>
      )}
    </div>
  );
}

function titlePlaceholder(t: PartType): string {
  switch (t) {
    case "Chairman":
      return "Chairman";
    case "Opening Prayer":
      return "Opening Prayer";
    case "Closing Prayer":
      return "Closing Prayer";
    case "Talk":
      return 'e.g. "Endure With Joy"';
    case "Bible Reading":
      return "e.g. Job 10:1-22";
    case "Living Part":
      return "e.g. Strengthen Your Faith";
    case "Video":
      return "e.g. \"Why Study the Bible?\"";
    case "Local Needs":
      return "Local Needs";
    case "Governing Body Update":
      return "Governing Body Update";
    case "Congregation Bible Study":
      return "e.g. jy chap. 43";
    default:
      return "Scenario / description (optional)";
  }
}

