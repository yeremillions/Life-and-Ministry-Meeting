/**
 * Data model for the Life and Ministry Meeting scheduler.
 *
 * Everything is stored locally in IndexedDB via Dexie.
 */

export type Gender = "M" | "F";

/**
 * Privileges / designations.
 * - E   = Elder
 * - QE  = Qualified (to be) Elder
 * - MS  = Ministerial Servant
 * - QMS = Qualified (to be) Ministerial Servant
 * - RP  = Regular Pioneer (can be held by brothers or sisters)
 */
export type Privilege = "E" | "QE" | "MS" | "QMS" | "RP" | "CBSR";

export interface Assignee {
  id?: number;
  name: string;
  gender: Gender;
  /** Is this person a baptised publisher? (applies to brothers for eligibility) */
  baptised: boolean;
  privileges: Privilege[];
  /** If false, person is skipped by the auto-assigner. */
  active: boolean;
  /** True when the enrollee is under 18. The auto-assigner prefers adult assistants for minors. */
  isMinor?: boolean;
  /** Optional free-form notes (e.g. availability, pairing preferences). */
  notes?: string;
  /** If present, the person can ONLY be assigned these specific part types. */
  allowedParts?: PartType[];
  /** Categorized restriction for frequency throttling and defaults. */
  restrictionType?: "infirmed" | "elderly" | "investigation" | "none" | "custom";
  createdAt: number;
}

/** Which segment an assignment belongs to. */
export type SegmentId = "opening" | "treasures" | "ministry" | "living";

/**
 * Catalog of supported assignment types per segment. The title on the
 * actual schedule can differ week to week (e.g. the Treasures opening
 * talk title), but the part *type* is fixed.
 */
export type PartType =
  // Opening
  | "Chairman"
  | "Opening Prayer"
  // Closing
  | "Closing Prayer"
  // Treasures
  | "Talk" // 10-min opening talk
  | "Spiritual Gems"
  | "Bible Reading"
  // Apply Yourself to the Field Ministry
  | "Starting a Conversation"
  | "Following Up"
  | "Making Disciples"
  | "Explaining Your Beliefs"
  | "Initial Call"
  | "Talk (Ministry)"
  // Living as Christians
  | "Living Part"
  | "Local Needs"
  | "Governing Body Update"
  | "Congregation Bible Study"
  | "Video";

export interface Assignment {
  /** Stable id within a week so UI can reorder without re-keying. */
  uid: string;
  segment: SegmentId;
  /** 1-indexed position within the meeting (1 = Treasures #1 talk). */
  order: number;
  partType: PartType;
  /** Human title, e.g. "Do Not Be Anxious About Tomorrow". */
  title: string;
  assigneeId?: number;
  /**
   * For Apply Yourself demonstrations & Congregation Bible Study reader,
   * a secondary participant can be assigned.
   */
  assistantId?: number;
  /** Any scheduler notes. */
  note?: string;
}

export interface Week {
  id?: number;
  /** ISO date (YYYY-MM-DD) of the Monday that the meeting week begins. */
  weekOf: string;
  /** The Bible reading reference (weekly), optional. */
  weeklyBibleReading?: string;
  assignments: Assignment[];
  locked?: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * A household groups enrollees who live together (or are family members).
 * Members of the same household may be paired as main/assistant in Apply
 * Yourself parts even if they are of different genders.
 */
export interface Household {
  id?: number;
  /** Display name, e.g. "Smith Family" */
  name: string;
  /** IDs of Assignee records that belong to this household. */
  memberIds: number[];
  createdAt: number;
}

/** Represents an entry in the application change log. */
export interface LogEntry {
  id?: number;
  timestamp: number;
  category: "settings" | "schedule" | "enrollees" | "system";
  action: string;
  details?: string;
}

export interface AppSettings {
  id: "app";
  /**
   * Percentage (0-100) of the time elders / MS should be preferred for
   * field-ministry (segment 2) parts. Default is 10%, matching the spec.
   */
  privilegedMinistryShare: number;
  /** Congregation name for report headers, etc. */
  congregationName?: string;

  // ── Scheduler fairness knobs ──────────────────────────────────────────

  /**
   * Minimum number of weeks that must pass before the same person can
   * receive another main assignment. Default 2.
   */
  minGapWeeks?: number;

  /**
   * Minimum number of weeks between Chairman assignments for the same
   * elder. Default 3.
   */
  chairmanGapWeeks?: number;

  /**
   * How aggressively to prioritise neglected publishers.
   * 1 = equal rotation (default — no special treatment, they simply
   *     join the normal pool alongside everyone else).
   * 3 = moderate catch-up (gives them a noticeable boost).
   * 5 = aggressive catch-up (fast-tracks them to the front).
   */
  catchUpIntensity?: number;

  /**
   * Maximum number of main assignments a person may receive in a
   * rolling 4-week period. 0 = no limit. Default 2.
   */
  maxAssignmentsPerMonth?: number;
  /** Minimum score difference to trigger a main role optimization suggestion. Default 50. */
  optimizationThresholdMain?: number;
  /** Minimum score difference to trigger an assistant role optimization suggestion. Default 40. */
  optimizationThresholdAssistant?: number;
  /** Custom eligibility rules for each part type. */
  assignmentRules: Record<string, AssignmentRule>;
}

export interface AssignmentRule {
  allowedGenders: Gender[];
  /** If empty, no specific privilege is required. */
  requiredPrivileges: Privilege[];
  mustBeBaptized: boolean;
  /** Rules for the assistant role (if applicable). */
  assistant?: {
    allowedGenders: Gender[];
    requiredPrivileges: Privilege[];
    mustBeBaptized: boolean;
  };
}

export const DEFAULT_ASSIGNMENT_RULES: Record<string, AssignmentRule> = {
  Chairman: {
    allowedGenders: ["M"],
    requiredPrivileges: ["QE"],
    mustBeBaptized: true,
  },
  "Opening Prayer": {
    allowedGenders: ["M"],
    requiredPrivileges: [],
    mustBeBaptized: true,
  },
  "Closing Prayer": {
    allowedGenders: ["M"],
    requiredPrivileges: [],
    mustBeBaptized: true,
  },
  Talk: {
    allowedGenders: ["M"],
    requiredPrivileges: ["MS", "QMS", "E", "QE"],
    mustBeBaptized: true,
  },
  "Spiritual Gems": {
    allowedGenders: ["M"],
    requiredPrivileges: ["MS", "QMS", "E", "QE"],
    mustBeBaptized: true,
  },
  "Bible Reading": {
    allowedGenders: ["M"],
    requiredPrivileges: [],
    mustBeBaptized: false,
  },
  "Starting a Conversation": {
    allowedGenders: ["M", "F"],
    requiredPrivileges: [],
    mustBeBaptized: false,
    assistant: {
      allowedGenders: ["M", "F"],
      requiredPrivileges: [],
      mustBeBaptized: false,
    },
  },
  "Following Up": {
    allowedGenders: ["M", "F"],
    requiredPrivileges: [],
    mustBeBaptized: false,
    assistant: {
      allowedGenders: ["M", "F"],
      requiredPrivileges: [],
      mustBeBaptized: false,
    },
  },
  "Making Disciples": {
    allowedGenders: ["M", "F"],
    requiredPrivileges: [],
    mustBeBaptized: false,
    assistant: {
      allowedGenders: ["M", "F"],
      requiredPrivileges: [],
      mustBeBaptized: false,
    },
  },
  "Explaining Your Beliefs": {
    allowedGenders: ["M", "F"],
    requiredPrivileges: [],
    mustBeBaptized: false,
    assistant: {
      allowedGenders: ["M", "F"],
      requiredPrivileges: [],
      mustBeBaptized: false,
    },
  },
  "Initial Call": {
    allowedGenders: ["M", "F"],
    requiredPrivileges: [],
    mustBeBaptized: false,
    assistant: {
      allowedGenders: ["M", "F"],
      requiredPrivileges: [],
      mustBeBaptized: false,
    },
  },
  "Talk (Ministry)": {
    allowedGenders: ["M"],
    requiredPrivileges: [],
    mustBeBaptized: true,
  },
  "Living Part": {
    allowedGenders: ["M"],
    requiredPrivileges: ["MS", "QMS", "E", "QE"],
    mustBeBaptized: true,
  },
  "Local Needs": {
    allowedGenders: ["M"],
    requiredPrivileges: ["E", "QE"],
    mustBeBaptized: true,
  },
  "Governing Body Update": {
    allowedGenders: ["M"],
    requiredPrivileges: ["E", "QE"],
    mustBeBaptized: true,
  },
  "Congregation Bible Study": {
    allowedGenders: ["M"],
    requiredPrivileges: ["QE"],
    mustBeBaptized: true,
    assistant: {
      allowedGenders: ["M"],
      requiredPrivileges: ["CBSR"],
      mustBeBaptized: false,
    },
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  id: "app",
  privilegedMinistryShare: 10,
  congregationName: "",
  minGapWeeks: 2,
  chairmanGapWeeks: 3,
  catchUpIntensity: 1,
  maxAssignmentsPerMonth: 2,
  optimizationThresholdMain: 50,
  optimizationThresholdAssistant: 40,
  assignmentRules: DEFAULT_ASSIGNMENT_RULES,
};
