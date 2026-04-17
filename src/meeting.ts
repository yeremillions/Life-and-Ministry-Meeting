import type {
  Assignee,
  PartType,
  Privilege,
  SegmentId,
} from "./types";

export const SEGMENTS: {
  id: SegmentId;
  label: string;
  color: string;
  /** Tailwind accent class for highlighting the segment. */
  accent: string;
}[] = [
  {
    id: "treasures",
    label: "Treasures From God's Word",
    color: "#b8860b",
    accent: "treasures",
  },
  {
    id: "ministry",
    label: "Apply Yourself to the Field Ministry",
    color: "#d9581f",
    accent: "ministry",
  },
  {
    id: "living",
    label: "Living as Christians",
    color: "#2f855a",
    accent: "living",
  },
];

export function segmentOf(id: SegmentId) {
  return SEGMENTS.find((s) => s.id === id)!;
}

/** Which part types belong to each segment in the picker. */
export const SEGMENT_PART_TYPES: Record<SegmentId, PartType[]> = {
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
  const order: Privilege[] = ["E", "QE", "MS", "QMS", "RP"];
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
    case "Talk":
    case "Spiritual Gems":
    case "Bible Reading":
    case "Talk (Ministry)":
    case "Living Part":
    case "Local Needs":
    case "Governing Body Update":
    case "Congregation Bible Study":
      return true;
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
  role: "main" | "assistant" = "main"
): boolean {
  if (!a.active) return false;

  const brothersOnly = isBrothersPart(partType);
  if (brothersOnly && a.gender !== "M") return false;

  switch (partType) {
    case "Talk": // Treasures opening talk — elders (sometimes MS)
      return a.gender === "M" && isMSorAbove(a) && a.baptised;

    case "Spiritual Gems":
      return a.gender === "M" && isMSorAbove(a) && a.baptised;

    case "Bible Reading":
      return a.gender === "M" && a.baptised;

    case "Talk (Ministry)":
      return a.gender === "M" && a.baptised;

    case "Living Part":
    case "Local Needs":
    case "Governing Body Update":
      // Usually given to elders / MS, but any baptised brother can fill in.
      return a.gender === "M" && a.baptised;

    case "Congregation Bible Study":
      if (role === "main") {
        // Conductor: elder (preferred) or MS.
        return a.gender === "M" && isMSorAbove(a) && a.baptised;
      }
      // Reader: any baptised brother.
      return a.gender === "M" && a.baptised;

    case "Starting a Conversation":
    case "Following Up":
    case "Making Disciples":
    case "Explaining Your Beliefs":
    case "Initial Call":
      // Demo parts can be taken by anyone baptised or unbaptised who is
      // enrolled as a publisher. We don't gate on baptism here because
      // unbaptised publishers may take these. Pairing rules (same-sex,
      // household) are left to the user to confirm.
      return true;
  }
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
  return null;
}
