/** Utility helpers shared across pages. */

export function todayIso(): string {
  const d = new Date();
  return toIso(d);
}

export function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Snap an arbitrary date to the Monday of that week (ISO week — Mon=1). */
export function mondayOf(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function nextMondayIso(after?: string): string {
  const base = after ? new Date(after + "T00:00:00") : new Date();
  const next = mondayOf(addDays(base, 7));
  return toIso(next);
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function classNames(
  ...parts: (string | false | null | undefined)[]
): string {
  return parts.filter(Boolean).join(" ");
}

const MONTH_NAMES = [
  "January", "February", "March", "April",
  "May", "June", "July", "August",
  "September", "October", "November", "December",
];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Returns a human-readable week range label matching the physical workbook
 * format, e.g. "MAY 4 - 10" or "APR 28 - MAY 4" for cross-month weeks.
 *
 * @param weekOf  ISO date string of the Monday that starts the week (YYYY-MM-DD).
 */
export function weekRangeLabel(weekOf: string): string {
  const mon = new Date(weekOf + "T00:00:00");
  const sun = addDays(mon, 6);
  const mMon = MONTH_SHORT[mon.getMonth()].toUpperCase();
  const mSun = MONTH_SHORT[sun.getMonth()].toUpperCase();
  if (mMon === mSun) {
    return `${mMon} ${mon.getDate()} - ${sun.getDate()}`;
  }
  return `${mMon} ${mon.getDate()} - ${mSun} ${sun.getDate()}`;
}

/**
 * Returns the bi-monthly "workbook period" that contains the given week.
 * JW workbooks cover two consecutive months (Jan–Feb, Mar–Apr, May–Jun, …).
 *
 * A week always belongs to the period of its Monday's month.
 *
 * @param weekOf  ISO date string for the Monday (YYYY-MM-DD).
 * @returns  Stable sort key (e.g. "2026-05") and display label
 *           (e.g. "May – June 2026").
 */
export function workbookPeriod(weekOf: string): { key: string; label: string } {
  const mon = new Date(weekOf + "T00:00:00");
  const year = mon.getFullYear();
  const monthIdx = mon.getMonth(); // 0-based
  // Snap to the start of the two-month block: 0→0, 1→0, 2→2, 3→2, 4→4 …
  const blockStart = Math.floor(monthIdx / 2) * 2;
  const blockEnd = blockStart + 1;
  const key = `${year}-${String(blockStart + 1).padStart(2, "0")}`;
  const label =
    `${MONTH_NAMES[blockStart]} \u2013 ${MONTH_NAMES[blockEnd]} ${year}`;
  return { key, label };
}
