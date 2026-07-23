import { detectYear as inferYear } from "./utils";
import mammoth from "mammoth";
import { extractPdfText } from "./workbookParser";

export interface ParsedWeekendMeeting {
  weekOf: string;
  banner: string;
  meetingDate?: string;
  publicTalkSpeakerType?: "local" | "visiting";
  rawSpeaker?: string;
  rawSpeakerCongregation?: string;
  publicTalkTitle?: string;
  publicTalkNumber?: number;
  rawChairman?: string;
  rawConductor?: string;
  rawReader?: string;
}

const MONTHS: Record<string, number> = {
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4,
  MAY: 5, JUNE: 6, JULY: 7, AUGUST: 8,
  SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
  JAN: 1, FEB: 2, MAR: 3, APR: 4, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
const MONTHS_RE = Object.keys(MONTHS).join("|");

const BANNER_RE = new RegExp(
  `(${MONTHS_RE})\\s+(\\d{1,2})\\s*[-\\u2010-\\u2015\\u2212~]\\s*(?:(${MONTHS_RE})\\s+)?(\\d{1,2})`,
  "i"
);

/* ------------------------------------------------------------------ */
/*  Text normalisation                                                 */
/* ------------------------------------------------------------------ */

function normalise(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-");
}

/* ------------------------------------------------------------------ */
/*  Speaker / congregation helper                                      */
/* ------------------------------------------------------------------ */

function parseSpeaker(raw: string): { name: string; congregation?: string } {
  let name = raw.trim();
  let congregation: string | undefined = undefined;

  // E.g., "John Doe (East Congregation)"
  const paren = /\(([^)]+)\)/.exec(name);
  if (paren) {
    congregation = paren[1].trim();
    name = name.replace(/\([^)]+\)/, "").trim();
  } else {
    // E.g., "John Doe - East Congregation"
    const dash = /-\s*(.+)/.exec(name);
    if (dash) {
      congregation = dash[1].trim();
      name = name.slice(0, name.indexOf("-")).trim();
    }
  }

  // Remove any "visiting from" or "from" prefix in congregation
  if (congregation) {
    congregation = congregation.replace(/^(visiting from|from)\s+/i, "").trim();
  }

  return { name, congregation };
}

/* ------------------------------------------------------------------ */
/*  Date helpers                                                       */
/* ------------------------------------------------------------------ */

// Snap any date to its ISO Monday (weekOf key)
function getMondayIso(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Detect whether numeric dates use DD/MM/YYYY order.
 * If any date's first component is > 12 it MUST be the day, proving DD/MM.
 * If any date's second component is > 12, it's the day, proving MM/DD.
 * Defaults to DD/MM (international standard) when ambiguous.
 */
function detectIsDMY(text: string): boolean {
  const rx = /\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const first = parseInt(m[1], 10);
    const second = parseInt(m[2], 10);
    if (first > 12) return true;   // first > 12 ⇒ must be day ⇒ DD/MM
    if (second > 12) return false;  // second > 12 ⇒ must be day ⇒ MM/DD
  }
  return true; // default DD/MM
}

/**
 * Try to parse a date from anywhere in the line.
 * `isDMY` controls interpretation of ambiguous numeric dates.
 */
function parseDateInLine(line: string, year: number, isDMY: boolean): Date | null {
  // 1. YYYY-MM-DD
  const ymd = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(line);
  if (ymd) {
    return new Date(
      Date.UTC(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10))
    );
  }

  // 2. DD/MM/YYYY or MM/DD/YYYY
  const numDate = /\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/.exec(line);
  if (numDate) {
    const a = parseInt(numDate[1], 10);
    const b = parseInt(numDate[2], 10);
    const y = parseInt(numDate[3], 10);
    if (isDMY) {
      return new Date(Date.UTC(y, b - 1, a)); // a=day, b=month
    } else {
      return new Date(Date.UTC(y, a - 1, b)); // a=month, b=day
    }
  }

  // 3. "Month Day[, Year]" e.g. "July 12, 2026"
  const regex1 = new RegExp(
    `\\b(${MONTHS_RE})\\s+(\\d{1,2})\\b(?:\\s*,?\\s*\\b(20\\d{2})\\b)?`, "i"
  );
  let match = regex1.exec(line);
  if (match) {
    const mo = MONTHS[match[1].toUpperCase()];
    const day = parseInt(match[2], 10);
    const y = match[3] ? parseInt(match[3], 10) : year;
    if (mo) return new Date(Date.UTC(y, mo - 1, day));
  }

  // 4. "Day Month[, Year]" e.g. "12 July 2026"
  const regex2 = new RegExp(
    `\\b(\\d{1,2})\\s+(${MONTHS_RE})\\b(?:\\s*,?\\s*\\b(20\\d{2})\\b)?`, "i"
  );
  match = regex2.exec(line);
  if (match) {
    const day = parseInt(match[1], 10);
    const mo = MONTHS[match[2].toUpperCase()];
    const y = match[3] ? parseInt(match[3], 10) : year;
    if (mo) return new Date(Date.UTC(y, mo - 1, day));
  }

  // 5. Range banner  e.g. "May 4-10"
  match = BANNER_RE.exec(line);
  if (match) {
    const mo = MONTHS[match[1].toUpperCase()];
    const day = parseInt(match[2], 10);
    if (mo) return new Date(Date.UTC(year, mo - 1, day));
  }

  return null;
}

/**
 * Strip the date token from the beginning of a line, returning
 * everything after the date portion.
 */
function stripDatePrefix(line: string): string {
  let s = line;
  // DD/MM/YYYY or MM/DD/YYYY
  s = s.replace(/^\s*\d{1,2}[-/]\d{1,2}[-/]\d{4}\s*/, "");
  // YYYY-MM-DD
  s = s.replace(/^\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*/, "");
  // Month-name banner  e.g. "May 4-10"
  const bannerRx = new RegExp(
    `^\\s*(?:${MONTHS_RE})\\s+\\d{1,2}\\s*[-\\u2010-\\u2015\\u2212~]\\s*(?:(?:${MONTHS_RE})\\s+)?\\d{1,2}\\s*`,
    "i"
  );
  s = s.replace(bannerRx, "");
  // "Month Day[, Year]" or "Day Month[, Year]"
  const monthNameRx = new RegExp(
    `^\\s*(?:(?:${MONTHS_RE})\\s+\\d{1,2}|\\d{1,2}\\s+(?:${MONTHS_RE}))(?:\\s*,?\\s*20\\d{2})?\\s*`,
    "i"
  );
  s = s.replace(monthNameRx, "");
  return s.trim();
}

/* ------------------------------------------------------------------ */
/*  Document entry points                                              */
/* ------------------------------------------------------------------ */

export async function parseWeekendDocx(
  file: File,
  forcedYear?: number
): Promise<ParsedWeekendMeeting[]> {
  const buf = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return parseWeekendText(value, forcedYear, file.name);
}

export async function parseWeekendPdf(
  file: File,
  forcedYear?: number
): Promise<ParsedWeekendMeeting[]> {
  const result = await extractPdfText(file);
  return parseWeekendText(result.fullText, forcedYear, file.name);
}

/* ------------------------------------------------------------------ */
/*  Main text → ParsedWeekendMeeting[] pipeline                        */
/* ------------------------------------------------------------------ */

export function parseWeekendText(
  raw: string,
  forcedYear?: number,
  filename?: string
): ParsedWeekendMeeting[] {
  const text = normalise(raw);
  const lines = text.split("\n");
  const year = forcedYear ?? inferYear(text, filename);
  const isDMY = detectIsDMY(text);

  /* ---- split lines into date-headed blocks ---- */
  interface Block {
    date: Date;
    dateLine: string;
    continuations: string[];
  }

  const blocks: Block[] = [];
  let cur: Block | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const d = parseDateInLine(line, year, isDMY);
    if (d) {
      if (cur) blocks.push(cur);
      cur = { date: d, dateLine: line, continuations: [] };
    } else if (cur) {
      cur.continuations.push(line);
    }
  }
  if (cur) blocks.push(cur);

  /* ---- sort chronologically ---- */
  blocks.sort((a, b) => a.date.getTime() - b.date.getTime());

  /* ---- parse each block ---- */
  const results: ParsedWeekendMeeting[] = [];
  for (const block of blocks) {
    const monday = getMondayIso(block.date.toISOString().split("T")[0]);
    const parsed = parseBlock(block, monday);
    if (parsed) results.push(parsed);
  }

  return results;
}

/* ------------------------------------------------------------------ */
/*  Block parser – dispatches between tabular and labeled layouts       */
/* ------------------------------------------------------------------ */

/**
 * Handles two layout styles:
 *
 * **Tabular** (no field labels, typical for PDF table schedules):
 *   DATE  [TOPIC TEXT]  TALK_NO  SPEAKER  CHAIRMAN  READER
 *
 * **Labeled** (keyword headers like "Chairman:", "Speaker:"):
 *   Chairman: Name
 *   Speaker: Name (Congregation)
 *   ...
 */
function parseBlock(
  block: { date: Date; dateLine: string; continuations: string[] },
  weekOf: string
): ParsedWeekendMeeting {
  const content = stripDatePrefix(block.dateLine);
  const allLines = [content, ...block.continuations];

  // Detect which format by checking for keyword labels
  const hasLabels = allLines.some((l) =>
    /\b(?:Chairman|Speaker|Reader|Conductor|Outline|Presiding)\s*[:#]/i.test(l)
  );

  if (hasLabels) {
    return parseLabeledBlock(allLines, weekOf, block.date);
  }
  return parseTabularBlock(content, block.continuations, weekOf, block.date);
}

/* ------------------------------------------------------------------ */
/*  Tabular layout parser                                              */
/*                                                                     */
/*  The PDF table has columns:                                         */
/*    DATE | TOPIC | TALK NO | SPEAKER | CHAIRMAN | READER             */
/*                                                                     */
/*  After the date is stripped the remaining text on the date line is:  */
/*    [TOPIC TEXT] <TALK_NO> <SPEAKER 2 words> <CHAIRMAN 2> <READER 2> */
/*                                                                     */
/*  Names are assumed to be two-word pairs (FIRST LAST).               */
/* ------------------------------------------------------------------ */

function parseTabularBlock(
  content: string,
  continuations: string[],
  weekOf: string,
  date: Date
): ParsedWeekendMeeting {
  let publicTalkNumber: number | undefined;
  let publicTalkTitle: string | undefined;
  let rawSpeaker: string | undefined;
  let rawChairman: string | undefined;
  let rawReader: string | undefined;

  // Find the talk number: a standalone number 1–200 on the date line
  const numRx = /\b(\d{1,3})\b/g;
  let nm;
  const numMatches: { num: number; index: number; len: number }[] = [];
  while ((nm = numRx.exec(content)) !== null) {
    const n = parseInt(nm[1], 10);
    if (n >= 1 && n <= 200) {
      numMatches.push({ num: n, index: nm.index, len: nm[0].length });
    }
  }

  if (numMatches.length > 0) {
    // Use the first valid number as the talk number
    const talkMatch = numMatches[0];
    publicTalkNumber = talkMatch.num;

    // Topic text = everything BEFORE the talk number
    const topicOnLine = content.substring(0, talkMatch.index).trim();

    // Names text = everything AFTER the talk number
    const namesText = content.substring(talkMatch.index + talkMatch.len).trim();

    // Split names into 2-word pairs: Speaker, Chairman, Reader
    const words = namesText.split(/\s+/).filter(Boolean);
    if (words.length >= 2) rawSpeaker = words.slice(0, 2).join(" ");
    if (words.length >= 4) rawChairman = words.slice(2, 4).join(" ");
    if (words.length >= 6) rawReader = words.slice(4, 6).join(" ");

    // Collect topic from the date line + sentence-like continuation lines
    const topicParts: string[] = [];
    if (topicOnLine) topicParts.push(topicOnLine);

    for (const cont of continuations) {
      const ct = cont.trim();
      if (!ct) continue;
      const cWords = ct.split(/\s+/);
      // Skip lines that look like isolated name fragments (1–2 uppercase words)
      if (
        cWords.length <= 2 &&
        cWords.every((w) => /^[A-Z][A-Z.']*$/.test(w))
      ) {
        continue;
      }
      // Include sentence-like fragments (questions, quotes, multi-word phrases)
      topicParts.push(ct);
    }
    if (topicParts.length > 0) {
      publicTalkTitle = topicParts
        .join(" ")
        .replace(/^["'""\s]+|["'""\s]+$/g, "")
        .trim();
    }

    // Try to recover a missing Reader from continuation lines
    if (!rawReader) {
      // Look for a 2-word all-caps name pair in the continuations
      for (const cont of continuations) {
        const cWords = cont.trim().split(/\s+/).filter(Boolean);
        if (
          cWords.length === 2 &&
          cWords.every((w) => /^[A-Z]/.test(w))
        ) {
          rawReader = cWords.join(" ");
          break;
        }
      }
    }
  } else {
    // No talk number — special event (Circuit Overseer, Assembly, etc.)
    const parts = [content, ...continuations.map((c) => c.trim())].filter(Boolean);
    publicTalkTitle = parts.join(" ").trim() || undefined;
  }

  return buildResult(
    weekOf,
    date,
    publicTalkNumber,
    publicTalkTitle,
    rawSpeaker,
    undefined,
    rawChairman,
    undefined,
    rawReader
  );
}

/* ------------------------------------------------------------------ */
/*  Labeled layout parser (keyword-header format)                      */
/* ------------------------------------------------------------------ */

function parseLabeledBlock(
  allLines: string[],
  weekOf: string,
  date: Date
): ParsedWeekendMeeting {
  let publicTalkNumber: number | undefined;
  let publicTalkTitle: string | undefined;
  let rawSpeaker: string | undefined;
  let rawSpeakerCongregation: string | undefined;
  let rawChairman: string | undefined;
  let rawConductor: string | undefined;
  let rawReader: string | undefined;

  // Re-join and split on keyword boundaries to create clean segments
  const combined = allLines.join(" ");
  const segments = combined
    .split(
      /(?=\b(?:Chairman|Presiding|Speaker|Lecturer|Talk\s+by|(?:WT\s+)?Conductor|(?:WT\s+)?Reader|Outline|No\.)\s*[:#]?\s)/i
    )
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segments) {
    let m;

    m = /^(?:Chairman|Presiding|Preside)\s*[:#]?\s*(.+)/i.exec(seg);
    if (m) {
      rawChairman = m[1].trim().replace(/\s*[,;]$/, "");
      continue;
    }

    m = /^(?:WT\s+Conductor|Watchtower\s+Conductor|Conductor)\s*[:#]?\s*(.+)/i.exec(seg);
    if (m) {
      rawConductor = m[1].trim().replace(/\s*[,;]$/, "");
      continue;
    }

    m = /^(?:WT\s+Reader|Watchtower\s+Reader|Reader)\s*[:#]?\s*(.+)/i.exec(seg);
    if (m) {
      rawReader = m[1].trim().replace(/\s*[,;]$/, "");
      continue;
    }

    m = /^(?:Speaker|Lecturer|Talk\s+by)\s*[:#]?\s*(.+)/i.exec(seg);
    if (m) {
      const sp = parseSpeaker(m[1].replace(/\s*[,;]$/, ""));
      rawSpeaker = sp.name;
      rawSpeakerCongregation = sp.congregation;
      continue;
    }

    m = /^(?:Outline|Talk|No\.)\s*[:#]?\s*(\d{1,3})\b\s*[:.–\-]?\s*(.*)/i.exec(seg);
    if (m) {
      publicTalkNumber = parseInt(m[1], 10);
      if (m[2].trim()) {
        publicTalkTitle = m[2].trim().replace(/^["'""]|["'""]$/g, "");
      }
      continue;
    }

    m = /^(\d{1,3})\b\s*[:.–\-]?\s*(.+)/.exec(seg);
    if (m) {
      const num = parseInt(m[1], 10);
      if (num >= 1 && num <= 200) {
        publicTalkNumber = num;
        const rest = m[2].trim();
        if (rest && !/^(?:Chairman|Speaker|Reader|Conductor|Song|Prayer)/i.test(rest)) {
          publicTalkTitle = rest.replace(/^["'""]|["'""]$/g, "");
        }
        continue;
      }
    }
  }

  return buildResult(
    weekOf,
    date,
    publicTalkNumber,
    publicTalkTitle,
    rawSpeaker,
    rawSpeakerCongregation,
    rawChairman,
    rawConductor,
    rawReader
  );
}

/* ------------------------------------------------------------------ */
/*  Result builder                                                     */
/* ------------------------------------------------------------------ */

function buildResult(
  weekOf: string,
  date: Date,
  publicTalkNumber: number | undefined,
  publicTalkTitle: string | undefined,
  rawSpeaker: string | undefined,
  rawSpeakerCongregation: string | undefined,
  rawChairman: string | undefined,
  rawConductor: string | undefined,
  rawReader: string | undefined
): ParsedWeekendMeeting {
  const mon = new Date(weekOf + "T00:00:00");
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  const SHORT = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  ];
  const mMon = SHORT[mon.getMonth()];
  const mSun = SHORT[sun.getMonth()];
  const banner =
    mMon === mSun
      ? `${mMon} ${mon.getDate()}-${sun.getDate()}`
      : `${mMon} ${mon.getDate()}-${mSun} ${sun.getDate()}`;

  return {
    weekOf,
    banner,
    meetingDate: date.toISOString().split("T")[0],
    publicTalkNumber,
    publicTalkTitle,
    rawSpeaker,
    rawSpeakerCongregation,
    rawChairman,
    rawConductor,
    rawReader,
  };
}
