/**
 * pdfExport.ts
 *
 * Generates a Midweek Meeting Schedule PDF that closely follows the layout
 * of the official S-140 schedule template.
 *
 * Layout per week (A4, portrait):
 *   - Header row: congregation name (left) | "Midweek Meeting Schedule" (right)
 *   - Week banner: date range | bible reading  +  Chairman / Prayer (right column)
 *   - Coloured segment bars (TREASURES / APPLY YOURSELF / LIVING AS CHRISTIANS)
 *   - Numbered part rows with name column on the right
 *   - Closing prayer row
 *
 * Two weeks fit on one A4 page with a divider line between them.
 */

import { jsPDF } from "jspdf";
import type { Assignee, Assignment, PartType, Week } from "./types";
import { weekRangeLabel } from "./utils";

// ─── Canonical segment for each part type ────────────────────────────────────
//
// Grouping is derived entirely from partType, NOT from the `segment` field
// stored in the database.  This makes the PDF robust against data that was
// imported with incorrect segment tags (e.g. duplicated segment headings in
// the source PDF causing misclassification).

type BodySegment = "treasures" | "ministry" | "living";

const PART_SEGMENT: Partial<Record<PartType, BodySegment>> = {
  // Treasures From God's Word
  "Talk":                    "treasures",
  "Spiritual Gems":          "treasures",
  "Bible Reading":           "treasures",
  // Apply Yourself to the Field Ministry
  "Starting a Conversation": "ministry",
  "Following Up":            "ministry",
  "Making Disciples":        "ministry",
  "Explaining Your Beliefs": "ministry",
  "Initial Call":            "ministry",
  "Talk (Ministry)":         "ministry",
  // Living as Christians
  "Living Part":             "living",
  "Local Needs":             "living",
  "Governing Body Update":   "living",
  "Congregation Bible Study":"living",
  // Chairman / Opening Prayer / Closing Prayer are NOT in this map;
  // they are handled separately (banner row / footer row).
};

// ─── Colour palette (matches the physical S-140 template) ────────────────────
const COLOUR = {
  treasuresBg: [66, 66, 66]   as [number, number, number],
  ministryBg:  [180, 115, 30] as [number, number, number],
  livingBg:    [120, 20, 40]  as [number, number, number],
  headerLine:  [30, 30, 30]   as [number, number, number],
  textMain:    [20, 20, 20]   as [number, number, number],
  textGrey:    [110, 110, 110] as [number, number, number],
  textWhite:   [255, 255, 255] as [number, number, number],
  divider:     [200, 200, 200] as [number, number, number],
};

// ─── Page geometry (mm, A4 portrait) ─────────────────────────────────────────
const PAGE_W  = 210;
const MARGIN  = 14;
const COL_W   = PAGE_W - MARGIN * 2;
const NAME_W  = 60;
const TEXT_W  = COL_W - NAME_W - 4;
const NAME_X  = MARGIN + TEXT_W + 4;

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
const ROW_H     = 6;
const SEG_BAR_H = 6.5;
const BANNER_H  = 10;
const HEADER_H  = 12;

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

  const sorted = [...weeks].sort((a, b) => a.weekOf.localeCompare(b.weekOf));

  let yTop = MARGIN;

  for (let i = 0; i < sorted.length; i++) {
    const week = sorted[i];
    const isSecond = i % 2 === 1;

    if (isSecond) {
      doc.setDrawColor(...COLOUR.divider);
      doc.setLineWidth(0.4);
      doc.line(MARGIN, yTop - 3, MARGIN + COL_W, yTop - 3);
    }

    if (i > 0 && i % 2 === 0) {
      doc.addPage();
      yTop = MARGIN;
    }

    yTop = renderWeek(doc, week, assignees, congregationName, yTop);
    yTop += 6;
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

  const name = (id?: number) =>
    id != null ? (assignees.find((a) => a.id === id)?.name ?? "") : "";

  // ── Partition assignments by canonical segment (partType-driven) ──────────
  //
  // Using `order` only as a secondary sort key within each group so that the
  // relative positions the user set (or that the importer stored) are
  // preserved.  We deliberately do NOT use the `segment` field here — it can
  // be wrong if the source document had repeated section headings.

  const byOrder = (a: Assignment, b: Assignment) => a.order - b.order;

  const chairman    = week.assignments.find(a => a.partType === "Chairman");
  const openPrayer  = week.assignments.find(a => a.partType === "Opening Prayer");
  const closePrayer = week.assignments.find(a => a.partType === "Closing Prayer");

  const treasuresParts = week.assignments
    .filter(a => PART_SEGMENT[a.partType] === "treasures")
    .sort(byOrder);
  const ministryParts = week.assignments
    .filter(a => PART_SEGMENT[a.partType] === "ministry")
    .sort(byOrder);
  const livingParts = week.assignments
    .filter(a => PART_SEGMENT[a.partType] === "living")
    .sort(byOrder);

  // ── Doc header (congregation name / schedule title) ───────────────────────
  doc.setFontSize(FS.congName);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLOUR.textMain);
  doc.text((congregationName || "Congregation").toUpperCase(), MARGIN, y + 6);

  doc.setFontSize(FS.heading);
  doc.text("Midweek Meeting Schedule", MARGIN + COL_W, y + 7, { align: "right" });

  doc.setDrawColor(...COLOUR.headerLine);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y + HEADER_H - 1, MARGIN + COL_W, y + HEADER_H - 1);
  y += HEADER_H;

  // ── Week banner (date | bible reading / Chairman / Prayer) ────────────────
  const dateLabel  = weekRangeLabel(week.weekOf).toUpperCase();
  const bibleRef   = week.weeklyBibleReading ?? "";
  const bannerText = bibleRef ? `${dateLabel}  |  ${bibleRef}` : dateLabel;

  doc.setFontSize(FS.banner);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLOUR.textMain);
  doc.text(bannerText, MARGIN, y + 5);

  const labelX = NAME_X - 2;
  doc.setFontSize(FS.label);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLOUR.textGrey);
  doc.text("Chairman:", labelX, y + 3.5, { align: "right" });
  doc.text("Prayer:",   labelX, y + 8.5, { align: "right" });

  doc.setFontSize(FS.body);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLOUR.textMain);
  doc.text(name(chairman?.assigneeId)   || "—", MARGIN + COL_W, y + 3.5, { align: "right" });
  doc.text(name(openPrayer?.assigneeId) || "—", MARGIN + COL_W, y + 8.5, { align: "right" });

  y += BANNER_H;

  // ── Body parts (three segments, numbered 1…N continuously) ───────────────
  //
  // partNumber never resets between segments — it counts every numbered
  // meeting part from the first Treasures item through to CBS.

  let partNumber = 1;

  if (treasuresParts.length > 0) {
    y = drawSegmentBar(doc, y, "TREASURES FROM GOD'S WORD", COLOUR.treasuresBg);
    for (const part of treasuresParts) {
      y = drawPartRow(doc, part, partNumber++, name, y);
    }
  }

  if (ministryParts.length > 0) {
    y = drawSegmentBar(doc, y, "APPLY YOURSELF TO THE FIELD MINISTRY", COLOUR.ministryBg);
    for (const part of ministryParts) {
      y = drawPartRow(doc, part, partNumber++, name, y);
    }
  }

  if (livingParts.length > 0) {
    y = drawSegmentBar(doc, y, "LIVING AS CHRISTIANS", COLOUR.livingBg);
    for (const part of livingParts) {
      y = drawPartRow(doc, part, partNumber++, name, y);
    }
  }

  // ── Closing prayer row ────────────────────────────────────────────────────
  y += 2;
  doc.setFontSize(FS.label);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLOUR.textGrey);
  doc.text("Prayer:", labelX, y + 4, { align: "right" });

  doc.setFontSize(FS.body);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLOUR.textMain);
  doc.text(name(closePrayer?.assigneeId) || "—", MARGIN + COL_W, y + 4, { align: "right" });
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
  const mainName  = name(part.assigneeId);
  const assistName = name(part.assistantId);

  let nameLabel = mainName || "—";
  if (assistName) nameLabel = `${mainName || "—"}/${assistName}`;

  if (part.partType === "Congregation Bible Study" && (mainName || assistName)) {
    nameLabel = `${mainName || "—"}/ ${assistName || "—"}`;
  }

  const titleText = formatPartTitle(part, partNumber);

  doc.setFontSize(FS.body);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLOUR.textMain);

  const maxTitleW  = TEXT_W - 2;
  const titleLines = doc.splitTextToSize(titleText, maxTitleW) as string[];
  doc.text(titleLines[0], MARGIN + 2, y + 4.5);
  doc.text(nameLabel, MARGIN + COL_W, y + 4.5, { align: "right" });

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
      return title
        ? `${num}. Bible Reading — ${title}  (4 min.)`
        : `${num}. Bible Reading  (4 min.)`;
    case "Congregation Bible Study":
      return title
        ? `${num}. Congregation Bible Study — ${title}  (30 min.)`
        : `${num}. Congregation Bible Study  (30 min.)`;
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
