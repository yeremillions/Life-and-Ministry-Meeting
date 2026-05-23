import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Assignee,
  Assignment,
  Household,
  PartType,
  SegmentId,
  Week,
  SpecialEventType,
} from "../types";
import { DEFAULT_ASSIGNMENT_RULES } from "../types";
import {
  SEGMENTS,
  SEGMENT_PART_TYPES,
  getRuleViolations,
  needsAssistant,
  privilegeLabel,
  segmentOf,
  byOrder,
} from "../meeting";
import { weekRangeLabel, getMeetingDate } from "../utils";
import {
  buildStats,
  buildTalkSplit,
  buildTreasuresSplit,
  scoreCandidate,
  analyzeWeekOptimization,
  type AssigneeStats,
  type TalkSplit,
  type TreasuresSplit,
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
  const { stats, talkSplit, treasuresSplit } = useMemo(() => {
    const before = props.allWeeks.filter((w) => w.weekOf < week.weekOf);
    return {
      stats: buildStats(assignees, before),
      talkSplit: buildTalkSplit(assignees, before),
      treasuresSplit: buildTreasuresSplit(assignees, before),
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
            <button className="btn-secondary" onClick={() => props.onClear()}>
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

        <div className="mt-3 flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="flex-1">
            <label className="label">Weekly Bible reading (optional)</label>
            <input
              className="input max-w-md font-bold text-slate-800"
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
          <div className="w-48">
            <label className="label">Special Event</label>
            <select
              className="input font-semibold"
              style={{ color: week.specialEvent ? "var(--living)" : "inherit" }}
              value={week.specialEvent ?? ""}
              onChange={(e) =>
                props.onSave({
                  ...week,
                  specialEvent: (e.target.value as SpecialEventType) || null,
                })
              }
            >
              <option value="">- Normal Meeting -</option>
              <option value="Convention">Regional Convention</option>
              <option value="Assembly">Circuit Assembly</option>
              <option value="Memorial">Memorial</option>
              <option value="Other">Other Special Event</option>
            </select>
          </div>
          <button
            className="btn-secondary"
            onClick={handleReviewOptimization}
            title="Review for compliance optimizations"
            disabled={!!week.specialEvent}
          >
            Review Optimization
          </button>
        </div>
      </header>

      {/* Opening segment — always first, single Chairman slot */}
      {week.specialEvent ? (
        <div className="card bg-slate-50 border-slate-200 py-16 text-center animate-fade-in">
          <div className="text-5xl mb-4">🗓️</div>
          <h3 className="text-2xl font-bold text-slate-800">
            {week.specialEvent === "Memorial" ? "Memorial Week" : 
             week.specialEvent === "Convention" ? "Convention Week" :
             week.specialEvent === "Assembly" ? "Assembly Week" : "Special Event"}
          </h3>
          <p className="text-slate-500 max-w-md mx-auto mt-2">
            No Life and Ministry Meeting is scheduled for this week due to the {week.specialEvent.toLowerCase()}. 
            Normal assignments are suspended.
          </p>
          <div className="mt-8">
            <button 
              className="btn-secondary"
              onClick={() => props.onSave({ ...week, specialEvent: null })}
            >
              Switch back to normal meeting
            </button>
          </div>
        </div>
      ) : (
        <>
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
            treasuresSplit={treasuresSplit}
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
              treasuresSplit={treasuresSplit}
              settings={props.settings}
              allWeeks={props.allWeeks}
              partNumbers={partNumbers}
            />
          ))}
        </>
      )}

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
  treasuresSplit,
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
  treasuresSplit: TreasuresSplit;
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
              treasuresSplit={treasuresSplit}
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
  treasuresSplit,
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
  treasuresSplit: TreasuresSplit;
  settings: AppSettings;
  allWeeks: Week[];
  partNumber?: number;
}) {
  const mainPerson = assignees.find((a) => a.id === assignment.assigneeId);

  const eligibleMain = useMemo(() => {
    const rule = settings.assignmentRules?.[assignment.partType] || DEFAULT_ASSIGNMENT_RULES[assignment.partType];
    const allowedGenders = rule?.allowedGenders ?? ["M", "F"];
    return assignees.filter((a) => !a.archived && a.active && allowedGenders.includes(a.gender));
  }, [assignees, assignment.partType, settings.assignmentRules]);

  const eligibleAssistant = useMemo(() => {
    const rule = settings.assignmentRules?.[assignment.partType] || DEFAULT_ASSIGNMENT_RULES[assignment.partType];
    const assistantRule = rule?.assistant;
    const allowedGenders = assistantRule?.allowedGenders ?? rule?.allowedGenders ?? ["M", "F"];
    return assignees.filter((a) => !a.archived && a.active && allowedGenders.includes(a.gender));
  }, [assignees, assignment.partType, settings.assignmentRules]);

  const mainViolations = useMemo(() => {
    if (!mainPerson) return [];
    return getRuleViolations(
      mainPerson,
      assignment.partType,
      "main",
      settings.assignmentRules,
      undefined,
      settings.preventMinorAssistantToAdult
    );
  }, [mainPerson, assignment.partType, settings.assignmentRules, settings.preventMinorAssistantToAdult]);

  const assistantPerson = assignees.find((a) => a.id === assignment.assistantId);
  const assistantViolations = useMemo(() => {
    if (!assistantPerson) return [];
    const s = stats.get(assistantPerson.id!);
    let lastAssignmentRole: "main" | "assistant" | undefined = undefined;
    if (s && s.lastWeekAssistant) {
      const lastMain = s.lastWeekMain;
      const lastAsst = s.lastWeekAssistant;
      if (!lastMain || lastAsst > lastMain) {
        lastAssignmentRole = "assistant";
      } else {
        lastAssignmentRole = "main";
      }
    } else if (s && s.lastWeekMain) {
      lastAssignmentRole = "main";
    }
    return getRuleViolations(
      assistantPerson,
      assignment.partType,
      "assistant",
      settings.assignmentRules,
      mainPerson?.isMinor ?? false,
      settings.preventMinorAssistantToAdult,
      lastAssignmentRole
    );
  }, [assistantPerson, assignment.partType, settings.assignmentRules, mainPerson, settings.preventMinorAssistantToAdult, stats]);

  const seg = segmentOf(assignment.segment);
  const showAssistant = needsAssistant(assignment.partType);

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

  // Same-Sex Demo Match Check inside PartRow
  const demoHouseholdViolation = useMemo(() => {
    if (!mainPerson || !assistantPerson) return null;
    const isMinistryDemo = assignment.segment === "ministry" && needsAssistant(assignment.partType);
    if (!isMinistryDemo) return null;
    if (mainPerson.gender === assistantPerson.gender) return null;
    const inSameHousehold = households.some(
      (h) => h.memberIds.includes(mainPerson.id!) && h.memberIds.includes(assistantPerson.id!)
    );
    if (inSameHousehold) return null;
    return `${mainPerson.name} (${mainPerson.gender === "M" ? "brother" : "sister"}) and assistant ${assistantPerson.name} (${assistantPerson.gender === "M" ? "brother" : "sister"}) genders do not match in a demonstration, and they are not in the same household.`;
  }, [mainPerson, assistantPerson, assignment.segment, assignment.partType, households]);

  // Main & Assistant other parts in the same midweek meeting
  const mainOtherParts = useMemo(() => {
    if (!mainPerson) return [];
    return week.assignments
      .filter(
        (a) =>
          a.uid !== assignment.uid &&
          (a.assigneeId === mainPerson.id || a.assistantId === mainPerson.id)
      )
      .map((a) => a.title || a.partType);
  }, [mainPerson, week.assignments, assignment.uid]);

  const assistantOtherParts = useMemo(() => {
    if (!assistantPerson) return [];
    return week.assignments
      .filter(
        (a) =>
          a.uid !== assignment.uid &&
          (a.assigneeId === assistantPerson.id || a.assistantId === assistantPerson.id)
      )
      .map((a) => a.title || a.partType);
  }, [assistantPerson, week.assignments, assignment.uid]);

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
              treasuresSplit={treasuresSplit}
              settings={settings}
              assignment={assignment}
              role="main"
              weekOf={week.weekOf}
              allWeeks={allWeeks}
              mainPerson={mainPerson}
              assistantPerson={assistantPerson}
              households={households}
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
                    const remaining = eligibleAssistant.filter(
                      (a) =>
                        !seen.has(a.id) &&
                        !householdCrossGender.some((x) => x.id === a.id)
                    );
                    return [
                      ...sameGender,
                      ...householdCrossGender.filter((a) => !seen.has(a.id)),
                      ...remaining,
                    ];
                  })()
                }
                usedIds={usedIds}
                householdIds={mainHousehold?.memberIds}
                onChange={(id) => onUpdate({ ...assignment, assistantId: id })}
                onNavigateToProfile={onNavigateToProfile}
                stats={stats}
                talkSplit={talkSplit}
                treasuresSplit={treasuresSplit}
                settings={settings}
                assignment={assignment}
                role="assistant"
                weekOf={week.weekOf}
                allWeeks={allWeeks}
                mainIsMinor={mainPerson?.isMinor}
                mainPerson={mainPerson}
                assistantPerson={assistantPerson}
                households={households}
              />
            )}
          </>
        )}
      </div>
      {mainViolations.length > 0 && (
        <div className="mt-2 text-[11px] text-amber-800 bg-amber-50/50 border border-amber-200 rounded px-2.5 py-1.5 flex flex-col gap-0.5 animate-fade-in">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800">
            <span>⚠️</span>
            <span>Rule Warning ({showAssistant ? "Main Publisher" : "Assignee"}):</span>
          </div>
          <ul className="list-disc pl-4 space-y-0.5 mt-0.5 text-slate-700">
            {mainViolations.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </div>
      )}
      {showAssistant && assistantViolations.length > 0 && (
        <div className="mt-2 text-[11px] text-amber-800 bg-amber-50/50 border border-amber-200 rounded px-2.5 py-1.5 flex flex-col gap-0.5 animate-fade-in">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800">
            <span>⚠️</span>
            <span>Rule Warning ({assignment.partType === "Congregation Bible Study" ? "Reader" : "Assistant"}):</span>
          </div>
          <ul className="list-disc pl-4 space-y-0.5 mt-0.5 text-slate-700">
            {assistantViolations.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </div>
      )}
      {demoHouseholdViolation && (
        <div className="mt-2 text-[11px] text-amber-800 bg-amber-50/50 border border-amber-200 rounded px-2.5 py-1.5 flex flex-col gap-0.5 animate-fade-in">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800">
            <span>⚠️</span>
            <span>Same-Sex Demo Match Warning:</span>
          </div>
          <p className="mt-0.5 text-slate-700 leading-relaxed pl-4 list-item">
            {demoHouseholdViolation}
          </p>
        </div>
      )}
      {mainPerson && assistantPerson && mainPerson.id === assistantPerson.id && (
        <div className="mt-2 text-[11px] text-amber-800 bg-amber-50/50 border border-amber-200 rounded px-2.5 py-1.5 flex flex-col gap-0.5 animate-fade-in">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800">
            <span>⚠️</span>
            <span>Double Assignment Warning:</span>
          </div>
          <p className="mt-0.5 text-slate-700 leading-relaxed pl-4 list-item">
            The same person ({mainPerson.name}) is assigned to both the Main and Assistant roles for this part.
          </p>
        </div>
      )}
      {mainOtherParts.length > 0 && (
        <div className="mt-2 text-[11px] text-amber-800 bg-amber-50/50 border border-amber-200 rounded px-2.5 py-1.5 flex flex-col gap-0.5 animate-fade-in">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800">
            <span>⚠️</span>
            <span>Double Booking Warning (Main Publisher):</span>
          </div>
          <p className="mt-0.5 text-slate-700 leading-relaxed pl-4 list-item">
            {mainPerson?.name} has another assignment in this meeting: {mainOtherParts.join(", ")}.
          </p>
        </div>
      )}
      {showAssistant && assistantOtherParts.length > 0 && (
        <div className="mt-2 text-[11px] text-amber-800 bg-amber-50/50 border border-amber-200 rounded px-2.5 py-1.5 flex flex-col gap-0.5 animate-fade-in">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800">
            <span>⚠️</span>
            <span>Double Booking Warning ({assignment.partType === "Congregation Bible Study" ? "Reader" : "Assistant"}):</span>
          </div>
          <p className="mt-0.5 text-slate-700 leading-relaxed pl-4 list-item">
            {assistantPerson?.name} has another assignment in this meeting: {assistantOtherParts.join(", ")}.
          </p>
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1">
          <input
            className="input"
            placeholder="Scheduler note (optional)"
            value={assignment.note ?? ""}
            onChange={(e) =>
              onUpdate({ ...assignment, note: e.target.value || undefined })
            }
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-500">Min:</span>
          <input
            type="number"
            min="1"
            max="120"
            className="input w-16 text-center px-1 placeholder-slate-400"
            value={assignment.minutes || ""}
            placeholder={defaultMinutes(assignment.partType)}
            onChange={(e) =>
              onUpdate({
                ...assignment,
                minutes: e.target.value ? parseInt(e.target.value, 10) : undefined,
              })
            }
          />
        </div>
      </div>
    </li>
  );
}

function parseDateUTC(dateStr: string): Date {
  const [year, month, day] = dateStr.trim().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function getDaysBetween(date1: string, date2: string): number {
  const d1 = parseDateUTC(date1);
  const d2 = parseDateUTC(date2);
  return Math.round((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24));
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
  treasuresSplit,
  settings,
  assignment,
  role,
  weekOf,
  allWeeks,
  mainIsMinor,
  mainPerson,
  assistantPerson,
  households,
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
  treasuresSplit: TreasuresSplit;
  settings: AppSettings;
  assignment: Assignment;
  role: "main" | "assistant";
  weekOf: string;
  allWeeks: Week[];
  mainIsMinor?: boolean;
  mainPerson?: Assignee;
  assistantPerson?: Assignee;
  households?: Household[];
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
    const meetingDay = settings.midweekMeetingDay || "Thursday";
    const meetingDateStr = getMeetingDate(weekOf, meetingDay);

    // Pre-calculate scores and availability for all options
    const scored = options.map((a) => {
      const s = stats.get(a.id!) || {
        totalMain: 0,
        bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
        totalAssistant: 0,
        recentMainDates: [],
        recentMainDatesBySegment: { opening: [], treasures: [], ministry: [], living: [] },
      };
      const score = scoreCandidate(
        a,
        assignment,
        weekOf,
        s,
        0, // seed
        settings.privilegedMinistryShare,
        talkSplit,
        treasuresSplit,
        role,
        {
          minGapWeeks: settings.minGapWeeks ?? 2,
          catchUpIntensity: settings.catchUpIntensity ?? 1,
          msTreasuresRatio: settings.msTreasuresRatio ?? 0,
          qmsTreasuresRatio: settings.qmsTreasuresRatio ?? 0,
        }
      );

      // --- Unified Proximity Indicators ---
      const matches = allWeeks
        .filter((w) => {
          return w.assignments.some(
            (ass: Assignment) =>
              (a.id != null && ass.assigneeId === a.id) ||
              (a.id != null && ass.assistantId === a.id)
          );
        })
        .map((w) => {
          const days = getDaysBetween(w.weekOf, weekOf);
          const weeksDiff = Math.round(days / 7);
          return { weeksDiff };
        });

      matches.sort((x, y) => Math.abs(x.weeksDiff) - Math.abs(y.weeksDiff));

      let proximityLabel = "Never assigned";
      let isRecentlyAssigned = false;
      let isFresh = matches.length === 0;

      if (matches.length > 0) {
        const otherMatches = matches.filter((m) => m.weeksDiff !== 0);
        isRecentlyAssigned = otherMatches.some((m) => Math.abs(m.weeksDiff) <= 2);

        if (otherMatches.length === 0) {
          proximityLabel = "This week only";
        } else {
          const nearest = otherMatches.slice(0, 2);
          nearest.sort((x, y) => x.weeksDiff - y.weeksDiff);

          const labels = nearest.map((m) => {
            const absVal = Math.abs(m.weeksDiff);
            const unit = absVal === 1 ? "wk" : "wks";
            return m.weeksDiff < 0 ? `${absVal} ${unit} ago` : `${absVal} ${unit} ahead`;
          });

          const hasThisWeek = matches.some((m) => m.weeksDiff === 0);
          if (hasThisWeek) {
            labels.unshift("This week");
          }
          proximityLabel = labels.join(", ");
        }
      }

      // --- Check out-of-town/availability ranges ---
      let awayReason: string | undefined = undefined;
      const ranges = a.unavailableRanges ?? [];
      const mode = settings.availabilityMode || "unavailable";
      if (ranges.length > 0) {
        const overlapsAny = ranges.some((range) => {
          return meetingDateStr >= range.start && meetingDateStr <= range.end;
        });
        if (mode === "available") {
          if (!overlapsAny) {
            awayReason = "Outside scheduled available dates";
          }
        } else {
          if (overlapsAny) {
            const matchingRange = ranges.find((range) => meetingDateStr >= range.start && meetingDateStr <= range.end);
            awayReason = matchingRange?.reason || "Out of town";
          }
        }
      }

      let lastAssignmentRole: "main" | "assistant" | undefined = undefined;
      if (s && s.lastWeekAssistant) {
        const lastMain = s.lastWeekMain;
        const lastAsst = s.lastWeekAssistant;
        if (!lastMain || lastAsst > lastMain) {
          lastAssignmentRole = "assistant";
        } else {
          lastAssignmentRole = "main";
        }
      } else if (s && s.lastWeekMain) {
        lastAssignmentRole = "main";
      }

      const violations = getRuleViolations(
        a,
        assignment.partType,
        role,
        settings.assignmentRules,
        mainIsMinor,
        settings.preventMinorAssistantToAdult,
        lastAssignmentRole
      );

      // Same-Sex Demo Match Check inside options map
      if (assignment.segment === "ministry" && needsAssistant(assignment.partType)) {
        if (role === "main" && assistantPerson && a.gender !== assistantPerson.gender) {
          const inSameHousehold = households?.some(
            (h) => h.memberIds.includes(a.id!) && h.memberIds.includes(assistantPerson.id!)
          );
          if (!inSameHousehold) {
            violations.push(`Opposite-gender pairing in demonstration without household relation.`);
          }
        } else if (role === "assistant" && mainPerson && a.gender !== mainPerson.gender) {
          const inSameHousehold = households?.some(
            (h) => h.memberIds.includes(a.id!) && h.memberIds.includes(mainPerson.id!)
          );
          if (!inSameHousehold) {
            violations.push(`Opposite-gender pairing in demonstration without household relation.`);
          }
        }
      }

      // Main & Assistant Double-Role Check
      if (role === "main" && assistantPerson && a.id === assistantPerson.id) {
        violations.push(`Assigned as the Assistant/Reader for this part.`);
      }
      if (role === "assistant" && mainPerson && a.id === mainPerson.id) {
        violations.push(`Assigned as the Main speaker for this part.`);
      }

      // Double Booking in Same Week Check
      const thisWeekObj = allWeeks.find((w) => w.weekOf.trim() === weekOf.trim());
      if (thisWeekObj && a.id != null) {
        const otherParts = thisWeekObj.assignments
          .filter(
            (ass) =>
              ass.uid !== assignment.uid &&
              (ass.assigneeId === a.id || ass.assistantId === a.id)
          )
          .map((ass) => ass.title || ass.partType);

        if (otherParts.length > 0) {
          violations.push(`Already scheduled in this meeting for: ${otherParts.join(", ")}`);
        }
      }

      let coreViolationsCount = 0;
      let schedulingViolationsCount = 0;

      violations.forEach((v) => {
        if (
          v.includes("allowed parts list") ||
          v.includes("Excluded from prayers") ||
          v.includes("restricted to") ||
          v.includes("requires a baptized") ||
          v.includes("requires privileges:")
        ) {
          coreViolationsCount++;
        } else {
          schedulingViolationsCount++;
        }
      });

      return {
        a,
        score,
        proximityLabel,
        isRecentlyAssigned,
        isFresh,
        awayReason,
        violations,
        coreViolationsCount,
        schedulingViolationsCount,
      };
    });

    // Sort: available enrollees first, then by core qualification violations ascending,
    // then by scheduling policy violations ascending, and finally by score descending
    scored.sort((x, y) => {
      const xAway = !!x.awayReason;
      const yAway = !!y.awayReason;
      if (xAway && !yAway) return 1;
      if (!xAway && yAway) return -1;

      if (x.coreViolationsCount !== y.coreViolationsCount) {
        return x.coreViolationsCount - y.coreViolationsCount;
      }

      if (x.schedulingViolationsCount !== y.schedulingViolationsCount) {
        return x.schedulingViolationsCount - y.schedulingViolationsCount;
      }

      return y.score - x.score;
    });

    if (!q) return scored;
    return scored.filter((item) =>
      item.a.name.toLowerCase().includes(q) ||
      (privilegeLabel(item.a) ?? "").toLowerCase().includes(q)
    );
  }, [options, query, stats, talkSplit, treasuresSplit, settings, assignment, weekOf, role, allWeeks, mainIsMinor, mainPerson, assistantPerson, households]);

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
            filtered.map(({ a, proximityLabel, isRecentlyAssigned, isFresh, awayReason, violations }) => {
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
                    opacity: awayReason ? 0.75 : 1,
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
                  <div className="flex flex-col items-end gap-1">
                    <span 
                      className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border select-none leading-none shadow-sm ${
                        isFresh 
                          ? "bg-green-50 border-green-200 text-green-700"
                          : isRecentlyAssigned 
                            ? "bg-amber-50 border-amber-200 text-amber-700 font-bold" 
                            : "bg-slate-50 border-slate-200 text-slate-500"
                      }`}
                    >
                      {proximityLabel}
                    </span>
                    {violations && violations.length > 0 && (
                      <span className="text-[8px] font-bold text-rose-600 bg-rose-50 px-1 rounded leading-tight border border-rose-100" title={violations.join("\n")}>
                        ⚠️ RULE
                      </span>
                    )}
                    {awayReason && (
                      <span 
                        className="text-[8px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded leading-tight border border-rose-100" 
                        title={`Away: ${awayReason}`}
                      >
                        ✈️ AWAY
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

function defaultMinutes(t: PartType): string {
  switch (t) {
    case "Talk":
      return "10";
    case "Spiritual Gems":
      return "10";
    case "Bible Reading":
      return "4";
    case "Congregation Bible Study":
      return "30";
    case "Local Needs":
      return "15";
    case "Living Part":
      return "15";
    case "Starting a Conversation":
      return "3";
    case "Following Up":
      return "4";
    case "Making Disciples":
      return "5";
    case "Explaining Your Beliefs":
      return "5";
    case "Initial Call":
      return "3";
    case "Talk (Ministry)":
      return "5";
    default:
      return "—";
  }
}

