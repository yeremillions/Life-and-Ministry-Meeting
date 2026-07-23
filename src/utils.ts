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

/**
 * Heuristic to detect the year from a text blob and/or a filename.
 * 1. Checks filename for a 4-digit year (e.g. mwb_E_202601.pdf).
 * 2. Checks document text for a 4-digit year starting with "20".
 * 3. Falls back to the current calendar year.
 */
export function detectYear(text: string, filename?: string): number {
  // 1. Try filename first (strong signal)
  if (filename) {
    const m = /\b(20\d{2})\b/.exec(filename);
    if (m) return parseInt(m[1], 10);
  }
  // 2. Try document text
  const m = /\b(20\d{2})\b/.exec(text);
  if (m) return parseInt(m[1], 10);
  // 3. Fallback
  return new Date().getFullYear();
}

/**
 * Calculate the exact meeting date for a given week (Monday-based YYYY-MM-DD string)
 * and congregation midweek meeting night.
 */
export function getMeetingDate(weekOf: string, meetingDay: string): string {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const offset = days.indexOf(meetingDay);
  const date = new Date(weekOf + "T00:00:00");
  date.setDate(date.getDate() + (offset >= 0 ? offset : 3)); // defaults to Thursday (+3)
  return toIso(date);
}

/** Days between two ISO dates (YYYY-MM-DD). */
export function daysBetween(aIso: string, bIso: string): number {
  if (!aIso || !bIso) return 0;
  const [y1, m1, d1] = aIso.trim().split("-").map(Number);
  const [y2, m2, d2] = bIso.trim().split("-").map(Number);
  if (isNaN(y1) || isNaN(y2)) return 0;
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

/**
 * Converts a string (e.g. ALL CAPS title) to Title Case, preserving minor words in lowercase
 * and keeping quotes/punctuation intact.
 */
export function toTitleCase(str: string): string {
  if (!str) return "";

  const minorWords = new Set([
    "a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "so", "the", "to", "up", "yet", "with"
  ]);

  const words = str.trim().split(/\s+/);

  const titleCased = words.map((word, index) => {
    if (!word) return "";

    const match = word.match(/^([^a-zA-Z0-9]*)(.*?)([^a-zA-Z0-9]*)$/);
    if (!match) return word;

    const [, prefix, core, suffix] = match;
    if (!core) return word;

    const isFirst = index === 0;
    const isLast = index === words.length - 1;

    let casedCore: string;
    if (!isFirst && !isLast && minorWords.has(core.toLowerCase())) {
      casedCore = core.toLowerCase();
    } else {
      casedCore = core.charAt(0).toUpperCase() + core.slice(1).toLowerCase();
    }

    return prefix + casedCore + suffix;
  });

  return titleCased.join(" ");
}



