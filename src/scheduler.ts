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
  isMinorMain?: boolean
): number {
  let score = 0;

  if (role === "main") {
    if (stats.lastWeekMain) {
      score += daysBetween(stats.lastWeekMain, weekOf);
    } else {
      score += 365; // never assigned as main — strongly prefer
    }
    score -= stats.totalMain * 7;
    // Segment balancing — penalise heavy use in this segment.
    score -= stats.bySegmentMain[part.segment] * 3;
  } else {
    // Assistant role — use assistant-only history.
    if (stats.lastWeekAssistant) {
      score += daysBetween(stats.lastWeekAssistant, weekOf);
    } else {
      score += 365;
    }
    score -= stats.totalAssistant * 7;
    // No segment-balance penalty for assistants.
  }

  // Privilege preferences only apply to main roles.
  if (role === "main") {
    if (part.segment === "ministry") {
      // Field Ministry parts should mostly go to non-privileged publishers.
      if (isPrivileged(a)) {
        score -= (100 - privilegedMinistryShare) / 5; // default ~18
      }
      // Talk (Ministry): strongly prefer baptised brothers when auto-filling.
      if (part.partType === "Talk (Ministry)" && !a.baptised) {
        score -= 50;
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
    // opening/Chairman: all eligible candidates are QE, so only
    // the fairness factors (time since last, total count) decide.
  }

  // Prefer adult assistants when pairing with a minor main participant.
  if (role === "assistant" && isMinorMain && !a.isMinor) {
    score += 30;
  }

  // Deterministic tiny jitter for reproducible tie-breaking per week.
  const jitter = ((a.id ?? 0) * 1315423911 + seed) % 97;
  score += jitter / 1000;

  return score;
}

export interface AutoAssignOptions {
  privilegedMinistryShare: number;
  /** Keep existing manual assignments (do not overwrite). */
  preserveExisting: boolean;
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
  } = args;

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

  const eligible = assignees.filter((a) => {
    if (used.has(a.id ?? -1)) return false;
    if (genderFilter && a.gender !== genderFilter) return false;
    return isEligible(a, part.partType, role);
  });

  if (eligible.length === 0) return null;

  // Enforce privileged ministry share as a *hard* cap if we're over target.
  if (part.segment === "ministry" && role === "main") {
    const projected = ministryTotal > 0 ? ministryPrivileged / ministryTotal : 0;
    const target = privilegedMinistryShare / 100;
    const nonPrivileged = eligible.filter((a) => !isPrivileged(a));
    if (projected >= target && nonPrivileged.length > 0) {
      return rankAndPick(
        nonPrivileged,
        part,
        weekOf,
        stats,
        seed,
        privilegedMinistryShare,
        talkSplit,
        role,
        isMinorMain
      );
    }
  }

  return rankAndPick(
    eligible,
    part,
    weekOf,
    stats,
    seed,
    privilegedMinistryShare,
    talkSplit,
    role,
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
  isMinorMain?: boolean
): Assignee {
  const empty: AssigneeStats = {
    totalMain: 0,
    bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
    totalAssistant: 0,
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
