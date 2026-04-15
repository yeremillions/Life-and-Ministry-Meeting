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
  const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
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
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

export function classNames(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
