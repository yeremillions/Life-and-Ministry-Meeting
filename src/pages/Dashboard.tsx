import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { db } from "../db";
import { buildStats, dueSoon } from "../scheduler";
import { SEGMENTS, segmentOf, needsAssistant } from "../meeting";
import { todayIso, weekRangeLabel, toIso, mondayOf, getMeetingDate } from "../utils";
import type { Week, Assignee, AppSettings, Household } from "../types";
import { DEFAULT_ASSIGNMENT_RULES } from "../types";
import QuickStartWizard from "../components/QuickStartWizard";
import ConfirmationModal from "../components/ConfirmationModal";

export interface Conflict {
  id: string;
  weekId: number;
  weekOf: string;
  partUid: string;
  partType: string;
  partTitle: string;
  ruleName: string;
  message: string;
  severity: "error" | "warning";
  assigneeId?: number;
  assistantId?: number;
}

export function findWeekConflicts(
  week: Week,
  assignees: Assignee[],
  households: Household[],
  settings: AppSettings | null
): Conflict[] {
  if (week.specialEvent) return [];

  const conflicts: Conflict[] = [];
  const assignments = week.assignments;
  const rules = settings?.assignmentRules || DEFAULT_ASSIGNMENT_RULES;
  const preventMinorAssistantToAdult = settings?.preventMinorAssistantToAdult ?? true;
  const mode = settings?.availabilityMode || "unavailable";
  const meetingDay = settings?.midweekMeetingDay || "Thursday";
  const meetingDateStr = getMeetingDate(week.weekOf, meetingDay);

  // Double Booking count
  const idCounts = new Map<number, number>();
  for (const a of assignments) {
    if (a.assigneeId != null) {
      idCounts.set(a.assigneeId, (idCounts.get(a.assigneeId) || 0) + 1);
    }
    if (a.assistantId != null) {
      idCounts.set(a.assistantId, (idCounts.get(a.assistantId) || 0) + 1);
    }
  }

  for (const a of assignments) {
    const main = a.assigneeId != null ? assignees.find((p) => p.id === a.assigneeId) : null;
    const assistant = a.assistantId != null ? assignees.find((p) => p.id === a.assistantId) : null;
    const rule = rules[a.partType] || DEFAULT_ASSIGNMENT_RULES[a.partType];

    // Main assignee rules
    if (main) {
      // 1. Inactive Assignee
      if (!main.active) {
        conflicts.push({
          id: `${week.id}-${a.uid}-main-inactive`,
          weekId: week.id!,
          weekOf: week.weekOf,
          partUid: a.uid,
          partType: a.partType,
          partTitle: a.title,
          ruleName: "Inactive Assignee",
          message: `${main.name} is currently inactive but is assigned to a part.`,
          severity: "error",
          assigneeId: main.id,
        });
      }

      // 2. Double Booking
      if ((idCounts.get(main.id!) || 0) > 1) {
        conflicts.push({
          id: `${week.id}-${a.uid}-main-doublebooking`,
          weekId: week.id!,
          weekOf: week.weekOf,
          partUid: a.uid,
          partType: a.partType,
          partTitle: a.title,
          ruleName: "Double Booking",
          message: `${main.name} is scheduled for multiple parts in the same week.`,
          severity: "warning",
          assigneeId: main.id,
        });
      }

      // 3. Calendar Availability
      const ranges = main.unavailableRanges ?? [];
      const overlapsAny = ranges.some((range) => {
        return meetingDateStr >= range.start && meetingDateStr <= range.end;
      });
      if (mode === "available") {
        if (ranges.length > 0 && !overlapsAny) {
          conflicts.push({
            id: `${week.id}-${a.uid}-main-avail`,
            weekId: week.id!,
            weekOf: week.weekOf,
            partUid: a.uid,
            partType: a.partType,
            partTitle: a.title,
            ruleName: "Calendar Availability",
            message: `${main.name} is assigned on a date (${meetingDateStr}) when they are not available.`,
            severity: "warning",
            assigneeId: main.id,
          });
        }
      } else {
        if (overlapsAny) {
          conflicts.push({
            id: `${week.id}-${a.uid}-main-avail`,
            weekId: week.id!,
            weekOf: week.weekOf,
            partUid: a.uid,
            partType: a.partType,
            partTitle: a.title,
            ruleName: "Calendar Availability",
            message: `${main.name} is assigned on a date (${meetingDateStr}) that overlaps with their away/travel dates.`,
            severity: "warning",
            assigneeId: main.id,
          });
        }
      }

      // 4. Allowed Parts Restriction
      if (main.allowedParts && !main.allowedParts.includes(a.partType)) {
        conflicts.push({
          id: `${week.id}-${a.uid}-main-allowedparts`,
          weekId: week.id!,
          weekOf: week.weekOf,
          partUid: a.uid,
          partType: a.partType,
          partTitle: a.title,
          ruleName: "Profile Allowed Parts",
          message: `${main.name}'s profile restricts them from being assigned to '${a.partType}'.`,
          severity: "error",
          assigneeId: main.id,
        });
      }

      // 5. Prayer Exclusions
      const isPrayer = a.partType === "Opening Prayer" || a.partType === "Closing Prayer";
      if (isPrayer && main.excludeFromPrayers) {
        conflicts.push({
          id: `${week.id}-${a.uid}-main-prayer-exclusion`,
          weekId: week.id!,
          weekOf: week.weekOf,
          partUid: a.uid,
          partType: a.partType,
          partTitle: a.title,
          ruleName: "Prayer Exclusions",
          message: `${main.name} is manually excluded from prayer assignments in their profile.`,
          severity: "error",
          assigneeId: main.id,
        });
      }

      // 6. Gender Matching
      if (rule && !rule.allowedGenders.includes(main.gender)) {
        conflicts.push({
          id: `${week.id}-${a.uid}-main-gender`,
          weekId: week.id!,
          weekOf: week.weekOf,
          partUid: a.uid,
          partType: a.partType,
          partTitle: a.title,
          ruleName: "Gender Matching",
          message: `${main.name} (${main.gender === "M" ? "brother" : "sister"}) is assigned to '${a.partType}', which requires a ${rule.allowedGenders.map(g => g === "M" ? "brother" : "sister").join(" or ")}.`,
          severity: "error",
          assigneeId: main.id,
        });
      }

      // 7. Baptism Requirement
      if (rule && rule.mustBeBaptized && !main.baptised) {
        conflicts.push({
          id: `${week.id}-${a.uid}-main-bapt`,
          weekId: week.id!,
          weekOf: week.weekOf,
          partUid: a.uid,
          partType: a.partType,
          partTitle: a.title,
          ruleName: "Baptism Requirement",
          message: `${main.name} is unbaptized but assigned to '${a.partType}', which requires baptism.`,
          severity: "error",
          assigneeId: main.id,
        });
      }

      // 8. Privilege Requirements
      if (rule && rule.requiredPrivileges.length > 0) {
        const manuallyIncluded = isPrayer && main.includeInPrayers;
        if (!manuallyIncluded) {
          const hasPriv = rule.requiredPrivileges.some(p => main.privileges.includes(p));
          if (!hasPriv) {
            conflicts.push({
              id: `${week.id}-${a.uid}-main-priv`,
              weekId: week.id!,
              weekOf: week.weekOf,
              partUid: a.uid,
              partType: a.partType,
              partTitle: a.title,
              ruleName: "Privilege Requirements",
              message: `${main.name} does not have required privileges (${rule.requiredPrivileges.join(", ")}) for '${a.partType}'.`,
              severity: "error",
              assigneeId: main.id,
            });
          }
        }
      }
    }

    // Assistant rules
    if (assistant) {
      // 1. Inactive Assignee (Assistant)
      if (!assistant.active) {
        conflicts.push({
          id: `${week.id}-${a.uid}-assistant-inactive`,
          weekId: week.id!,
          weekOf: week.weekOf,
          partUid: a.uid,
          partType: a.partType,
          partTitle: a.title,
          ruleName: "Inactive Assignee",
          message: `${assistant.name} is currently inactive but is assigned as assistant.`,
          severity: "error",
          assistantId: assistant.id,
        });
      }

      // 2. Double Booking (Assistant)
      if ((idCounts.get(assistant.id!) || 0) > 1) {
        conflicts.push({
          id: `${week.id}-${a.uid}-assistant-doublebooking`,
          weekId: week.id!,
          weekOf: week.weekOf,
          partUid: a.uid,
          partType: a.partType,
          partTitle: a.title,
          ruleName: "Double Booking",
          message: `${assistant.name} (assistant) is scheduled for multiple parts in the same week.`,
          severity: "warning",
          assistantId: assistant.id,
        });
      }

      // 3. Calendar Availability (Assistant)
      const ranges = assistant.unavailableRanges ?? [];
      const overlapsAny = ranges.some((range) => {
        return meetingDateStr >= range.start && meetingDateStr <= range.end;
      });
      if (mode === "available") {
        if (ranges.length > 0 && !overlapsAny) {
          conflicts.push({
            id: `${week.id}-${a.uid}-assistant-avail`,
            weekId: week.id!,
            weekOf: week.weekOf,
            partUid: a.uid,
            partType: a.partType,
            partTitle: a.title,
            ruleName: "Calendar Availability",
            message: `${assistant.name} (assistant) is assigned on a date (${meetingDateStr}) when they are not available.`,
            severity: "warning",
            assistantId: assistant.id,
          });
        }
      } else {
        if (overlapsAny) {
          conflicts.push({
            id: `${week.id}-${a.uid}-assistant-avail`,
            weekId: week.id!,
            weekOf: week.weekOf,
            partUid: a.uid,
            partType: a.partType,
            partTitle: a.title,
            ruleName: "Calendar Availability",
            message: `${assistant.name} (assistant) is assigned on a date (${meetingDateStr}) that overlaps with their away/travel dates.`,
            severity: "warning",
            assistantId: assistant.id,
          });
        }
      }

      // 4. Allowed Parts Restriction (Assistant)
      if (assistant.allowedParts && !assistant.allowedParts.includes(a.partType)) {
        conflicts.push({
          id: `${week.id}-${a.uid}-assistant-allowedparts`,
          weekId: week.id!,
          weekOf: week.weekOf,
          partUid: a.uid,
          partType: a.partType,
          partTitle: a.title,
          ruleName: "Profile Allowed Parts",
          message: `${assistant.name}'s profile restricts them from being assigned to '${a.partType}' as assistant.`,
          severity: "error",
          assistantId: assistant.id,
        });
      }

      // 5. Prayer Exclusions (Assistant - safety fallback)
      const isPrayer = a.partType === "Opening Prayer" || a.partType === "Closing Prayer";
      if (isPrayer && assistant.excludeFromPrayers) {
        conflicts.push({
          id: `${week.id}-${a.uid}-assistant-prayer-exclusion`,
          weekId: week.id!,
          weekOf: week.weekOf,
          partUid: a.uid,
          partType: a.partType,
          partTitle: a.title,
          ruleName: "Prayer Exclusions",
          message: `${assistant.name} (assistant) is manually excluded from prayer assignments in their profile.`,
          severity: "error",
          assistantId: assistant.id,
        });
      }

      // 6. Gender Matching (Assistant)
      if (rule && rule.assistant && !rule.assistant.allowedGenders.includes(assistant.gender)) {
        if (a.partType === "Congregation Bible Study") {
          // 10. Congregation Bible Study Reader specific warning
          conflicts.push({
            id: `${week.id}-${a.uid}-assistant-cbs-reader`,
            weekId: week.id!,
            weekOf: week.weekOf,
            partUid: a.uid,
            partType: a.partType,
            partTitle: a.title,
            ruleName: "Congregation Bible Study Reader",
            message: `The Congregation Bible Study reader must be a brother, but ${assistant.name} (sister) is assigned.`,
            severity: "error",
            assistantId: assistant.id,
          });
        } else {
          conflicts.push({
            id: `${week.id}-${a.uid}-assistant-gender`,
            weekId: week.id!,
            weekOf: week.weekOf,
            partUid: a.uid,
            partType: a.partType,
            partTitle: a.title,
            ruleName: "Gender Matching",
            message: `${assistant.name} (assistant) does not match gender requirements for '${a.partType}'.`,
            severity: "error",
            assistantId: assistant.id,
          });
        }
      }

      // 7. Baptism Requirement (Assistant)
      if (rule && rule.assistant && rule.assistant.mustBeBaptized && !assistant.baptised) {
        conflicts.push({
          id: `${week.id}-${a.uid}-assistant-bapt`,
          weekId: week.id!,
          weekOf: week.weekOf,
          partUid: a.uid,
          partType: a.partType,
          partTitle: a.title,
          ruleName: "Baptism Requirement",
          message: `${assistant.name} (assistant) is unbaptized but assigned to '${a.partType}', which requires baptism.`,
          severity: "error",
          assistantId: assistant.id,
        });
      }

      // 8. Privilege Requirements (Assistant)
      if (rule && rule.assistant && rule.assistant.requiredPrivileges.length > 0) {
        const hasPriv = rule.assistant.requiredPrivileges.some(p => assistant.privileges.includes(p));
        if (!hasPriv) {
          conflicts.push({
            id: `${week.id}-${a.uid}-assistant-priv`,
            weekId: week.id!,
            weekOf: week.weekOf,
            partUid: a.uid,
            partType: a.partType,
            partTitle: a.title,
            ruleName: "Privilege Requirements",
            message: `${assistant.name} (assistant) does not have required privileges (${rule.assistant.requiredPrivileges.join(", ")}) for '${a.partType}'.`,
            severity: "error",
            assistantId: assistant.id,
          });
        }
      }
    }

    // Main & Assistant combined rules
    if (main && assistant) {
      // 9. Same-Sex Demo Match
      const isMinistryDemo = a.segment === "ministry" && needsAssistant(a.partType);
      if (isMinistryDemo) {
        if (main.gender !== assistant.gender) {
          // Check household bypass
          const inSameHousehold = households.some(
            (h) => h.memberIds.includes(main.id!) && h.memberIds.includes(assistant.id!)
          );
          if (!inSameHousehold) {
            conflicts.push({
              id: `${week.id}-${a.uid}-demo-gender`,
              weekId: week.id!,
              weekOf: week.weekOf,
              partUid: a.uid,
              partType: a.partType,
              partTitle: a.title,
              ruleName: "Same-Sex Demo Match",
              message: `${main.name} (${main.gender === "M" ? "brother" : "sister"}) and assistant ${assistant.name} (${assistant.gender === "M" ? "brother" : "sister"}) genders do not match in a demonstration, and they are not in the same household.`,
              severity: "error",
              assigneeId: main.id,
              assistantId: assistant.id,
            });
          }
        }
      }

      // 11. Age Constraints
      if (preventMinorAssistantToAdult && a.segment === "ministry") {
        const mainIsMinor = main.isMinor ?? false;
        const assIsMinor = assistant.isMinor ?? false;
        if (!mainIsMinor && assIsMinor) {
          conflicts.push({
            id: `${week.id}-${a.uid}-age-constraint`,
            weekId: week.id!,
            weekOf: week.weekOf,
            partUid: a.uid,
            partType: a.partType,
            partTitle: a.title,
            ruleName: "Age Constraints",
            message: `Minor ${assistant.name} is assigned as assistant to adult ${main.name} in a ministry part.`,
            severity: "warning",
            assigneeId: main.id,
            assistantId: assistant.id,
          });
        }
      }
    }
  }

  return conflicts;
}

export default function Dashboard({
  onNavigate,
  onNavigateToProfile,
}: {
  onNavigate: (t: "enrollees" | "schedule" | "reports", weekId?: number) => void;
  onNavigateToProfile: (id: number) => void;
}) {
  const rawAssignees =
    useLiveQuery(() => db.assignees.orderBy("name").toArray(), []) ?? [];
  const rawWeeks =
    useLiveQuery(() => db.weeks.orderBy("weekOf").toArray(), []) ?? [];
  const settings =
    useLiveQuery(() => db.settings.get("app"), []) ?? null;
  const households =
    useLiveQuery(() => db.households.toArray(), []) ?? [];

  const assignees = useMemo(() => {
    try {
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
          excludeFromPrayers: typeof a.excludeFromPrayers === "boolean" ? a.excludeFromPrayers : false,
          includeInPrayers: typeof a.includeInPrayers === "boolean" ? a.includeInPrayers : false,
        }));
    } catch (e) {
      console.error("Error sanitizing assignees:", e);
      return [];
    }
  }, [rawAssignees]);

  const weeks = useMemo(() => {
    try {
      return rawWeeks
        .filter((w): w is Week => w != null && typeof w.weekOf === "string" && Array.isArray(w.assignments))
        .map((w) => {
          const sanitizedAssignments = w.assignments
            .filter((a): a is any => a != null && typeof a === "object")
            .map((a) => ({
              uid: typeof a.uid === "string" ? a.uid : String(Math.random()),
              segment: typeof a.segment === "string" && ["opening", "treasures", "ministry", "living"].includes(a.segment) ? a.segment : "opening",
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
    } catch (e) {
      console.error("Error sanitizing weeks:", e);
      return [];
    }
  }, [rawWeeks]);

  const [showWizard, setShowWizard] = useState(false);

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

  const handleIgnoreConflict = (conflictId: string) => {
    setConfirmState({
      isOpen: true,
      title: "Ignore Conflict",
      message: "Are you sure you want to ignore this scheduling conflict? It will be hidden from the dashboard.",
      confirmText: "Ignore",
      cancelText: "Cancel",
      type: "warning",
      onConfirm: async () => {
        const currentIgnored = settings?.ignoredConflicts ?? [];
        if (!currentIgnored.includes(conflictId)) {
          await db.settings.update("app", {
            ignoredConflicts: [...currentIgnored, conflictId],
          });
        }
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  const handleResetIgnored = async () => {
    await db.settings.update("app", {
      ignoredConflicts: [],
    });
  };

  let today = "";
  let currentMonday = "";
  let upcoming: Week[] = [];
  let thisWeek: Week | null = null;
  let recent: Week[] = [];
  let soon: { assignee: Assignee; stats: any; neglect: number }[] = [];
  let stats = new Map<number, any>();
  let totalAssignments = 0;
  let activeAssignees: Assignee[] = [];
  let activeBrothers: Assignee[] = [];
  let activeSisters: Assignee[] = [];
  let neverAssigned: Assignee[] = [];
  let inactiveAssignees: Assignee[] = [];
  let upcomingFill = 0;
  let segmentCounts: Record<string, number> = { opening: 0, treasures: 0, ministry: 0, living: 0 };
  let segmentTotal = 0;
  let needsAttention: Week[] = [];
  let isBrandNew = false;

  try {
    today = todayIso();
    currentMonday = toIso(mondayOf(new Date()));
    upcoming = weeks.filter((w) => w.weekOf >= currentMonday).slice(0, 4);
    thisWeek = upcoming.length > 0 ? upcoming[0] : null;
    recent = [...weeks]
      .filter((w) => w.weekOf < currentMonday)
      .sort((a, b) => b.weekOf.localeCompare(a.weekOf))
      .slice(0, 3);
    soon = dueSoon(assignees, weeks, today, 8);
    stats = buildStats(assignees, weeks);

    totalAssignments = [...stats.values()].reduce(
      (sum, s) => sum + s.totalMain,
      0
    );
    activeAssignees = assignees.filter((a) => a.active && !a.archived);
    activeBrothers = activeAssignees.filter(
      (a) => a.gender === "M" && a.baptised
    );
    activeSisters = activeAssignees.filter((a) => a.gender === "F");
    neverAssigned = activeAssignees.filter((a) => {
      const s = stats.get(a.id!);
      return !s || !s.lastWeekMain;
    });
    inactiveAssignees = assignees.filter((a) => !a.active && !a.archived);

    // Overall fill rate for upcoming weeks
    let filled = 0, total = 0;
    for (const w of upcoming) {
      total += w.assignments.length;
      filled += w.assignments.filter((a) => a.assigneeId).length;
    }
    upcomingFill = total > 0 ? Math.round((filled / total) * 100) : 0;

    // Segment distribution across all weeks
    for (const w of weeks) {
      for (const a of w.assignments) {
        if (a.assigneeId != null) {
          segmentCounts[a.segment] = (segmentCounts[a.segment] || 0) + 1;
        }
      }
    }
    segmentTotal = Object.values(segmentCounts).reduce((a, b) => a + b, 0);

    // Weeks needing attention (upcoming and not fully filled)
    needsAttention = upcoming.filter((w) => {
      const filled = w.assignments.filter((a) => a.assigneeId).length;
      return filled < w.assignments.length;
    });

    isBrandNew = assignees.length === 0 && weeks.length === 0;

    const allUpcomingConflicts = upcoming.flatMap((w) => findWeekConflicts(w, assignees, households, settings));
    const ignoredList = settings?.ignoredConflicts ?? [];
    const ignoredUpcomingCount = allUpcomingConflicts.filter((c) => ignoredList.includes(c.id)).length;

    const conflictsByWeek = upcoming.reduce<{ weekId: number; weekOf: string; list: Conflict[] }[]>((acc, w) => {
      const list = findWeekConflicts(w, assignees, households, settings);
      const activeList = list.filter((c) => !ignoredList.includes(c.id));
      if (activeList.length > 0) {
        acc.push({ weekId: w.id!, weekOf: w.weekOf, list: activeList });
      }
      return acc;
    }, []);

    const allConflicts = conflictsByWeek.flatMap((g) => g.list);

    return (
      <div className="space-y-5">
        {/* ── Wizard Overlay ─────────────────────────────────────────── */}
        {showWizard && (
          <QuickStartWizard
            onClose={() => setShowWizard(false)}
            onNavigate={onNavigate}
          />
        )}

        {/* ── Welcome Banner for New Users ───────────────────────────── */}
        {isBrandNew && (
          <div className="card bg-indigo-50 border-indigo-200 shadow-sm flex flex-col sm:flex-row items-center gap-4 sm:justify-between p-6">
            <div>
              <h2 className="text-xl font-bold text-indigo-900">Welcome to Life & Ministry Meeting Scheduler!</h2>
              <p className="text-indigo-700 mt-1">
                It looks like your database is empty. Would you like us to guide you through setting up your first schedule?
              </p>
            </div>
            <button
              className="btn bg-indigo-600 hover:bg-indigo-700 text-white whitespace-nowrap shrink-0"
              onClick={() => setShowWizard(true)}
            >
              Start Guided Setup
            </button>
          </div>
        )}

        {/* ── This Week's Meeting ─────────────────────────────────────── */}
        {thisWeek && (
          <ThisWeekCard
            week={thisWeek}
            assignees={assignees}
            onOpen={() => onNavigate("schedule", thisWeek?.id)}
            onNavigateToProfile={onNavigateToProfile}
          />
        )}

        {/* ── Stat Cards ──────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="Active Enrollees"
            value={activeAssignees.length}
            sub={`${activeBrothers.length} brothers · ${activeSisters.length} sisters`}
            onClick={() => onNavigate("enrollees")}
          />
          <StatCard
            label="Scheduled Weeks"
            value={weeks.length}
            sub={`${upcoming.length} upcoming`}
            onClick={() => onNavigate("schedule")}
          />
          <StatCard
            label="Assignments Given"
            value={totalAssignments}
            sub="all time"
            onClick={() => onNavigate("reports")}
          />
          <StatCard
            label="Upcoming Fill Rate"
            value={upcomingFill}
            valueSuffix="%"
            sub={needsAttention.length > 0 ? `${needsAttention.length} need attention` : "all filled"}
            accent={upcomingFill === 100 ? "#006064" : upcomingFill > 50 ? "#c4952a" : "#7b1928"}
            onClick={() => onNavigate("schedule", needsAttention.length > 0 ? needsAttention[0].id : undefined)}
          />
        </section>

        {/* ── Main Content Grid ───────────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Upcoming weeks column */}
          <div className="lg:col-span-2 space-y-5">
            {allConflicts.length > 0 && (
              <div className="card border-red-200 bg-red-50/20 p-5 space-y-4 animate-fade-in" style={{ borderLeft: '4px solid #ef4444' }}>
                <div className="flex items-center justify-between border-b border-red-100 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl">⚠️</span>
                    <div>
                      <h2 className="font-bold text-slate-900 leading-none flex items-center gap-2 flex-wrap">
                        Rule Conflicts & Warnings
                        <span className="text-[11px] font-extrabold px-2 py-0.5 bg-red-100 text-red-800 rounded-full border border-red-200 shadow-sm animate-pulse">
                          {allConflicts.length} {allConflicts.length === 1 ? "Issue" : "Issues"}
                        </span>
                        {ignoredUpcomingCount > 0 && (
                          <button
                            onClick={handleResetIgnored}
                            className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full border border-slate-300 transition-all flex items-center gap-1 shadow-sm shrink-0"
                            title="Restore ignored conflicts to view"
                          >
                            <span>🔄 Restore {ignoredUpcomingCount} Ignored</span>
                          </button>
                        )}
                      </h2>
                      <p className="text-xs text-slate-500 mt-1">
                        Scanning 4 upcoming weeks. Click on enrollees or schedule editor to resolve.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 max-h-[380px] overflow-y-auto pr-1">
                  {conflictsByWeek.map((group) => (
                    <div key={group.weekOf} className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
                      <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
                        <span className="font-semibold text-xs text-slate-700 uppercase tracking-wider">
                          Week of {weekRangeLabel(group.weekOf)}
                        </span>
                        <button
                          onClick={() => onNavigate("schedule", group.weekId)}
                          className="text-[11px] font-bold hover:underline transition-all flex items-center gap-1"
                          style={{ color: 'var(--color-primary)' }}
                        >
                          <span>Fix Schedule</span>
                          <span className="text-xs">🗓️</span>
                        </button>
                      </div>

                      <div className="divide-y divide-slate-100">
                        {group.list.map((c) => {
                          const assigneeName = c.assigneeId
                            ? assignees.find((p) => p.id === c.assigneeId)?.name
                            : null;
                          const assistantName = c.assistantId
                            ? assignees.find((p) => p.id === c.assistantId)?.name
                            : null;
                          const isError = c.severity === "error";

                          return (
                            <div key={c.id} className="p-3 flex items-start gap-3 hover:bg-slate-50/50 transition-colors">
                              <span className={`text-base shrink-0 mt-0.5 ${isError ? "text-rose-500" : "text-amber-500"}`}>
                                {isError ? "🛑" : "⚠️"}
                              </span>
                              <div className="flex-1 space-y-1.5 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-bold text-slate-800 text-xs shrink-0 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                                    {c.partTitle || c.partType}
                                  </span>
                                  <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                                    isError 
                                      ? "bg-rose-50 border-rose-200 text-rose-700" 
                                      : "bg-amber-50 border-amber-200 text-amber-700"
                                  }`}>
                                    {c.ruleName}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-600 font-medium leading-relaxed break-words">
                                  {c.message}
                                </p>
                                <div className="flex flex-wrap items-center gap-1.5 pt-0.5 w-full justify-between">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {assigneeName && c.assigneeId && (
                                      <button
                                        onClick={() => onNavigateToProfile(c.assigneeId!)}
                                        className="text-[10px] font-semibold bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded px-2 py-0.5 transition-all flex items-center gap-1"
                                        style={{ color: 'var(--color-primary)' }}
                                      >
                                        <span>👤 {assigneeName}</span>
                                      </button>
                                    )}
                                    {assistantName && c.assistantId && (
                                      <button
                                        onClick={() => onNavigateToProfile(c.assistantId!)}
                                        className="text-[10px] font-semibold bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded px-2 py-0.5 transition-all flex items-center gap-1"
                                        style={{ color: 'var(--color-primary)' }}
                                      >
                                        <span>👥 Assistant: {assistantName}</span>
                                      </button>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => handleIgnoreConflict(c.id)}
                                    className="text-[10px] font-bold text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded px-2 py-0.5 transition-all flex items-center gap-1 shrink-0 ml-auto"
                                    title="Ignore this conflict warning on the dashboard"
                                  >
                                    <span>🔕 Ignore</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold">Upcoming Weeks</h2>
                <button
                  className="btn-secondary text-xs"
                  onClick={() => onNavigate("schedule")}
                >
                  View all
                </button>
              </div>
              {upcoming.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500 mb-3">
                    No upcoming weeks planned yet.
                  </p>
                  <button
                    className="btn text-xs"
                    onClick={() => onNavigate("schedule")}
                  >
                    Create a week
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {upcoming.map((w) => {
                    const filled = w.assignments.filter((a) => a.assigneeId).length;
                    const total = w.assignments.length;
                    const pct = total > 0 ? (filled / total) * 100 : 0;
                    const isComplete = filled === total && total > 0;
                    const isThisWeek = w.id === thisWeek?.id;

                    if (w.specialEvent) {
                      return (
                        <div
                          key={w.id}
                          className="border p-3 cursor-pointer transition-colors hover:bg-gray-50"
                          style={{
                            borderColor: isThisWeek ? 'var(--living)' : '#ddd',
                            borderRadius: '3px',
                          }}
                          onClick={() => onNavigate("schedule", w.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">{weekRangeLabel(w.weekOf)}</span>
                              <span className="pill bg-slate-100 text-slate-600 text-[10px] font-bold uppercase border border-slate-200">
                                {w.specialEvent}
                              </span>
                              {isThisWeek && (
                                <span
                                  className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 text-white bg-slate-400"
                                  style={{ borderRadius: '2px' }}
                                >
                                  This week
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-slate-400 font-medium italic">No regular meeting</span>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={w.id}
                        className="border p-3 cursor-pointer transition-colors hover:bg-gray-50"
                        style={{
                          borderColor: isThisWeek ? 'var(--color-primary)' : '#ddd',
                          borderRadius: '3px',
                        }}
                        onClick={() => onNavigate("schedule", w.id)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{weekRangeLabel(w.weekOf)}</span>
                            {isThisWeek && (
                              <span
                                className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 text-white"
                                style={{ backgroundColor: 'var(--color-primary)', borderRadius: '2px' }}
                              >
                                This week
                              </span>
                            )}
                          </div>
                          <span className={
                            "text-xs font-semibold tabular-nums " +
                            (isComplete ? "text-green-700" : "text-gray-500")
                          }>
                            {filled}/{total}
                          </span>
                        </div>
                        {/* Progress bar */}
                        <div className="h-1.5 bg-gray-200 overflow-hidden" style={{ borderRadius: '1px' }}>
                          <div
                            className="h-full transition-all duration-500"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: isComplete ? '#006064' : 'var(--color-primary)',
                              borderRadius: '1px',
                            }}
                          />
                        </div>
                        {/* Segment pills */}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {SEGMENTS.map((seg) => {
                            const segParts = w.assignments.filter(
                              (a) => a.segment === seg.id
                            );
                            const segFilled = segParts.filter(
                              (a) => a.assigneeId
                            ).length;
                            if (segParts.length === 0) return null;
                            return (
                              <span
                                key={seg.id}
                                className="text-[10px] px-1.5 py-0.5 font-medium text-white"
                                style={{
                                  backgroundColor: seg.color,
                                  opacity: segFilled === segParts.length ? 1 : 0.45,
                                  borderRadius: '2px',
                                }}
                              >
                                {seg.id === "opening" ? "Open" : seg.id === "treasures" ? "Gems" : seg.id === "ministry" ? "Ministry" : "Living"} {segFilled}/{segParts.length}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Segment Distribution */}
            {segmentTotal > 0 && (
              <div className="card">
                <h2 className="font-semibold mb-4">Assignment Distribution</h2>
                <div className="space-y-3">
                  {SEGMENTS.filter((s) => s.id !== "opening").map((seg) => {
                    const count = segmentCounts[seg.id] || 0;
                    const pct = segmentTotal > 0 ? (count / segmentTotal) * 100 : 0;
                    return (
                      <div key={seg.id}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold" style={{ color: seg.color }}>
                            {seg.label}
                          </span>
                          <span className="text-xs text-gray-500 tabular-nums">
                            {count} ({Math.round(pct)}%)
                          </span>
                        </div>
                        <div className="h-2 bg-gray-100 overflow-hidden" style={{ borderRadius: '1px' }}>
                          <div
                            className="h-full transition-all duration-700"
                            style={{ width: `${pct}%`, backgroundColor: seg.color, borderRadius: '1px' }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right sidebar */}
          <div className="space-y-5">
            {/* Due Soon */}
            <div className="card">
              <h2 className="font-semibold mb-3">Due for Assignment</h2>
              {soon.length === 0 ? (
                <p className="text-sm text-gray-500">
                  Add enrollees to see rotation suggestions.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {soon.map(({ assignee, stats: s }, idx) => {
                    const daysSinceLast = s.lastWeekMain
                      ? Math.round(
                          (new Date(today).getTime() -
                            new Date(s.lastWeekMain).getTime()) /
                            86400000
                        )
                      : null;

                    return (
                      <li key={assignee.id} className="flex items-center gap-2 py-1 border-b border-gray-100 last:border-0">
                        <span className="flex-shrink-0 text-[11px] font-bold text-gray-400 w-4 text-right tabular-nums">
                          {idx + 1}
                        </span>
                        <button
                          onClick={() => onNavigateToProfile(assignee.id!)}
                          className="flex-1 text-sm font-medium text-left truncate hover:underline"
                          style={{ color: 'var(--color-primary)' }}
                        >
                          {assignee.name}
                        </button>
                        <span className="text-[10px] text-gray-400 tabular-nums flex-shrink-0">
                          {daysSinceLast != null ? `${daysSinceLast}d` : "never"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Never Assigned */}
            {neverAssigned.length > 0 && (
              <div className="card" style={{ borderLeft: '3px solid var(--ministry)' }}>
                <h3 className="text-sm font-semibold mb-1">
                  Never Assigned ({neverAssigned.length})
                </h3>
                <p className="text-xs text-gray-500 mb-2">
                  {neverAssigned.length === 1
                    ? "1 active enrollee has"
                    : `${neverAssigned.length} active enrollees have`}{" "}
                  never received any assignment.
                </p>
                <div className="flex flex-wrap gap-1">
                  {neverAssigned.slice(0, 5).map((a) => (
                    <button
                      key={a.id}
                      onClick={() => onNavigateToProfile(a.id!)}
                      className="text-[11px] font-medium px-2 py-0.5 hover:underline"
                      style={{ color: 'var(--color-primary)', backgroundColor: '#f0f4f9', borderRadius: '2px' }}
                    >
                      {a.name}
                    </button>
                  ))}
                  {neverAssigned.length > 5 && (
                    <span className="text-[11px] text-gray-500 px-1 py-0.5">
                      +{neverAssigned.length - 5} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Inactive Publishers */}
            {inactiveAssignees.length > 0 && (
              <div className="card" style={{ borderLeft: '3px solid #f43f5e' }}>
                <h3 className="text-sm font-semibold mb-1 text-slate-800 flex items-center justify-between">
                  <span>Inactive List ({inactiveAssignees.length})</span>
                  <span className="text-[9px] text-rose-500 font-bold uppercase tracking-wider bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100/50">
                    Paused
                  </span>
                </h3>
                <p className="text-xs text-gray-500 mb-2.5">
                  These enrollees are currently set to inactive and are skipped during automatic scheduling.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {inactiveAssignees.slice(0, 8).map((a) => (
                    <button
                      key={a.id}
                      onClick={() => onNavigateToProfile(a.id!)}
                      className="text-[11px] font-semibold px-2 py-0.5 hover:underline text-rose-700 bg-rose-50/60 hover:bg-rose-100 rounded border border-rose-200/50 transition-all shadow-sm"
                    >
                      {a.name}
                    </button>
                  ))}
                  {inactiveAssignees.length > 8 && (
                    <span className="text-[11px] text-slate-400 font-semibold self-center ml-1">
                      +{inactiveAssignees.length - 8} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Quick Actions */}
            <div className="card">
              <h2 className="font-semibold mb-3">Quick Actions</h2>
              <div className="space-y-2">
                <button
                  className="w-full btn-secondary text-left text-sm"
                  onClick={() => onNavigate("schedule")}
                >
                  Create new week
                </button>
                <button
                  className="w-full btn-secondary text-left text-sm"
                  onClick={() => onNavigate("enrollees")}
                >
                  Add enrollee
                </button>
                <button
                  className="w-full btn-secondary text-left text-sm flex justify-between"
                  onClick={() => setShowWizard(true)}
                >
                  <span>Guided Setup Wizard</span>
                  <span className="text-indigo-500">✨</span>
                </button>
                <button
                  className="w-full btn-secondary text-left text-sm"
                  onClick={() => onNavigate("reports")}
                >
                  View reports
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── Recent weeks ────────────────────────────────────────────── */}
        {recent.length > 0 && (
          <section className="card">
            <h2 className="font-semibold mb-3">Recent Weeks</h2>
            <div className="space-y-3">
              {recent.map((w) => (
                <div
                  key={w.id}
                  className="border-l-3 pl-3 cursor-pointer hover:bg-gray-50 py-2 transition-colors"
                  style={{
                    borderLeftWidth: '3px',
                    borderLeftColor: w.assignments.every((a) => a.assigneeId) ? '#006064' : '#ddd',
                    borderRadius: '2px',
                  }}
                  onClick={() => onNavigate("schedule", w.id)}
                >
                  <div className="text-sm font-medium">{weekRangeLabel(w.weekOf)}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {w.assignments.slice(0, 6).map((a) => {
                      const person = assignees.find(
                        (p) => p.id === a.assigneeId
                      );
                      const seg = segmentOf(a.segment);
                      return (
                        <button
                          key={a.uid}
                          className="pill text-white hover:brightness-110 transition-all text-left"
                          style={{ backgroundColor: seg.color }}
                          onClick={(e) => {
                            if (person?.id) {
                              e.stopPropagation();
                              onNavigateToProfile(person.id);
                            }
                          }}
                        >
                          {a.partType}: {person?.name ?? "—"}
                        </button>
                      );
                    })}
                    {w.assignments.length > 6 && (
                      <span className="text-xs text-gray-500 self-center">
                        + {w.assignments.length - 6} more
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

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
      </div>
    );
  } catch (renderError: any) {
    console.error("Crash during Dashboard render:", renderError);
    return (
      <div className="card p-6 border-[#4a6da7]/20 bg-slate-50 text-[#3d5b8e] space-y-4 shadow-md">
        <div className="flex items-start gap-3">
          <span className="text-2xl text-[#4a6da7]">⚠️</span>
          <div>
            <h3 className="text-lg font-bold text-[#4a6da7]">Dashboard Diagnostic Panel</h3>
            <p className="text-xs text-slate-500 mt-1">
              A runtime anomaly was caught and isolated. Your database remains safe and untouched.
            </p>
          </div>
        </div>
        <p className="text-sm text-slate-700">Please review the technical diagnostic details below. You can try reloading the application to clear browser memory:</p>
        <pre className="p-4 bg-slate-100 rounded-lg text-xs font-mono overflow-auto max-h-80 border border-slate-200 text-slate-800 leading-relaxed">
          {renderError?.stack || renderError?.message || String(renderError)}
        </pre>
        <div className="flex gap-2">
          <button 
            className="btn text-xs py-1.5 px-3 bg-[#4a6da7] hover:bg-[#3d5b8e] text-white" 
            onClick={() => window.location.reload()}
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }
}

/* ── This Week Card ────────────────────────────────────────────────── */

function ThisWeekCard({
  week,
  assignees,
  onOpen,
  onNavigateToProfile,
}: {
  week: Week;
  assignees: Assignee[];
  onOpen: () => void;
  onNavigateToProfile: (id: number) => void;
}) {
  const filled = week.assignments.filter((a) => a.assigneeId).length;
  const total = week.assignments.length;
  const isComplete = filled === total && total > 0;
  const chairman = week.assignments.find((a) => a.partType === "Chairman");
  const chairmanName = chairman?.assigneeId
    ? assignees.find((p) => p.id === chairman.assigneeId)?.name
    : null;

  if (week.specialEvent) {
    return (
      <div
        className="card cursor-pointer hover:bg-slate-50 transition-colors border-l-4 border-slate-400"
        onClick={onOpen}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">
              This Week's Meeting
            </p>
            <h2 className="text-lg font-bold">{weekRangeLabel(week.weekOf)}</h2>
            <div className="mt-4 flex items-center gap-3">
              <span className="text-3xl">🗓️</span>
              <div>
                <p className="font-bold text-slate-800 leading-none">
                  {week.specialEvent === "Memorial" ? "Memorial Day" : 
                   week.specialEvent === "Convention" ? "Regional Convention" :
                   week.specialEvent === "Assembly" ? "Circuit Assembly" : "Special Event"}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  No Life and Ministry Meeting held this week.
                </p>
              </div>
            </div>
          </div>
          <div className="bg-slate-100 text-slate-600 px-3 py-1 rounded font-bold text-xs uppercase tracking-widest">
            Special
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="card cursor-pointer hover:bg-gray-50 transition-colors"
      style={{ borderLeft: '4px solid var(--color-primary)' }}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">
            This Week's Meeting
          </p>
          <h2 className="text-lg font-bold">{weekRangeLabel(week.weekOf)}</h2>
          {week.weeklyBibleReading && (
            <p className="text-sm text-gray-500 mt-0.5">
              {week.weeklyBibleReading}
            </p>
          )}
          {chairmanName && (
            <p className="text-sm text-gray-600 mt-2">
              Chairman:{" "}
              <button
                className="font-medium hover:underline"
                style={{ color: 'var(--color-primary)' }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (chairman?.assigneeId) onNavigateToProfile(chairman.assigneeId);
                }}
              >
                {chairmanName}
              </button>
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums" style={{ color: isComplete ? '#006064' : 'var(--color-primary)' }}>
            {filled}/{total}
          </div>
          <p className="text-[11px] text-gray-400">
            {isComplete ? "Fully assigned" : "parts filled"}
          </p>
        </div>
      </div>
      {/* Segment summary */}
      <div className="mt-3 flex gap-2">
        {SEGMENTS.map((seg) => {
          const parts = week.assignments.filter((a) => a.segment === seg.id);
          const segFilled = parts.filter((a) => a.assigneeId).length;
          if (parts.length === 0) return null;
          return (
            <div
              key={seg.id}
              className="flex-1 text-center py-1.5 px-2"
              style={{
                backgroundColor: seg.color + '12',
                borderBottom: `2px solid ${seg.color}`,
                borderRadius: '2px',
              }}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: seg.color }}>
                {seg.id === "opening" ? "Opening" : seg.id === "treasures" ? "Treasures" : seg.id === "ministry" ? "Ministry" : "Living"}
              </div>
              <div className="text-sm font-bold tabular-nums" style={{ color: seg.color }}>
                {segFilled}/{parts.length}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Stat Card ─────────────────────────────────────────────────────── */

function StatCard({
  label,
  value,
  valueSuffix,
  sub,
  accent,
  onClick,
}: {
  label: string;
  value: number;
  valueSuffix?: string;
  sub?: string;
  accent?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="card text-left hover:bg-gray-50 transition-colors"
    >
      <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color: accent || '#333' }}>
        {value}{valueSuffix}
      </div>
      {sub && <div className="text-[11px] text-gray-500 mt-1">{sub}</div>}
    </button>
  );
}
