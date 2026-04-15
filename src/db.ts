import Dexie, { type Table } from "dexie";
import {
  type Assignee,
  type Week,
  type AppSettings,
  DEFAULT_SETTINGS,
} from "./types";

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
