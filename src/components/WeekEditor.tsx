import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../db";
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
  checkPairingViolation,
} from "../meeting";
import { weekRangeLabel, getMeetingDate } from "../utils";
import {
  buildStats,
  buildTalkSplit,
  buildTreasuresSplit,
  buildLivingSplit,
  buildBibleReadingSplit,
  buildPrayerSplit,
  scoreCandidate,
  getWeeksInCalendarMonth,
  getWeeksInWorkbookPeriod,
  analyzePeriodOptimization,
  type AssigneeStats,
  type TalkSplit,
  type TreasuresSplit,
  type LivingSplit,
  type BibleReadingSplit,
  type PrayerSplit,
  type OptimizationSuggestion,
} from "../scheduler";
import type { AppSettings, AssignmentRule } from "../types";
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
  onBackToOverview?: () => void;
  periodLabel?: string;
}

export default function WeekEditor(props: WeekEditorProps) {
  const { week, assignees, households } = props;
  const [activeScope, setActiveScope] = useState<"week" | "month" | "month-pair">("week");
  const [showOptimizationModal, setShowOptimizationModal] = useState(false);
  const [isEditingDispatched, setIsEditingDispatched] = useState(false);
  const isReadOnly = !!week.dispatched && !isEditingDispatched;

  useEffect(() => {
    setIsEditingDispatched(false);
  }, [week.id]);

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

  // Compute stats, splits based on weeks BEFORE this one.
  const { stats, talkSplit, treasuresSplit, livingSplit, bibleReadingSplit, prayerSplit } = useMemo(() => {
    const before = props.allWeeks.filter((w) => w.weekOf < week.weekOf);
    return {
      stats: buildStats(assignees, before),
      talkSplit: buildTalkSplit(assignees, before),
      treasuresSplit: buildTreasuresSplit(assignees, before),
      livingSplit: buildLivingSplit(assignees, before),
      bibleReadingSplit: buildBibleReadingSplit(assignees, before),
      prayerSplit: buildPrayerSplit(assignees, before),
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
    setShowOptimizationModal(true);
  }

  async function applyPeriodOptimization(opt: OptimizationSuggestion & { week: Week }) {
    const targetWeek = opt.week;
    const nextAssignments = targetWeek.assignments.map(a => {
      if (a.uid === opt.uid) {
        if (opt.role === "main") {
          return { ...a, assigneeId: opt.suggestedAssigneeId };
        } else {
          return { ...a, assistantId: opt.suggestedAssigneeId };
        }
      }
      return a;
    });
    await props.onSave({ ...targetWeek, assignments: nextAssignments });
  }

  async function skipPeriodOptimization(opt: OptimizationSuggestion & { week: Week }) {
    const targetWeek = opt.week;
    const skippedList = targetWeek.skippedOptimizations ?? [];
    const updatedSkipped = [
      ...skippedList,
      {
        uid: opt.uid,
        role: opt.role,
        suggestedAssigneeId: opt.suggestedAssigneeId,
      }
    ];
    await props.onSave({ ...targetWeek, skippedOptimizations: updatedSkipped });
  }

  const healthMetrics = useMemo(() => {
    const scopeWeeks = activeScope === "week" 
      ? [week]
      : activeScope === "month" 
      ? getWeeksInCalendarMonth(week.weekOf, props.allWeeks)
      : getWeeksInWorkbookPeriod(week.weekOf, props.allWeeks);

    let totalParts = 0;
    let filledParts = 0;
    let suggestionsCount = 0;
    let criticalViolations = 0;

    const allSuggestions = analyzePeriodOptimization(
      scopeWeeks,
      assignees,
      props.allWeeks,
      { 
        ...props.settings, 
        households: props.households,
        preserveExisting: true,
        minGapWeeks: props.settings.minGapWeeks ?? 2,
        chairmanGapWeeks: props.settings.chairmanGapWeeks ?? 3,
        catchUpIntensity: props.settings.catchUpIntensity ?? 3,
        maxAssignmentsPerMonth: props.settings.maxAssignmentsPerMonth ?? 2,
      }
    ).flatMap(res => res.suggestions.map(s => ({ ...s, week: res.week })));

    suggestionsCount = allSuggestions.length;

    for (const w of scopeWeeks) {
      if (w.specialEvent) continue;
      for (const a of w.assignments) {
        totalParts++;
        if (a.assigneeId) filledParts++;
        if (needsAssistant(a.partType, props.settings.assignmentRules) && a.assistantId) filledParts++;

        const mainPerson = assignees.find(p => p.id === a.assigneeId);
        const assistantPerson = assignees.find(p => p.id === a.assistantId);

        if (mainPerson) {
          const mainV = getRuleViolations(
            mainPerson,
            a.partType,
            "main",
            props.settings.assignmentRules,
            undefined,
            undefined,
            w.weekOf,
            props.settings,
            assistantPerson?.isMinor
          );
          criticalViolations += mainV.length;
        }

        if (assistantPerson) {
          const assistantV = getRuleViolations(
            assistantPerson,
            a.partType,
            "assistant",
            props.settings.assignmentRules,
            mainPerson?.isMinor ?? false,
            undefined,
            w.weekOf,
            props.settings
          );
          criticalViolations += assistantV.length;
        }

        if (mainPerson && assistantPerson && a.segment === "ministry" && needsAssistant(a.partType, props.settings.assignmentRules)) {
          if (mainPerson.gender !== assistantPerson.gender) {
            const inSameHousehold = households.some(
              (h) => h.memberIds.includes(mainPerson.id!) && h.memberIds.includes(assistantPerson.id!)
            );
            if (!inSameHousehold) {
              criticalViolations += 1;
            }
          }
        }
      }
    }

    let totalSlots = 0;
    let filledSlots = 0;
    for (const w of scopeWeeks) {
      if (w.specialEvent) continue;
      for (const a of w.assignments) {
        if (a.partType === "Video") continue;
        totalSlots++;
        if (a.assigneeId) filledSlots++;
        if (needsAssistant(a.partType, props.settings.assignmentRules)) {
          totalSlots++;
          if (a.assistantId) filledSlots++;
        }
      }
    }

    const fillPct = totalSlots > 0 ? filledSlots / totalSlots : 0;
    const fillScore = fillPct * 60; // Up to 60 points for complete assignments
    
    // Compliance Score: Up to 30 points. Each rule violation deducts 10 points.
    const violationScore = Math.max(0, 30 - criticalViolations * 10);
    
    // Optimization Score: Up to 10 points. Each suggestion deducts 2 points, representing a minor improvement opportunity.
    const optimizationScore = Math.max(0, 10 - suggestionsCount * 2);

    let score = Math.round(fillScore + violationScore + optimizationScore);
    if (score < 0) score = 0;
    if (score > 100) score = 100;

    return {
      score,
      totalSlots,
      filledSlots,
      suggestionsCount,
      criticalViolations,
      allSuggestions,
      scopeWeeks
    };
  }, [activeScope, week, props.allWeeks, assignees, households, props.settings]);

  // ── Dispatch (Circulation) Change Tracking ────────────────────────────
  const changes = useMemo(() => {
    if (!week.dispatched || !week.dispatchedAssignments) return [];

    const oldMap = new Map(week.dispatchedAssignments.map((a) => [a.uid, a]));
    const newMap = new Map(week.assignments.map((a) => [a.uid, a]));
    const allUids = new Set([...oldMap.keys(), ...newMap.keys()]);
    const enrolleeChanges = new Map<number, { name: string; changes: string[] }>();

    function addEnrolleeChange(id: number, changeText: string) {
      const enrollee = assignees.find((p) => p.id === id);
      if (!enrollee) return;
      if (!enrolleeChanges.has(id)) {
        enrolleeChanges.set(id, { name: enrollee.name, changes: [] });
      }
      enrolleeChanges.get(id)!.changes.push(changeText);
    }

    for (const uid of allUids) {
      const oldAss = oldMap.get(uid);
      const newAss = newMap.get(uid);

      if (oldAss && !newAss) {
        // Part removed
        const partName = oldAss.title || oldAss.partType;
        if (oldAss.assigneeId) {
          addEnrolleeChange(oldAss.assigneeId, `Removed from part: "${partName}" (Part was deleted)`);
        }
        if (oldAss.assistantId) {
          addEnrolleeChange(oldAss.assistantId, `Removed as assistant from part: "${partName}" (Part was deleted)`);
        }
      } else if (!oldAss && newAss) {
        // Part added
        const partName = newAss.title || newAss.partType;
        if (newAss.assigneeId) {
          addEnrolleeChange(newAss.assigneeId, `Assigned to new part: "${partName}"`);
        }
        if (newAss.assistantId) {
          addEnrolleeChange(newAss.assistantId, `Assigned as assistant to new part: "${partName}"`);
        }
      } else if (oldAss && newAss) {
        const assigneeChanged = oldAss.assigneeId !== newAss.assigneeId;
        const assistantChanged = oldAss.assistantId !== newAss.assistantId;
        const titleChanged = oldAss.title !== newAss.title;

        const oldMainName = oldAss.assigneeId ? assignees.find((p) => p.id === oldAss.assigneeId)?.name || "Unknown" : undefined;
        const newMainName = newAss.assigneeId ? assignees.find((p) => p.id === newAss.assigneeId)?.name || "Unknown" : undefined;
        const oldAsstName = oldAss.assistantId ? assignees.find((p) => p.id === oldAss.assistantId)?.name || "Unknown" : undefined;
        const newAsstName = newAss.assistantId ? assignees.find((p) => p.id === newAss.assistantId)?.name || "Unknown" : undefined;

        const partName = newAss.title || newAss.partType;
        const isSwap = oldAss.assigneeId === newAss.assistantId && oldAss.assistantId === newAss.assigneeId && oldAss.assigneeId && oldAss.assistantId;

        if (isSwap) {
          addEnrolleeChange(oldAss.assigneeId!, `Swapped role: now Assistant on "${partName}" (was Main)`);
          addEnrolleeChange(oldAss.assistantId!, `Swapped role: now Main speaker on "${partName}" (was Assistant)`);
        } else {
          if (assigneeChanged) {
            if (oldAss.assigneeId) {
              addEnrolleeChange(oldAss.assigneeId, `Removed from part: "${oldAss.title || oldAss.partType}"${newMainName ? ` (replaced by ${newMainName})` : ""}`);
            }
            if (newAss.assigneeId) {
              addEnrolleeChange(newAss.assigneeId, `Assigned to part: "${partName}"${oldMainName ? ` (replacing ${oldMainName})` : ""}`);
            }
          }
          if (assistantChanged) {
            if (oldAss.assistantId) {
              addEnrolleeChange(oldAss.assistantId, `Removed as assistant from part: "${oldAss.title || oldAss.partType}"${newAsstName ? ` (replaced by ${newAsstName})` : ""}`);
            }
            if (newAss.assistantId) {
              addEnrolleeChange(newAss.assistantId, `Assigned as assistant to part: "${partName}"${oldAsstName ? ` (replacing ${oldAsstName})` : ""}`);
            }
          }
        }

        // Details changed but assignee is the same
        if (!assigneeChanged && !isSwap && titleChanged) {
          if (newAss.assigneeId) {
            addEnrolleeChange(newAss.assigneeId, `Part title changed to "${newAss.title}" (was "${oldAss.title}")`);
          }
          if (newAss.assistantId && !assistantChanged) {
            addEnrolleeChange(newAss.assistantId, `Part title changed to "${newAss.title}" (was "${oldAss.title}")`);
          }
        }
      }
    }

    return Array.from(enrolleeChanges.entries()).map(([id, data]) => ({
      id,
      name: data.name,
      changes: data.changes,
    }));
  }, [week.dispatched, week.assignments, week.dispatchedAssignments, assignees]);

  function handleMarkAsDispatched() {
    props.onSave({
      ...week,
      dispatched: true,
      dispatchedAssignments: JSON.parse(JSON.stringify(week.assignments)),
    });
  }

  function handleCancelDispatch() {
    props.onSave({
      ...week,
      dispatched: false,
      dispatchedAssignments: undefined,
    });
  }

  function handleUpdateDispatchBaseline() {
    props.onSave({
      ...week,
      dispatchedAssignments: JSON.parse(JSON.stringify(week.assignments)),
    });
  }

  function handleToggleQaCheck() {
    props.onSave({
      ...week,
      qaChecked: !week.qaChecked,
    });
  }

  return (
    <div className="space-y-5">
      {props.onBackToOverview && (
        <div className="flex">
          <button
            onClick={props.onBackToOverview}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors hover:underline flex items-center gap-1 cursor-pointer"
          >
            ← Back to {props.periodLabel ? `"${props.periodLabel}"` : "Workbook"} Overview
          </button>
        </div>
      )}
      <header className="card">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <span>{weekRangeLabel(week.weekOf)}</span>
              {week.dispatched && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Dispatched
                </span>
              )}
              {week.qaChecked && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200" title="This week's assignments have been verified against the workbook.">
                  ✓ Checked against Workbook
                </span>
              )}
            </h2>
            <div className="text-xs text-slate-500">
              {week.weeklyBibleReading
                ? <span className="font-medium text-slate-600">{week.weeklyBibleReading} &middot; </span>
                : null}
              {week.assignments.length} parts &middot;{" "}
              {week.assignments.filter((a) => a.assigneeId).length} assigned
            </div>
          </div>
          <div className="ml-auto flex flex-col items-end gap-2.5 w-full lg:w-auto">
            {/* Top row: Scheduling / Assignment & QA Actions */}
            <div className="flex flex-wrap items-center justify-end gap-2.5 w-full">
              {/* Group 1: Scheduling / Assignment Actions */}
              <div className="flex flex-wrap items-center gap-1.5 bg-slate-100/60 p-1.5 rounded-lg border border-slate-200/50" title="Scheduling / Assignment Actions">
                <button
                  className="btn text-xs md:text-sm px-2 md:px-4 py-1.5 md:py-2"
                  onClick={() => props.onAutoFill(false)}
                  title="Reassign everything from scratch"
                  disabled={isReadOnly}
                >
                  Auto-assign all
                </button>
                <button
                  className="btn-secondary text-xs md:text-sm px-2 md:px-4 py-1.5 md:py-2"
                  onClick={() => props.onAutoFill(true)}
                  title="Fill empty slots only"
                  disabled={isReadOnly}
                >
                  Auto-fill empty
                </button>
              </div>

              <div className="h-6 w-px bg-slate-200 hidden sm:block" />

              {/* Group 2: QA Actions */}
              <div className="flex flex-wrap items-center gap-1.5 bg-indigo-50/30 p-1.5 rounded-lg border border-indigo-100/40" title="Quality Assurance Actions">
                <button
                  className={`btn text-xs md:text-sm px-2 md:px-4 py-1.5 md:py-2 flex items-center gap-1.5 cursor-pointer ${
                    week.qaChecked
                      ? "bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 font-semibold"
                      : "bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                  }`}
                  onClick={handleToggleQaCheck}
                  disabled={isReadOnly}
                  title={
                    week.qaChecked
                      ? "Unmark this week as checked against the workbook"
                      : "Mark this week as checked against the workbook and verified"
                  }
                >
                  <span>{week.qaChecked ? "☑" : "☐"}</span> {week.qaChecked ? "Verified" : "Verify against Workbook"}
                </button>
                {!week.dispatched ? (
                  <button
                    className="btn text-xs md:text-sm px-2 md:px-4 py-1.5 md:py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1.5 cursor-pointer"
                    onClick={handleMarkAsDispatched}
                    title="Mark this week's schedule as dispatched/circulated"
                  >
                    <span>📤</span> Mark as Dispatched
                  </button>
                ) : null}
                <button
                  className="btn-secondary text-xs md:text-sm px-2 md:px-4 py-1.5 md:py-2 cursor-pointer"
                  onClick={handleReviewOptimization}
                  title="Review for compliance optimizations"
                  disabled={!!week.specialEvent || isReadOnly}
                >
                  Review Optimization
                </button>
              </div>
            </div>

            {/* Bottom row: Data Management Actions */}
            <div className="flex flex-wrap items-center gap-1.5 bg-rose-50/20 p-1.5 rounded-lg border border-rose-100/30" title="Data Management Actions">
              <button
                className="btn-secondary text-xs md:text-sm px-2 md:px-4 py-1.5 md:py-2 border-rose-200 text-rose-700 hover:bg-rose-50 hover:border-rose-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                onClick={() => props.onClear()}
                disabled={isReadOnly}
              >
                Clear all
              </button>
              <button
                className="btn-danger text-xs md:text-sm px-2 md:px-4 py-1.5 md:py-2 cursor-pointer"
                onClick={() => props.onDelete()}
                disabled={isReadOnly}
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="flex-1">
            <label className="label">Weekly Bible reading (optional)</label>
            <input
              className="input max-w-md font-bold text-slate-800"
              value={week.weeklyBibleReading ?? ""}
              disabled={isReadOnly}
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
              disabled={isReadOnly}
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
        </div>
      </header>

      {/* Dispatch Status & Changes Tracker Banner */}
      {week.dispatched && (
        changes.length > 0 ? (
          <div className="card border-amber-200 bg-amber-50/30 backdrop-blur-xs p-5 space-y-4 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl mt-0.5 select-none">⚠️</span>
                <div>
                  <h4 className="font-bold text-amber-900 text-base">Schedule changed since dispatch!</h4>
                  <p className="text-xs text-amber-700 font-medium">
                    The following enrollees are affected by changes made after the schedule was distributed to the congregation.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  className={`btn text-xs font-semibold px-3 py-1.5 rounded cursor-pointer ${
                    isEditingDispatched
                      ? "bg-slate-600 hover:bg-slate-700 text-white"
                      : "bg-indigo-600 hover:bg-indigo-700 text-white"
                  }`}
                  onClick={() => setIsEditingDispatched(!isEditingDispatched)}
                  title={isEditingDispatched ? "Lock editing to make assignments view-only" : "Enable editing for this dispatched week"}
                >
                  {isEditingDispatched ? "🔒 Lock Editing" : "🔓 Enable Editing"}
                </button>
                <button
                  className="btn bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1.5 rounded cursor-pointer"
                  onClick={handleUpdateDispatchBaseline}
                  title="Update the dispatch baseline to current assignments, acknowledging all current changes"
                >
                  Update Dispatch Baseline
                </button>
                <button
                  className="btn-secondary border-amber-200 hover:bg-amber-100/50 text-amber-800 text-xs font-semibold px-3 py-1.5 rounded cursor-pointer"
                  onClick={handleCancelDispatch}
                  title="Remove dispatched status from this week"
                >
                  Cancel Dispatch
                </button>
              </div>
            </div>

            {/* Affected Enrollees Summary list */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-amber-200/40">
              {changes.map((c) => (
                <div key={c.id} className="bg-white/80 border border-amber-100 rounded-lg p-3 shadow-2xs">
                  <div className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                    <span>👤</span>
                    <span>{c.name}</span>
                  </div>
                  <ul className="mt-1.5 space-y-1 pl-4 list-disc text-xs text-slate-600 font-medium">
                    {c.changes.map((changeText, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {changeText}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="card border-emerald-200 bg-emerald-50/20 py-3.5 px-4 flex items-center justify-between gap-3 animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="text-base select-none">📤</span>
              <span className="text-xs font-semibold text-emerald-800">
                This week's schedule is dispatched and in sync with the distributed version.
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                className={`btn text-xs font-semibold px-3 py-1.5 rounded cursor-pointer ${
                  isEditingDispatched
                    ? "bg-slate-600 hover:bg-slate-700 text-white"
                    : "bg-indigo-600 hover:bg-indigo-700 text-white"
                }`}
                onClick={() => setIsEditingDispatched(!isEditingDispatched)}
                title={isEditingDispatched ? "Lock editing to make assignments view-only" : "Enable editing for this dispatched week"}
              >
                {isEditingDispatched ? "🔒 Lock Editing" : "🔓 Enable Editing"}
              </button>
              <button
                className="text-xs font-bold text-slate-500 hover:text-rose-600 transition-colors cursor-pointer"
                onClick={handleCancelDispatch}
                title="Remove dispatched status"
              >
                Cancel Dispatch
              </button>
            </div>
          </div>
        )
      )}

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
            livingSplit={livingSplit}
            bibleReadingSplit={bibleReadingSplit}
            prayerSplit={prayerSplit}
            settings={props.settings}
            allWeeks={props.allWeeks}
            partNumbers={partNumbers}
            disabled={isReadOnly}
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
              livingSplit={livingSplit}
              bibleReadingSplit={bibleReadingSplit}
              prayerSplit={prayerSplit}
              settings={props.settings}
              allWeeks={props.allWeeks}
              partNumbers={partNumbers}
              disabled={isReadOnly}
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
      {showOptimizationModal && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in"
          onClick={() => setShowOptimizationModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 max-h-[92vh] flex flex-col border border-slate-100 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-4 shrink-0">
              <div>
                <h3 className="font-bold text-xl text-slate-800 flex items-center gap-2">
                  <span>✨</span> Schedule Optimizer
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Optimize your assignments for fairness, gaps, and congregational rules.
                </p>
              </div>
              <button
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors"
                onClick={() => setShowOptimizationModal(false)}
              >
                ×
              </button>
            </div>

            {/* Scope Tabs */}
            <div className="bg-slate-100 p-1 rounded-xl mb-4 flex shrink-0">
              {(["week", "month", "month-pair"] as const).map((scope) => {
                const isActive = activeScope === scope;
                const label =
                  scope === "week"
                    ? "Current Week"
                    : scope === "month"
                    ? "This Month"
                    : "Workbook Period";
                return (
                  <button
                    key={scope}
                    className={`flex-1 text-center py-2 text-xs font-semibold rounded-lg transition-all ${
                      isActive
                        ? "bg-white text-indigo-600 shadow-xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                    onClick={() => setActiveScope(scope)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Health Dashboard & Metrics */}
            <div className="bg-gradient-to-r from-slate-50 to-indigo-50/20 border border-slate-200/60 rounded-xl p-4 mb-5 flex flex-col sm:flex-row items-center gap-6 shrink-0">
              {/* Radial Progress Score */}
              <div className="relative w-20 h-20 shrink-0">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                  {/* Background track */}
                  <path
                    className="text-slate-100"
                    strokeWidth="3.5"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  {/* Colored progress line */}
                  <path
                    className={`transition-all duration-500 ${
                      healthMetrics.score >= 80
                        ? "text-emerald-500"
                        : healthMetrics.score >= 50
                        ? "text-amber-500"
                        : "text-rose-500"
                    }`}
                    strokeDasharray={`${healthMetrics.score}, 100`}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-extrabold text-slate-800 tabular-nums">{healthMetrics.score}%</span>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter text-center scale-90">Health</span>
                </div>
              </div>

              {/* Grid Metrics */}
              <div className="flex-1 w-full grid grid-cols-3 gap-3">
                <div className="bg-white/80 backdrop-blur-xs border border-slate-100 p-2.5 rounded-lg text-center">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Completeness</div>
                  <div className="text-sm font-bold text-slate-800 mt-0.5 tabular-nums">
                    {healthMetrics.filledSlots}/{healthMetrics.totalSlots}
                  </div>
                  <div className="w-full bg-slate-100 h-1 rounded-full mt-1.5 overflow-hidden">
                    <div 
                      className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${healthMetrics.totalSlots > 0 ? (healthMetrics.filledSlots / healthMetrics.totalSlots) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                <div className="bg-white/80 backdrop-blur-xs border border-slate-100 p-2.5 rounded-lg text-center">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Warnings</div>
                  <div className={`text-sm font-bold mt-0.5 tabular-nums ${healthMetrics.criticalViolations > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                    {healthMetrics.criticalViolations}
                  </div>
                  <div className="text-[9px] text-slate-400 mt-1.5 truncate">
                    {healthMetrics.criticalViolations > 0 ? "Rule violations" : "Compliance perfect"}
                  </div>
                </div>

                <div className="bg-white/80 backdrop-blur-xs border border-slate-100 p-2.5 rounded-lg text-center">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Opportunities</div>
                  <div className={`text-sm font-bold mt-0.5 tabular-nums ${healthMetrics.suggestionsCount > 0 ? "text-indigo-600" : "text-emerald-600"}`}>
                    {healthMetrics.suggestionsCount}
                  </div>
                  <div className="text-[9px] text-slate-400 mt-1.5 truncate">
                    {healthMetrics.suggestionsCount > 0 ? "Optimizations found" : "Fully optimal"}
                  </div>
                </div>
              </div>
            </div>

            {/* Suggestions scroll list */}
            <div className="flex-1 overflow-y-auto min-h-0 space-y-4 custom-scrollbar pr-2 -mr-2">
              {healthMetrics.scopeWeeks.map((w) => {
                const weekSuggestions = healthMetrics.allSuggestions.filter(s => s.week.id === w.id);
                const isCurrentWeek = w.id === week.id;

                return (
                  <div key={w.id} className={`border rounded-xl p-3 transition-colors ${
                    isCurrentWeek ? "border-indigo-200 bg-indigo-50/5 shadow-xs" : "border-slate-200 bg-white"
                  }`}>
                    {/* Week Header */}
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${isCurrentWeek ? "bg-indigo-500 animate-pulse" : "bg-slate-400"}`} />
                        <h4 className="font-bold text-xs text-slate-700 uppercase tracking-wider">
                          Week of {weekRangeLabel(w.weekOf)}
                          {isCurrentWeek && <span className="text-[10px] text-indigo-600 normal-case font-semibold ml-2">(Current Week)</span>}
                        </h4>
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium font-mono">
                        {w.weeklyBibleReading || "Normal Schedule"}
                      </span>
                    </div>

                    {/* Suggestions content */}
                    {w.specialEvent ? (
                      <div className="text-center py-2 text-xs text-slate-400 italic">
                        🗓️ {w.specialEvent} week — optimizations suspended.
                      </div>
                    ) : weekSuggestions.length === 0 ? (
                      <div className="flex items-center gap-1.5 justify-center py-3 text-xs text-emerald-600 font-medium">
                        <span>✓</span>
                        <span>This week is fully optimized and compliant!</span>
                      </div>
                    ) : (
                      <div className="space-y-3 mt-2">
                        {weekSuggestions.map((opt, idx) => {
                          const part = w.assignments.find((a) => a.uid === opt.uid);
                          const currentPerson = assignees.find((p) => p.id === opt.currentAssigneeId);
                          const newPerson = assignees.find((p) => p.id === opt.suggestedAssigneeId);
                          
                          // Find part color accent
                          const segmentDef = SEGMENTS.find(s => s.id === part?.segment);
                          const partColor = segmentDef?.color || "#64748b";

                          return (
                            <div 
                              key={idx} 
                              className="bg-slate-50 hover:bg-slate-100/70 border border-slate-200/80 rounded-lg p-3 transition-all hover:shadow-2xs group"
                            >
                              <div className="flex items-start justify-between gap-3 mb-2">
                                <div>
                                  <span 
                                    className="inline-block w-1.5 h-1.5 rounded-full mr-2 animate-pulse"
                                    style={{ backgroundColor: partColor }}
                                  />
                                  <span className="font-bold text-xs text-slate-800">
                                    {part?.title}
                                  </span>
                                  <span className="text-[10px] font-semibold text-slate-400 ml-1.5 uppercase tracking-wider">
                                    &middot; {opt.role}
                                  </span>
                                </div>
                                <div className="flex gap-1.5 shrink-0">
                                  <button
                                    className="px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-md transition-colors"
                                    onClick={() => skipPeriodOptimization({ ...opt, week: w })}
                                  >
                                    Skip
                                  </button>
                                  <button
                                    className="btn text-[11px] py-1 px-3 shadow-none bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-md border-0 transform active:scale-95 transition-transform"
                                    onClick={() => applyPeriodOptimization({ ...opt, week: w })}
                                  >
                                    Apply Swap
                                  </button>
                                </div>
                              </div>

                              <div className="grid grid-cols-[1fr,20px,1fr] items-center gap-2 text-xs py-1 px-1.5 bg-white rounded-md border border-slate-100">
                                <div className="text-slate-400 font-medium line-through truncate px-1 text-center bg-rose-50/50 rounded border border-rose-100/40">
                                  {currentPerson?.name || "Unassigned"}
                                </div>
                                <div className="text-slate-400 font-semibold text-center">→</div>
                                <div className="text-emerald-700 font-bold truncate px-1 text-center bg-emerald-50 rounded border border-emerald-100/60">
                                  {newPerson?.name}
                                </div>
                              </div>
                              <p className="text-[10px] text-slate-500 mt-2 font-medium bg-white/40 border border-slate-100 rounded px-2 py-1 leading-relaxed">
                                {opt.reason}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="mt-5 flex justify-end shrink-0 gap-2 border-t border-slate-100 pt-3">
              <button 
                className="btn-secondary" 
                onClick={() => setShowOptimizationModal(false)}
              >
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
  livingSplit,
  bibleReadingSplit,
  prayerSplit,
  settings,
  allWeeks,
  partNumbers,
  disabled,
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
  livingSplit: LivingSplit;
  bibleReadingSplit: BibleReadingSplit;
  prayerSplit: PrayerSplit;
  settings: AppSettings;
  allWeeks: Week[];
  partNumbers: Map<string, number>;
  disabled?: boolean;
}) {
  const [isOver, setIsOver] = useState(false);
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeNeedsAssistant, setNewTypeNeedsAssistant] = useState(false);

  useEffect(() => {
    if (isAddingCustom) {
      setNewTypeNeedsAssistant(segment === "ministry");
    }
  }, [isAddingCustom, segment]);

  const availablePartTypes = useMemo(() => {
    return [
      ...SEGMENT_PART_TYPES[segment],
      ...(settings.customPartTypes?.[segment] || [])
    ];
  }, [segment, settings.customPartTypes]);

  const [pickerType, setPickerType] = useState<PartType>(
    SEGMENT_PART_TYPES[segment][0]
  );

  useEffect(() => {
    if (!availablePartTypes.includes(pickerType)) {
      setPickerType(availablePartTypes[0]);
    }
  }, [availablePartTypes, pickerType]);

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
            className="input w-auto text-sm"
            value={pickerType}
            disabled={disabled}
            onChange={(e) => {
              if (e.target.value === "__ADD_NEW_PART_TYPE__") {
                setIsAddingCustom(true);
              } else {
                setPickerType(e.target.value as PartType);
              }
            }}
          >
            {availablePartTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value="__ADD_NEW_PART_TYPE__">+ Add new part type...</option>
          </select>
          <button
            className="btn-secondary"
            onClick={() => onAddPart(pickerType)}
            disabled={disabled}
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
              livingSplit={livingSplit}
              bibleReadingSplit={bibleReadingSplit}
              prayerSplit={prayerSplit}
              settings={settings}
              allWeeks={allWeeks}
              partNumber={partNumbers.get(a.uid)}
              disabled={disabled}
            />
          ))}
        </ul>
      )}

      {isAddingCustom && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-100 max-w-md w-full p-6 space-y-4 animate-scale-in">
            <h3 className="text-lg font-bold text-slate-800">Add New Part Type</h3>
            <p className="text-xs text-slate-500">
              Create a custom assignment type for the <strong>{title}</strong> segment. It will be available to add to schedules and customize rules.
            </p>
            <div>
              <label className="label">Part Type Name</label>
              <input
                type="text"
                className="input w-full text-slate-800 font-medium"
                placeholder="e.g. Auxiliary Pioneer Talk"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2 pt-2 select-none">
              <input
                type="checkbox"
                id="newTypeNeedsAssistant"
                className="checkbox w-4 h-4 text-slate-800"
                checked={newTypeNeedsAssistant}
                onChange={(e) => setNewTypeNeedsAssistant(e.target.checked)}
              />
              <label htmlFor="newTypeNeedsAssistant" className="font-semibold text-slate-700 text-sm cursor-pointer select-none">
                This part needs an assistant / reader
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <button
                className="btn-secondary"
                onClick={() => {
                  setIsAddingCustom(false);
                  setNewTypeName("");
                  setPickerType(availablePartTypes[0]);
                }}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={async () => {
                  const trimmed = newTypeName.trim();
                  if (!trimmed) return;
                  if (availablePartTypes.includes(trimmed)) {
                    alert("A part type with this name already exists.");
                    return;
                  }
                  
                  const currentCustom = settings.customPartTypes?.[segment] || [];
                  const updatedCustom: Record<SegmentId, string[]> = {
                    opening: settings.customPartTypes?.opening || [],
                    treasures: settings.customPartTypes?.treasures || [],
                    ministry: settings.customPartTypes?.ministry || [],
                    living: settings.customPartTypes?.living || [],
                    [segment]: [...currentCustom, trimmed]
                  };
                  const updatedSettings: AppSettings = {
                    ...settings,
                    customPartTypes: updatedCustom
                  };
                  
                  const defaultRule: AssignmentRule = segment === "ministry"
                    ? {
                        allowedGenders: ["M" as const, "F" as const],
                        requiredPrivileges: [],
                        mustBeBaptized: false
                      }
                    : {
                        allowedGenders: ["M" as const],
                        requiredPrivileges: [],
                        mustBeBaptized: true
                      };

                  if (newTypeNeedsAssistant) {
                    defaultRule.assistant = {
                      allowedGenders: segment === "ministry" ? ["M" as const, "F" as const] : ["M" as const],
                      requiredPrivileges: [],
                      mustBeBaptized: false
                    };
                  }
                      
                  updatedSettings.assignmentRules = {
                    ...settings.assignmentRules,
                    [trimmed]: defaultRule
                  };

                  await db.settings.put(updatedSettings);
                  
                  await db.logs.add({
                    timestamp: Date.now(),
                    category: "settings",
                    action: `Added custom part type "${trimmed}" to segment "${segment}"`
                  });

                  setPickerType(trimmed);
                  setIsAddingCustom(false);
                  setNewTypeName("");
                }}
              >
                Add Part Type
              </button>
            </div>
          </div>
        </div>
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
  livingSplit,
  bibleReadingSplit,
  prayerSplit,
  settings,
  allWeeks,
  partNumber,
  disabled,
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
  livingSplit: LivingSplit;
  bibleReadingSplit: BibleReadingSplit;
  prayerSplit: PrayerSplit;
  settings: AppSettings;
  allWeeks: Week[];
  partNumber?: number;
  disabled?: boolean;
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

  const assistantPerson = assignees.find((a) => a.id === assignment.assistantId);

  const mainViolations = useMemo(() => {
    if (!mainPerson) return [];
    return getRuleViolations(
      mainPerson,
      assignment.partType,
      "main",
      settings.assignmentRules,
      undefined,
      undefined,
      week.weekOf,
      settings,
      assistantPerson?.isMinor
    );
  }, [mainPerson, assistantPerson, assignment.partType, settings.assignmentRules, week.weekOf, settings]);

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
      lastAssignmentRole,
      week.weekOf,
      settings
    );
  }, [assistantPerson, assignment.partType, settings.assignmentRules, mainPerson, stats, week.weekOf, settings]);

  const seg = segmentOf(assignment.segment);
  const showAssistant = needsAssistant(assignment.partType, settings.assignmentRules);
  const canSwap = showAssistant && assignment.partType !== "Congregation Bible Study";

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
    const isMinistryDemo = assignment.segment === "ministry" && needsAssistant(assignment.partType, settings.assignmentRules);
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
      .map((a) => a.title || "");
  }, [mainPerson, week.assignments, assignment.uid]);

  const assistantOtherParts = useMemo(() => {
    if (!assistantPerson) return [];
    return week.assignments
      .filter(
        (a) =>
          a.uid !== assignment.uid &&
          (a.assigneeId === assistantPerson.id || a.assistantId === assistantPerson.id)
      )
      .map((a) => a.title || "");
  }, [assistantPerson, week.assignments, assignment.uid]);

  function handleSwap() {
    onUpdate({
      ...assignment,
      assigneeId: assignment.assistantId,
      assistantId: assignment.assigneeId,
    });
  }

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
            disabled={disabled}
            onChange={(e) =>
              onUpdate({
                ...assignment,
                partType: e.target.value as PartType,
              })
            }
          >
            {[
              ...SEGMENT_PART_TYPES[assignment.segment],
              ...(settings.customPartTypes?.[assignment.segment] || [])
            ].map((t) => (
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
            disabled={disabled}
            placeholder={titlePlaceholder(assignment.partType)}
            onChange={(e) =>
              onUpdate({ ...assignment, title: e.target.value })
            }
          />
        </div>

        <div className="pt-5">
          <button
            className="text-slate-400 hover:text-red-600 text-sm disabled:text-slate-300 disabled:hover:text-slate-300 disabled:cursor-not-allowed"
            onClick={onRemove}
            disabled={disabled}
            title="Remove part"
          >
            Remove
          </button>
        </div>
      </div>

      <div className={`grid ${canSwap ? "sm:grid-cols-[1fr_auto_1fr]" : "sm:grid-cols-2"} items-end gap-3 mt-3`}>
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
              disabled={disabled}
              onChange={(id) => onUpdate({ ...assignment, assigneeId: id })}
              onNavigateToProfile={onNavigateToProfile}
              stats={stats}
              talkSplit={talkSplit}
              treasuresSplit={treasuresSplit}
              livingSplit={livingSplit}
              bibleReadingSplit={bibleReadingSplit}
              prayerSplit={prayerSplit}
              settings={settings}
              assignment={assignment}
              role="main"
              weekOf={week.weekOf}
              allWeeks={allWeeks}
              mainPerson={mainPerson}
              assistantPerson={assistantPerson}
              households={households}
            />
            {canSwap && (
              <div className="flex items-center justify-center pb-2.5">
                <button
                  type="button"
                  onClick={handleSwap}
                  disabled={disabled}
                  className="w-9 h-9 rounded-full border border-slate-200 bg-slate-50 hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 flex items-center justify-center transition-colors shadow-xs active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-slate-50 disabled:hover:text-slate-500"
                  title="Swap main and assistant roles"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                </button>
              </div>
            )}
            {showAssistant && (
              <AssigneePicker
                label={
                  assignment.partType === "Congregation Bible Study"
                    ? "Reader"
                    : "Householder / assistant"
                }
                value={assignment.assistantId}
                disabled={disabled}
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
                livingSplit={livingSplit}
                bibleReadingSplit={bibleReadingSplit}
                prayerSplit={prayerSplit}
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
  livingSplit,
  bibleReadingSplit,
  prayerSplit,
  settings,
  assignment,
  role,
  weekOf,
  allWeeks,
  mainIsMinor,
  mainPerson,
  assistantPerson,
  households,
  disabled,
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
  livingSplit: LivingSplit;
  bibleReadingSplit: BibleReadingSplit;
  prayerSplit: PrayerSplit;
  settings: AppSettings;
  assignment: Assignment;
  role: "main" | "assistant";
  weekOf: string;
  allWeeks: Week[];
  mainIsMinor?: boolean;
  mainPerson?: Assignee;
  assistantPerson?: Assignee;
  households?: Household[];
  disabled?: boolean;
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
        recentPrayerDates: [],
        lastPartWasWithMinor: false,
      };
      const partner = role === "main" ? assistantPerson : mainPerson;
      const partnerIsMinor = partner ? !!partner.isMinor : undefined;
      const partnerStats = partner ? stats.get(partner.id!) : undefined;
      const partnerLastPartWasWithMinor = partnerStats ? partnerStats.lastPartWasWithMinor : undefined;

      const score = scoreCandidate(
        a,
        assignment,
        weekOf,
        s,
        0, // seed
        talkSplit,
        treasuresSplit,
        livingSplit,
        bibleReadingSplit,
        role,
        {
          minGapWeeks: settings.minGapWeeks ?? 2,
          catchUpIntensity: settings.catchUpIntensity ?? 1,
          msTreasuresRatio: settings.msTreasuresRatio ?? 0,
          qmsTreasuresRatio: settings.qmsTreasuresRatio ?? 0,
          qeLivingRatio: settings.qeLivingRatio ?? 25,
          eLivingRatio: settings.eLivingRatio ?? 25,
          qmsLivingRatio: settings.qmsLivingRatio ?? 25,
          privilegedBibleReadingRatio: settings.privilegedBibleReadingRatio ?? 10,
          shareMinistryQE: settings.shareMinistryQE ?? 2,
          shareMinistryE: settings.shareMinistryE ?? 2,
          shareMinistryMS: settings.shareMinistryMS ?? 2,
          shareMinistryQMS: settings.shareMinistryQMS ?? 2,
          shareMinistryBrothers: settings.shareMinistryBrothers ?? 2,
          ruleMinGap: settings.ruleMinGap,
          ruleChairmanGap: settings.ruleChairmanGap,
          ruleRoleAlternation: settings.ruleRoleAlternation,
          ruleMinorAssistantToAdult: settings.ruleMinorAssistantToAdult,
          ruleAdultAssistantForMinor: settings.ruleAdultAssistantForMinor,
          ruleWorkloadBalancing: settings.ruleWorkloadBalancing,
          ruleSegmentBalancing: settings.ruleSegmentBalancing,
          ruleInfirmedThrottling: settings.ruleInfirmedThrottling,
          ruleSameSexDemogenders: settings.ruleSameSexDemogenders,
          ruleMainToAssistantConsecutive: settings.ruleMainToAssistantConsecutive,
          qePrayerRatio: settings.qePrayerRatio ?? 20,
          ePrayerRatio: settings.ePrayerRatio ?? 20,
          qmsPrayerRatio: settings.qmsPrayerRatio ?? 20,
          msPrayerRatio: settings.msPrayerRatio ?? 20,
          rulePrayerRotation: settings.rulePrayerRotation,
          ruleUnifiedMinistry: settings.ruleUnifiedMinistry,
        },
        mainIsMinor,
        partnerIsMinor,
        partnerLastPartWasWithMinor,
        prayerSplit
      );

      const isCurrentPrayer = assignment.partType === "Opening Prayer" || assignment.partType === "Closing Prayer";
      // --- Unified Proximity Indicators ---
      const matches = allWeeks
        .filter((w) => {
          return w.assignments.some((ass: Assignment) => {
            if (a.id == null) return false;
            const hasRole = ass.assigneeId === a.id || ass.assistantId === a.id;
            if (!hasRole) return false;
            const isAssPrayer = ass.partType === "Opening Prayer" || ass.partType === "Closing Prayer";
            return isCurrentPrayer === isAssPrayer;
          });
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
        lastAssignmentRole,
        weekOf,
        settings,
        partnerIsMinor
      );

      // Same-Sex Demo Match Check inside options map
      if (assignment.segment === "ministry" && needsAssistant(assignment.partType, settings.assignmentRules)) {
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

      // Main/Assistant Pairing Repetition Avoidance Check
      const pairingAvoidance = settings.pairingAvoidance || "strict";
      if (pairingAvoidance !== "off" && a.id != null) {
        if (role === "main" && assistantPerson && assistantPerson.id != null) {
          if (checkPairingViolation(a.id, assistantPerson.id, weekOf, allWeeks)) {
            violations.push(`Pairing violation: already paired in last/next two parts.`);
          }
        } else if (role === "assistant" && mainPerson && mainPerson.id != null) {
          if (checkPairingViolation(mainPerson.id, a.id, weekOf, allWeeks)) {
            violations.push(`Pairing violation: already paired in last/next two parts.`);
          }
        }
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
          .map((ass) => ass.title || "");

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

      let privilegeCategory = 5; // default unbaptized/pioneers/sisters
      if (a.privileges?.includes("E") || a.privileges?.includes("QE")) {
        privilegeCategory = 0; // Elders
      } else if (a.privileges?.includes("QMS")) {
        privilegeCategory = 1; // Qualified Ministerial Servants
      } else if (a.privileges?.includes("MS")) {
        privilegeCategory = 2; // Ministerial Servants
      } else if (a.gender === "M" && a.baptised) {
        privilegeCategory = 3; // Baptized Brothers
      } else if (a.gender === "F" && a.baptised) {
        privilegeCategory = 4; // Baptized Sisters
      }

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
        privilegeCategory,
      };
    });

    // Sort: available enrollees first, then by core qualification violations ascending,
    // then by congregation spiritual status category ascending (Elders -> Qualified MS -> MS -> Baptized Brothers -> Baptized Sisters -> Unbaptized Publishers),
    // then by scheduling policy violations ascending, and finally by score descending
    scored.sort((x, y) => {
      const xAway = !!x.awayReason;
      const yAway = !!y.awayReason;
      if (xAway && !yAway) return 1;
      if (!xAway && yAway) return -1;

      if (x.coreViolationsCount !== y.coreViolationsCount) {
        return x.coreViolationsCount - y.coreViolationsCount;
      }

      if (x.privilegeCategory !== y.privilegeCategory) {
        return x.privilegeCategory - y.privilegeCategory;
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
  }, [options, query, stats, talkSplit, treasuresSplit, livingSplit, bibleReadingSplit, settings, assignment, weekOf, role, allWeeks, mainIsMinor, mainPerson, assistantPerson, households, prayerSplit]);

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
          style={{ paddingRight: "2rem", cursor: disabled ? "not-allowed" : "text" }}
          placeholder="— unassigned —"
          value={open ? query : displayValue}
          disabled={disabled}
          onFocus={() => {
            if (!disabled) {
              setOpen(true);
              setQuery("");
            }
          }}
          onChange={(e) => {
            if (!disabled) {
              setQuery(e.target.value);
              setOpen(true);
            }
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
            <a
              href={`?tab=profile&profileId=${value}`}
              onClick={(e) => {
                if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
                  e.preventDefault();
                  e.stopPropagation();
                  onNavigateToProfile(value);
                } else {
                  e.stopPropagation();
                }
              }}
              className="p-1 hover:bg-slate-100 rounded text-indigo-500 transition-colors"
              title="View Profile"
            >
              👤
            </a>
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

