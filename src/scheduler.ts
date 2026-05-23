import {
  isEligible,
  isPrivileged,
  needsAssistant,
} from "./meeting";
import {
  Assignee,
  Assignment,
  Week,
  AssignmentRule,
} from "./types";
import { getMeetingDate } from "./utils";

export interface AssigneeStats {
  /** Main (direct) assignment history. */
  totalMain: number;
  lastWeekMain?: string; // ISO date, undefined if never assigned as main
  bySegmentMain: { opening: number; treasures: number; ministry: number; living: number };
  /** Assistant (secondary) assignment history — tracked separately. */
  totalAssistant: number;
  lastWeekAssistant?: string; // ISO date, undefined if never served as assistant
  lastWeekChairman?: string; // Specific history for the Chairman role
  /** All dates (ISO) where this person was assigned as main, for rolling-window caps. */
  recentMainDates: string[];
  /** All dates (ISO) where this person was assigned as assistant. */
  recentAssistantDates?: string[];
}

/** Compute per-assignee assignment history from weeks. */
export function buildStats(
  assignees: Assignee[],
  weeks: Week[]
): Map<number, AssigneeStats> {
  const stats = new Map<number, AssigneeStats>();
  for (const a of assignees) {
    if (a.id == null) continue;
    stats.set(a.id, {
      totalMain: 0,
      bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
      totalAssistant: 0,
      lastWeekChairman: undefined,
      recentMainDates: [],
      recentAssistantDates: [],
    });
  }

  const sortedWeeks = [...weeks].sort((a, b) =>
    a.weekOf.localeCompare(b.weekOf)
  );

  for (const w of sortedWeeks) {
    if (!w || !Array.isArray(w.assignments)) continue;
    for (const ass of w.assignments) {
      if (!ass) continue;
      // Main assignee — counts toward main history only.
      if (ass.assigneeId != null) {
        const s = stats.get(ass.assigneeId);
        if (s) {
          s.totalMain += 1;
          if (ass.segment && s.bySegmentMain) {
            s.bySegmentMain[ass.segment] = (s.bySegmentMain[ass.segment] || 0) + 1;
          }
          if (!s.lastWeekMain || w.weekOf > s.lastWeekMain)
            s.lastWeekMain = w.weekOf;
          s.recentMainDates.push(w.weekOf);
          if (ass.partType === "Chairman") {
            if (!s.lastWeekChairman || w.weekOf > s.lastWeekChairman)
              s.lastWeekChairman = w.weekOf;
          }
        }
      }
      // Assistant — counts toward assistant history only.
      if (ass.assistantId != null) {
        const s = stats.get(ass.assistantId);
        if (s) {
          s.totalAssistant += 1;
          if (!s.lastWeekAssistant || w.weekOf > s.lastWeekAssistant)
            s.lastWeekAssistant = w.weekOf;
          if (s.recentAssistantDates) s.recentAssistantDates.push(w.weekOf);
        }
      }
    }
  }

  return stats;
}

/** Days between two ISO dates (YYYY-MM-DD). */
function daysBetween(aIso: string, bIso: string): number {
  if (!aIso || !bIso) return 0;
  const [y1, m1, d1] = aIso.trim().split("-").map(Number);
  const [y2, m2, d2] = bIso.trim().split("-").map(Number);
  if (isNaN(y1) || isNaN(y2)) return 0;
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

/**
 * Aggregate counts used to balance the Treasures opening Talk between
 * elders and ministerial servants.
 */
export interface TalkSplit {
  elderCount: number;
  msCount: number;
}

/** Tally how many past Treasures Talks have gone to each group. */
export function buildTalkSplit(
  assignees: Assignee[],
  weeks: Week[]
): TalkSplit {
  const split: TalkSplit = { elderCount: 0, msCount: 0 };
  for (const w of weeks) {
    for (const a of w.assignments) {
      if (a.partType !== "Talk") continue;
      if (a.assigneeId == null) continue;
      const person = assignees.find((p) => p.id === a.assigneeId);
      if (person) tallyTalk(person, split);
    }
  }
  return split;
}

/**
 * Increment a TalkSplit by a single Talk assigned to `person`.
 * QE → E and QMS → MS are already normalised on save. If somehow both
 * flags are present (rare), the person is counted as MS for sharing.
 */
function tallyTalk(person: Assignee, split: TalkSplit): void {
  const isE = person.privileges?.includes("E") ?? false;
  const isMS = person.privileges?.includes("MS") ?? false;
  if (isMS) split.msCount += 1;
  else if (isE) split.elderCount += 1;
}

/**
 * Aggregate counts used to balance Treasures Talk and Spiritual Gems parts
 * between MS/QMS and Elders.
 */
export interface TreasuresSplit {
  msCount: number;      // Regular MS (MS but not QMS)
  qmsCount: number;     // Qualified MS (QMS)
  elderCount: number;   // Elders (E or QE)
}

/** Tally past Treasures Talk and Spiritual Gems assignments by group. */
export function buildTreasuresSplit(
  assignees: Assignee[],
  weeks: Week[]
): TreasuresSplit {
  const split: TreasuresSplit = { msCount: 0, qmsCount: 0, elderCount: 0 };
  for (const w of weeks) {
    if (!w || !Array.isArray(w.assignments)) continue;
    for (const a of w.assignments) {
      if (a.partType !== "Talk" && a.partType !== "Spiritual Gems") continue;
      if (a.assigneeId == null) continue;
      const person = assignees.find((p) => p.id === a.assigneeId);
      if (person) tallyTreasures(person, split);
    }
  }
  return split;
}

export function tallyTreasures(person: Assignee, split: TreasuresSplit): void {
  const isQMS = person.privileges?.includes("QMS") ?? false;
  const isMS = !isQMS && (person.privileges?.includes("MS") ?? false);
  const isE = person.privileges?.includes("E") ?? false;
  if (isQMS) split.qmsCount += 1;
  else if (isMS) split.msCount += 1;
  else if (isE) split.elderCount += 1;
}

/**
 * Score a candidate for an assignment. Higher = better.
 *
 * Main role scoring uses main-only history (days since last main,
 * total mains, segment-specific mains). Assistant role scoring uses
 * assistant-only history. Neither bleeds into the other.
 *
 * The scoring uses configurable knobs from AutoAssignOptions to give
 * administrators granular control over fairness behavior.
 */
export function scoreCandidate(
  a: Assignee,
  part: Assignment,
  weekOf: string,
  stats: AssigneeStats,
  seed: number,
  privilegedMinistryShare: number,
  talkSplit: TalkSplit,
  treasuresSplit: TreasuresSplit,
  role: "main" | "assistant",
  opts: Pick<AutoAssignOptions, "minGapWeeks" | "catchUpIntensity" | "msTreasuresRatio" | "qmsTreasuresRatio">,
  isMinorMain?: boolean
): number {
  void talkSplit;
  let score = 0;

  // ── Gap-based scoring ────────────────────────────────────────────────
  const minGapDays = (opts.minGapWeeks ?? 2) * 7;
  // Catch-up intensity: 1–5.
  //   1 = equal rotation (no prioritisation, simply include them)
  //   3 = moderate boost for neglected members
  //   5 = aggressive fast-tracking
  const catchUp = Math.max(1, Math.min(5, opts.catchUpIntensity ?? 1));

  // The prioritisation multiplier is zero-based at intensity 1,
  // meaning overlooked people get NO special bonus — they're just
  // part of the normal pool.  Each step above 1 adds real priority.
  const priorityMul = (catchUp - 1) * 0.4; // 0.0 .. 1.6

  if (role === "main") {
    if (stats.lastWeekMain) {
      const gap = daysBetween(stats.lastWeekMain, weekOf);

      // Hard recency penalty: steep penalty within the min-gap window.
      if (gap < minGapDays) {
        score -= (minGapDays - gap) * 30;
      }

      // Base gap score: everyone gets a small time-since-last bonus
      // to naturally spread assignments around. Grows linearly up to 180 days.
      const DECAY_DAYS = 180;
      score += Math.min(gap, DECAY_DAYS) * 0.8;

      // Catch-up bonus: only active at intensity > 1.  Grows with
      // the gap AND the intensity, giving overlooked people extra
      // priority when the overseer explicitly asks for it.
      if (priorityMul > 0) {
        const neglectCap = 80 + catchUp * 32; // 112..240
        const neglectBonus = Math.min(gap, neglectCap);
        score += neglectBonus * priorityMul;
      }
    } else {
      // Never assigned. They start with a neutral gap score (0) and will be
      // picked when others are penalized or naturally exhausted from the pool.
      score += 0;
    }

    // Workload penalty: penalise based on recent main workload in the last 12 weeks (84 days).
    const recentMainCount = stats.recentMainDates.filter(
      (d) => daysBetween(d, weekOf) > 0 && daysBetween(d, weekOf) <= 84
    ).length;
    score -= recentMainCount * 8;

    // Segment balancing — penalise heavy use in this segment.
    score -= stats.bySegmentMain[part.segment] * 3;
  } else {
    // Assistant role — use assistant-only history.
    if (stats.lastWeekAssistant) {
      const gap = daysBetween(stats.lastWeekAssistant, weekOf);
      if (gap < 21) {
        score -= (21 - gap) * 15;
      }
      const DECAY_DAYS = 120;
      score += Math.min(gap, DECAY_DAYS) * 0.6;
    } else {
      score += 0;
    }

    // Workload penalty: penalise based on recent assistant workload in the last 12 weeks (84 days).
    const recentAssistantDates = stats.recentAssistantDates ?? [];
    const recentAssistantCount = recentAssistantDates.filter(
      (d) => daysBetween(d, weekOf) > 0 && daysBetween(d, weekOf) <= 84
    ).length;
    score -= recentAssistantCount * 6;
  }

  // Privilege preferences only apply to main roles.
  if (role === "main") {
    if (part.segment === "ministry") {
      // Field Ministry parts should mostly go to non-privileged publishers.
      if (isPrivileged(a)) {
        score -= (100 - privilegedMinistryShare) / 5;
      }
    } else if (part.segment === "living") {
      if (part.partType === "Living Part") {
        if (isPrivileged(a)) score -= 10;
      }
      if (
        part.partType === "Local Needs" ||
        part.partType === "Governing Body Update"
      ) {
        if (a.privileges?.includes("E")) score += 8;
        else if (a.privileges?.includes("QE")) score += 4;
      }
    } else if (part.segment === "treasures") {
      if (part.partType === "Talk" || part.partType === "Spiritual Gems") {
        const candIsQMS = a.privileges?.includes("QMS") ?? false;
        const candIsMS = !candIsQMS && (a.privileges?.includes("MS") ?? false);
        const candIsE = a.privileges?.includes("E") ?? false;

        if (candIsQMS || candIsMS || candIsE) {
          const targetMsShare = (opts.msTreasuresRatio ?? 0) / 100;
          const targetQmsShare = (opts.qmsTreasuresRatio ?? 0) / 100;
          const targetElderShare = Math.max(0, 1 - targetMsShare - targetQmsShare);

          const total = treasuresSplit.msCount + treasuresSplit.qmsCount + treasuresSplit.elderCount;
          if (total === 0) {
            // First assignment: use the target share directly to bias
            if (candIsQMS) {
              score += (targetQmsShare - 0.33) * 40;
            } else if (candIsMS) {
              score += (targetMsShare - 0.33) * 40;
            } else if (candIsE) {
              score += (targetElderShare - 0.34) * 40;
            }
          } else {
            const currentMsShare = treasuresSplit.msCount / total;
            const currentQmsShare = treasuresSplit.qmsCount / total;
            const currentElderShare = treasuresSplit.elderCount / total;

            if (candIsQMS) {
              const diff = targetQmsShare - currentQmsShare;
              score += diff * 50;
            } else if (candIsMS) {
              const diff = targetMsShare - currentMsShare;
              score += diff * 50;
            } else if (candIsE) {
              const diff = targetElderShare - currentElderShare;
              score += diff * 50;
            }
          }

          // Hard boundary constraints:
          if (candIsMS && targetMsShare === 0) {
            score -= 5000;
          }
          if (candIsQMS && targetQmsShare === 0) {
            score -= 5000;
          }
          if (candIsE && targetElderShare === 0) {
            score -= 5000;
          }
        }
      }
      if (part.partType === "Bible Reading") {
        // Prefer non-privileged brothers.
        if (isPrivileged(a)) score -= 4;
      }
    }
  }

  // Prefer adult assistants when pairing with a minor main participant.
  if (role === "assistant" && isMinorMain && !a.isMinor) {
    score += 50; // Increased priority
  }

  // ── Frequency throttling ────────────────────────────────────────────
  if (a.restrictionType === "infirmed" || a.restrictionType === "elderly") {
    // Significant penalty to ensure they are chosen last.
    score -= 100;
  }

  // Deterministic tiny jitter for reproducible tie-breaking per week.
  // Scaled small enough (0..0.99) to never override meaningful differences.
  const jitter = ((a.id ?? 0) * 1315423911 + seed) % 100;
  score += jitter / 100;

  return score;
}

export interface AutoAssignOptions {
  privilegedMinistryShare: number;
  /** Keep existing manual assignments (do not overwrite). */
  preserveExisting: boolean;
  /** Minimum weeks between main assignments. Default 2. */
  minGapWeeks: number;
  /** Minimum weeks between Chairman assignments. Default 3. */
  chairmanGapWeeks: number;
  /** Catch-up intensity (1-5). Default 3. */
  catchUpIntensity: number;
  /** Max main assignments in a rolling 4-week window. 0 = no limit. Default 2. */
  maxAssignmentsPerMonth: number;
  optimizationThresholdMain?: number;
  optimizationThresholdAssistant?: number;
  /** Custom eligibility rules. */
  assignmentRules: Record<string, AssignmentRule>;
  /** If true, minors are not allowed to assist adults in ministry parts. */
  preventMinorAssistantToAdult: boolean;
  /** Custom balance ratio for Treasures parts between regular MS and Elders. */
  msTreasuresRatio?: number;
  /** Custom balance ratio for Treasures parts between QMS and Elders. */
  qmsTreasuresRatio?: number;
  /** The weekday that the midweek meeting is held. */
  midweekMeetingDay?: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
  /** How availability ranges are tracked. "unavailable" means away dates, "available" means in-town dates. */
  availabilityMode?: "unavailable" | "available";
}

/**
 * Auto-assign every unfilled slot in the given week.
 *
 * Returns a new week with `assignments` populated where possible.
 * If a slot truly has no eligible candidate, it is left unfilled.
 */
export function autoAssignWeek(
  week: Week,
  assignees: Assignee[],
  historicalWeeks: Week[],
  opts: AutoAssignOptions
): Week {
  // If this is a special week (Convention, Assembly, etc.), skip assignments.
  if (week.specialEvent) {
    return { ...week };
  }

  // Clone assignments so we can mutate while computing.
  const assignments: Assignment[] = week.assignments.map((a) => ({ ...a }));

  // Pre-compute stats from all historical weeks plus already-filled
  // assignments in this draft (so when we fill slot N we consider slot 1..N-1).
  const workingWeeks = [...historicalWeeks.filter((w) => w.id !== week.id)];

  // Seed for this week (date-based)
  const seed = parseInt(week.weekOf.replace(/-/g, ""), 10) || 1;

  // Track IDs already used in this week so the same person doesn't get two
  // main parts in the same meeting (assistants are allowed to double up).
  const usedThisWeek = new Set<number>();
  for (const a of assignments) {
    if (opts.preserveExisting && a.assigneeId != null) {
      usedThisWeek.add(a.assigneeId);
    }
  }

  // Track per-segment "privileged share" for field ministry.
  let ministryTotal = 0;
  let ministryPrivileged = 0;
  for (const a of assignments) {
    if (a.segment !== "ministry" || a.assigneeId == null) continue;
    const person = assignees.find((p) => p.id === a.assigneeId);
    if (!person) continue;
    ministryTotal += 1;
    if (isPrivileged(person)) ministryPrivileged += 1;
  }

  // Track running splits — seeded from history only.
  const talkSplit: TalkSplit = buildTalkSplit(assignees, workingWeeks);
  const treasuresSplit: TreasuresSplit = buildTreasuresSplit(assignees, workingWeeks);

  // Order parts so Treasures is filled before Ministry (which depends on
  // the privileged-share counter) — the array is already in this order.
  for (const assignment of assignments) {
    const stats = buildStats(assignees, [
      ...workingWeeks,
      { ...week, assignments },
    ]);

    if (!(opts.preserveExisting && assignment.assigneeId != null)) {
      // For Opening Prayer, allow the already-assigned Chairman to also be
      // considered — remove his ID from the exclusion set for this pick only.
      let usedForPick = usedThisWeek;
      if (assignment.partType === "Opening Prayer") {
        const chairmanId = assignments.find(
          (a) => a.partType === "Chairman"
        )?.assigneeId;
        if (chairmanId != null && usedThisWeek.has(chairmanId)) {
          usedForPick = new Set(usedThisWeek);
          usedForPick.delete(chairmanId);
        }
      }

      const candidate = pickCandidate({
        part: assignment,
        role: "main",
        assignees,
        stats,
        weekOf: week.weekOf,
        seed,
        used: usedForPick,
        privilegedMinistryShare: opts.privilegedMinistryShare,
        ministryTotal,
        ministryPrivileged,
        talkSplit,
        treasuresSplit,
        opts,
      });
      if (candidate) {
        assignment.assigneeId = candidate.id!;
        usedThisWeek.add(candidate.id!);
        if (assignment.segment === "ministry") {
          ministryTotal += 1;
          if (isPrivileged(candidate)) ministryPrivileged += 1;
        }
        if (assignment.partType === "Talk") {
          tallyTalk(candidate, talkSplit);
        }
        if (assignment.partType === "Talk" || assignment.partType === "Spiritual Gems") {
          tallyTreasures(candidate, treasuresSplit);
        }
      }
    } else {
      if (assignment.partType === "Talk") {
        const person = assignees.find((p) => p.id === assignment.assigneeId);
        if (person) tallyTalk(person, talkSplit);
      }
      if (assignment.partType === "Talk" || assignment.partType === "Spiritual Gems") {
        const person = assignees.find((p) => p.id === assignment.assigneeId);
        if (person) tallyTreasures(person, treasuresSplit);
      }
    }

    // Secondary participant (householder / reader).
    if (needsAssistant(assignment.partType)) {
      if (!(opts.preserveExisting && assignment.assistantId != null)) {
        const candidate = pickCandidate({
          part: assignment,
          role: "assistant",
          assignees,
          stats,
          weekOf: week.weekOf,
          seed: seed + 1,
          used: new Set([
            ...usedThisWeek,
            ...(assignment.assigneeId != null
              ? [assignment.assigneeId]
              : []),
          ]),
          privilegedMinistryShare: opts.privilegedMinistryShare,
          ministryTotal,
          ministryPrivileged,
          talkSplit,
          treasuresSplit,
          opts,
        });
        if (candidate) {
          assignment.assistantId = candidate.id!;
          usedThisWeek.add(candidate.id!);
        }
      }
    }
  }

  return { ...week, assignments };
}

interface PickArgs {
  part: Assignment;
  role: "main" | "assistant";
  assignees: Assignee[];
  stats: Map<number, AssigneeStats>;
  weekOf: string;
  seed: number;
  used: Set<number>;
  privilegedMinistryShare: number;
  ministryTotal: number;
  ministryPrivileged: number;
  talkSplit: TalkSplit;
  treasuresSplit: TreasuresSplit;
  isMinorMain?: boolean;
  opts: AutoAssignOptions;
}

function pickCandidate(args: PickArgs): Assignee | null {
  const {
    part,
    role,
    assignees,
    stats,
    weekOf,
    seed,
    used,
    privilegedMinistryShare,
    ministryTotal,
    ministryPrivileged,
    talkSplit,
    treasuresSplit,
    opts,
  } = args;

  const minGapDays = (opts.minGapWeeks ?? 2) * 7;
  const chairmanGapDays = (opts.chairmanGapWeeks ?? 3) * 7;
  const maxPerMonth = opts.maxAssignmentsPerMonth ?? 2;

  // For demo assistants, prefer same gender as the main assignee.
  let genderFilter: "M" | "F" | null = null;
  const mainId = part.assigneeId;
  let isMinorMain = false;
  if (role === "assistant" && mainId != null) {
    const main = assignees.find((p) => p.id === mainId);
    if (main && needsAssistant(part.partType)) {
      if (part.partType === "Congregation Bible Study") {
        genderFilter = "M"; // reader must be a brother too
      } else {
        genderFilter = main.gender; // same-sex demo pairings
      }
      isMinorMain = main.isMinor ?? false;
    }
  }


  // --- Check publisher availability for the midweek meeting ---
  const meetingDay = opts.midweekMeetingDay || "Thursday";
  const meetingDateStr = getMeetingDate(weekOf, meetingDay);

  let eligiblePool = assignees.filter((a) => {
    if (used.has(a.id ?? -1)) return false;
    if (genderFilter && a.gender !== genderFilter) return false;

    // 1. Calendar ranges check
    const ranges = a.unavailableRanges ?? [];
    const mode = opts.availabilityMode || "unavailable";
    if (ranges.length > 0) {
      const overlapsAny = ranges.some((range) => {
        return meetingDateStr >= range.start && meetingDateStr <= range.end;
      });
      if (mode === "available") {
        if (!overlapsAny) return false;
      } else {
        if (overlapsAny) return false;
      }
    }

    // Hard eligibility check
    if (!isEligible(a, part.partType, role, "auto", opts.assignmentRules, isMinorMain, opts.preventMinorAssistantToAdult)) {
      return false;
    }
    return true;
  });

  // ── Hard constraint: minimum gap between main assignments ──────────
  if (role === "main" && minGapDays > 0) {
    const filtered = eligiblePool.filter((a) => {
      const s = stats.get(a.id!);
      if (!s || !s.lastWeekMain) return true;
      return daysBetween(s.lastWeekMain, weekOf) >= minGapDays;
    });
    if (filtered.length > 0) eligiblePool = filtered;
  }

  // ── Hard constraint: rolling monthly cap on main assignments ───────
  if (role === "main" && maxPerMonth > 0) {
    const windowDays = 28; // 4-week rolling window
    const filtered = eligiblePool.filter((a) => {
      const s = stats.get(a.id!);
      if (!s) return true;
      const recentCount = s.recentMainDates.filter(
        (d) => daysBetween(d, weekOf) >= 0 && daysBetween(d, weekOf) < windowDays
      ).length;
      return recentCount < maxPerMonth;
    });
    if (filtered.length > 0) eligiblePool = filtered;
  }

  // ── Enforce privileged ministry share as a hard cap ─────────────────
  if (part.segment === "ministry" && role === "main") {
    const projected = ministryTotal > 0 ? ministryPrivileged / ministryTotal : 0;
    const target = privilegedMinistryShare / 100;
    const nonPrivileged = eligiblePool.filter((a) => !isPrivileged(a));
    if (projected >= target && nonPrivileged.length > 0) {
      eligiblePool = nonPrivileged;
    }
  }

  // ── Chairman rotation constraint ───────────────────────────────────
  if (part.partType === "Chairman") {
    const freshCandidates = eligiblePool.filter((a) => {
      const s = stats.get(a.id!) || { lastWeekChairman: undefined };
      if (!s.lastWeekChairman) return true;
      return daysBetween(s.lastWeekChairman, weekOf) >= chairmanGapDays;
    });
    if (freshCandidates.length > 0) {
      eligiblePool = freshCandidates;
    }
  }

  if (eligiblePool.length === 0) return null;

  return rankAndPick(
    eligiblePool,
    part,
    weekOf,
    stats,
    seed,
    privilegedMinistryShare,
    talkSplit,
    treasuresSplit,
    role,
    opts,
    isMinorMain
  );
}

function rankAndPick(
  pool: Assignee[],
  part: Assignment,
  weekOf: string,
  stats: Map<number, AssigneeStats>,
  seed: number,
  privilegedMinistryShare: number,
  talkSplit: TalkSplit,
  treasuresSplit: TreasuresSplit,
  role: "main" | "assistant",
  opts: Pick<AutoAssignOptions, "minGapWeeks" | "catchUpIntensity" | "msTreasuresRatio" | "qmsTreasuresRatio">,
  isMinorMain?: boolean
): Assignee {
  const empty: AssigneeStats = {
    totalMain: 0,
    bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
    totalAssistant: 0,
    recentMainDates: [],
    recentAssistantDates: [],
  };
  const ranked = [...pool].sort((a, b) => {
    const sa = stats.get(a.id!) ?? empty;
    const sb = stats.get(b.id!) ?? empty;
    return (
      scoreCandidate(
        b,
        part,
        weekOf,
        sb,
        seed,
        privilegedMinistryShare,
        talkSplit,
        treasuresSplit,
        role,
        opts,
        isMinorMain
      ) -
      scoreCandidate(
        a,
        part,
        weekOf,
        sa,
        seed,
        privilegedMinistryShare,
        talkSplit,
        treasuresSplit,
        role,
        opts,
        isMinorMain
      )
    );
  });
  return ranked[0];
}

/**
 * "Who should be assigned soon" — returns assignees ranked by a
 * neediness score (never-assigned > longest-gap > fewest total).
 * Uses main-assignment history only; assistant appearances do not
 * count as "used up" for this ranking.
 */
export function dueSoon(
  assignees: Assignee[],
  weeks: Week[],
  today: string,
  limit = 10
): { assignee: Assignee; stats: AssigneeStats; neglect: number }[] {
  const stats = buildStats(assignees, weeks);

  return assignees
    .filter((a) => a.active)
    .map((a) => {
      const s = stats.get(a.id!) ?? {
        totalMain: 0,
        bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
        totalAssistant: 0,
        recentMainDates: [],
        recentAssistantDates: [],
      };

      let neglect: number;
      if (s.lastWeekMain) {
        // Has been assigned before — gap-based neglect.
        const recentMainCount = s.recentMainDates.filter(
          (d) => daysBetween(d, today) > 0 && daysBetween(d, today) <= 84
        ).length;
        neglect = daysBetween(s.lastWeekMain, today) - recentMainCount * 7;
      } else {
        // Never assigned. Check how long they've been enrolled.
        // Based on user feedback, newcomers should never be treated as neglected.
        neglect = 0;
      }

      return { assignee: a, stats: s, neglect };
    })
    .sort((a, b) => b.neglect - a.neglect)
    .slice(0, limit);
}

export function fmtLastAssigned(stats: AssigneeStats): string {
  if (!stats.lastWeekMain) return "never";
  return stats.lastWeekMain;
}

export interface OptimizationSuggestion {
  uid: string;
  partType: string;
  role: "main" | "assistant";
  currentAssigneeId?: number;
  currentScore: number;
  suggestedAssigneeId: number;
  suggestedScore: number;
  reason: string;
}

export function analyzeWeekOptimization(
  week: Week,
  assignees: Assignee[],
  historicalWeeks: Week[],
  opts: AutoAssignOptions
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];
  const workingWeeks = historicalWeeks.filter((w) => w.id !== week.id);
  const seed = parseInt(week.weekOf.replace(/-/g, ""), 10) || 1;
  const talkSplit = buildTalkSplit(assignees, workingWeeks);
  const treasuresSplit = buildTreasuresSplit(assignees, workingWeeks);
  const stats = buildStats(assignees, workingWeeks);

  const usedMainsThisWeek = new Set<number>();
  let ministryTotal = 0;
  let ministryPrivileged = 0;

  for (const a of week.assignments) {
    if (a.assigneeId != null) usedMainsThisWeek.add(a.assigneeId);
    if (a.segment === "ministry" && a.assigneeId != null) {
      ministryTotal += 1;
      const p = assignees.find((x) => x.id === a.assigneeId);
      if (p && isPrivileged(p)) ministryPrivileged += 1;
    }
  }

  for (const a of week.assignments) {
    if (a.assigneeId != null) {
      const currentPerson = assignees.find((x) => x.id === a.assigneeId);
      if (currentPerson) {
        let usedForPick = new Set(usedMainsThisWeek);
        usedForPick.delete(a.assigneeId);

        if (a.partType === "Opening Prayer") {
          const chairmanId = week.assignments.find((x) => x.partType === "Chairman")?.assigneeId;
          if (chairmanId != null) usedForPick.delete(chairmanId);
        }

        const s = stats.get(currentPerson.id!) ?? {
          totalMain: 0, bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
          totalAssistant: 0, recentMainDates: []
        };
        const currentScore = scoreCandidate(
          currentPerson, a, week.weekOf, s, seed, opts.privilegedMinistryShare, talkSplit, treasuresSplit, "main", opts
        );

        const best = pickCandidate({
          part: a, role: "main", assignees, stats, weekOf: week.weekOf, seed, used: usedForPick,
          privilegedMinistryShare: opts.privilegedMinistryShare, ministryTotal, ministryPrivileged, talkSplit, treasuresSplit, opts
        });

        if (best && best.id !== currentPerson.id) {
          const bestStats = stats.get(best.id!) ?? {
            totalMain: 0, bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
            totalAssistant: 0, recentMainDates: []
          };
          const bestScore = scoreCandidate(
            best, a, week.weekOf, bestStats, seed, opts.privilegedMinistryShare, talkSplit, treasuresSplit, "main", opts
          );

          const threshold = opts.optimizationThresholdMain ?? 50;
          if (bestScore - currentScore > threshold) {
            suggestions.push({
              uid: a.uid, partType: a.partType, role: "main", currentAssigneeId: currentPerson.id, currentScore,
              suggestedAssigneeId: best.id!, suggestedScore: bestScore,
              reason: `Strongly recommended (score +${Math.round(bestScore - currentScore)})`,
            });
          }
        }
      }
    }

    if (needsAssistant(a.partType) && a.assistantId != null) {
      const currentAssistant = assignees.find((x) => x.id === a.assistantId);
      if (currentAssistant) {
        const usedForAssistant = new Set([...usedMainsThisWeek]);
        if (a.assigneeId != null) usedForAssistant.add(a.assigneeId);
        usedForAssistant.delete(a.assistantId);

        const isMinorMain = assignees.find((x) => x.id === a.assigneeId)?.isMinor;
        const s = stats.get(currentAssistant.id!) ?? {
          totalMain: 0, bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
          totalAssistant: 0, recentMainDates: []
        };

        const currentScore = scoreCandidate(
          currentAssistant, a, week.weekOf, s, seed + 1, opts.privilegedMinistryShare, talkSplit, treasuresSplit, "assistant", opts, isMinorMain
        );

        const bestAss = pickCandidate({
          part: a, role: "assistant", assignees, stats, weekOf: week.weekOf, seed: seed + 1, used: usedForAssistant,
          privilegedMinistryShare: opts.privilegedMinistryShare, ministryTotal, ministryPrivileged, talkSplit, treasuresSplit, opts, isMinorMain
        });

        if (bestAss && bestAss.id !== currentAssistant.id) {
          const bestAssStats = stats.get(bestAss.id!) ?? {
            totalMain: 0, bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
            totalAssistant: 0, recentMainDates: []
          };
          const bestScore = scoreCandidate(
            bestAss, a, week.weekOf, bestAssStats, seed + 1, opts.privilegedMinistryShare, talkSplit, treasuresSplit, "assistant", opts, isMinorMain
          );

          const threshold = opts.optimizationThresholdAssistant ?? 40;
          if (bestScore - currentScore > threshold) {
            suggestions.push({
              uid: a.uid, partType: a.partType, role: "assistant", currentAssigneeId: currentAssistant.id, currentScore,
              suggestedAssigneeId: bestAss.id!, suggestedScore: bestScore,
              reason: `Strongly recommended (score +${Math.round(bestScore - currentScore)})`,
            });
          }
        }
      }
    }
  }

  // De-duplicate: pick the best slot for each suggested assignee
  const bySuggestedPerson = new Map<number, OptimizationSuggestion>();
  for (const sug of suggestions) {
    const existing = bySuggestedPerson.get(sug.suggestedAssigneeId);
    const scoreDiff = sug.suggestedScore - sug.currentScore;
    if (!existing) {
      bySuggestedPerson.set(sug.suggestedAssigneeId, sug);
    } else {
      const existingDiff = existing.suggestedScore - existing.currentScore;
      if (scoreDiff > existingDiff) {
        bySuggestedPerson.set(sug.suggestedAssigneeId, sug);
      }
    }
  }

  // Return the top 3 most impactful optimizations
  return Array.from(bySuggestedPerson.values())
    .sort((a, b) => (b.suggestedScore - b.currentScore) - (a.suggestedScore - a.currentScore))
    .slice(0, 3);
}
