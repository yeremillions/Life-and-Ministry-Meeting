/**
 * pdfExport.ts
 *
 * Generates a Midweek Meeting Schedule PDF that closely follows the layout
 * of the official S-140 schedule template.
 *
 * Layout per week (A4, portrait):
 *   - Header row: congregation name (left) | "Midweek Meeting Schedule" (right)
 *   - Week banner: date range | bible reading  +  Chairman / Prayer (right column)
 *   - Song + Opening Comments row
 *   - Coloured segment bars (TREASURES / APPLY YOURSELF / LIVING AS CHRISTIANS)
 *   - Numbered part rows with name column on the right
 *   - Concluding song + closing prayer row
 *
 * Two weeks fit on one A4 page with a divider line between them.
 */

import { jsPDF } from "jspdf";
import type { Assignee, Assignment, Week } from "./types";
import { weekRangeLabel } from "./utils";

// ─── Colour palette (matches the physical S-140 template) ────────────────────
const COLOUR = {
  treasuresBg: [66, 66, 66] as [number, number, number],   // dark grey
  ministryBg:  [180, 115, 30] as [number, number, number], // amber / gold
  livingBg:    [120, 20, 40] as [number, number, number],  // dark red/maroon
  headerLine:  [30, 30, 30] as [number, number, number],
  textMain:    [20, 20, 20] as [number, number, number],
  textGrey:    [110, 110, 110] as [number, number, number],
  textWhite:   [255, 255, 255] as [number, number, number],
  divider:     [200, 200, 200] as [number, number, number],
};

// ─── Page geometry (mm, A4 portrait) ─────────────────────────────────────────
const PAGE_W  = 210;
const MARGIN  = 14;
const COL_W   = PAGE_W - MARGIN * 2;   // usable width
const NAME_W  = 60;                     // right-hand name column width
const TEXT_W  = COL_W - NAME_W - 4;    // left content column width
const NAME_X  = MARGIN + TEXT_W + 4;   // x start of name column

// ─── Font sizes ───────────────────────────────────────────────────────────────
const FS = {
  heading:   16,
  congName:  10,
  banner:    10,
  label:      7.5,
  body:       8.5,
  segHeader:  8,
};

// ─── Row heights / spacing ────────────────────────────────────────────────────
const ROW_H       = 6;    // standard part row height
const SEG_BAR_H   = 6.5; // segment header bar
const BANNER_H    = 10;  // week banner area height
const HEADER_H    = 12;  // doc header height

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ExportOptions {
  congregationName: string;
  weeks: Week[];
  assignees: Assignee[];
}

/**
 * Generate a PDF and trigger a browser download.
 * Returns false if there is nothing to export.
 */
export function exportSchedulePdf(opts: ExportOptions): boolean {
  const { weeks, assignees, congregationName } = opts;
  if (weeks.length === 0) return false;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  doc.setFont("helvetica");

  // Sort weeks chronologically
  const sorted = [...weeks].sort((a, b) => a.weekOf.localeCompare(b.weekOf));

  // Two weeks per page
  let yTop = MARGIN; // current Y origin for the week being rendered

  for (let i = 0; i < sorted.length; i++) {
    const week = sorted[i];
    const isSecond = i % 2 === 1;

    if (isSecond) {
      // Draw divider between the two weeks on this page
      doc.setDrawColor(...COLOUR.divider);
      doc.setLineWidth(0.4);
      doc.line(MARGIN, yTop - 3, MARGIN + COL_W, yTop - 3);
    }

    if (i > 0 && i % 2 === 0) {
      // New page for every pair of weeks
      doc.addPage();
      yTop = MARGIN;
    }

    yTop = renderWeek(doc, week, assignees, congregationName, yTop);
    yTop += 6; // gap between weeks
  }

  const filename =
    sorted.length === 1
      ? `schedule-${sorted[0].weekOf}.pdf`
      : `schedule-${sorted[0].weekOf}--${sorted[sorted.length - 1].weekOf}.pdf`;

  doc.save(filename);
  return true;
}

// ─── Render one week ──────────────────────────────────────────────────────────

function renderWeek(
  doc: jsPDF,
  week: Week,
  assignees: Assignee[],
  congregationName: string,
  startY: number
): number {
  let y = startY;
  const sortedA = [...week.assignments].sort((a, b) => a.order - b.order);

  // Helper: resolve a name from an ID
  const name = (id?: number) =>
    id != null ? (assignees.find((a) => a.id === id)?.name ?? "") : "";

  // ── Doc header (congregation / title) ────────────────────────────────────
  doc.setFontSize(FS.congName);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLOUR.textMain);
  doc.text((congregationName || "Congregation").toUpperCase(), MARGIN, y + 6);

  doc.setFontSize(FS.heading);
  doc.text("Midweek Meeting Schedule", MARGIN + COL_W, y + 7, { align: "right" });

  // Underline
  doc.setDrawColor(...COLOUR.headerLine);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y + HEADER_H - 1, MARGIN + COL_W, y + HEADER_H - 1);
  y += HEADER_H;

  // ── Week banner (date | bible reading / Chairman / Prayer) ───────────────
  const chairman  = name(sortedA.find((a) => a.partType === "Chairman")?.assigneeId);
  const openPrayer = name(sortedA.find((a) => a.partType === "Opening Prayer")?.assigneeId);

  const dateLabel = weekRangeLabel(week.weekOf).toUpperCase();
  const bibleRef  = week.weeklyBibleReading ?? "";
  const bannerText = bibleRef ? `${dateLabel}  |  ${bibleRef}` : dateLabel;

  doc.setFontSize(FS.banner);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLOUR.textMain);
  doc.text(bannerText, MARGIN, y + 5);

  // Right-side labels
  const labelX = NAME_X - 2;
  doc.setFontSize(FS.label);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLOUR.textGrey);
  doc.text("Chairman:", labelX, y + 3.5, { align: "right" });
  doc.text("Prayer:", labelX, y + 8.5, { align: "right" });

  doc.setFontSize(FS.body);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLOUR.textMain);
  doc.text(chairman || "—", MARGIN + COL_W, y + 3.5, { align: "right" });
  doc.text(openPrayer || "—", MARGIN + COL_W, y + 8.5, { align: "right" });

  y += BANNER_H;

  // ── Filter out opening-segment parts (handled above) ─────────────────────
  const parts = sortedA.filter(
    (a) => a.partType !== "Chairman" && a.partType !== "Opening Prayer"
  );

  // Separate closing prayer (lives at the very bottom)
  const closingPrayerAssignment = parts.find((a) => a.partType === "Closing Prayer");
  const bodyParts = parts.filter((a) => a.partType !== "Closing Prayer");

  // ── Render body parts by segment ─────────────────────────────────────────
  let currentSegment: string | null = null;
  let partNumber = 1;

  for (const part of bodyParts) {
    // Emit segment header bar when segment changes
    if (part.segment !== currentSegment) {
      currentSegment = part.segment;
      partNumber = 1; // reset numbering per segment
      if (part.segment === "treasures") {
        y = drawSegmentBar(doc, y, "TREASURES FROM GOD'S WORD", COLOUR.treasuresBg);
      } else if (part.segment === "ministry") {
        y = drawSegmentBar(doc, y, "APPLY YOURSELF TO THE FIELD MINISTRY", COLOUR.ministryBg);
      } else if (part.segment === "living") {
        y = drawSegmentBar(doc, y, "LIVING AS CHRISTIANS", COLOUR.livingBg);
      }
    }

    y = drawPartRow(doc, part, partNumber, name, y);
    partNumber++;
  }

  // ── Closing prayer row ────────────────────────────────────────────────────
  y += 2;
  const closingPrayerName = name(closingPrayerAssignment?.assigneeId);
  doc.setFontSize(FS.label);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLOUR.textGrey);
  doc.text("Prayer:", labelX, y + 4, { align: "right" });
  doc.setFontSize(FS.body);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLOUR.textMain);
  doc.text(closingPrayerName || "—", MARGIN + COL_W, y + 4, { align: "right" });
  y += ROW_H + 2;

  return y;
}

// ─── Draw a coloured segment header bar ──────────────────────────────────────

function drawSegmentBar(
  doc: jsPDF,
  y: number,
  label: string,
  bgColour: [number, number, number]
): number {
  doc.setFillColor(...bgColour);
  doc.rect(MARGIN, y, COL_W, SEG_BAR_H, "F");

  doc.setFontSize(FS.segHeader);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLOUR.textWhite);
  doc.text(label, MARGIN + 2, y + SEG_BAR_H - 1.8);

  // "Main Hall" label on the right inside the bar
  doc.setFontSize(FS.label);
  doc.setFont("helvetica", "normal");
  doc.text("Main Hall", MARGIN + COL_W - 2, y + SEG_BAR_H - 1.8, { align: "right" });

  doc.setTextColor(...COLOUR.textMain);
  return y + SEG_BAR_H + 1;
}

// ─── Draw a single part row ───────────────────────────────────────────────────

function drawPartRow(
  doc: jsPDF,
  part: Assignment,
  partNumber: number,
  name: (id?: number) => string,
  y: number
): number {
  const mainName = name(part.assigneeId);
  const assistName = name(part.assistantId);

  // Format name column: "Main/Assistant" for demo pairs; just name otherwise
  let nameText = mainName || "—";
  if (assistName) {
    nameText = `${mainName || "—"}/${assistName}`;
  }

  // Special label for CBS
  let nameLabel = nameText;
  if (part.partType === "Congregation Bible Study" && (mainName || assistName)) {
    const conductor = mainName || "—";
    const reader = assistName || "—";
    nameLabel = `${conductor}/ ${reader}`;
  }

  // Part title text (number + title, truncated to fit)
  const titleText = formatPartTitle(part, partNumber);

  doc.setFontSize(FS.body);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLOUR.textMain);

  // Truncate title if it would overflow into the name column
  const maxTitleW = TEXT_W - 2;
  const titleLines = doc.splitTextToSize(titleText, maxTitleW) as string[];
  const titleLine  = titleLines[0]; // single-line only; clip overflow

  doc.text(titleLine, MARGIN + 2, y + 4.5);
  doc.text(nameLabel, MARGIN + COL_W, y + 4.5, { align: "right" });

  // Special "Conductor/Reader:" label for CBS
  if (part.partType === "Congregation Bible Study") {
    doc.setFontSize(FS.label);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLOUR.textGrey);
    doc.text("Conductor/Reader:", NAME_X - 2, y + 4.5, { align: "right" });
    doc.setTextColor(...COLOUR.textMain);
    doc.setFontSize(FS.body);
  }

  return y + ROW_H;
}

// ─── Format the display label for a part row ─────────────────────────────────

function formatPartTitle(part: Assignment, num: number): string {
  const title = part.title?.trim();

  switch (part.partType) {
    case "Talk":
      return title ? `${num}. ${title} (10 min.)` : `${num}. [Title]  (10 min.)`;
    case "Spiritual Gems":
      return `${num}. Spiritual Gems  (10 min.)`;
    case "Bible Reading":
      return title ? `${num}. Bible Reading — ${title}  (4 min.)` : `${num}. Bible Reading  (4 min.)`;
    case "Congregation Bible Study":
      return title ? `${num}. Congregation Bible Study — ${title}  (30 min.)` : `${num}. Congregation Bible Study  (30 min.)`;
    case "Local Needs":
      return `${num}. Local Needs  (15 min.)`;
    case "Governing Body Update":
      return `${num}. Governing Body Update`;
    case "Living Part":
      return title ? `${num}. ${title}  (15 min.)` : `${num}. [Title]  (15 min.)`;
    case "Starting a Conversation":
      return title ? `${num}. ${title}  (3 min.)` : `${num}. Starting a Conversation  (3 min.)`;
    case "Following Up":
      return title ? `${num}. ${title}  (4 min.)` : `${num}. Following Up  (4 min.)`;
    case "Making Disciples":
      return title ? `${num}. ${title}  (5 min.)` : `${num}. Making Disciples  (5 min.)`;
    case "Explaining Your Beliefs":
      return title ? `${num}. ${title}  (5 min.)` : `${num}. Explaining Your Beliefs  (5 min.)`;
    case "Initial Call":
      return title ? `${num}. ${title}  (3 min.)` : `${num}. Initial Call  (3 min.)`;
    case "Talk (Ministry)":
      return title ? `${num}. ${title}` : `${num}. Talk  (X min.)`;
    default:
      return title ? `${num}. ${title}` : `${num}. [Title]`;
  }
}
