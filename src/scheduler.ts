import {
  isEligible,
  isPrivileged,
  needsAssistant,
} from "./meeting";
import type {
  Assignee,
  Assignment,
  Week,
} from "./types";

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
    });
  }

  const sortedWeeks = [...weeks].sort((a, b) =>
    a.weekOf.localeCompare(b.weekOf)
  );

  for (const w of sortedWeeks) {
    for (const ass of w.assignments) {
      // Main assignee — counts toward main history only.
      if (ass.assigneeId != null) {
        const s = stats.get(ass.assigneeId);
        if (s) {
          s.totalMain += 1;
          s.bySegmentMain[ass.segment] += 1;
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
        }
      }
    }
  }

  return stats;
}

/** Days between two ISO dates (YYYY-MM-DD). */
function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + "T00:00:00");
  const b = new Date(bIso + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
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
  const isE = person.privileges.includes("E");
  const isMS = person.privileges.includes("MS");
  if (isMS) split.msCount += 1;
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
function scoreCandidate(
  a: Assignee,
  part: Assignment,
  weekOf: string,
  stats: AssigneeStats,
  seed: number,
  privilegedMinistryShare: number,
  talkSplit: TalkSplit,
  role: "main" | "assistant",
  opts: Pick<AutoAssignOptions, "minGapWeeks" | "catchUpIntensity">,
  isMinorMain?: boolean
): number {
  let score = 0;

  // ── Gap-based scoring ────────────────────────────────────────────────
  const minGapDays = (opts.minGapWeeks ?? 2) * 7;
  // Catch-up intensity: 1 (very gradual) to 5 (aggressive).
  // Controls how much bonus a neglected person gets.
  const catchUp = Math.max(1, Math.min(5, opts.catchUpIntensity ?? 3));

  if (role === "main") {
    if (stats.lastWeekMain) {
      const gap = daysBetween(stats.lastWeekMain, weekOf);

      // Hard recency penalty: steep penalty within the min-gap window.
      if (gap < minGapDays) {
        score -= (minGapDays - gap) * 30;
      }

      // Neglect bonus: favor those overlooked, scaled by catch-up intensity.
      // Cap at 120 days to prevent monopolisation when catch-up is low,
      // up to 240 days when catch-up is high.
      const neglectCap = 80 + catchUp * 32; // 112..240
      const neglectBonus = Math.min(gap, neglectCap);
      score += neglectBonus * (0.5 + catchUp * 0.3); // 0.8..2.0 multiplier
    } else {
      // Never assigned — give a moderate boost proportional to catch-up.
      score += (80 + catchUp * 32) * (0.5 + catchUp * 0.3);
    }

    // Workload penalty: spread the total lifetime burden.
    score -= stats.totalMain * 15;
    // Segment balancing — penalise heavy use in this segment.
    score -= stats.bySegmentMain[part.segment] * 8;
  } else {
    // Assistant role — use assistant-only history.
    if (stats.lastWeekAssistant) {
      const gap = daysBetween(stats.lastWeekAssistant, weekOf);
      if (gap < 21) {
        score -= (21 - gap) * 15;
      }
      score += Math.min(gap, 180);
    } else {
      score += 180;
    }
    score -= stats.totalAssistant * 10;
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
        if (a.privileges.includes("E")) score += 8;
        else if (a.privileges.includes("QE")) score += 4;
      }
    } else if (part.segment === "treasures") {
      if (part.partType === "Talk") {
        const isE = a.privileges.includes("E");
        const isMS = a.privileges.includes("MS");
        const total = talkSplit.elderCount + talkSplit.msCount;
        if (isE || isMS) {
          if (total === 0) {
            score += 4;
          } else {
            const elderShare = talkSplit.elderCount / total;
            const bias = (0.5 - elderShare) * 20;
            if (isMS && !isE) score -= bias;
            else if (isE && !isMS) score += bias;
          }
        }
      }
      if (part.partType === "Spiritual Gems") {
        const isMS = a.privileges.includes("MS");
        const isE = a.privileges.includes("E");
        if (isMS && !isE) score += 6;
        else if (isMS && isE) score += 3;
        else if (isE) score += 2;
      }
      if (part.partType === "Bible Reading") {
        // Prefer non-privileged brothers.
        if (isPrivileged(a)) score -= 4;
      }
    }
  }

  // Prefer adult assistants when pairing with a minor main participant.
  if (role === "assistant" && isMinorMain && !a.isMinor) {
    score += 30;
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

  // Track running 50/50 split for the Treasures opening Talk — seeded
  // from history only. Pre-existing Talks in the current draft (when
  // preserveExisting=true) are counted as we encounter them in the
  // loop below, alongside newly assigned ones.
  const talkSplit: TalkSplit = buildTalkSplit(assignees, workingWeeks);

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
      }
    } else if (assignment.partType === "Talk") {
      // Preserved manual Talk — count it toward the running 50/50 split.
      const person = assignees.find((p) => p.id === assignment.assigneeId);
      if (person) tallyTalk(person, talkSplit);
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

  let eligiblePool = assignees.filter((a) => {
    if (used.has(a.id ?? -1)) return false;
    if (genderFilter && a.gender !== genderFilter) return false;
    return isEligible(a, part.partType, role, "auto");
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
  role: "main" | "assistant",
  opts: Pick<AutoAssignOptions, "minGapWeeks" | "catchUpIntensity">,
  isMinorMain?: boolean
): Assignee {
  const empty: AssigneeStats = {
    totalMain: 0,
    bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
    totalAssistant: 0,
    recentMainDates: [],
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
      };
      const neglect =
        (s.lastWeekMain ? daysBetween(s.lastWeekMain, today) : 999) -
        s.totalMain * 7;
      return { assignee: a, stats: s, neglect };
    })
    .sort((a, b) => b.neglect - a.neglect)
    .slice(0, limit);
}

export function fmtLastAssigned(stats: AssigneeStats): string {
  if (!stats.lastWeekMain) return "never";
  return stats.lastWeekMain;
}
