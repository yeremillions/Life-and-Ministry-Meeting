import Dexie, { type Table } from "dexie";
import {
  type Assignee,
  type PartType,
  type SegmentId,
  type Week,
  type AppSettings,
  DEFAULT_SETTINGS,
} from "./types";

// Canonical segment for each part type.  Used by the v2 migration to
// normalise any `segment` values that were stored incorrectly by the
// old workbook/S-140 parser (which could misclassify parts when a
// section heading appeared more than once in a week's text slice).
const CANONICAL_SEGMENT: Partial<Record<PartType, SegmentId>> = {
  "Chairman":              "opening",
  "Opening Prayer":        "opening",
  "Talk":                  "treasures",
  "Spiritual Gems":        "treasures",
  "Bible Reading":         "treasures",
  "Starting a Conversation": "ministry",
  "Following Up":          "ministry",
  "Making Disciples":      "ministry",
  "Explaining Your Beliefs": "ministry",
  "Initial Call":          "ministry",
  "Talk (Ministry)":       "ministry",
  "Living Part":           "living",
  "Local Needs":           "living",
  "Governing Body Update": "living",
  "Congregation Bible Study": "living",
  "Closing Prayer":        "living",
};

class MeetingDB extends Dexie {
  assignees!: Table<Assignee, number>;
  weeks!: Table<Week, number>;
  settings!: Table<AppSettings, string>;

  constructor() {
    super("life-and-ministry-meeting");

    this.version(1).stores({
      assignees: "++id, name, gender, active, createdAt",
      weeks: "++id, weekOf, createdAt",
      settings: "id",
    });

    // v2: normalise every assignment's `segment` field to match the
    // canonical segment for its `partType`.  Fixes weeks that were
    // imported while the parser could emit duplicate section headings,
    // which caused parts to be tagged with the wrong segment.
    this.version(2)
      .stores({
        assignees: "++id, name, gender, active, createdAt",
        weeks: "++id, weekOf, createdAt",
        settings: "id",
      })
      .upgrade(async (tx) => {
        const weeks = await tx.table("weeks").toArray() as Week[];
        for (const week of weeks) {
          let dirty = false;
          const assignments = week.assignments.map((a) => {
            const canonical = CANONICAL_SEGMENT[a.partType];
            if (canonical && canonical !== a.segment) {
              dirty = true;
              return { ...a, segment: canonical };
            }
            return a;
          });
          if (dirty) {
            await tx.table("weeks").update(week.id as number, { assignments });
          }
        }
      });
  }
}

export const db = new MeetingDB();

/** Ensure the singleton settings row exists. */
export async function ensureSettings(): Promise<AppSettings> {
  const existing = await db.settings.get("app");
  if (existing) return existing;
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}
