/**
 * Lightweight telemetry — sends a single anonymous heartbeat per browser
 * session to a Supabase table.  Silently no-ops if the environment
 * variables are not configured.
 *
 * Data sent:
 *   - congregation name (from settings)
 *   - enrollee count
 *   - week count
 *   - app version (from package.json via Vite define)
 *   - timestamp (server-side, via Supabase default)
 */

import { db, ensureSettings } from "./db";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const TABLE = "heartbeats";
const SESSION_KEY = "lm_heartbeat_sent";

/**
 * Fire-and-forget heartbeat.  Safe to call on every app mount — it
 * will only send once per browser session (uses sessionStorage guard).
 */
export async function sendHeartbeat(): Promise<void> {
  // Skip if Supabase is not configured
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  // Skip if already sent this session
  if (sessionStorage.getItem(SESSION_KEY)) return;

  try {
    const settings = await ensureSettings();
    const congregationName = settings?.congregationName?.trim() || "Unknown";
    const enrolleeCount = await db.assignees.count();
    const weekCount = await db.weeks.count();

    const payload = {
      congregation: congregationName,
      enrollee_count: enrolleeCount,
      week_count: weekCount,
      app_version: "1.0.0",
    };

    await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });

    // Mark this session as sent
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // Silently ignore — telemetry should never break the app
  }
}

/**
 * Read all heartbeat records from Supabase.
 * Used by the Admin page.  Requires VITE_SUPABASE_ADMIN_KEY or falls
 * back to the anon key (table must have SELECT enabled for admin use).
 */
export interface HeartbeatRecord {
  id: number;
  congregation: string;
  enrollee_count: number;
  week_count: number;
  app_version: string;
  created_at: string;
}

export async function fetchHeartbeats(): Promise<HeartbeatRecord[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=created_at.desc&limit=1000`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );

  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  return res.json();
}
