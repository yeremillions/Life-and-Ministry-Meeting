import Papa from "papaparse";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import type { Assignee, Gender, Privilege } from "./types";
import { normalizePrivileges } from "./meeting";

/**
 * Header keywords used to identify each column in tabular imports.
 *
 * Matching is case-insensitive and substring-aware so headers like
 * "Full Name", "Publisher's Name", "Brother/Sister" still resolve to
 * the right field. Column-detection is also used to *skip* spurious
 * rows that happen to repeat the header (e.g. a second header on a
 * new page in a multi-page DOCX export).
 */
const NAME_HINTS = ["name", "publisher", "assignee"];
const GENDER_HINTS = ["gender", "sex", "m/f", "brother/sister"];
const BAPTISED_HINTS = ["baptised", "baptized", "baptism"];
const PRIV_HINTS = ["privilege", "role", "appointment"];
const ACTIVE_HINTS = ["active", "enabled", "status"];
const NOTES_HINTS = ["note", "comment", "remark"];

/**
 * Header-only words that should never be treated as enrollee names.
 * Used as a defensive filter on a row's name cell.
 */
const HEADER_NOISE = new Set([
  "name",
  "names",
  "full name",
  "publisher",
  "publishers",
  "assignee",
  "sex",
  "gender",
  "m/f",
  "brother",
  "sister",
  "brother/sister",
  "privilege",
  "privileges",
  "role",
  "appointment",
  "status",
  "baptised",
  "baptized",
  "active",
  "enabled",
  "notes",
  "note",
  "comment",
  "comments",
  "remark",
  "remarks",
  "s/n",
  "s/no",
  "sn",
  "no",
  "no.",
  "serial",
  "serial no",
  "serial number",
  "#",
  "id",
]);

export interface ParsedAssignee {
  name: string;
  gender: Gender;
  baptised: boolean;
  privileges: Privilege[];
  active: boolean;
  notes?: string;
}

/* --------------------------- value coercers --------------------------- */

function parseGender(v: string | undefined): Gender {
  if (!v) return "M";
  const s = v.trim().toLowerCase();
  if (
    s.startsWith("f") ||
    s === "sister" ||
    s === "w" ||
    s === "female"
  )
    return "F";
  return "M";
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (!s) return fallback;
  if (["y", "yes", "true", "1", "baptised", "baptized"].includes(s)) return true;
  if (["n", "no", "false", "0", "unbaptised", "unbaptized"].includes(s))
    return false;
  return fallback;
}

function parsePrivileges(v: string | undefined): Privilege[] {
  if (!v) return [];
  const tokens = v
    .toUpperCase()
    .replace(/[,/|;]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const allowed: Privilege[] = ["E", "QE", "MS", "QMS", "RP"];
  const out: Privilege[] = [];
  for (const t of tokens) {
    const clean = t.replace(/[()\[\]]/g, "");
    if (
      (allowed as string[]).includes(clean) &&
      !out.includes(clean as Privilege)
    ) {
      out.push(clean as Privilege);
    }
  }
  return out;
}

/* --------------------------- header detection -------------------------- */

function normalize(s: unknown): string {
  return String(s ?? "")
    .replace(/\u00a0/g, " ") // NBSP
    .trim()
    .toLowerCase();
}

/**
 * True if `cell` is essentially a single header word (or a short
 * keyword phrase). We use word-boundary matching so a long title
 * like "Publishers List - 2026" doesn't get mistaken for a
 * "publisher" column header.
 */
function matchesAny(cell: string, hints: string[]): boolean {
  if (!cell) return false;
  const words = cell.split(/[^a-z0-9]+/i).filter(Boolean);
  if (words.length === 0) return false;
  return hints.some((h) =>
    words.some((w) => w === h || (h.length >= 4 && w.startsWith(h)))
  );
}

/** Returns true if a single cell looks like a header keyword overall. */
function looksLikeHeaderCell(cell: string): boolean {
  if (!cell) return false;
  if (HEADER_NOISE.has(cell)) return true;
  if (matchesAny(cell, NAME_HINTS)) return true;
  if (matchesAny(cell, GENDER_HINTS)) return true;
  if (matchesAny(cell, BAPTISED_HINTS)) return true;
  if (matchesAny(cell, PRIV_HINTS)) return true;
  if (matchesAny(cell, ACTIVE_HINTS)) return true;
  if (matchesAny(cell, NOTES_HINTS)) return true;
  return false;
}

interface ColumnMap {
  name: number;
  gender: number;
  baptised: number;
  privileges: number;
  active: number;
  notes: number;
}

/**
 * Find the row index that looks like the header. We score the first
 * 8 rows by the number of cells that look like header keywords (so
 * a stray title row above the headers, which usually contains just
 * one phrase, never wins). The row must contain a "name" column to
 * be chosen at all.
 */
function findHeaderRow(
  rows: string[][]
): { headerIdx: number; columns: ColumnMap } | null {
  const limit = Math.min(rows.length, 8);
  let best: {
    idx: number;
    score: number;
    columns: ColumnMap;
  } | null = null;

  for (let i = 0; i < limit; i++) {
    const cells = rows[i].map(normalize);
    const nameIdx = cells.findIndex((c) => matchesAny(c, NAME_HINTS));
    if (nameIdx === -1) continue;
    const score = cells.filter(looksLikeHeaderCell).length;
    // Need at least two header-like cells to beat a coincidental title.
    if (score < 2) continue;
    const find = (hints: string[]) =>
      cells.findIndex((c) => matchesAny(c, hints));
    const columns: ColumnMap = {
      name: nameIdx,
      gender: find(GENDER_HINTS),
      baptised: find(BAPTISED_HINTS),
      privileges: find(PRIV_HINTS),
      active: find(ACTIVE_HINTS),
      notes: find(NOTES_HINTS),
    };
    if (!best || score > best.score) {
      best = { idx: i, score, columns };
    }
  }

  if (!best) return null;
  return { headerIdx: best.idx, columns: best.columns };
}

/** A name cell that's empty, header noise, or a pure number is junk. */
function isJunkName(name: string): boolean {
  if (!name) return true;
  const lower = name.trim().toLowerCase();
  if (HEADER_NOISE.has(lower)) return true;
  if (/^[\d.\s)]+$/.test(name)) return true; // pure numbering like "1." or "12)"
  if (name.length < 2) return true;
  return false;
}

/* --------------------------- row → assignee --------------------------- */

function rowsToAssignees(rows: string[][]): ParsedAssignee[] {
  // Drop fully blank rows up-front.
  const cleaned = rows.filter((r) => r.some((c) => normalize(c) !== ""));
  if (cleaned.length === 0) return [];

  const header = findHeaderRow(cleaned);
  const out: ParsedAssignee[] = [];
  const seen = new Set<string>(); // dedupe within this import

  if (header) {
    const { headerIdx, columns } = header;
    const get = (row: string[], idx: number): string | undefined =>
      idx >= 0 ? String(row[idx] ?? "").trim() : undefined;

    for (let i = headerIdx + 1; i < cleaned.length; i++) {
      const row = cleaned[i];
      const rawName = get(row, columns.name) ?? "";
      const name = rawName.replace(/\s+/g, " ").trim();
      if (isJunkName(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name,
        gender: parseGender(get(row, columns.gender)),
        baptised: parseBool(get(row, columns.baptised), true),
        privileges: normalizePrivileges(
          parsePrivileges(get(row, columns.privileges))
        ),
        active: parseBool(get(row, columns.active), true),
        notes: get(row, columns.notes) || undefined,
      });
    }
  } else {
    // Header not found — treat each row as: [name, optional tags...]
    // This handles bullet-list-style imports where there are no headers.
    for (const row of cleaned) {
      const merged = row
        .map((c) => String(c ?? "").trim())
        .filter(Boolean)
        .join(" ");
      if (!merged) continue;
      for (const a of parseTextList(merged)) {
        const key = a.name.toLowerCase();
        if (isJunkName(a.name) || seen.has(key)) continue;
        seen.add(key);
        out.push(a);
      }
    }
  }

  return out;
}

/* ------------------------------ parsers ------------------------------- */

export async function parseCSV(file: File): Promise<ParsedAssignee[]> {
  const text = await file.text();
  // Parse as raw 2-D array — header detection happens in rowsToAssignees,
  // so a title row above the real headers no longer poisons parsing.
  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
  });
  const rows = (result.data ?? []).map((r) => r.map((c) => String(c ?? "")));
  return rowsToAssignees(rows);
}

export async function parseXLSX(file: File): Promise<ParsedAssignee[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const out: ParsedAssignee[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false,
    });
    const stringRows = rows.map((r) =>
      Array.isArray(r) ? r.map((c) => String(c ?? "")) : []
    );
    out.push(...rowsToAssignees(stringRows));
  }
  // Dedupe across sheets.
  const seen = new Set<string>();
  return out.filter((a) => {
    const k = a.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * DOCX (including Google Doc exports saved as .docx) are parsed with
 * mammoth. If the document is a *table* (the most common case for an
 * enrollment list), mammoth's raw text uses tab separators, which we
 * route through the same tabular parser used for CSV/XLSX so header
 * detection applies. Otherwise we fall back to the line-by-line list
 * parser used for bullet/numbered lists.
 */
export async function parseDocx(file: File): Promise<ParsedAssignee[]> {
  const buf = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return parseTabularOrList(value);
}

/**
 * Parse text that may be either tab-separated (DOCX tables) or a flat
 * line-by-line list. Exported for testing and reuse from the .txt path.
 */
export function parseTabularOrList(text: string): ParsedAssignee[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, " "))
    .filter((l) => l.trim().length > 0);

  // If at least two lines contain tabs, treat the whole thing as TSV.
  const tabbed = lines.filter((l) => l.includes("\t")).length;
  if (tabbed >= 2) {
    const rows = lines.map((l) => l.split("\t").map((c) => c.trim()));
    return rowsToAssignees(rows);
  }

  return parseTextList(lines.join("\n"));
}

/**
 * One-name-per-line text parser used for plain-text pasting and for
 * DOCX files that aren't shaped like tables.
 *
 * Lines whose only meaningful content is a header keyword (e.g. "Name",
 * "Sex", "S/N") are silently skipped — this prevents a flat list with
 * a single-column header above it from polluting the import.
 */
export function parseTextList(text: string): ParsedAssignee[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, " ").trim())
    .filter(Boolean);

  const out: ParsedAssignee[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    // Strip leading bullet/numbering ("1.", "1)", "-", "*").
    const cleaned = line.replace(/^[-*•·\d.\)\s]+/, "").trim();
    if (!cleaned) continue;

    // Pull every (...) tag.
    const tokens: string[] = [];
    const nameCore = cleaned.replace(/\(([^)]+)\)/g, (_m, t) => {
      tokens.push(String(t).trim());
      return " ";
    });
    const name = nameCore.replace(/\s+/g, " ").trim();
    if (isJunkName(name)) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let gender: Gender = "M";
    let baptised = true;
    let active = true;
    const privs: Privilege[] = [];
    for (const raw of tokens) {
      const t = raw.toUpperCase().trim();
      if (t === "F" || t === "SISTER" || t === "FEMALE") gender = "F";
      else if (t === "M" || t === "BROTHER" || t === "MALE") gender = "M";
      else if (t === "UNBAPTISED" || t === "UNBAPTIZED") baptised = false;
      else if (t === "INACTIVE") active = false;
      else if (t === "RP" || t === "REGULAR PIONEER" || t === "PIONEER") {
        if (!privs.includes("RP")) privs.push("RP");
      } else {
        const p = parsePrivileges(t);
        for (const x of p) if (!privs.includes(x)) privs.push(x);
      }
    }
    out.push({
      name,
      gender,
      baptised,
      privileges: normalizePrivileges(privs),
      active,
    });
  }
  return out;
}

/** Dispatch to the correct parser based on file extension. */
export async function parseAssigneeFile(file: File): Promise<ParsedAssignee[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return parseCSV(file);
  if (name.endsWith(".xlsx") || name.endsWith(".xls"))
    return parseXLSX(file);
  if (name.endsWith(".docx")) return parseDocx(file);
  if (name.endsWith(".txt")) return parseTabularOrList(await file.text());
  throw new Error(
    `Unsupported file type: ${file.name}. Use CSV, XLSX, DOCX, or TXT.`
  );
}

/**
 * Take a ParsedAssignee object the UI is about to send to Dexie and
 * ensure it has defensible defaults.
 */
export function parsedToAssignee(p: ParsedAssignee): Omit<Assignee, "id"> {
  return {
    name: p.name,
    gender: p.gender,
    baptised: p.baptised,
    privileges: p.privileges,
    active: p.active,
    notes: p.notes,
    createdAt: Date.now(),
  };
}
