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
  JAN: 1, FEB: 2, MAR: 3, APR: 4, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12
};
const MONTHS_RE = Object.keys(MONTHS).join("|");

const BANNER_RE = new RegExp(
  `(${MONTHS_RE})\\s+(\\d{1,2})\\s*[-\\u2010-\\u2015\\u2212~]\\s*(?:(${MONTHS_RE})\\s+)?(\\d{1,2})`,
  "i"
);

function normalise(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-");
}

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

// Snap date to Monday
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

export function parseWeekendText(
  raw: string,
  forcedYear?: number,
  filename?: string
): ParsedWeekendMeeting[] {
  const text = normalise(raw);
  const lines = text.split("\n");
  const year = forcedYear ?? inferYear(text, filename);

  const results: ParsedWeekendMeeting[] = [];
  let currentBlock: { date: Date; lines: string[] } | null = null;
  const blocks: { date: Date; lines: string[] }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Detect if this line starts a week block by matching a date
    const d = parseDateInLine(line, year);
    if (d) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = { date: d, lines: [line] };
    } else if (currentBlock) {
      currentBlock.lines.push(line);
    }
  }
  if (currentBlock) {
    blocks.push(currentBlock);
  }

  for (const block of blocks) {
    const monday = getMondayIso(block.date.toISOString().split("T")[0]);
    const parsed = parseBlockLines(block.lines, monday);
    if (parsed) {
      results.push(parsed);
    }
  }

  return results;
}

function parseDateInLine(line: string, year: number): Date | null {
  // Try YYYY-MM-DD
  const ymd = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(line);
  if (ymd) {
    return new Date(Date.UTC(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10)));
  }

  // Try MM/DD/YYYY
  const mdy = /\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/.exec(line);
  if (mdy) {
    return new Date(Date.UTC(parseInt(mdy[3], 10), parseInt(mdy[1], 10) - 1, parseInt(mdy[2], 10)));
  }

  // Try Month Day, Year or Day Month Year
  const regex1 = new RegExp(`\\b(${MONTHS_RE})\\s+(\\d{1,2})\\b(?:\\s*,?\\s*\\b(20\\d{2})\\b)?`, "i");
  const regex2 = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS_RE})\\b(?:\\s*,?\\s*\\b(20\\d{2})\\b)?`, "i");

  let match = regex1.exec(line);
  if (match) {
    const monthName = match[1].toUpperCase();
    const day = parseInt(match[2], 10);
    const y = match[3] ? parseInt(match[3], 10) : year;
    const m = MONTHS[monthName];
    if (m) return new Date(Date.UTC(y, m - 1, day));
  }

  match = regex2.exec(line);
  if (match) {
    const day = parseInt(match[1], 10);
    const monthName = match[2].toUpperCase();
    const y = match[3] ? parseInt(match[3], 10) : year;
    const m = MONTHS[monthName];
    if (m) return new Date(Date.UTC(y, m - 1, day));
  }

  // Try range banner (e.g. "May 4-10")
  match = BANNER_RE.exec(line);
  if (match) {
    const monthName = match[1].toUpperCase();
    const day = parseInt(match[2], 10);
    const m = MONTHS[monthName];
    if (m) return new Date(Date.UTC(year, m - 1, day));
  }

  return null;
}

function parseBlockLines(lines: string[], weekOf: string): ParsedWeekendMeeting | null {
  if (lines.length === 0) return null;

  let publicTalkNumber: number | undefined = undefined;
  let publicTalkTitle: string | undefined = undefined;
  let rawSpeaker: string | undefined = undefined;
  let rawSpeakerCongregation: string | undefined = undefined;
  let rawChairman: string | undefined = undefined;
  let rawConductor: string | undefined = undefined;
  let rawReader: string | undefined = undefined;

  for (const line of lines) {
    // Check Chairman
    let m = /(?:Chairman|Presiding|Preside):\s*(.+)/i.exec(line);
    if (!m) m = /(?:Chairman|Presiding|Preside)\s+([A-Z][a-zA-Z'. -]+)/i.exec(line);
    if (m) { rawChairman = m[1].trim(); continue; }

    // Check Conductor
    m = /(?:Conductor|WT Conductor|Watchtower Conductor):\s*(.+)/i.exec(line);
    if (!m) m = /(?:Conductor|WT Conductor|Watchtower Conductor)\s+([A-Z][a-zA-Z'. -]+)/i.exec(line);
    if (m) { rawConductor = m[1].trim(); continue; }

    // Check Reader
    m = /(?:Reader|WT Reader|Watchtower Reader):\s*(.+)/i.exec(line);
    if (!m) m = /(?:Reader|WT Reader|Watchtower Reader)\s+([A-Z][a-zA-Z'. -]+)/i.exec(line);
    if (m) { rawReader = m[1].trim(); continue; }

    // Check Speaker
    m = /(?:Speaker|Lecturer|Talk by):\s*(.+)/i.exec(line);
    if (!m) m = /(?:Speaker|Lecturer|Talk by)\s+([A-Z][a-zA-Z'. -]+)/i.exec(line);
    if (m) {
      const sp = parseSpeaker(m[1]);
      rawSpeaker = sp.name;
      rawSpeakerCongregation = sp.congregation;
      continue;
    }

    // Check Outline Outline #45 / Outline 45 / No. 45 / Talk #45
    m = /(?:Outline|Talk|No\.|#)\s*(\d{1,3})\b\s*[:.-]?\s*(.*)/i.exec(line);
    if (m) {
      publicTalkNumber = parseInt(m[1], 10);
      if (m[2].trim()) {
        publicTalkTitle = m[2].trim();
      }
      continue;
    }

    m = /^(\d{1,3})\b\s*[:.-]?\s*(.*)/.exec(line);
    if (m) {
      const num = parseInt(m[1], 10);
      if (num > 0 && num <= 200) {
        publicTalkNumber = num;
        if (m[2].trim()) {
          publicTalkTitle = m[2].trim();
        }
        continue;
      }
    }

    // If we have a talk number but no title, grab it
    if (publicTalkNumber !== undefined && !publicTalkTitle && !line.includes("Song") && !line.includes("Prayer")) {
      publicTalkTitle = line.replace(/^["'“”]|["'“”]$/g, "").trim();
    }
  }

  // Render a clean banner label for display
  const mon = new Date(weekOf + "T00:00:00");
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  const MONTH_NAMES_SHORT = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const mMon = MONTH_NAMES_SHORT[mon.getMonth()];
  const mSun = MONTH_NAMES_SHORT[sun.getMonth()];
  const banner = mMon === mSun
    ? `${mMon} ${mon.getDate()}-${sun.getDate()}`
    : `${mMon} ${mon.getDate()}-${mSun} ${sun.getDate()}`;

  return {
    weekOf,
    banner,
    meetingDate: lines[0] ? parseDateInLine(lines[0], mon.getFullYear())?.toISOString().split("T")[0] : undefined,
    publicTalkNumber,
    publicTalkTitle,
    rawSpeaker,
    rawSpeakerCongregation,
    rawChairman,
    rawConductor,
    rawReader,
  };
}
