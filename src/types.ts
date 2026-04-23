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

export interface AppSettings {
  id: "app";
  /**
   * Percentage (0-100) of the time elders / MS should be preferred for
   * field-ministry (segment 2) parts. Default is 10%, matching the spec.
   */
  privilegedMinistryShare: number;
  /** Congregation name for report headers, etc. */
  congregationName?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: "app",
  privilegedMinistryShare: 10,
  congregationName: "",
};
