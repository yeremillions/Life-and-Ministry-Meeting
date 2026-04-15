import Papa from "papaparse";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import type { Assignee, Gender, Privilege } from "./types";
import { normalizePrivileges } from "./meeting";

/** Fields we know how to map from a row's column name (case-insensitive). */
const NAME_KEYS = ["name", "full name", "publisher", "assignee"];
const GENDER_KEYS = ["gender", "sex"];
const BAPTISED_KEYS = ["baptised", "baptized", "baptism"];
const PRIV_KEYS = ["privilege", "privileges", "role", "status"];
const ACTIVE_KEYS = ["active", "enabled"];
const NOTES_KEYS = ["notes", "comment", "comments"];

export interface ParsedAssignee {
  name: string;
  gender: Gender;
  baptised: boolean;
  privileges: Privilege[];
  active: boolean;
  notes?: string;
}

function pick(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    for (const rk of Object.keys(row)) {
      if (rk.trim().toLowerCase() === k) {
        const v = row[rk];
        if (v == null) return undefined;
        return String(v).trim();
      }
    }
  }
  return undefined;
}

function parseGender(v: string | undefined): Gender {
  if (!v) return "M";
  const s = v.trim().toLowerCase();
  if (s.startsWith("f") || s === "sister" || s === "w") return "F";
  return "M";
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (["y", "yes", "true", "1", "baptised", "baptized"].includes(s)) return true;
  if (["n", "no", "false", "0", "unbaptised", "unbaptized"].includes(s)) return false;
  return fallback;
}

function parsePrivileges(v: string | undefined): Privilege[] {
  if (!v) return [];
  const tokens = v
    .toUpperCase()
    .replace(/[,/|;]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const allowed: Privilege[] = ["E", "QE", "MS", "QMS"];
  const out: Privilege[] = [];
  for (const t of tokens) {
    const clean = t.replace(/[()\[\]]/g, "");
    if ((allowed as string[]).includes(clean) && !out.includes(clean as Privilege)) {
      out.push(clean as Privilege);
    }
  }
  return out;
}

/**
 * Convert a row (keyed by column header) into a ParsedAssignee. Rows
 * missing a name are dropped.
 */
function rowToAssignee(row: Record<string, unknown>): ParsedAssignee | null {
  const name = pick(row, NAME_KEYS);
  if (!name) return null;
  return {
    name,
    gender: parseGender(pick(row, GENDER_KEYS)),
    baptised: parseBool(pick(row, BAPTISED_KEYS), true),
    privileges: normalizePrivileges(parsePrivileges(pick(row, PRIV_KEYS))),
    active: parseBool(pick(row, ACTIVE_KEYS), true),
    notes: pick(row, NOTES_KEYS),
  };
}

export async function parseCSV(file: File): Promise<ParsedAssignee[]> {
  const text = await file.text();
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return (result.data ?? [])
    .map(rowToAssignee)
    .filter((x): x is ParsedAssignee => x !== null);
}

export async function parseXLSX(file: File): Promise<ParsedAssignee[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const out: ParsedAssignee[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: "",
      raw: false,
    });
    for (const row of rows) {
      const a = rowToAssignee(row);
      if (a) out.push(a);
    }
  }
  return out;
}

/**
 * DOCX (including Google Doc exports saved as .docx) are parsed with
 * mammoth to extract raw text, then split line-by-line.
 *
 * Each non-empty line becomes one enrollee. A trailing parenthesised
 * token like "(E)", "(MS)" or "(QMS)" is treated as a privilege tag.
 * A leading/trailing marker of "(F)" or "(sister)" sets gender to F.
 */
export async function parseDocx(file: File): Promise<ParsedAssignee[]> {
  const buf = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return parseTextList(value);
}

/**
 * Generic text-line parser, exposed for manual "paste a list" import.
 */
export function parseTextList(text: string): ParsedAssignee[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: ParsedAssignee[] = [];
  for (const line of lines) {
    // Ignore bullet/numbering prefixes.
    const cleaned = line.replace(/^[-*\d.\)\s]+/, "");
    // Pull every (...) token.
    const tokens: string[] = [];
    const nameCore = cleaned.replace(/\(([^)]+)\)/g, (_m, t) => {
      tokens.push(t.trim());
      return " ";
    });
    const name = nameCore.replace(/\s+/g, " ").trim();
    if (!name) continue;

    let gender: Gender = "M";
    let baptised = true;
    let active = true;
    const privs: Privilege[] = [];
    for (const raw of tokens) {
      const t = raw.toUpperCase();
      if (t === "F" || t === "SISTER" || t === "FEMALE") gender = "F";
      else if (t === "M" || t === "BROTHER" || t === "MALE") gender = "M";
      else if (t === "UNBAPTISED" || t === "UNBAPTIZED") baptised = false;
      else if (t === "INACTIVE") active = false;
      else {
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
  if (name.endsWith(".txt")) return parseTextList(await file.text());
  throw new Error(
    `Unsupported file type: ${file.name}. Use CSV, XLSX, DOCX, or TXT.`
  );
}

/**
 * Take an Assignee object the UI is about to send to Dexie and ensure
 * it has defensible defaults.
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
