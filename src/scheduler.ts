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
  total: number;
  lastWeek?: string; // ISO date, undefined if never assigned
  bySegment: { treasures: number; ministry: number; living: number };
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
      total: 0,
      bySegment: { treasures: 0, ministry: 0, living: 0 },
    });
  }

  const sortedWeeks = [...weeks].sort((a, b) =>
    a.weekOf.localeCompare(b.weekOf)
  );

  for (const w of sortedWeeks) {
    for (const ass of w.assignments) {
      for (const id of [ass.assigneeId, ass.assistantId]) {
        if (id == null) continue;
        const s = stats.get(id);
        if (!s) continue;
        s.total += 1;
        s.bySegment[ass.segment] += 1;
        if (!s.lastWeek || w.weekOf > s.lastWeek) s.lastWeek = w.weekOf;
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
 * Primary factor: time since last assignment (absence rewarded).
 * Secondary: inverse of total assignments (less-used rewarded).
 * Tertiary: small randomisation to break ties deterministically per-week.
 */
function scoreCandidate(
  a: Assignee,
  part: Assignment,
  weekOf: string,
  stats: AssigneeStats,
  seed: number,
  privilegedMinistryShare: number,
  talkSplit: TalkSplit
): number {
  let score = 0;

  if (stats.lastWeek) {
    score += daysBetween(stats.lastWeek, weekOf); // days since last
  } else {
    score += 365; // never assigned — strongly prefer
  }

  // Penalise people with many total assignments.
  score -= stats.total * 7;

  // Segment balancing — if the person has been heavily used in this
  // segment, prefer rotating to someone else.
  score -= stats.bySegment[part.segment] * 3;

  // Privilege preferences per segment:
  if (part.segment === "ministry") {
    // Field Ministry parts should mostly go to non-privileged publishers.
    // Honour the configured "privilegedMinistryShare" (default 10%).
    if (isPrivileged(a)) {
      // Pull privileged brothers down unless their share is already low.
      // We can't know the share before assigning, so use a soft penalty
      // proportional to (100 - share).
      score -= (100 - privilegedMinistryShare) / 5; // default ~18
    }
  } else if (part.segment === "living") {
    if (part.partType === "Living Part") {
      // Talks in Living-as-Christians are preferably given to baptised
      // brothers who are *not* E/QE/MS/QMS.
      if (isPrivileged(a)) score -= 10;
    }
    if (
      part.partType === "Local Needs" ||
      part.partType === "Governing Body Update"
    ) {
      // These are normally handled by elders.
      if (a.privileges.includes("E")) score += 8;
      else if (a.privileges.includes("QE")) score += 4;
    }
  } else if (part.segment === "treasures") {
    if (part.partType === "Talk") {
      // The Treasures opening Talk is split ~50/50 between elders and
      // ministerial servants over time. Bias toward whichever group is
      // currently under-represented; if the count is even, neither
      // group gets a boost and the regular fairness factors decide.
      const isE = a.privileges.includes("E");
      const isMS = a.privileges.includes("MS");
      const total = talkSplit.elderCount + talkSplit.msCount;
      if (isE || isMS) {
        if (total === 0) {
          // No history yet — give both groups a small equal nudge so
          // they outrank non-eligible candidates if pools overlap.
          score += 4;
        } else {
          const elderShare = talkSplit.elderCount / total;
          // 0 when balanced, +/- up to ~10 when fully skewed.
          const bias = (0.5 - elderShare) * 20;
          if (isMS && !isE) score -= bias; // MS preferred when elders over-share
          else if (isE && !isMS) score += bias; // elder preferred when MS over-share
        }
      }
    }
    if (part.partType === "Spiritual Gems") {
      // Either an elder or a ministerial servant can handle Spiritual
      // Gems, but ministerial servants are preferred. (Note: because
      // QMS implies MS via normalizePrivileges, QMS also gets this
      // bonus; same for QE/E.)
      const isMS = a.privileges.includes("MS");
      const isE = a.privileges.includes("E");
      if (isMS && !isE) score += 6; // pure MS — most preferred
      else if (isMS && isE) score += 3; // unusual: both flags set
      else if (isE) score += 2; // elder fallback
    }
    if (part.partType === "Bible Reading") {
      // Prefer non-privileged brothers for the Bible Reading so they get
      // featured more often.
      if (isPrivileged(a)) score -= 4;
    }
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
      const candidate = pickCandidate({
        part: assignment,
        role: "main",
        assignees,
        stats,
        weekOf: week.weekOf,
        seed,
        used: usedThisWeek,
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
  if (role === "assistant" && mainId != null) {
    const main = assignees.find((p) => p.id === mainId);
    if (main && needsAssistant(part.partType)) {
      if (part.partType === "Congregation Bible Study") {
        genderFilter = "M"; // reader must be a brother too
      } else {
        genderFilter = main.gender; // same-sex demo pairings
      }
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
        talkSplit
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
    talkSplit
  );
}

function rankAndPick(
  pool: Assignee[],
  part: Assignment,
  weekOf: string,
  stats: Map<number, AssigneeStats>,
  seed: number,
  privilegedMinistryShare: number,
  talkSplit: TalkSplit
): Assignee {
  const empty: AssigneeStats = {
    total: 0,
    bySegment: { treasures: 0, ministry: 0, living: 0 },
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
        talkSplit
      ) -
      scoreCandidate(
        a,
        part,
        weekOf,
        sa,
        seed,
        privilegedMinistryShare,
        talkSplit
      )
    );
  });
  return ranked[0];
}

/**
 * "Who should be assigned soon" — returns assignees ranked by a
 * neediness score (never-assigned > longest-gap > fewest total).
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
        total: 0,
        bySegment: { treasures: 0, ministry: 0, living: 0 },
      };
      const neglect =
        (s.lastWeek ? daysBetween(s.lastWeek, today) : 999) - s.total * 7;
      return { assignee: a, stats: s, neglect };
    })
    .sort((a, b) => b.neglect - a.neglect)
    .slice(0, limit);
}

export function fmtLastAssigned(stats: AssigneeStats): string {
  if (!stats.lastWeek) return "never";
  return stats.lastWeek;
}
