import Dexie, { type Table } from "dexie";
import {
  type Assignee,
  type Household,
  type PartType,
  type SegmentId,
  type Week,
  type AppSettings,
  type LogEntry,
  type AssignmentRule,
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
  households!: Table<Household, number>;
  logs!: Table<LogEntry, number>;

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

    // v3: add isMinor field (default false) to all existing assignees that
    // were created before this field existed.
    this.version(3)
      .stores({
        assignees: "++id, name, gender, active, createdAt",
        weeks: "++id, weekOf, createdAt",
        settings: "id",
      })
      .upgrade(async (tx) => {
        const assignees = await tx.table("assignees").toArray();
        for (const a of assignees) {
          if (a.isMinor == null) {
            await tx.table("assignees").update(a.id as number, { isMinor: false });
          }
        }
      });

    // v4: add households table for cross-gender family pairing support.
    // No data upgrade needed — the table is new and starts empty.
    this.version(4).stores({
      assignees:  "++id, name, gender, active, createdAt",
      weeks:      "++id, weekOf, createdAt",
      settings:   "id",
      households: "++id, name, createdAt",
    });

    // v5: add logs table for audit trail.
    this.version(5).stores({
      assignees:  "++id, name, gender, active, createdAt",
      weeks:      "++id, weekOf, createdAt",
      settings:   "id",
      households: "++id, name, createdAt",
      logs:       "++id, timestamp, category",
    });

    // v6: support for publisher availability ranges and day selections.
    this.version(6).stores({
      assignees:  "++id, name, gender, active, createdAt",
      weeks:      "++id, weekOf, createdAt",
      settings:   "id",
      households: "++id, name, createdAt",
      logs:       "++id, timestamp, category",
    });
  }
}

export const db = new MeetingDB();

function getDefaultRuleForCustomPart(partType: string, customPartTypes: Record<string, string[]> | undefined): AssignmentRule {
  let segment: SegmentId = "living";
  if (customPartTypes) {
    for (const seg of Object.keys(customPartTypes) as SegmentId[]) {
      if (customPartTypes[seg]?.includes(partType)) {
        segment = seg;
        break;
      }
    }
  }

  if (segment === "ministry") {
    return {
      allowedGenders: ["M", "F"],
      requiredPrivileges: [],
      mustBeBaptized: false,
    };
  } else {
    return {
      allowedGenders: ["M"],
      requiredPrivileges: [],
      mustBeBaptized: true,
    };
  }
}

/** Ensure the singleton settings row exists. */
export async function ensureSettings(): Promise<AppSettings> {
  try {
    const existing = await db.settings.get("app");
    if (!existing || typeof existing !== "object") {
      await db.settings.put(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }

    // Start with a clean copy of DEFAULT_SETTINGS
    const updated: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...existing,
      assignmentRules: {
        ...DEFAULT_SETTINGS.assignmentRules,
      },
    };

    // Migration from old settings fields
    const oldExisting = existing as any;
    if (existing.ruleRoleAlternation === undefined) {
      updated.ruleRoleAlternation = oldExisting.ruleMinistryAlternation ?? oldExisting.rulePreventAssistantTwice ?? DEFAULT_SETTINGS.ruleRoleAlternation;
    }
    if (existing.ruleWorkloadBalancing === undefined) {
      updated.ruleWorkloadBalancing = oldExisting.ruleMainWorkload ?? oldExisting.ruleAssistantWorkload ?? DEFAULT_SETTINGS.ruleWorkloadBalancing;
    }

    // Clean up old fields
    delete (updated as any).ruleMinistryAlternation;
    delete (updated as any).rulePreventAssistantTwice;
    delete (updated as any).ruleMainWorkload;
    delete (updated as any).ruleAssistantWorkload;
    delete (updated as any).preventMinorAssistantToAdult;

    // Safely merge assignmentRules
    const existingRules = existing.assignmentRules && typeof existing.assignmentRules === "object"
      ? existing.assignmentRules
      : {};

    const allPartTypes = new Set(Object.keys(DEFAULT_SETTINGS.assignmentRules));
    if (existing.customPartTypes && typeof existing.customPartTypes === "object") {
      const custom = existing.customPartTypes;
      for (const seg of Object.keys(custom) as SegmentId[]) {
        if (Array.isArray(custom[seg])) {
          for (const pt of custom[seg]) {
            allPartTypes.add(pt);
          }
        }
      }
    }

    for (const partType of allPartTypes) {
      const defaultRule = DEFAULT_SETTINGS.assignmentRules[partType] || getDefaultRuleForCustomPart(partType, existing.customPartTypes);
      const existingRule = existingRules[partType];

      if (existingRule && typeof existingRule === "object") {
        const mergedRule: AssignmentRule = {
          allowedGenders: Array.isArray(existingRule.allowedGenders)
            ? existingRule.allowedGenders
            : [...defaultRule.allowedGenders],
          requiredPrivileges: Array.isArray(existingRule.requiredPrivileges)
            ? existingRule.requiredPrivileges
            : [...defaultRule.requiredPrivileges],
          mustBeBaptized: typeof existingRule.mustBeBaptized === "boolean"
            ? existingRule.mustBeBaptized
            : defaultRule.mustBeBaptized,
        };

        const hasAssistant = existingRule.assistant !== undefined || defaultRule.assistant !== undefined;
        if (hasAssistant) {
          const defaultAssistant = defaultRule.assistant || {
            allowedGenders: partType.toLowerCase().includes("ministry") ? ["M", "F"] : ["M"],
            requiredPrivileges: [],
            mustBeBaptized: false,
          };
          const existingAssistant = existingRule.assistant;

          if (existingAssistant && typeof existingAssistant === "object") {
            mergedRule.assistant = {
              allowedGenders: Array.isArray(existingAssistant.allowedGenders)
                ? existingAssistant.allowedGenders
                : [...defaultAssistant.allowedGenders],
              requiredPrivileges: Array.isArray(existingAssistant.requiredPrivileges)
                ? existingAssistant.requiredPrivileges
                : [...defaultAssistant.requiredPrivileges],
              mustBeBaptized: typeof existingAssistant.mustBeBaptized === "boolean"
                ? existingAssistant.mustBeBaptized
                : defaultAssistant.mustBeBaptized,
            };
          } else if (defaultRule.assistant) {
            mergedRule.assistant = { ...defaultRule.assistant };
          }
        }

        updated.assignmentRules[partType] = mergedRule;
      } else {
        updated.assignmentRules[partType] = { ...defaultRule };
      }
    }

    // Save the cleaned/completed settings back to DB if they changed
    if (JSON.stringify(existing) !== JSON.stringify(updated)) {
      await db.settings.put(updated);
      return updated;
    }

    return existing;
  } catch (e) {
    console.error("Error in ensureSettings, falling back to default settings:", e);
    return DEFAULT_SETTINGS;
  }
}

/** Record an action in the change log. */
export async function addLog(
  category: LogEntry["category"],
  action: string,
  details?: string
) {
  await db.logs.add({
    timestamp: Date.now(),
    category,
    action,
    details,
  });

  // Keep logs manageable (keep last 500)
  const count = await db.logs.count();
  if (count > 500) {
    const oldest = await db.logs.orderBy("timestamp").limit(count - 500).toArray();
    const ids = oldest.map(l => l.id).filter((id): id is number => id != null);
    await db.logs.bulkDelete(ids);
  }
}
