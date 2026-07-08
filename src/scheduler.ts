import {
  isEligible,
  isPrivileged,
  needsAssistant,
  checkPairingViolation,
  meetsSpecialRequirement,
} from "./meeting";
import {
  Assignee,
  Assignment,
  Week,
  AssignmentRule,
  Household,
  SegmentId,
  RuleEnforcementLevel,
} from "./types";
import { getMeetingDate, workbookPeriod } from "./utils";

export function getMinistryCategory(a: Assignee): "QE" | "E" | "QMS" | "MS" | "Brothers" | "Sisters" {
  if (a.privileges?.includes("QE")) return "QE";
  if (a.privileges?.includes("E")) return "E";
  if (a.privileges?.includes("QMS")) return "QMS";
  if (a.privileges?.includes("MS")) return "MS";
  if (a.gender === "M" && a.baptised) return "Brothers";
  return "Sisters";
}

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
  /** All segment-specific main assignment dates for rolling-window segment balancing. */
  recentMainDatesBySegment: { opening: string[]; treasures: string[]; ministry: string[]; living: string[] };
  lastWeekPrayer?: string;
  recentPrayerDates?: string[];
  lastWeekByPartTypeMain?: Record<string, string>;
  lastWeekByPartTypeAssistant?: Record<string, string>;
  lastMinistryRole?: "main" | "assistant";
  lastPartWasWithMinor?: boolean;
  lastWeekMinistry?: string;
  recentMinistryDates?: string[];
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
      recentMainDatesBySegment: { opening: [], treasures: [], ministry: [], living: [] },
      lastWeekPrayer: undefined,
      recentPrayerDates: [],
      lastWeekByPartTypeMain: {},
      lastWeekByPartTypeAssistant: {},
      lastMinistryRole: undefined,
      lastWeekMinistry: undefined,
      recentMinistryDates: [],
    });
  }

  const sortedWeeks = [...weeks].sort((a, b) =>
    a.weekOf.localeCompare(b.weekOf)
  );

  const segmentOrder: Record<string, number> = { opening: 0, treasures: 1, ministry: 2, living: 3 };

  for (const w of sortedWeeks) {
    if (!w || !Array.isArray(w.assignments)) continue;

    const sortedAssignments = [...w.assignments].sort((x, y) => {
      const diff = (segmentOrder[x.segment] ?? 99) - (segmentOrder[y.segment] ?? 99);
      if (diff !== 0) return diff;
      return x.order - y.order;
    });

    for (const ass of sortedAssignments) {
      if (!ass) continue;
      // Main assignee — counts toward main history only.
      if (ass.assigneeId != null) {
        const s = stats.get(ass.assigneeId);
        if (s) {
          const isPrayer = ass.partType === "Opening Prayer" || ass.partType === "Closing Prayer";
          if (isPrayer) {
            if (!s.lastWeekPrayer || w.weekOf > s.lastWeekPrayer) {
              s.lastWeekPrayer = w.weekOf;
            }
            if (s.recentPrayerDates) {
              s.recentPrayerDates.push(w.weekOf);
            }
          } else {
            s.totalMain += 1;
            if (ass.segment && s.bySegmentMain) {
              s.bySegmentMain[ass.segment] = (s.bySegmentMain[ass.segment] || 0) + 1;
            }
            if (!s.lastWeekMain || w.weekOf > s.lastWeekMain)
              s.lastWeekMain = w.weekOf;
            s.recentMainDates.push(w.weekOf);
            if (ass.segment && s.recentMainDatesBySegment) {
              const arr = s.recentMainDatesBySegment[ass.segment as "opening" | "treasures" | "ministry" | "living"];
              if (arr) {
                arr.push(w.weekOf);
              }
            }
          }
          if (ass.partType === "Chairman") {
            if (!s.lastWeekChairman || w.weekOf > s.lastWeekChairman)
              s.lastWeekChairman = w.weekOf;
          }
          if (!s.lastWeekByPartTypeMain) s.lastWeekByPartTypeMain = {};
          s.lastWeekByPartTypeMain[ass.partType] = w.weekOf;
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
          if (!s.lastWeekByPartTypeAssistant) s.lastWeekByPartTypeAssistant = {};
          s.lastWeekByPartTypeAssistant[ass.partType] = w.weekOf;
        }
      }
      if (ass.segment === "ministry") {
        if (ass.assigneeId != null) {
          const s = stats.get(ass.assigneeId);
          if (s) {
            s.lastMinistryRole = "main";
            if (!s.lastWeekMinistry || w.weekOf > s.lastWeekMinistry) {
              s.lastWeekMinistry = w.weekOf;
            }
            if (s.recentMinistryDates && !s.recentMinistryDates.includes(w.weekOf)) {
              s.recentMinistryDates.push(w.weekOf);
            }
          }
        }
        if (ass.assistantId != null) {
          const s = stats.get(ass.assistantId);
          if (s) {
            s.lastMinistryRole = "assistant";
            if (!s.lastWeekMinistry || w.weekOf > s.lastWeekMinistry) {
              s.lastWeekMinistry = w.weekOf;
            }
            if (s.recentMinistryDates && !s.recentMinistryDates.includes(w.weekOf)) {
              s.recentMinistryDates.push(w.weekOf);
            }
          }
        }
      }

      // Track if the assignee's partner in this part was a minor.
      const hasPartner = ass.assigneeId != null && ass.assistantId != null;
      if (ass.assigneeId != null) {
        const s = stats.get(ass.assigneeId);
        if (s) {
          if (hasPartner) {
            const assistantAssignee = assignees.find((p) => p.id === ass.assistantId);
            s.lastPartWasWithMinor = !!assistantAssignee?.isMinor;
          } else {
            s.lastPartWasWithMinor = false;
          }
        }
      }
      if (ass.assistantId != null) {
        const s = stats.get(ass.assistantId);
        if (s) {
          if (hasPartner) {
            const mainAssignee = assignees.find((p) => p.id === ass.assigneeId);
            s.lastPartWasWithMinor = !!mainAssignee?.isMinor;
          } else {
            s.lastPartWasWithMinor = false;
          }
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
 * Aggregate counts used to balance the Living Parts between
 * QE, E, QMS, and MS.
 */
export interface LivingSplit {
  qeCount: number;
  elderCount: number;
  qmsCount: number;
  msCount: number;
}

/** Tally past Living Part assignments by group. */
export function buildLivingSplit(
  assignees: Assignee[],
  weeks: Week[]
): LivingSplit {
  const split: LivingSplit = { qeCount: 0, elderCount: 0, qmsCount: 0, msCount: 0 };
  for (const w of weeks) {
    if (!w || !Array.isArray(w.assignments)) continue;
    for (const a of w.assignments) {
      if (a.partType !== "Living Part") continue;
      if (a.assigneeId == null) continue;
      const person = assignees.find((p) => p.id === a.assigneeId);
      if (person) tallyLiving(person, split);
    }
  }
  return split;
}

export function tallyLiving(person: Assignee, split: LivingSplit): void {
  const isQE = person.privileges?.includes("QE") ?? false;
  const isE = !isQE && (person.privileges?.includes("E") ?? false);
  const isQMS = person.privileges?.includes("QMS") ?? false;
  const isMS = !isQE && !isE && !isQMS && (person.privileges?.includes("MS") ?? false);
  if (isQE) split.qeCount += 1;
  else if (isE) split.elderCount += 1;
  else if (isQMS) split.qmsCount += 1;
  else if (isMS) split.msCount += 1;
}

export interface PrayerSplit {
  qeCount: number;
  elderCount: number;
  qmsCount: number;
  msCount: number;
  nonPrivilegedCount: number;
}

export function buildPrayerSplit(
  assignees: Assignee[],
  weeks: Week[]
): PrayerSplit {
  const split: PrayerSplit = { qeCount: 0, elderCount: 0, qmsCount: 0, msCount: 0, nonPrivilegedCount: 0 };
  for (const w of weeks) {
    if (!w || !Array.isArray(w.assignments)) continue;
    for (const a of w.assignments) {
      if (a.partType === "Opening Prayer" || a.partType === "Closing Prayer") {
        if (a.assigneeId == null) continue;
        const person = assignees.find((p) => p.id === a.assigneeId);
        if (person) tallyPrayer(person, split);
      }
    }
  }
  return split;
}

export function tallyPrayer(person: Assignee, split: PrayerSplit): void {
  const cat = getPrayerCategory(person);
  if (cat === "QE") split.qeCount += 1;
  else if (cat === "E") split.elderCount += 1;
  else if (cat === "QMS") split.qmsCount += 1;
  else if (cat === "MS") split.msCount += 1;
  else split.nonPrivilegedCount += 1;
}

export function getPrayerCategory(person: Assignee): "QE" | "E" | "QMS" | "MS" | "Non-Privileged" {
  const isQE = person.privileges?.includes("QE") ?? false;
  const isE = !isQE && (person.privileges?.includes("E") ?? false);
  const isQMS = !isQE && !isE && (person.privileges?.includes("QMS") ?? false);
  const isMS = !isQE && !isE && !isQMS && (person.privileges?.includes("MS") ?? false);

  if (isQE) return "QE";
  if (isE) return "E";
  if (isQMS) return "QMS";
  if (isMS) return "MS";
  return "Non-Privileged";
}

export interface BibleReadingSplit {
  privilegedCount: number;
  nonPrivilegedCount: number;
}

export function buildBibleReadingSplit(
  assignees: Assignee[],
  weeks: Week[]
): BibleReadingSplit {
  const split: BibleReadingSplit = { privilegedCount: 0, nonPrivilegedCount: 0 };
  for (const w of weeks) {
    if (!w || !Array.isArray(w.assignments)) continue;
    for (const a of w.assignments) {
      if (a.partType !== "Bible Reading") continue;
      if (a.assigneeId == null) continue;
      const person = assignees.find((p) => p.id === a.assigneeId);
      if (person) tallyBibleReading(person, split);
    }
  }
  return split;
}

export function tallyBibleReading(person: Assignee, split: BibleReadingSplit): void {
  if (isPrivileged(person)) {
    split.privilegedCount += 1;
  } else {
    split.nonPrivilegedCount += 1;
  }
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
export function getPartnerInfo(
  part: Assignment,
  role: "main" | "assistant",
  assignees: Assignee[],
  stats: Map<number, AssigneeStats>
): { partnerIsMinor?: boolean; partnerLastPartWasWithMinor?: boolean } {
  const partnerId = role === "main" ? part.assistantId : part.assigneeId;
  if (partnerId == null) return {};
  const partner = assignees.find((x) => x.id === partnerId);
  if (!partner) return {};
  const partnerStats = stats.get(partnerId);
  return {
    partnerIsMinor: !!partner.isMinor,
    partnerLastPartWasWithMinor: partnerStats?.lastPartWasWithMinor,
  };
}

export function scoreCandidate(
  a: Assignee,
  part: Assignment,
  weekOf: string,
  stats: AssigneeStats,
  seed: number,
  talkSplit: TalkSplit,
  treasuresSplit: TreasuresSplit,
  livingSplit: LivingSplit,
  bibleReadingSplit: BibleReadingSplit,
  role: "main" | "assistant",
  opts: Pick<
    AutoAssignOptions,
    | "minGapWeeks"
    | "catchUpIntensity"
    | "msTreasuresRatio"
    | "qmsTreasuresRatio"
    | "qeLivingRatio"
    | "eLivingRatio"
    | "qmsLivingRatio"
    | "privilegedBibleReadingRatio"
    | "shareMinistryQE"
    | "shareMinistryE"
    | "shareMinistryMS"
    | "shareMinistryQMS"
    | "shareMinistryBrothers"
    | "ruleMinGap"
    | "ruleChairmanGap"
    | "ruleRoleAlternation"
    | "ruleMinorAssistantToAdult"
    | "ruleAdultAssistantForMinor"
    | "ruleWorkloadBalancing"
    | "ruleSegmentBalancing"
    | "ruleInfirmedThrottling"
    | "ruleSameSexDemogenders"
    | "ruleMainToAssistantConsecutive"
    | "qePrayerRatio"
    | "ePrayerRatio"
    | "qmsPrayerRatio"
    | "msPrayerRatio"
    | "rulePrayerRotation"
    | "ruleUnifiedMinistry"
  >,
  isMinorMain?: boolean,
  partnerIsMinor?: boolean,
  partnerLastPartWasWithMinor?: boolean,
  prayerSplit?: PrayerSplit
): number {
  void talkSplit;
  void prayerSplit;
  void seed;
  let score = 0;

  // Ministry segment role alternation:
  const roleAlternationLevel = opts.ruleRoleAlternation ?? "strong";
  if (roleAlternationLevel !== "off" && part.segment === "ministry" && stats.lastMinistryRole !== undefined) {
    const isRepeatedRole = (role === "main" && stats.lastMinistryRole === "main") ||
                           (role === "assistant" && stats.lastMinistryRole === "assistant");
    if (isRepeatedRole) {
      const penalty = roleAlternationLevel === "weak" ? 500 :
                      roleAlternationLevel === "medium" ? 5000 :
                      roleAlternationLevel === "strong" ? 20000 : 1000000;
      score -= penalty;
    }
  }

  // ── Rotation Fairness Rules (Date-Based Rotation Mark System) ──────
  const lastWeekForPart = role === "main"
    ? stats.lastWeekByPartTypeMain?.[part.partType]
    : stats.lastWeekByPartTypeAssistant?.[part.partType];

  if (!lastWeekForPart) {
    // Never assigned to this specific part type: highest priority!
    score += 1000000;
  } else {
    // Has been assigned before. Add bonus proportional to the gap in days
    // since their last assignment in this specific category (oldest first).
    const catGap = daysBetween(lastWeekForPart, weekOf);
    score += catGap * 100;
  }

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
    const minGapLevel = opts.ruleMinGap ?? "strict";
    const isCurrentPrayer = part.partType === "Opening Prayer" || part.partType === "Closing Prayer";
    if (isCurrentPrayer) {
      if (stats.lastWeekPrayer) {
        const gap = daysBetween(stats.lastWeekPrayer, weekOf);
        if (minGapLevel !== "off" && gap < minGapDays) {
          const mult = minGapLevel === "weak" ? 5 :
                       minGapLevel === "medium" ? 15 : 30;
          score -= (minGapDays - gap) * mult;
        }
        const DECAY_DAYS = 180;
        score += Math.min(gap, DECAY_DAYS) * 0.8;

        if (priorityMul > 0) {
          const neglectCap = 80 + catchUp * 32;
          const neglectBonus = Math.min(gap, neglectCap);
          score += neglectBonus * priorityMul;
        }
      } else {
        score += 0;
      }

      const recentPrayerCount = (stats.recentPrayerDates ?? []).filter(
        (d) => daysBetween(d, weekOf) > 0 && daysBetween(d, weekOf) <= 84
      ).length;
      score -= recentPrayerCount * 8;

      // Quota-based scoring for prayers
      if (prayerSplit) {
        const candIsQE = a.privileges?.includes("QE") ?? false;
        const candIsE = !candIsQE && (a.privileges?.includes("E") ?? false);
        const candIsQMS = a.privileges?.includes("QMS") ?? false;
        const candIsMS = !candIsQE && !candIsE && !candIsQMS && (a.privileges?.includes("MS") ?? false);

        const targetQeShare = (opts.qePrayerRatio ?? 20) / 100;
        const targetElderShare = (opts.ePrayerRatio ?? 20) / 100;
        const targetQmsShare = (opts.qmsPrayerRatio ?? 20) / 100;
        const targetMsShare = (opts.msPrayerRatio ?? 20) / 100;
        const targetNonPrivilegedShare = Math.max(0, 1 - targetQeShare - targetElderShare - targetQmsShare - targetMsShare);

        const total = prayerSplit.qeCount + prayerSplit.elderCount + prayerSplit.qmsCount + prayerSplit.msCount + prayerSplit.nonPrivilegedCount;
        if (total === 0) {
          if (candIsQE) {
            score += (targetQeShare - 0.20) * 40;
          } else if (candIsE) {
            score += (targetElderShare - 0.20) * 40;
          } else if (candIsQMS) {
            score += (targetQmsShare - 0.20) * 40;
          } else if (candIsMS) {
            score += (targetMsShare - 0.20) * 40;
          } else {
            score += (targetNonPrivilegedShare - 0.20) * 40;
          }
        } else {
          const currentQeShare = prayerSplit.qeCount / total;
          const currentElderShare = prayerSplit.elderCount / total;
          const currentQmsShare = prayerSplit.qmsCount / total;
          const currentMsShare = prayerSplit.msCount / total;
          const currentNonPrivilegedShare = prayerSplit.nonPrivilegedCount / total;

          if (candIsQE) {
            score += (targetQeShare - currentQeShare) * 50;
          } else if (candIsE) {
            score += (targetElderShare - currentElderShare) * 50;
          } else if (candIsQMS) {
            score += (targetQmsShare - currentQmsShare) * 50;
          } else if (candIsMS) {
            score += (targetMsShare - currentMsShare) * 50;
          } else {
            score += (targetNonPrivilegedShare - currentNonPrivilegedShare) * 50;
          }
        }

        // Hard boundary constraints:
        if (candIsQE && targetQeShare === 0) score -= 1000000;
        if (candIsE && targetElderShare === 0) score -= 1000000;
        if (candIsQMS && targetQmsShare === 0) score -= 1000000;
        if (candIsMS && targetMsShare === 0) score -= 1000000;
        if (!candIsQE && !candIsE && !candIsQMS && !candIsMS && targetNonPrivilegedShare === 0) score -= 1000000;
      }
    } else {
      const isUnifiedMinistry = (opts.ruleUnifiedMinistry ?? true) && part.segment === "ministry";
      const lastWeek = isUnifiedMinistry ? stats.lastWeekMinistry : stats.lastWeekMain;

      if (lastWeek) {
        const gap = daysBetween(lastWeek, weekOf);

        // Hard recency penalty: steep penalty within the min-gap window.
        if (minGapLevel !== "off" && gap < minGapDays) {
          const mult = minGapLevel === "weak" ? 5 :
                       minGapLevel === "medium" ? 15 : 30;
          score -= (minGapDays - gap) * mult;
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
      const workloadBalancingLevel = opts.ruleWorkloadBalancing ?? "medium";
      if (workloadBalancingLevel !== "off") {
        const recentDates = isUnifiedMinistry ? (stats.recentMinistryDates ?? []) : stats.recentMainDates;
        const recentCount = recentDates.filter(
          (d) => daysBetween(d, weekOf) > 0 && daysBetween(d, weekOf) <= 84
        ).length;
        const mainWMultiplier = workloadBalancingLevel === "weak" ? 2 :
                                workloadBalancingLevel === "medium" ? 8 : 20;
        score -= recentCount * mainWMultiplier;
      }

      // Segment balancing — penalise heavy recent use in this segment in the last 12 weeks (84 days).
      const segmentBalancingLevel = opts.ruleSegmentBalancing ?? "medium";
      if (segmentBalancingLevel !== "off") {
        const recentSegmentDates = stats.recentMainDatesBySegment?.[part.segment] ?? [];
        const recentSegmentCount = recentSegmentDates.filter(
          (d) => daysBetween(d, weekOf) > 0 && daysBetween(d, weekOf) <= 84
        ).length;
        const segmentBMultiplier = segmentBalancingLevel === "weak" ? 2 :
                                   segmentBalancingLevel === "medium" ? 6 : 15;
        score -= recentSegmentCount * segmentBMultiplier;
      }
    }

    // Favor main role if their last overall assignment was as an assistant.
    const lastMain = stats.lastWeekMain;
    const lastAsst = stats.lastWeekAssistant;
    const wasLastAssistant = lastAsst && (!lastMain || lastAsst > lastMain);
    if (wasLastAssistant) {
      score += 20; // healthy favor bonus
    }
  } else {
    // Assistant role — use assistant-only history.
    const workloadBalancingLevel = opts.ruleWorkloadBalancing ?? "medium";
    const isUnifiedMinistry = (opts.ruleUnifiedMinistry ?? true) && part.segment === "ministry";
    const lastWeek = isUnifiedMinistry ? stats.lastWeekMinistry : stats.lastWeekAssistant;
    const gapDays = isUnifiedMinistry ? minGapDays : 21;

    if (lastWeek) {
      const gap = daysBetween(lastWeek, weekOf);
      if (workloadBalancingLevel !== "off" && gap < gapDays) {
        const gapMultiplier = workloadBalancingLevel === "weak" ? 5 :
                              workloadBalancingLevel === "medium" ? 15 : 30;
        score -= (gapDays - gap) * gapMultiplier;
      }
      const DECAY_DAYS = isUnifiedMinistry ? 180 : 120;
      score += Math.min(gap, DECAY_DAYS) * (isUnifiedMinistry ? 0.8 : 0.6);
    } else {
      score += 0;
    }

    // Workload penalty: penalise based on recent assistant workload in the last 12 weeks (84 days).
    if (workloadBalancingLevel !== "off") {
      const recentDates = isUnifiedMinistry ? (stats.recentMinistryDates ?? []) : (stats.recentAssistantDates ?? []);
      const recentCount = recentDates.filter(
        (d) => daysBetween(d, weekOf) > 0 && daysBetween(d, weekOf) <= 84
      ).length;
      const assistantWMultiplier = workloadBalancingLevel === "weak" ? 2 :
                                   workloadBalancingLevel === "medium" ? 6 : 15;
      score -= recentCount * assistantWMultiplier;
    }
  }

  // Privilege preferences only apply to main roles.
  if (role === "main") {
    if (part.segment === "ministry") {
      let shareSetting = 100;
      const cat = getMinistryCategory(a);
      if (cat === "QE") shareSetting = opts.shareMinistryQE ?? 0;
      else if (cat === "E") shareSetting = opts.shareMinistryE ?? 0;
      else if (cat === "QMS") shareSetting = opts.shareMinistryQMS ?? 0;
      else if (cat === "MS") shareSetting = opts.shareMinistryMS ?? 0;
      else if (cat === "Brothers") shareSetting = opts.shareMinistryBrothers ?? 0;

      if (cat !== "Sisters") {
        score -= (100 - shareSetting) / 5;
      }
    } else if (part.segment === "living") {
      if (part.partType === "Living Part") {
        if (isPrivileged(a)) score -= 10;

        const candIsQE = a.privileges?.includes("QE") ?? false;
        const candIsE = !candIsQE && (a.privileges?.includes("E") ?? false);
        const candIsQMS = a.privileges?.includes("QMS") ?? false;
        const candIsMS = !candIsQE && !candIsE && !candIsQMS && (a.privileges?.includes("MS") ?? false);

        if (candIsQE || candIsE || candIsQMS || candIsMS) {
          const targetQeShare = (opts.qeLivingRatio ?? 25) / 100;
          const targetElderShare = (opts.eLivingRatio ?? 25) / 100;
          const targetQmsShare = (opts.qmsLivingRatio ?? 25) / 100;
          const targetMsShare = Math.max(0, 1 - targetQeShare - targetElderShare - targetQmsShare);

          const total = livingSplit.qeCount + livingSplit.elderCount + livingSplit.qmsCount + livingSplit.msCount;
          if (total === 0) {
            // First assignment: use the target share directly to bias
            if (candIsQE) {
              score += (targetQeShare - 0.25) * 40;
            } else if (candIsE) {
              score += (targetElderShare - 0.25) * 40;
            } else if (candIsQMS) {
              score += (targetQmsShare - 0.25) * 40;
            } else if (candIsMS) {
              score += (targetMsShare - 0.25) * 40;
            }
          } else {
            const currentQeShare = livingSplit.qeCount / total;
            const currentElderShare = livingSplit.elderCount / total;
            const currentQmsShare = livingSplit.qmsCount / total;
            const currentMsShare = livingSplit.msCount / total;

            if (candIsQE) {
              const diff = targetQeShare - currentQeShare;
              score += diff * 50;
            } else if (candIsE) {
              const diff = targetElderShare - currentElderShare;
              score += diff * 50;
            } else if (candIsQMS) {
              const diff = targetQmsShare - currentQmsShare;
              score += diff * 50;
            } else if (candIsMS) {
              const diff = targetMsShare - currentMsShare;
              score += diff * 50;
            }
          }

          // Hard boundary constraints:
          if (candIsQE && targetQeShare === 0) {
            score -= 1000000;
          }
          if (candIsE && targetElderShare === 0) {
            score -= 1000000;
          }
          if (candIsQMS && targetQmsShare === 0) {
            score -= 1000000;
          }
          if (candIsMS && targetMsShare === 0) {
            score -= 1000000;
          }
        }
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
            score -= 1000000;
          }
          if (candIsQMS && targetQmsShare === 0) {
            score -= 1000000;
          }
          if (candIsE && targetElderShare === 0) {
            score -= 1000000;
          }
        }
      }
      if (part.partType === "Bible Reading") {
        const candIsPrivileged = isPrivileged(a);
        const targetPrivilegedShare = (opts.privilegedBibleReadingRatio ?? 10) / 100;
        const targetNonPrivilegedShare = Math.max(0, 1 - targetPrivilegedShare);

        const total = bibleReadingSplit.privilegedCount + bibleReadingSplit.nonPrivilegedCount;
        if (total === 0) {
          if (candIsPrivileged) {
            score += (targetPrivilegedShare - 0.5) * 40;
          } else {
            score += (targetNonPrivilegedShare - 0.5) * 40;
          }
        } else {
          const currentPrivilegedShare = bibleReadingSplit.privilegedCount / total;
          const currentNonPrivilegedShare = bibleReadingSplit.nonPrivilegedCount / total;

          if (candIsPrivileged) {
            const diff = targetPrivilegedShare - currentPrivilegedShare;
            score += diff * 50;
          } else {
            const diff = targetNonPrivilegedShare - currentNonPrivilegedShare;
            score += diff * 50;
          }
        }

        // Hard boundary constraints:
        if (candIsPrivileged && targetPrivilegedShare === 0) {
          score -= 1000000;
        }
        if (!candIsPrivileged && targetNonPrivilegedShare === 0) {
          score -= 1000000;
        }
      }
    }
  }

  // Prefer adult assistants when pairing with a minor main participant.
  const adultAssistantForMinorLevel = opts.ruleAdultAssistantForMinor ?? "strong";
  if (adultAssistantForMinorLevel !== "off" && role === "assistant" && isMinorMain && !a.isMinor) {
    const bonus = adultAssistantForMinorLevel === "weak" ? 10 :
                  adultAssistantForMinorLevel === "medium" ? 25 : 50;
    score += bonus; // Increased priority
  }

  // Penalty for minor assistant to adult main
  const minorAssistantToAdultLevel = opts.ruleMinorAssistantToAdult ?? "strict";
  if (minorAssistantToAdultLevel !== "off" && minorAssistantToAdultLevel !== "strict") {
    if (role === "assistant" && !isMinorMain && a.isMinor) {
      const penalty = minorAssistantToAdultLevel === "weak" ? 250 :
                      minorAssistantToAdultLevel === "medium" ? 1000 : 5000;
      score -= penalty;
    } else if (role === "main" && partnerIsMinor && !a.isMinor) {
      const penalty = minorAssistantToAdultLevel === "weak" ? 250 :
                      minorAssistantToAdultLevel === "medium" ? 1000 : 5000;
      score -= penalty;
    }
  }

  // ── Frequency throttling ────────────────────────────────────────────
  const infirmedThrottlingLevel = opts.ruleInfirmedThrottling ?? "medium";
  if (infirmedThrottlingLevel !== "off" && (a.restrictionType === "infirmed" || a.restrictionType === "elderly")) {
    const penalty = infirmedThrottlingLevel === "weak" ? 20 :
                    infirmedThrottlingLevel === "medium" ? 100 : 500;
    // Significant penalty to ensure they are chosen last.
    score -= penalty;
  }

  // Penalty for main part last week followed by assistant part this week
  const consecutiveMainAsstLevel = opts.ruleMainToAssistantConsecutive ?? "medium";
  if (role === "assistant" && consecutiveMainAsstLevel !== "off" && stats.lastWeekMain) {
    const gap = daysBetween(stats.lastWeekMain, weekOf);
    if (gap < 14) {
      const penalty = consecutiveMainAsstLevel === "weak" ? 100 :
                      consecutiveMainAsstLevel === "medium" ? 1000 :
                      consecutiveMainAsstLevel === "strong" ? 10000 : 200000;
      score -= penalty;
    }
  }

  // Prefer adult partner if candidate's last part was with a minor
  // Prefer adult candidate if partner's last part was with a minor
  if (partnerIsMinor !== undefined) {
    const isPartnerAdult = !partnerIsMinor;
    if (stats.lastPartWasWithMinor && isPartnerAdult) {
      score += 10000;
    }
    if (partnerLastPartWasWithMinor && !a.isMinor) {
      score += 10000;
    }
  }

  // Random tiny jitter for tie-breaking.
  // Scaled small enough (0..0.99) to never override meaningful differences.
  const jitter = Math.random() * 100;
  score += jitter / 100;

  return score;
}

export interface AutoAssignOptions {
  /** Households in the congregation for family pairing and avoidance constraints. */
  households?: Household[];
  shareMinistryQE?: number;
  shareMinistryE?: number;
  shareMinistryMS?: number;
  shareMinistryQMS?: number;
  shareMinistryBrothers?: number;
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
  /** Max demonstration parts assigned to brothers per month. 0 = no limit. */
  maxBrothersMinistryPartsPerMonth?: number;
  optimizationThresholdMain?: number;
  optimizationThresholdAssistant?: number;
  /** Custom eligibility rules. */
  assignmentRules: Record<string, AssignmentRule>;
  /** Custom balance ratio for Treasures parts between regular MS and Elders. */
  msTreasuresRatio?: number;
  /** Custom balance ratio for Treasures parts between QMS and Elders. */
  qmsTreasuresRatio?: number;
  /** Custom balance ratio for Living parts for QE. */
  qeLivingRatio?: number;
  /** Custom balance ratio for Living parts for E. */
  eLivingRatio?: number;
  /** Custom balance ratio for Living parts for QMS. */
  qmsLivingRatio?: number;
  /** Custom balance ratio for Bible Reading parts for privileged brothers. */
  privilegedBibleReadingRatio?: number;
  /** The weekday that the midweek meeting is held. */
  midweekMeetingDay?: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
  /** How availability ranges are tracked. "unavailable" means away dates, "available" means in-town dates. */
  availabilityMode?: "unavailable" | "available";
  /** Custom part types. */
  customPartTypes?: Record<SegmentId, string[]>;
  /** Main/Assistant pairing repetition avoidance check: strict, relaxed, or off. */
  pairingAvoidance?: RuleEnforcementLevel;
  ruleMinGap?: RuleEnforcementLevel;
  ruleChairmanGap?: RuleEnforcementLevel;
  ruleRoleAlternation?: RuleEnforcementLevel;
  ruleMinorAssistantToAdult?: RuleEnforcementLevel;
  ruleAdultAssistantForMinor?: RuleEnforcementLevel;
  ruleWorkloadBalancing?: RuleEnforcementLevel;
  ruleSegmentBalancing?: RuleEnforcementLevel;
  ruleInfirmedThrottling?: RuleEnforcementLevel;
  ruleSameSexDemogenders?: RuleEnforcementLevel;
  ruleMainToAssistantConsecutive?: RuleEnforcementLevel;
  qePrayerRatio?: number;
  ePrayerRatio?: number;
  qmsPrayerRatio?: number;
  msPrayerRatio?: number;
  rulePrayerRotation?: RuleEnforcementLevel;
  ruleUnifiedMinistry?: boolean;
  ruleAvoidPioneerPairing?: boolean;
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

  // Track per-segment category shares for field ministry.
  let ministryTotal = 0;
  const ministryCounts = { QE: 0, E: 0, QMS: 0, MS: 0, Brothers: 0 };
  for (const a of assignments) {
    if (a.segment !== "ministry" || a.assigneeId == null) continue;
    const person = assignees.find((p) => p.id === a.assigneeId);
    if (!person) continue;
    ministryTotal += 1;
    const cat = getMinistryCategory(person);
    if (cat !== "Sisters") {
      ministryCounts[cat] += 1;
    }
  }

  // Track running splits — seeded from history only.
  const talkSplit: TalkSplit = buildTalkSplit(assignees, workingWeeks);
  const treasuresSplit: TreasuresSplit = buildTreasuresSplit(assignees, workingWeeks);
  const livingSplit: LivingSplit = buildLivingSplit(assignees, workingWeeks);
  const bibleReadingSplit: BibleReadingSplit = buildBibleReadingSplit(assignees, workingWeeks);
  const prayerSplit: PrayerSplit = buildPrayerSplit(assignees, workingWeeks);

  // Order parts so Treasures is filled before Ministry (which depends on
  // the privileged-share counter) — the array is already in this order.
  for (const assignment of assignments) {
    if (assignment.isSpecial) {
      if (assignment.assigneeId != null) {
        usedThisWeek.add(assignment.assigneeId);
      }
      if (assignment.assistantId != null) {
        usedThisWeek.add(assignment.assistantId);
      }
    }

    const stats = buildStats(assignees, [
      ...workingWeeks,
      { ...week, assignments },
    ]);

    if (!(opts.preserveExisting && assignment.assigneeId != null) && !(assignment.isSpecial && assignment.assigneeId != null)) {
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
        ministryTotal,
        ministryCounts,
        talkSplit,
        treasuresSplit,
        livingSplit,
        bibleReadingSplit,
        opts,
        assignments,
        historicalWeeks,
        prayerSplit,
      });
      if (candidate) {
        assignment.assigneeId = candidate.id!;
        usedThisWeek.add(candidate.id!);
        if (assignment.segment === "ministry") {
          ministryTotal += 1;
          const cat = getMinistryCategory(candidate);
          if (cat !== "Sisters") {
            ministryCounts[cat] += 1;
          }
        }
        if (assignment.partType === "Talk") {
          tallyTalk(candidate, talkSplit);
        }
        if (assignment.partType === "Talk" || assignment.partType === "Spiritual Gems") {
          tallyTreasures(candidate, treasuresSplit);
        }
        if (assignment.partType === "Living Part") {
          tallyLiving(candidate, livingSplit);
        }
        if (assignment.partType === "Bible Reading") {
          tallyBibleReading(candidate, bibleReadingSplit);
        }
        if (assignment.partType === "Opening Prayer" || assignment.partType === "Closing Prayer") {
          tallyPrayer(candidate, prayerSplit);
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
      if (assignment.partType === "Living Part") {
        const person = assignees.find((p) => p.id === assignment.assigneeId);
        if (person) tallyLiving(person, livingSplit);
      }
      if (assignment.partType === "Bible Reading") {
        const person = assignees.find((p) => p.id === assignment.assigneeId);
        if (person) tallyBibleReading(person, bibleReadingSplit);
      }
      if (assignment.partType === "Opening Prayer" || assignment.partType === "Closing Prayer") {
        const person = assignees.find((p) => p.id === assignment.assigneeId);
        if (person) tallyPrayer(person, prayerSplit);
      }
    }

    // Secondary participant (householder / reader).
    if (needsAssistant(assignment.partType, opts.assignmentRules)) {
      if (!(opts.preserveExisting && assignment.assistantId != null) && !(assignment.isSpecial && assignment.assistantId != null)) {
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
          ministryTotal,
          ministryCounts,
          talkSplit,
          treasuresSplit,
          livingSplit,
          bibleReadingSplit,
          opts,
          assignments,
          historicalWeeks,
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
  ministryTotal: number;
  ministryCounts: { QE: number; E: number; QMS: number; MS: number; Brothers: number };
  talkSplit: TalkSplit;
  treasuresSplit: TreasuresSplit;
  livingSplit: LivingSplit;
  bibleReadingSplit: BibleReadingSplit;
  isMinorMain?: boolean;
  opts: AutoAssignOptions;
  assignments?: Assignment[];
  historicalWeeks: Week[];
  prayerSplit?: PrayerSplit;
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
    ministryTotal,
    ministryCounts,
    talkSplit,
    treasuresSplit,
    livingSplit,
    bibleReadingSplit,
    opts,
    assignments,
    historicalWeeks,
    prayerSplit,
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
    if (main && needsAssistant(part.partType, opts.assignmentRules)) {
      if (part.partType === "Congregation Bible Study") {
        genderFilter = "M"; // reader must be a brother too
      } else if ((opts.ruleSameSexDemogenders ?? "strict") !== "off") {
        genderFilter = main.gender; // same-sex demo pairings
      }
      isMinorMain = main.isMinor ?? false;
    }
  }

  let partnerIsMinor = false;
  if (role === "main" && part.assistantId != null) {
    const assistant = assignees.find((p) => p.id === part.assistantId);
    if (assistant) {
      partnerIsMinor = assistant.isMinor ?? false;
    }
  }


  // --- Check publisher availability for the midweek meeting ---
  const meetingDay = opts.midweekMeetingDay || "Thursday";
  const meetingDateStr = getMeetingDate(weekOf, meetingDay);

  let eligiblePool = assignees.filter((a) => {
    if (used.has(a.id ?? -1)) return false;
    
    if (genderFilter && a.gender !== genderFilter) {
      // Household exception for strict/strong same-sex rules
      const sameSexLevel = opts.ruleSameSexDemogenders ?? "strict";
      if (sameSexLevel !== "off" && part.partType !== "Congregation Bible Study" && mainId != null && opts.households) {
        const mainH = opts.households.find((h) => h.memberIds.includes(mainId));
        const assH = opts.households.find((h) => h.memberIds.includes(a.id!));
        if (mainH && assH && mainH.id === assH.id) {
          // opposite gender allowed since they are in the same household
        } else {
          return false;
        }
      } else {
        return false;
      }
    }

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
    const preventMinor = (opts.ruleMinorAssistantToAdult ?? "strict") === "strict";
    if (!isEligible(a, part.partType, role, "auto", opts.assignmentRules, isMinorMain, preventMinor, opts.customPartTypes, partnerIsMinor)) {
      return false;
    }

    // Main/Assistant pairing avoidance (Strict)
    if (role === "assistant" && mainId != null && opts.pairingAvoidance === "strict") {
      if (checkPairingViolation(mainId, a.id!, weekOf, historicalWeeks)) {
        return false;
      }
    }
    return true;
  });

  if (part.isSpecial && part.specialRequirements) {
    const req = part.specialRequirements.trim().toLowerCase();
    if (req === "parent and child" || req === "child and parent") {
      if (role === "main") {
        eligiblePool = eligiblePool.filter((a) =>
          meetsSpecialRequirement(a, part.specialRequirements!, opts.households, assignees)
        );
      } else if (role === "assistant" && mainId != null) {
        const main = assignees.find((p) => p.id === mainId);
        if (main && opts.households) {
          const mainH = opts.households.find((h) => h.memberIds.includes(mainId));
          const isMainParent = !!main.isHusband || !!main.isWife || !!main.isFather || !!main.isMother;
          const isMainChild = !!main.isMinor;
          eligiblePool = eligiblePool.filter((a) => {
            const inSameH = mainH ? mainH.memberIds.includes(a.id!) : false;
            if (!inSameH) return false;
            if (isMainParent) return !!a.isMinor;
            if (isMainChild) return !!a.isHusband || !!a.isWife || !!a.isFather || !!a.isMother;
            return false;
          });
        }
      }
    } else {
      if (role === "main") {
        eligiblePool = eligiblePool.filter((a) =>
          meetsSpecialRequirement(a, part.specialRequirements!, opts.households, assignees)
        );
      }
    }
  }

  // ── Hard constraint: minimum gap between main assignments ──────────
  const isUnifiedMinistry = (opts.ruleUnifiedMinistry ?? true) && part.segment === "ministry";
  if (isUnifiedMinistry) {
    if (minGapDays > 0 && (opts.ruleMinGap ?? "strict") === "strict") {
      const filtered = eligiblePool.filter((a) => {
        const s = stats.get(a.id!);
        if (!s || !s.lastWeekMinistry) return true;
        return daysBetween(s.lastWeekMinistry, weekOf) >= minGapDays;
      });
      if (filtered.length > 0) eligiblePool = filtered;
    }
  } else {
    if (role === "main" && minGapDays > 0 && (opts.ruleMinGap ?? "strict") === "strict") {
      const filtered = eligiblePool.filter((a) => {
        const s = stats.get(a.id!);
        if (!s || !s.lastWeekMain) return true;
        return daysBetween(s.lastWeekMain, weekOf) >= minGapDays;
      });
      if (filtered.length > 0) eligiblePool = filtered;
    }
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

  // ── Demonstration part constraints (limit total brother parts and adjacent weeks) ──
  const isDemonstrationPart =
    part.segment === "ministry" &&
    part.partType !== "Talk (Ministry)" &&
    !part.partType.toLowerCase().includes("talk");

  if (isDemonstrationPart) {
    const genderMap = new Map<number, "M" | "F">();
    for (const p of assignees) {
      if (p.id != null) {
        genderMap.set(p.id, p.gender);
      }
    }

    const isBrother = (id: number | undefined) => id != null && genderMap.get(id) === "M";

    const isFamilyPairing = (mainId: number | undefined, assistantId: number | undefined) => {
      if (mainId == null || assistantId == null || !opts.households) return false;
      return opts.households.some(
        (h) => h.memberIds.includes(mainId) && h.memberIds.includes(assistantId)
      );
    };

    const isBrotherPart = (mainId: number | undefined, assistantId: number | undefined) => {
      if (!isBrother(mainId) && !isBrother(assistantId)) return false;
      if (isFamilyPairing(mainId, assistantId)) return false;
      return true;
    };

    const currentMon = new Date(weekOf + "T00:00:00");
    const year = currentMon.getFullYear();
    const month = currentMon.getMonth();
    const otherWeeksInMonth = historicalWeeks.filter((w) => {
      if (w.weekOf === weekOf) return false;
      const wMon = new Date(w.weekOf + "T00:00:00");
      return wMon.getFullYear() === year && wMon.getMonth() === month;
    });

    // Compute all weeks in the calendar month to get total weeks count
    const weeksInMonth = [...otherWeeksInMonth];
    weeksInMonth.push({ weekOf, assignments: [] } as any);

    // 1. Monthly cap and weekly spacing constraints
    const maxBrothersMinistryParts = opts.maxBrothersMinistryPartsPerMonth ?? 0;
    if (maxBrothersMinistryParts > 0) {
      const maxBrothersMinistryPartsPerWeek = Math.ceil(maxBrothersMinistryParts / weeksInMonth.length);

      let brotherPartsInMonthCount = 0;
      let brotherPartsInCurrentWeekCount = 0;

      for (const w of otherWeeksInMonth) {
        for (const ass of w.assignments) {
          if (
            ass.segment === "ministry" &&
            ass.partType !== "Talk (Ministry)" &&
            !ass.partType.toLowerCase().includes("talk")
          ) {
            if (isBrotherPart(ass.assigneeId, ass.assistantId)) {
              brotherPartsInMonthCount++;
            }
          }
        }
      }

      if (assignments) {
        for (const ass of assignments) {
          if (ass.uid === part.uid) continue;
          if (
            ass.segment === "ministry" &&
            ass.partType !== "Talk (Ministry)" &&
            !ass.partType.toLowerCase().includes("talk")
          ) {
            if (isBrotherPart(ass.assigneeId, ass.assistantId)) {
              brotherPartsInMonthCount++;
              brotherPartsInCurrentWeekCount++;
            }
          }
        }
      }

      const filtered = eligiblePool.filter((a) => {
        if (a.gender !== "M") return true; // Female is always fine

        const nextMainId = role === "main" ? a.id : part.assigneeId;
        const nextAssistantId = role === "assistant" ? a.id : part.assistantId;
        const wouldBeBrotherPart = isBrotherPart(nextMainId, nextAssistantId);

        if (!wouldBeBrotherPart) return true;

        const withinMonthlyLimit = brotherPartsInMonthCount + 1 <= maxBrothersMinistryParts;
        if (!withinMonthlyLimit) return false;

        const withinWeeklyLimit = brotherPartsInCurrentWeekCount + 1 <= maxBrothersMinistryPartsPerWeek;
        if (!withinWeeklyLimit) return false;

        // Dynamic gap spacing between weeks containing brother parts
        const L = maxBrothersMinistryParts;
        const W = weeksInMonth.length;
        const minGapWeeks = L > 1 ? Math.floor((W - L) / (L - 1)) : 0;

        if (minGapWeeks > 0) {
          for (const w of otherWeeksInMonth) {
            const diffDays = Math.abs(daysBetween(w.weekOf, weekOf));
            const diffWeeks = Math.round(diffDays / 7);
            if (diffWeeks <= minGapWeeks) {
              const otherWeekHasBrother = w.assignments.some((ass) => {
                if (
                  ass.segment === "ministry" &&
                  ass.partType !== "Talk (Ministry)" &&
                  !ass.partType.toLowerCase().includes("talk")
                ) {
                  return isBrotherPart(ass.assigneeId, ass.assistantId);
                }
                return false;
              });
              if (otherWeekHasBrother) {
                return false;
              }
            }
          }
        }

        return true;
      });

      if (filtered.length > 0) eligiblePool = filtered;
    }

    // 2. Adjacent weeks constraint (Soft constraint)
    const adjacentWeeks = historicalWeeks.filter((w) => {
      if (w.weekOf === weekOf) return false;
      const diff = Math.abs(daysBetween(w.weekOf, weekOf));
      return diff > 0 && diff <= 7;
    });

    const filtered = eligiblePool.filter((a) => {
      if (a.gender !== "M") return true;

      const nextMainId = role === "main" ? a.id : part.assigneeId;
      const nextAssistantId = role === "assistant" ? a.id : part.assistantId;
      
      // If assigning a brother here is a family pairing, adjacent week restriction does not apply
      if (isFamilyPairing(nextMainId, nextAssistantId)) return true;

      const hasAdjacent = adjacentWeeks.some((w) =>
        w.assignments.some(
          (ass) =>
            ass.segment === "ministry" &&
            ass.partType !== "Talk (Ministry)" &&
            !ass.partType.toLowerCase().includes("talk") &&
            isBrotherPart(ass.assigneeId, ass.assistantId) &&
            (ass.assigneeId === a.id || ass.assistantId === a.id)
        )
      );
      return !hasAdjacent;
    });

    if (filtered.length > 0) eligiblePool = filtered;

    // 3. Avoid pioneer-to-pioneer pairings (Soft constraint)
    if (opts.ruleAvoidPioneerPairing) {
      const isPioneer = (p: Assignee) => p.privileges?.includes("RP");
      const otherRoleId = role === "main" ? part.assistantId : part.assigneeId;
      if (otherRoleId != null) {
        const otherPerson = assignees.find((p) => p.id === otherRoleId);
        if (otherPerson && isPioneer(otherPerson)) {
          const filtered = eligiblePool.filter((p) => !isPioneer(p));
          if (filtered.length > 0) eligiblePool = filtered;
        }
      }
    }
  }

  // ── Enforce ministry category shares as a hard cap ─────────────────
  if (part.segment === "ministry" && role === "main") {
    const categories: ("QE" | "E" | "QMS" | "MS" | "Brothers")[] = ["QE", "E", "QMS", "MS", "Brothers"];
    for (const cat of categories) {
      const shareSetting =
        cat === "QE"
          ? opts.shareMinistryQE ?? 0
          : cat === "E"
          ? opts.shareMinistryE ?? 0
          : cat === "QMS"
          ? opts.shareMinistryQMS ?? 0
          : cat === "MS"
          ? opts.shareMinistryMS ?? 0
          : opts.shareMinistryBrothers ?? 0;

      const projected = ministryTotal > 0 ? ministryCounts[cat] / ministryTotal : 0;
      const target = shareSetting / 100;
      if (projected >= target) {
        const filtered = eligiblePool.filter((a) => getMinistryCategory(a) !== cat);
        if (filtered.length > 0) {
          eligiblePool = filtered;
        }
      }
    }
  }

  // ── Chairman rotation constraint ───────────────────────────────────
  if (part.partType === "Chairman" && (opts.ruleChairmanGap ?? "strict") === "strict") {
    const freshCandidates = eligiblePool.filter((a) => {
      const s = stats.get(a.id!) || { lastWeekChairman: undefined };
      if (!s.lastWeekChairman) return true;
      return daysBetween(s.lastWeekChairman, weekOf) >= chairmanGapDays;
    });
    if (freshCandidates.length > 0) {
      eligiblePool = freshCandidates;
    }
  }

  // ── Hard constraint: prevent assistant role if they had a recent main part last week ──
  if (role === "assistant" && (opts.ruleMainToAssistantConsecutive ?? "medium") === "strict") {
    const filtered = eligiblePool.filter((a) => {
      const s = stats.get(a.id!);
      if (!s || !s.lastWeekMain) return true;
      const gap = daysBetween(s.lastWeekMain, weekOf);
      return gap >= 14;
    });
    if (filtered.length > 0) eligiblePool = filtered;
  }

  // ── Hard constraint: prevent assistant twice in a row (part of Role Alternation) ──
  if (role === "assistant" && (opts.ruleRoleAlternation ?? "strong") === "strict") {
    const filtered = eligiblePool.filter((a) => {
      const s = stats.get(a.id!);
      if (!s || !s.lastWeekAssistant) return true;
      const lastMain = s.lastWeekMain;
      const lastAsst = s.lastWeekAssistant;
      const wasLastAssistant = lastAsst && (!lastMain || lastAsst > lastMain);
      return !wasLastAssistant;
    });
    if (filtered.length > 0) eligiblePool = filtered;
  }

  // ── Hard constraint: ministry segment role alternation ─────────────
  if ((role === "main" || role === "assistant") && (opts.ruleRoleAlternation ?? "strong") === "strict") {
    if (part.segment === "ministry") {
      const filtered = eligiblePool.filter((a) => {
        const s = stats.get(a.id!);
        if (!s || s.lastMinistryRole === undefined) return true;
        return s.lastMinistryRole !== role;
      });
      if (filtered.length > 0) eligiblePool = filtered;
    }
  }

  // ── Hard constraint: strict category rotation for prayers ───────────
  if ((part.partType === "Opening Prayer" || part.partType === "Closing Prayer") && (opts.rulePrayerRotation ?? "medium") === "strict") {
    const finalFilteredPool: Assignee[] = [];
    const categories: ("QE" | "E" | "QMS" | "MS" | "Non-Privileged")[] = ["QE", "E", "QMS", "MS", "Non-Privileged"];
    
    for (const cat of categories) {
      const catPool = eligiblePool.filter((a) => getPrayerCategory(a) === cat);
      if (catPool.length === 0) continue;
      
      const oldestDateStr = catPool.reduce((min, a) => {
        const s = stats.get(a.id!);
        const date = s?.lastWeekPrayer || "1970-01-01";
        return date < min ? date : min;
      }, "9999-99-99");
      
      const catFiltered = catPool.filter((a) => {
        const s = stats.get(a.id!);
        const date = s?.lastWeekPrayer || "1970-01-01";
        return date === oldestDateStr;
      });
      finalFilteredPool.push(...catFiltered);
    }
    if (finalFilteredPool.length > 0) {
      eligiblePool = finalFilteredPool;
    }
  }

  if (eligiblePool.length === 0) return null;

  return rankAndPick(
    eligiblePool,
    part,
    weekOf,
    stats,
    seed,
    talkSplit,
    treasuresSplit,
    livingSplit,
    bibleReadingSplit,
    role,
    opts,
    isMinorMain,
    assignments,
    historicalWeeks,
    assignees,
    prayerSplit
  );
}

function rankAndPick(
  pool: Assignee[],
  part: Assignment,
  weekOf: string,
  stats: Map<number, AssigneeStats>,
  seed: number,
  talkSplit: TalkSplit,
  treasuresSplit: TreasuresSplit,
  livingSplit: LivingSplit,
  bibleReadingSplit: BibleReadingSplit,
  role: "main" | "assistant",
  opts: AutoAssignOptions,
  isMinorMain?: boolean,
  assignments?: Assignment[],
  historicalWeeks?: Week[],
  allAssignees?: Assignee[],
  prayerSplit?: PrayerSplit
): Assignee {
  const empty: AssigneeStats = {
    totalMain: 0,
    bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
    totalAssistant: 0,
    recentMainDates: [],
    recentAssistantDates: [],
    recentMainDatesBySegment: { opening: [], treasures: [], ministry: [], living: [] },
    recentPrayerDates: [],
    lastMinistryRole: undefined,
    lastPartWasWithMinor: false,
    lastWeekMinistry: undefined,
    recentMinistryDates: [],
  };

  const { partnerIsMinor, partnerLastPartWasWithMinor } = allAssignees
    ? getPartnerInfo(part, role, allAssignees, stats)
    : {};

  const getScore = (candidate: Assignee, s: AssigneeStats) => {
    let score = scoreCandidate(
      candidate,
      part,
      weekOf,
      s,
      seed,
      talkSplit,
      treasuresSplit,
      livingSplit,
      bibleReadingSplit,
      role,
      opts,
      isMinorMain,
      partnerIsMinor,
      partnerLastPartWasWithMinor,
      prayerSplit
    );

    // Apply prayer category rotation penalty
    const prayerRotationLevel = opts.rulePrayerRotation ?? "medium";
    if ((part.partType === "Opening Prayer" || part.partType === "Closing Prayer") && prayerRotationLevel !== "off") {
      const cat = getPrayerCategory(candidate);
      const candidateDate = s.lastWeekPrayer || "1970-01-01";
      const compareList = allAssignees || pool;
      const activeInCat = compareList.filter((other) =>
        other.active &&
        !other.archived &&
        getPrayerCategory(other) === cat &&
        other.id !== candidate.id
      );

      let olderCount = 0;
      for (const other of activeInCat) {
        const otherStats = stats.get(other.id!);
        const otherDate = otherStats?.lastWeekPrayer || "1970-01-01";
        if (otherDate < candidateDate) {
          olderCount++;
        }
      }

      if (olderCount > 0) {
        const penalty = prayerRotationLevel === "weak" ? 100 :
                        prayerRotationLevel === "medium" ? 1000 :
                        prayerRotationLevel === "strong" ? 10000 : 0;
        score -= olderCount * penalty;
      }
    }

    // Apply household different assignments penalty
    if (assignments && opts.households && candidate.id != null) {
      const h = opts.households.find((h) => h.memberIds.includes(candidate.id!));
      if (h) {
        const hasClash = assignments.some((ass) => {
          if (ass.uid === part.uid) return false; // same part is fine

          const isAssigneeClash = ass.assigneeId != null && ass.assigneeId !== candidate.id && h.memberIds.includes(ass.assigneeId);
          const isAssistantClash = ass.assistantId != null && ass.assistantId !== candidate.id && h.memberIds.includes(ass.assistantId);

          return isAssigneeClash || isAssistantClash;
        });

        if (hasClash) {
          score -= 40; // Discourage assigning another family member to a different part in the same week
        }
      }
    }

    // Apply pairing avoidance penalty in soft constraint mode
    const mainId = part.assigneeId;
    const avoidanceLevel = opts.pairingAvoidance || "strict";
    if (role === "assistant" && mainId != null && avoidanceLevel !== "off" && avoidanceLevel !== "strict" && candidate.id != null && historicalWeeks) {
      if (checkPairingViolation(mainId, candidate.id, weekOf, historicalWeeks)) {
        const penalty = avoidanceLevel === "weak" ? 100 : avoidanceLevel === "medium" ? 250 : 500;
        score -= penalty;
      }
    }
    return score;
  };

  const ranked = [...pool].sort((a, b) => {
    const sa = stats.get(a.id!) ?? empty;
    const sb = stats.get(b.id!) ?? empty;
    return getScore(b, sb) - getScore(a, sa);
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
        recentMainDatesBySegment: { opening: [], treasures: [], ministry: [], living: [] },
        recentPrayerDates: [],
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
  const livingSplit = buildLivingSplit(assignees, workingWeeks);
  const bibleReadingSplit = buildBibleReadingSplit(assignees, workingWeeks);
  const prayerSplit = buildPrayerSplit(assignees, workingWeeks);
  const stats = buildStats(assignees, workingWeeks);

  const skipped = week.skippedOptimizations ?? [];
  const isSkipped = (uid: string, role: "main" | "assistant", suggestedId: number) => {
    return skipped.some(s => s.uid === uid && s.role === role && s.suggestedAssigneeId === suggestedId);
  };
 
  const usedMainsThisWeek = new Set<number>();
  let ministryTotal = 0;
  const ministryCounts = { QE: 0, E: 0, QMS: 0, MS: 0, Brothers: 0 };
 
  for (const a of week.assignments) {
    if (a.assigneeId != null) usedMainsThisWeek.add(a.assigneeId);
    if (a.segment === "ministry" && a.assigneeId != null) {
      ministryTotal += 1;
      const p = assignees.find((x) => x.id === a.assigneeId);
      if (p) {
        const cat = getMinistryCategory(p);
        if (cat !== "Sisters") {
          ministryCounts[cat] += 1;
        }
      }
    }
  }
 
  for (const a of week.assignments) {
    if (a.isSpecial) continue;
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
          totalAssistant: 0, recentMainDates: [],
          recentMainDatesBySegment: { opening: [], treasures: [], ministry: [], living: [] },
          recentPrayerDates: [],
          recentMinistryDates: [],
        };
        const { partnerIsMinor, partnerLastPartWasWithMinor } = getPartnerInfo(a, "main", assignees, stats);
        const currentScore = scoreCandidate(
          currentPerson, a, week.weekOf, s, seed, talkSplit, treasuresSplit, livingSplit, bibleReadingSplit, "main", opts,
          undefined, partnerIsMinor, partnerLastPartWasWithMinor,
          prayerSplit
        );
 
        const best = pickCandidate({
          part: a, role: "main", assignees, stats, weekOf: week.weekOf, seed, used: usedForPick,
          ministryTotal, ministryCounts, talkSplit, treasuresSplit, livingSplit, bibleReadingSplit, opts,
          assignments: week.assignments,
          historicalWeeks,
          prayerSplit,
        });
 
        if (best && best.id !== currentPerson.id) {
          const bestStats = stats.get(best.id!) ?? {
            totalMain: 0, bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
            totalAssistant: 0, recentMainDates: [],
            recentMainDatesBySegment: { opening: [], treasures: [], ministry: [], living: [] },
            recentPrayerDates: [],
            recentMinistryDates: [],
          };
          const bestScore = scoreCandidate(
            best, a, week.weekOf, bestStats, seed, talkSplit, treasuresSplit, livingSplit, bibleReadingSplit, "main", opts,
            undefined, partnerIsMinor, partnerLastPartWasWithMinor,
            prayerSplit
          );
 
          const threshold = opts.optimizationThresholdMain ?? 50;
          if (bestScore - currentScore > threshold && !isSkipped(a.uid, "main", best.id!)) {
            suggestions.push({
              uid: a.uid, partType: a.partType, role: "main", currentAssigneeId: currentPerson.id, currentScore,
              suggestedAssigneeId: best.id!, suggestedScore: bestScore,
              reason: `Strongly recommended (score +${Math.round(bestScore - currentScore)})`,
            });
          }
        }
      }
    }
 
    if (needsAssistant(a.partType, opts.assignmentRules) && a.assistantId != null) {
      const currentAssistant = assignees.find((x) => x.id === a.assistantId);
      if (currentAssistant) {
        const usedForAssistant = new Set([...usedMainsThisWeek]);
        if (a.assigneeId != null) usedForAssistant.add(a.assigneeId);
        usedForAssistant.delete(a.assistantId);
 
        const isMinorMain = assignees.find((x) => x.id === a.assigneeId)?.isMinor;
        const s = stats.get(currentAssistant.id!) ?? {
          totalMain: 0, bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
          totalAssistant: 0, recentMainDates: [],
          recentMainDatesBySegment: { opening: [], treasures: [], ministry: [], living: [] },
          recentPrayerDates: [],
          recentMinistryDates: [],
        };
 
        const { partnerIsMinor, partnerLastPartWasWithMinor } = getPartnerInfo(a, "assistant", assignees, stats);
        const currentScore = scoreCandidate(
          currentAssistant, a, week.weekOf, s, seed + 1, talkSplit, treasuresSplit, livingSplit, bibleReadingSplit, "assistant", opts, isMinorMain,
          partnerIsMinor, partnerLastPartWasWithMinor,
          prayerSplit
        );
 
        const bestAss = pickCandidate({
          part: a, role: "assistant", assignees, stats, weekOf: week.weekOf, seed: seed + 1, used: usedForAssistant,
          ministryTotal, ministryCounts, talkSplit, treasuresSplit, livingSplit, bibleReadingSplit, opts, isMinorMain,
          assignments: week.assignments,
          historicalWeeks,
          prayerSplit,
        });
 
        if (bestAss && bestAss.id !== currentAssistant.id) {
          const bestAssStats = stats.get(bestAss.id!) ?? {
            totalMain: 0, bySegmentMain: { opening: 0, treasures: 0, ministry: 0, living: 0 },
            totalAssistant: 0, recentMainDates: [],
            recentMainDatesBySegment: { opening: [], treasures: [], ministry: [], living: [] },
            recentPrayerDates: [],
            recentMinistryDates: [],
          };
          const bestScore = scoreCandidate(
            bestAss, a, week.weekOf, bestAssStats, seed + 1, talkSplit, treasuresSplit, livingSplit, bibleReadingSplit, "assistant", opts, isMinorMain,
            partnerIsMinor, partnerLastPartWasWithMinor,
            prayerSplit
          );
 
          const threshold = opts.optimizationThresholdAssistant ?? 40;
          if (bestScore - currentScore > threshold && !isSkipped(a.uid, "assistant", bestAss.id!)) {
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

export function getWeeksInCalendarMonth(currentWeekOf: string, allWeeks: Week[]): Week[] {
  const currentMon = new Date(currentWeekOf + "T00:00:00");
  const year = currentMon.getFullYear();
  const month = currentMon.getMonth(); // 0-based

  return allWeeks.filter((w) => {
    const wMon = new Date(w.weekOf + "T00:00:00");
    return wMon.getFullYear() === year && wMon.getMonth() === month;
  }).sort((a, b) => a.weekOf.localeCompare(b.weekOf));
}

export function getWeeksInWorkbookPeriod(currentWeekOf: string, allWeeks: Week[]): Week[] {
  const currentPeriod = workbookPeriod(currentWeekOf).key;
  return allWeeks.filter((w) => {
    return workbookPeriod(w.weekOf).key === currentPeriod;
  }).sort((a, b) => a.weekOf.localeCompare(b.weekOf));
}

export interface PeriodOptimizationResult {
  week: Week;
  suggestions: OptimizationSuggestion[];
}

export function analyzePeriodOptimization(
  weeks: Week[],
  assignees: Assignee[],
  historicalWeeks: Week[],
  opts: AutoAssignOptions
): PeriodOptimizationResult[] {
  return weeks.map((week) => {
    const suggestions = analyzeWeekOptimization(week, assignees, historicalWeeks, opts);
    return {
      week,
      suggestions,
    };
  });
}

