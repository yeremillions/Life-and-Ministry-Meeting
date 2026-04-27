import {
  Assignee,
  Assignment,
  PartType,
  Privilege,
  SegmentId,
  AssignmentRule,
  DEFAULT_ASSIGNMENT_RULES,
} from "./types";

export const SEGMENTS: {
  id: SegmentId;
  label: string;
  color: string;
  /** Tailwind accent class for highlighting the segment. */
  accent: string;
}[] = [
  {
    id: "opening",
    label: "Opening",
    color: "#546e7a",
    accent: "opening",
  },
  {
    id: "treasures",
    label: "Treasures From God's Word",
    color: "#006064",
    accent: "treasures",
  },
  {
    id: "ministry",
    label: "Apply Yourself to the Field Ministry",
    color: "#c4952a",
    accent: "ministry",
  },
  {
    id: "living",
    label: "Living as Christians",
    color: "#7b1928",
    accent: "living",
  },
];

export function segmentOf(id: SegmentId) {
  return SEGMENTS.find((s) => s.id === id)!;
}

/** Which part types belong to each segment in the picker. */
export const SEGMENT_PART_TYPES: Record<SegmentId, PartType[]> = {
  opening: ["Chairman", "Opening Prayer"],
  treasures: ["Talk", "Spiritual Gems", "Bible Reading"],
  ministry: [
    "Starting a Conversation",
    "Following Up",
    "Making Disciples",
    "Explaining Your Beliefs",
    "Initial Call",
    "Talk (Ministry)",
  ],
  living: [
    "Living Part",
    "Local Needs",
    "Governing Body Update",
    "Congregation Bible Study",
    "Closing Prayer",
    "Video",
  ],
};

/** Is this assignee an appointed brother (E / QE / MS / QMS)?
 *  RP is a designation, not a congregation appointment, so it
 *  doesn't count here. */
export function isPrivileged(a: Assignee): boolean {
  return (
    a.privileges.includes("E") ||
    a.privileges.includes("QE") ||
    a.privileges.includes("MS") ||
    a.privileges.includes("QMS")
  );
}

export function hasPrivilege(a: Assignee, p: Privilege): boolean {
  return a.privileges.includes(p);
}

export function isElderLike(a: Assignee): boolean {
  return hasPrivilege(a, "E") || hasPrivilege(a, "QE");
}

export function isMSorAbove(a: Assignee): boolean {
  return (
    hasPrivilege(a, "E") ||
    hasPrivilege(a, "QE") ||
    hasPrivilege(a, "MS") ||
    hasPrivilege(a, "QMS")
  );
}

/**
 * Apply implication rules to a privilege list:
 *   - QE  implies E   (every QE is also an E)
 *   - QMS implies MS  (every QMS is also an MS)
 *
 * The reverse is *not* true. Use this whenever privileges are read from
 * user input or imported from a file before storing them.
 */
export function normalizePrivileges(privs: Privilege[]): Privilege[] {
  const set = new Set(privs);
  if (set.has("QE")) set.add("E");
  if (set.has("QMS")) set.add("MS");
  // Stable canonical ordering for display.
  const order: Privilege[] = ["E", "QE", "MS", "QMS", "RP", "CBSR"];
  return order.filter((p) => set.has(p));
}

/** Does this part type involve a second participant? */
export function needsAssistant(partType: PartType): boolean {
  return (
    partType === "Starting a Conversation" ||
    partType === "Following Up" ||
    partType === "Making Disciples" ||
    partType === "Explaining Your Beliefs" ||
    partType === "Initial Call" ||
    partType === "Congregation Bible Study"
  );
}

/** True if this part must be given to a male enrollee. */
export function isBrothersPart(partType: PartType): boolean {
  switch (partType) {
    case "Chairman":
    case "Opening Prayer":
    case "Closing Prayer":
    case "Talk":
    case "Spiritual Gems":
    case "Bible Reading":
    case "Talk (Ministry)":
    case "Living Part":
    case "Local Needs":
    case "Governing Body Update":
    case "Congregation Bible Study":
      return true;
    case "Video":
      return false;
    default:
      return false;
  }
}

/**
 * Hard eligibility check for the main assignee.
 *
 * The rules here intentionally err on the side of being permissive; the
 * scheduler's scoring function expresses the finer preferences (e.g.
 * preferring non-privileged brothers for Living-as-Christians talks).
 */
export function isEligible(
  a: Assignee,
  partType: PartType,
  role: "main" | "assistant" = "main",
  purpose: "auto" | "manual" = "manual",
  rules: Record<string, AssignmentRule> = DEFAULT_ASSIGNMENT_RULES
): boolean {
  if (!a.active) return false;

  const rule = rules[partType] || DEFAULT_ASSIGNMENT_RULES[partType];
  if (!rule) return false;

  // Individual restrictions (e.g. ill health, investigation)
  if (a.allowedParts && !a.allowedParts.includes(partType)) {
    return false;
  }

  const target = role === "assistant" && rule.assistant ? rule.assistant : rule;

  // Gender check
  if (!target.allowedGenders.includes(a.gender)) return false;

  // Baptism check
  if (target.mustBeBaptized && !a.baptised) return false;

  // Privilege check
  if (target.requiredPrivileges.length > 0) {
    const hasAny = target.requiredPrivileges.some((p) => a.privileges.includes(p));
    if (!hasAny) return false;
  }

  // Specific hardcoded overrides that are harder to represent in simple rules
  // but could eventually be moved too.
  if (partType === "Opening Prayer" || partType === "Closing Prayer") {
    if (purpose === "auto") {
      // In auto-assign, we prefer MS/E/CBSR for prayers.
      return isMSorAbove(a) || a.privileges.includes("CBSR");
    }
  }

  if (partType === "Video") return false;

  return true;
}

/**
 * Short pill label for an assignee's most specific privilege.
 *
 * Because QE implies E (and QMS implies MS), we report the *more
 * specific* tag when both are present so the badge is meaningful.
 */
export function privilegeLabel(a: Assignee): string | null {
  if (a.privileges.includes("QE")) return "QE";
  if (a.privileges.includes("E")) return "E";
  if (a.privileges.includes("QMS")) return "QMS";
  if (a.privileges.includes("MS")) return "MS";
  if (a.privileges.includes("RP")) return "RP";
  if (a.privileges.includes("CBSR")) return "CBSR";
  return null;
}

/**
 * Sort assignments by segment (Opening -> Treasures -> Ministry -> Living)
 * and then by their relative order within the segment.
 */
export function byOrder(a: { segment: SegmentId; order: number }, b: { segment: SegmentId; order: number }) {
  const SEG_ORDER: SegmentId[] = ["opening", "treasures", "ministry", "living"];
  const seg = (s: SegmentId) => SEG_ORDER.indexOf(s);
  const sd = seg(a.segment) - seg(b.segment);
  if (sd !== 0) return sd;
  return a.order - b.order;
}

/**
 * Ensure a week's assignments include the standard "fixed" parts.
 * If they are missing (e.g. after a partial workbook parse), they are added.
 */
export function ensureRequiredParts(
  assignments: Assignment[],
  generateUid: () => string
): Assignment[] {
  const result = [...assignments];
  const has = (seg: SegmentId, type: PartType) =>
    result.some((a) => a.segment === seg && a.partType === type);

  // Opening Segment
  if (!has("opening", "Chairman")) {
    result.push({
      uid: generateUid(),
      segment: "opening",
      order: -2,
      partType: "Chairman",
      title: "",
    });
  }
  if (!has("opening", "Opening Prayer")) {
    result.push({
      uid: generateUid(),
      segment: "opening",
      order: -1,
      partType: "Opening Prayer",
      title: "",
    });
  }

  // Treasures Segment
  if (!has("treasures", "Talk")) {
    result.push({
      uid: generateUid(),
      segment: "treasures",
      order: 1,
      partType: "Talk",
      title: "",
    });
  }
  if (!has("treasures", "Spiritual Gems")) {
    result.push({
      uid: generateUid(),
      segment: "treasures",
      order: 2,
      partType: "Spiritual Gems",
      title: "",
    });
  }
  if (!has("treasures", "Bible Reading")) {
    result.push({
      uid: generateUid(),
      segment: "treasures",
      order: 3,
      partType: "Bible Reading",
      title: "",
    });
  }

  // Living Segment
  const talks = result.filter(
    (a) =>
      a.segment === "living" &&
      ["Living Part", "Local Needs", "Governing Body Update"].includes(a.partType)
  );
  if (talks.length === 0) {
    result.push({
      uid: generateUid(),
      segment: "living",
      order: 10,
      partType: "Living Part",
      title: "",
    });
  }
  if (!has("living", "Congregation Bible Study")) {
    result.push({
      uid: generateUid(),
      segment: "living",
      order: 98,
      partType: "Congregation Bible Study",
      title: "",
    });
  }
  if (!has("living", "Closing Prayer")) {
    result.push({
      uid: generateUid(),
      segment: "living",
      order: 99,
      partType: "Closing Prayer",
      title: "",
    });
  }

  // Final sort and canonical integer ordering
  return result.sort(byOrder).map((a, i) => ({ ...a, order: i }));
}
