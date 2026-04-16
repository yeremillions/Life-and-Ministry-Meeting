import type { PartType, SegmentId } from "./types";

/* -------------------------------------------------------------------- *
 * Life and Ministry Meeting Workbook parser.
 *
 * The workbook (published on jw.org as MWB-<yy>.pdf) contains a 1- to
 * 2-month schedule, with each week broken into three segments and a
 * numbered list of parts. Layout varies year to year but the headings
 * and numbering scheme have stayed consistent enough that a heuristic
 * parser built on regex matching over extracted PDF text is robust.
 *
 * Workflow:
 *   1. `extractPdfText(file)` loads the file with pdf.js and extracts
 *      a line-preserving text blob.
 *   2. `parseWorkbookText(text)` splits into weeks, assigns dates, and
 *      classifies each numbered part into a (segment, partType).
 * -------------------------------------------------------------------- */

/** One numbered part parsed out of a week. */
export interface ParsedPart {
  number: number;
  segment: SegmentId;
  partType: PartType;
  title: string;
  /** Minutes as printed in the workbook, if we could extract it. */
  minutes?: number;
}

/** One meeting week parsed from the workbook. */
export interface ParsedMeeting {
  /** ISO date (YYYY-MM-DD) for the Monday of the week. */
  weekOf: string;
  /** Raw banner text, e.g. "JANUARY 5-11". */
  banner: string;
  /** Bible reading reference for the week, e.g. "PROVERBS 26-28". */
  bibleReading?: string;
  parts: ParsedPart[];
}

const MONTHS: Record<string, number> = {
  JANUARY: 1,
  FEBRUARY: 2,
  MARCH: 3,
  APRIL: 4,
  MAY: 5,
  JUNE: 6,
  JULY: 7,
  AUGUST: 8,
  SEPTEMBER: 9,
  OCTOBER: 10,
  NOVEMBER: 11,
  DECEMBER: 12,
};

const MONTHS_RE = Object.keys(MONTHS).join("|");

/**
 * Match week banner, e.g. "JANUARY 5-11" (ASCII hyphen, en-dash, or em-dash).
 * Some workbooks also split across months: "JANUARY 26–FEBRUARY 1".
 */
const WEEK_RE = new RegExp(
  `(${MONTHS_RE})\\s*(\\d{1,2})\\s*[-\\u2010-\\u2015\\u2212~]\\s*(?:(${MONTHS_RE})\\s*)?(\\d{1,2})`,
  "gi"
);

const SEGMENT_RE = {
  treasures: /TREASURES\s*FROM\s*GOD'?S?\s*\u2019?S?\s*WORD/i,
  ministry: /APPLY\s*YOURSELF\s*TO\s*THE\s*FIELD\s*MINISTRY/i,
  living: /LIVING\s*AS\s*CHRISTIANS/i,
};

const BIBLE_READING_RE = /\|\s*([A-Z][A-Za-z ]+?\s+\d+(?:[:\d\-–—]+)?(?:\s*[-–—]\s*\d+)?)\s*$/m;

/**
 * Load the file as an ArrayBuffer and extract line-preserving text.
 * Uses pdf.js in the browser (no server calls). Worker is loaded
 * from the bundle via a Vite ?url import.
 */
export async function extractPdfText(file: File): Promise<string> {
  // Dynamic imports so pdf.js isn't in the main bundle until the user
  // actually opens the importer.
  const pdfjsLib = await import("pdfjs-dist");
  // @ts-expect-error Vite URL import for the worker file.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url"))
    .default;
  (pdfjsLib as unknown as { GlobalWorkerOptions: { workerSrc: string } })
    .GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Reconstruct lines by grouping items with similar y-coordinates.
    const items = content.items as Array<{
      str: string;
      transform: number[];
      hasEOL?: boolean;
    }>;
    type Row = { y: number; pieces: { x: number; text: string }[] };
    const rows: Row[] = [];
    for (const it of items) {
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) {
        row = { y, pieces: [] };
        rows.push(row);
      }
      row.pieces.push({ x, text: it.str });
    }
    rows.sort((a, b) => b.y - a.y); // top of page first (higher y = higher)
    const lines = rows.map((r) =>
      r.pieces
        .sort((a, b) => a.x - b.x)
        .map((p) => p.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    );
    pages.push(lines.filter(Boolean).join("\n"));
  }
  return pages.join("\n\n");
}

/* -------------------------- core parsing --------------------------- */

/**
 * Parse the document text into meeting weeks. Year inference: if the
 * `forcedYear` argument is supplied it wins; otherwise we look for
 * the first 4-digit year in the document text.
 */
export function parseWorkbookText(
  text: string,
  forcedYear?: number
): ParsedMeeting[] {
  // Normalise to simplify downstream regexes.
  const normalised = text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');

  const year = forcedYear ?? detectYear(normalised);

  // Find every week banner and its offset. Regexp state reset each call.
  WEEK_RE.lastIndex = 0;
  const banners: {
    match: RegExpExecArray;
    startMonth: string;
    startDay: number;
    endMonth: string;
    endDay: number;
  }[] = [];
  let m: RegExpExecArray | null;
  while ((m = WEEK_RE.exec(normalised))) {
    const startMonth = m[1].toUpperCase();
    const startDay = parseInt(m[2], 10);
    const endMonth = (m[3] ?? m[1]).toUpperCase();
    const endDay = parseInt(m[4], 10);
    // Guard: realistic day ranges.
    if (startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31) continue;
    banners.push({ match: m, startMonth, startDay, endMonth, endDay });
  }

  const results: ParsedMeeting[] = [];
  for (let i = 0; i < banners.length; i++) {
    const b = banners[i];
    const next = banners[i + 1]?.match.index ?? normalised.length;
    const slice = normalised.slice(b.match.index, next);
    const weekOf = toIsoDate(year, b.startMonth, b.startDay);
    if (!weekOf) continue;

    const banner =
      b.startMonth === b.endMonth
        ? `${b.startMonth} ${b.startDay}-${b.endDay}`
        : `${b.startMonth} ${b.startDay}-${b.endMonth} ${b.endDay}`;

    const bibleReading = extractBibleReading(slice);
    const parts = extractParts(slice);
    results.push({ weekOf, banner, bibleReading, parts });
  }

  // Deduplicate weeks (a workbook occasionally repeats a week in TOC-like
  // spots); keep the one with the most parts.
  const byDate = new Map<string, ParsedMeeting>();
  for (const w of results) {
    const existing = byDate.get(w.weekOf);
    if (!existing || w.parts.length > existing.parts.length) {
      byDate.set(w.weekOf, w);
    }
  }
  return [...byDate.values()].sort((a, b) => a.weekOf.localeCompare(b.weekOf));
}

/* ------------------------- helpers ------------------------- */

function detectYear(text: string): number {
  const m = /\b(20\d{2})\b/.exec(text);
  if (m) return parseInt(m[1], 10);
  return new Date().getFullYear();
}

function toIsoDate(year: number, monthName: string, day: number): string | null {
  const monthNum = MONTHS[monthName];
  if (!monthNum) return null;
  const d = new Date(Date.UTC(year, monthNum - 1, day));
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function extractBibleReading(slice: string): string | undefined {
  // Typical banner line: "JANUARY 5-11 | PROVERBS 26-28"
  const m = BIBLE_READING_RE.exec(slice);
  if (m) return m[1].trim();
  return undefined;
}

/**
 * Parse numbered parts from a week's text slice.
 *
 * Each part is introduced by a number followed by "." or ")" at the
 * start of a line, e.g. "1. Putting Up With Grievances". The part
 * text continues until the next numbered line or the next segment
 * header.
 */
function extractParts(slice: string): ParsedPart[] {
  const segMarkers = findSegmentMarkers(slice);
  if (segMarkers.length === 0) return [];

  // Walk numbered lines within each segment.
  const parts: ParsedPart[] = [];
  for (let s = 0; s < segMarkers.length; s++) {
    const { id, start } = segMarkers[s];
    const end = segMarkers[s + 1]?.start ?? slice.length;
    const body = slice.slice(start, end);
    const numbered = splitNumberedItems(body);
    for (const item of numbered) {
      const classified = classifyPart(id, item.number, item.rawText);
      if (classified) parts.push(classified);
    }
  }

  // Sort by part number if present so the output is deterministic even
  // if pdf.js returned items out of order.
  parts.sort((a, b) => a.number - b.number);
  return parts;
}

interface SegmentMarker {
  id: SegmentId;
  start: number; // offset in slice AFTER the heading (so we don't scan it again)
}

function findSegmentMarkers(slice: string): SegmentMarker[] {
  const out: SegmentMarker[] = [];
  for (const id of ["treasures", "ministry", "living"] as SegmentId[]) {
    const re = new RegExp(SEGMENT_RE[id].source, "gi");
    let m;
    while ((m = re.exec(slice))) {
      out.push({ id, start: m.index + m[0].length });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Pull `(N) ...text...` style numbered lines out of a block. */
function splitNumberedItems(
  body: string
): { number: number; rawText: string }[] {
  // Match numbers 1-20 at line start, followed by "." or ")" then a space.
  const re = /(^|\n)\s*(\d{1,2})[.)]\s+([^\n]+(?:\n(?!\s*\d{1,2}[.)]\s)[^\n]*)*)/g;
  const out: { number: number; rawText: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const n = parseInt(m[2], 10);
    if (n < 1 || n > 20) continue;
    out.push({ number: n, rawText: m[3].replace(/\s+/g, " ").trim() });
  }
  return out;
}

function classifyPart(
  segment: SegmentId,
  number: number,
  rawText: string
): ParsedPart | null {
  const minutes = extractMinutes(rawText);
  const title = cleanTitle(rawText);
  const partType = inferPartType(segment, title, number);
  if (!title) return null;
  return { number, segment, partType, title, minutes };
}

function extractMinutes(raw: string): number | undefined {
  const m = /\((\d{1,3})\s*min\.?\)/i.exec(raw);
  return m ? parseInt(m[1], 10) : undefined;
}

/** Strip "(n min.)" suffixes and trailing body-text run-on. */
function cleanTitle(raw: string): string {
  let title = raw
    // drop any "(n min.)" marker and everything after it
    .replace(/\s*\(\s*\d+\s*min\.?.*$/i, "")
    .trim();
  // Drop stray trailing punctuation
  title = title.replace(/[.\s]+$/, "").trim();
  // Strip quotes wrapping the whole title.
  if (
    (title.startsWith('"') && title.endsWith('"')) ||
    (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1).trim();
  }
  return title;
}

function inferPartType(
  segment: SegmentId,
  title: string,
  number: number
): PartType {
  const t = title.toLowerCase();

  if (segment === "treasures") {
    // Order within Treasures is guaranteed: 1=Talk, 2=Gems, 3=Bible reading.
    if (number === 2 || /spiritual\s+gems/.test(t)) return "Spiritual Gems";
    if (number === 3 || /bible\s+reading/.test(t)) return "Bible Reading";
    return "Talk";
  }

  if (segment === "ministry") {
    if (/starting\s+a\s+conversation/.test(t)) return "Starting a Conversation";
    if (/following\s+up/.test(t)) return "Following Up";
    if (/making\s+disciples/.test(t)) return "Making Disciples";
    if (/explaining\s+your\s+beliefs/.test(t)) return "Explaining Your Beliefs";
    if (/initial\s+call/.test(t)) return "Initial Call";
    if (/^talk\b/.test(t)) return "Talk (Ministry)";
    // Fallback for custom titles under the segment heading.
    return "Starting a Conversation";
  }

  // living
  if (/congregation\s+bible\s+study/.test(t)) return "Congregation Bible Study";
  if (/local\s+needs/.test(t)) return "Local Needs";
  if (/governing\s+body\s+update/.test(t)) return "Governing Body Update";
  return "Living Part";
}
