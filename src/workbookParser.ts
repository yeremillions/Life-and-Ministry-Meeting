import type { PartType, SegmentId } from "./types";
import { detectYear as inferYear } from "./utils";

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
  /** The 1-indexed page number where this week was primarily found. */
  pageNumber?: number;
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
  // 2025 and earlier: heading on one line.
  // 2026+: heading split across two lines ("TREASURES\nFROM GOD'S WORD").
  // Use [\s\S] so the match can span a newline.
  treasures: /TREASURES[\s\S]*?FROM\s+GOD[''\u2019]?S?\s+WORD/i,
  ministry: /APPLY\s*YOURSELF[\s\S]*?TO\s+THE\s+FIELD\s+MINISTRY/i,
  living: /LIVING[\s\S]*?AS\s+CHRISTIANS/i,
};

/**
 * Bible reading appears after the week banner, typically on the same line
 * after a pipe separator (which may be a graphic, not a text char), or on
 * the very next line.  We search only the first few lines of the slice to
 * avoid matching part-title text further down.
 */
function extractBibleReading(slice: string): string | undefined {
  const lines = slice.split("\n");
  const firstLine = lines[0] ?? "";

  // Case A: "JANUARY 5-11 | GENESIS 1-3"  (| present as text element)
  const mPipe = /\|\s*([A-Z][A-Za-z ]+?\s+\d+(?:[:\d–—-]+)?(?:\s*[-–—]\s*\d+)?)/i.exec(firstLine);
  if (mPipe) return mPipe[1].trim();

  // Case B: on the banner line, after the day range: "MAY 4-10 ISAIAH 58-59 2"
  // Match BOOK CHAPTERS (optionally with a trailing page-number digit).
  const mBanner =
    /[-–—]\s*\d{1,2}\s+((?:\d\s+)?[A-Z][A-Za-z]+(?:\s+[A-Za-z]+)?\s+\d+(?:\s*[-–—]\s*\d+)?)/i.exec(
      firstLine
    );
  if (mBanner) return mBanner[1].trim();

  // Case C: reading on its own line immediately after the banner.
  for (const line of lines.slice(1, 4)) {
    const mLine =
      /^((?:\d\s+)?[A-Z][A-Za-z]+(?:\s+[A-Za-z]+)?\s+\d+\s*[-–—]\s*\d+)\b/.exec(
        line.trim()
      );
    if (mLine) return mLine[1].trim();
  }

  return undefined;
}

/**
 * Load the file as an ArrayBuffer and extract line-preserving text.
 * Uses pdf.js in the browser (no server calls). Worker is loaded
 * from the bundle via a Vite ?url import.
 *
 * Many MWB PDFs use heavy letter-spacing/tracking for display headings
 * (e.g. "T R E A S U R E S").  pdf.js surfaces each character as a
 * separate text item in that case, so we cannot join naively — we use
 * each item's reported x/width to detect whether the gap between two
 * adjacent items is a within-word letter-space (no separator) or a
 * real inter-word space.
 */
export async function extractPdfText(file: File): Promise<{
  fullText: string;
  pageTexts: { page: number; text: string }[];
}> {
  // Dynamic imports so pdf.js isn't in the main bundle until the user
  // actually opens the importer.
  const pdfjsLib = await import("pdfjs-dist");
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
    const items = content.items as Array<{
      str: string;
      transform: number[];
      width?: number;
      height?: number;
      hasEOL?: boolean;
    }>;

    type Piece = { x: number; width: number; text: string };
    type Row = { y: number; pieces: Piece[] };

    const rows: Row[] = [];
    for (const it of items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      // Fall back to a 4-pt-per-char estimate when pdf.js omits width.
      const width =
        typeof it.width === "number" && it.width > 0
          ? it.width
          : it.str.length * 4;
      // 5-point tolerance (≈1.7 mm) handles PDFs where glyphs on the same
      // visual line have slightly different baseline y values.
      let row = rows.find((r) => Math.abs(r.y - y) < 5);
      if (!row) {
        row = { y, pieces: [] };
        rows.push(row);
      }
      row.pieces.push({ x, width, text: it.str });
    }
    rows.sort((a, b) => b.y - a.y); // top of page first (higher y = higher)

    const lines = rows.map((r) =>
      assembleLine(r.pieces.sort((a, b) => a.x - b.x))
    );
    pages.push(lines.filter(Boolean).join("\n"));
  }
  return {
    fullText: pages.join("\n\n"),
    pageTexts: pages.map((text, i) => ({ page: i + 1, text })),
  };
}

/**
 * Glue a row's pieces into a single line, using x-coordinate gaps to
 * decide between "no separator" (within-word) and "space" (between words).
 */
function assembleLine(
  pieces: { x: number; width: number; text: string }[]
): string {
  if (pieces.length === 0) return "";
  let result = pieces[0].text;
  for (let i = 1; i < pieces.length; i++) {
    const prev = pieces[i - 1];
    const curr = pieces[i];
    const prevEnd = prev.x + prev.width;
    const gap = curr.x - prevEnd;
    // Approximate glyph width, taking the wider of the two neighbours so
    // short multi-char tokens (e.g. "sh", "RE") don't force an overly
    // tight threshold that confuses letter-spacing with real spaces.
    const prevCharW = prev.width / Math.max(prev.text.length, 1);
    const currCharW = curr.width / Math.max(curr.text.length, 1);
    const charW = Math.max(prevCharW, currCharW);
    // Small gap relative to a glyph = letter-spacing / kerning (no space).
    // Use a 2.5 pt floor so narrow glyphs still cluster correctly.
    const threshold = Math.max(charW * 0.5, 2.5);
    if (gap < threshold) {
      result += curr.text;
    } else {
      result += " " + curr.text;
    }
  }
  return result.replace(/\s+/g, " ").trim();
}

/* -------------------------- core parsing --------------------------- */

/**
 * Parse the document text into meeting weeks. Year inference: if the
 * `forcedYear` argument is supplied it wins; otherwise we look for
 * the first 4-digit year in the document text.
 */
export function parseWorkbookText(
  input: string | { fullText: string; pageTexts: { page: number; text: string }[] },
  forcedYear?: number,
  filename?: string
): ParsedMeeting[] {
  const text = typeof input === "string" ? input : input.fullText;
  const pageTexts = typeof input === "string" ? [] : input.pageTexts;
  const normalised = normalizeWorkbookText(text);
  const normalizedPageTexts = pageTexts.map((pt) => ({
    page: pt.page,
    text: normalizeWorkbookText(pt.text),
  }));

  const year = forcedYear ?? inferYear(normalised, filename);

  // --- Step 1: find all TREASURES headings (one per week, reliable) ---
  const treasuresGlobal = new RegExp(SEGMENT_RE.treasures.source, "gi");
  const treasuresPositions: number[] = [];
  let tm: RegExpExecArray | null;
  while ((tm = treasuresGlobal.exec(normalised))) {
    treasuresPositions.push(tm.index);
  }

  // --- Step 2: find all banner matches (date ranges like "MAY 4-10") ---
  WEEK_RE.lastIndex = 0;
  const banners: {
    index: number;
    text: string;
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
    if (startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31) continue;
    banners.push({
      index: m.index,
      text: m[0],
      startMonth,
      startDay,
      endMonth,
      endDay,
    });
  }

  // --- Step 3: delimit weeks by TREASURES headings ---
  // Each TREASURES heading starts a new week. We scan backwards from each
  // TREASURES position to capture the banner line that precedes it.
  // The slice for each week ends where the next week's slice begins.
  const weekSlices: { sliceStart: number; sliceEnd: number }[] = [];

  // First pass: compute the start of each week (looking back for banner).
  const weekStarts: number[] = [];
  for (let i = 0; i < treasuresPositions.length; i++) {
    const earliest = i > 0 ? weekStarts[i - 1] + 1 : 0;
    const region = normalised.slice(earliest, treasuresPositions[i]);
    // Find the *last* "Song N" line before TREASURES (each week starts
    // with "Song N and Prayer / Opening Comments").
    let songIdx = -1;
    const songRe = /\bSong\s+\d+/gi;
    let sm: RegExpExecArray | null;
    while ((sm = songRe.exec(region))) songIdx = sm.index;

    if (songIdx >= 0) {
      const beforeSong = region.lastIndexOf("\n", songIdx);
      weekStarts.push(earliest + (beforeSong >= 0 ? beforeSong : songIdx));
    } else {
      // Fallback: find the last double-newline (paragraph break).
      const dblNl = region.lastIndexOf("\n\n");
      weekStarts.push(earliest + (dblNl >= 0 ? dblNl : 0));
    }
  }

  for (let i = 0; i < treasuresPositions.length; i++) {
    const sliceStart = weekStarts[i];
    const sliceEnd =
      i + 1 < weekStarts.length ? weekStarts[i + 1] : normalised.length;
    weekSlices.push({ sliceStart, sliceEnd });
  }

  // --- Step 4: pair each week slice with a banner ---
  const results: ParsedMeeting[] = [];
  let lastWeekOf: string | null = null;

  for (let i = 0; i < weekSlices.length; i++) {
    const { sliceStart, sliceEnd } = weekSlices[i];
    const slice = normalised.slice(sliceStart, sliceEnd);

    // Find the best banner for this week: the latest banner between the
    // previous TREASURES heading and this one. We use the wider region
    // (not sliceStart) because the banner line appears before the Song
    // line that sliceStart is anchored to.
    const tPos = treasuresPositions[i];
    const prevTPos = i > 0 ? treasuresPositions[i - 1] : 0;
    const matchingBanner = banners
      .filter((b) => b.index >= prevTPos && b.index < tPos)
      .sort((a, b) => b.index - a.index)[0];

    let weekOf: string | null = null;
    let banner: string;

    if (matchingBanner) {
      weekOf = toIsoDate(year, matchingBanner.startMonth, matchingBanner.startDay);
      banner =
        matchingBanner.startMonth === matchingBanner.endMonth
          ? `${matchingBanner.startMonth} ${matchingBanner.startDay}-${matchingBanner.endDay}`
          : `${matchingBanner.startMonth} ${matchingBanner.startDay}-${matchingBanner.endMonth} ${matchingBanner.endDay}`;
    } else if (lastWeekOf) {
      // Infer date: previous week + 7 days.
      const prev = new Date(lastWeekOf + "T00:00:00Z");
      prev.setUTCDate(prev.getUTCDate() + 7);
      weekOf = toIsoDate(prev.getUTCFullYear(), monthNameFromNum(prev.getUTCMonth() + 1), prev.getUTCDate());
      banner = weekOf ? `Week of ${weekOf}` : "Unknown week";
    } else {
      banner = "Unknown week";
    }

    if (!weekOf) continue;
    lastWeekOf = weekOf;

    const bibleReading = extractBibleReading(slice);
    const parts = extractParts(slice);

    // Heuristic: which page was this slice likely on?
    let pageNumber: number | undefined;
    if (normalizedPageTexts.length > 0) {
      // 1. Try exact banner match in normalized page text
      const bannerMarker = banner.toUpperCase();
      let match = normalizedPageTexts.find((pt) =>
        pt.text.toUpperCase().includes(bannerMarker)
      );

      // 2. Fallback: Try matching the start date components
      if (!match && matchingBanner) {
        const { startMonth, startDay } = matchingBanner;
        const fallbackMarker = `${startMonth} ${startDay}`.toUpperCase();
        match = normalizedPageTexts.find((pt) =>
          pt.text.toUpperCase().includes(fallbackMarker)
        );
      }

      // 3. Fallback: Try searching for the bible reading reference
      if (!match && bibleReading) {
        const brMarker = bibleReading.toUpperCase();
        match = normalizedPageTexts.find((pt) =>
          pt.text.toUpperCase().includes(brMarker)
        );
      }

      if (match) pageNumber = match.page;
    }

    results.push({ weekOf, banner, bibleReading, parts, pageNumber });
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


/**
 * Standard normalization used for both full text and individual pages.
 */
function normalizeWorkbookText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // Strip non-printable control characters
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    // Month-name normalisation
    .replace(/J\s*A\s*N\s*U\s*A\s*R\s*Y/gi, "JANUARY")
    .replace(/F\s*E\s*B\s*R\s*U\s*A\s*R\s*Y/gi, "FEBRUARY")
    .replace(/M\s*A\s*R\s*C\s*H/gi, "MARCH")
    .replace(/A\s*P\s*R\s*I\s*L/gi, "APRIL")
    .replace(/J\s*U\s*N\s*E/gi, "JUNE")
    .replace(/J\s*U\s*L\s*Y/gi, "JULY")
    .replace(/A\s*U\s*G\s*U\s*S\s*T/gi, "AUGUST")
    .replace(/S\s*E\s*P\s*T\s*E\s*M\s*B\s*E\s*R/gi, "SEPTEMBER")
    .replace(/O\s*C\s*T\s*O\s*B\s*E\s*R/gi, "OCTOBER")
    .replace(/N\s*O\s*V\s*E\s*M\s*B\s*E\s*R/gi, "NOVEMBER")
    .replace(/D\s*E\s*C\s*E\s*M\s*B\s*E\s*R/gi, "DECEMBER")
    // Collapse any remaining letter-spaced uppercase words
    .replace(/(?<![A-Za-z])(?:[A-Z] ){2,}[A-Z](?![A-Za-z])/g, (m) =>
      m.replace(/ /g, "")
    )
    // Collapse letter-spaced digit runs
    .replace(/(?<=\b)(\d) (\d)(?=\b)/g, "$1$2")
    .replace(/(?<=\b)(\d) (\d)(?=\b)/g, "$1$2")
    // Remove spurious space before range hyphen
    .replace(/([A-Z]{3,})\s*(\d{1,2})\s*[-\u2013\u2014]\s*(\d{1,2})/gi, "$1 $2-$3")
    // Collapse "20 26" -> "2026"
    .replace(/\b(20)\s(\d{2})\b/g, "$1$2");
}

function monthNameFromNum(monthNum: number): string {
  const names = [
    "", "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
  ];
  return names[monthNum] ?? "JANUARY";
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

  // Sort: segment order first (T→M→L), then by part number within segment.
  // This keeps the stored assignment array in a logical reading order even
  // when pdf.js returns text items out of sequence.
  const SEG_RANK: Record<string, number> = { treasures: 0, ministry: 1, living: 2 };
  parts.sort(
    (a, b) =>
      (SEG_RANK[a.segment] ?? 9) - (SEG_RANK[b.segment] ?? 9) ||
      a.number - b.number
  );
  return parts;
}

interface SegmentMarker {
  id: SegmentId;
  start: number; // offset in slice AFTER the heading (so we don't scan it again)
}

function findSegmentMarkers(slice: string): SegmentMarker[] {
  // Search T → M → L in canonical order: each heading must appear *after*
  // the previous one in the text.  This prevents out-of-order or repeated
  // hits (page footers, running headers, ToC lines) from corrupting the
  // body boundaries that extractParts relies on.
  const out: SegmentMarker[] = [];
  let cursor = 0;
  for (const id of ["treasures", "ministry", "living"] as (keyof typeof SEGMENT_RE)[]) {
    const m = new RegExp(SEGMENT_RE[id].source, "i").exec(slice.slice(cursor));
    if (!m) continue;
    const absStart = cursor + m.index + m[0].length;
    out.push({ id, start: absStart });
    cursor = absStart; // next heading must come strictly after this one
  }
  return out; // already in T→M→L order — no sort needed
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
  let title = cleanTitle(rawText);
  
  if (!title || /^[.\s]*$/.test(title)) {
    const partType = inferPartType(segment, "", number);
    return { number, segment, partType, title: partType, minutes };
  }

  const partType = inferPartType(segment, title, number);
  return { number, segment, partType, title, minutes };
}

function extractMinutes(raw: string): number | undefined {
  const m = /\((\d{1,3})\s*min\.?\)/i.exec(raw);
  return m ? parseInt(m[1], 10) : undefined;
}

/** Strip "(n min.)" suffixes and trailing body-text run-on. */
function cleanTitle(raw: string): string {
  let title = raw
    // drop any "(n min.)" marker and everything after it (this keeps the 
    // importer neat by cutting off the body text that often follows).
    .replace(/\s*\(\s*\d+\s*min\.?.*$/i, "")
    .trim();
  // Drop stray trailing punctuation
  title = title.replace(/[.\s:]+$/, "").trim();
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
