/**
 * ExportPdfModal.tsx
 *
 * A modal that lets the user choose which weeks to include in the exported
 * Midweek Meeting Schedule PDF.
 *
 * Scope options:
 *   - All weeks in the currently-visible workbook period
 *   - All weeks ever stored
 *   - A specific workbook period chosen from a dropdown
 */

import { useMemo, useState } from "react";
import type { Assignee, Week } from "../types";
import { workbookPeriod } from "../utils";
import { exportSchedulePdf } from "../pdfExport";

interface Props {
  weeks: Week[];
  assignees: Assignee[];
  congregationName: string;
  /** The workbook period key (e.g. "2026-05") currently shown in the sidebar. */
  currentPeriodKey?: string;
  onClose: () => void;
}

export default function ExportPdfModal({
  weeks,
  assignees,
  congregationName,
  currentPeriodKey,
  onClose,
}: Props) {
  // Collect unique workbook periods that have data
  const periods = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const w of weeks) {
      const { key, label } = workbookPeriod(w.weekOf);
      if (!map.has(key)) map.set(key, { key, label, count: 0 });
      map.get(key)!.count++;
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [weeks]);

  // Scope: "current" period, a "specific" period, or "all"
  type Scope = "current" | "specific" | "all";
  const defaultScope: Scope =
    currentPeriodKey && periods.some((p) => p.key === currentPeriodKey)
      ? "current"
      : "all";

  const [scope, setScope] = useState<Scope>(defaultScope);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState(
    periods[0]?.key ?? ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Weeks that will be exported given the current scope
  const exportWeeks = useMemo(() => {
    if (scope === "all") return weeks;
    const key =
      scope === "current"
        ? currentPeriodKey
        : selectedPeriodKey;
    return weeks.filter((w) => workbookPeriod(w.weekOf).key === key);
  }, [scope, currentPeriodKey, selectedPeriodKey, weeks]);

  const currentPeriodLabel = useMemo(
    () => periods.find((p) => p.key === currentPeriodKey)?.label ?? "",
    [periods, currentPeriodKey]
  );

  function handleExport() {
    setError(null);
    if (exportWeeks.length === 0) {
      setError("No weeks in the selected range. Add weeks first.");
      return;
    }
    setBusy(true);
    // Small timeout so the button re-render ("Generating…") is visible
    setTimeout(() => {
      try {
        exportSchedulePdf({ weeks: exportWeeks, assignees, congregationName });
        onClose();
      } catch (e) {
        setError("PDF generation failed. Check the console for details.");
        console.error(e);
      }
      setBusy(false);
    }, 50);
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h3 className="font-semibold text-lg text-slate-800">
              Export Schedule PDF
            </h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Generates a Midweek Meeting Schedule in S-140 format.
            </p>
          </div>
          <button
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Scope selector */}
        <div className="space-y-3 mb-5">
          <label className="label">Include weeks</label>

          {/* Current period */}
          {currentPeriodKey && currentPeriodLabel && (
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="radio"
                name="scope"
                value="current"
                checked={scope === "current"}
                onChange={() => setScope("current")}
                className="accent-indigo-600"
              />
              <span className="text-sm">
                <span className="font-medium">Current period</span>
                <span className="text-slate-500 ml-1.5">
                  ({currentPeriodLabel} ·{" "}
                  {
                    weeks.filter(
                      (w) => workbookPeriod(w.weekOf).key === currentPeriodKey
                    ).length
                  }{" "}
                  week
                  {weeks.filter(
                    (w) => workbookPeriod(w.weekOf).key === currentPeriodKey
                  ).length !== 1
                    ? "s"
                    : ""}
                  )
                </span>
              </span>
            </label>
          )}

          {/* Specific period */}
          {periods.length > 1 && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="scope"
                value="specific"
                checked={scope === "specific"}
                onChange={() => setScope("specific")}
                className="accent-indigo-600 mt-0.5"
              />
              <div className="flex-1">
                <span className="text-sm font-medium">Choose a period</span>
                {scope === "specific" && (
                  <select
                    className="input mt-2 w-full"
                    value={selectedPeriodKey}
                    onChange={(e) => setSelectedPeriodKey(e.target.value)}
                  >
                    {periods.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label} ({p.count} week{p.count !== 1 ? "s" : ""})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </label>
          )}

          {/* All weeks */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="scope"
              value="all"
              checked={scope === "all"}
              onChange={() => setScope("all")}
              className="accent-indigo-600"
            />
            <span className="text-sm">
              <span className="font-medium">All weeks</span>
              <span className="text-slate-500 ml-1.5">
                ({weeks.length} week{weeks.length !== 1 ? "s" : ""})
              </span>
            </span>
          </label>
        </div>

        {/* Preview count */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 mb-5">
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-800">
              {exportWeeks.length}
            </span>{" "}
            week{exportWeeks.length !== 1 ? "s" : ""} will be exported
            {exportWeeks.length > 0 && (
              <>
                {" "}·{" "}
                <span className="text-slate-500">
                  ~{Math.ceil(exportWeeks.length / 2)} page
                  {Math.ceil(exportWeeks.length / 2) !== 1 ? "s" : ""}
                </span>
              </>
            )}
          </p>
          {exportWeeks.length > 0 && (
            <p className="text-xs text-slate-400 mt-1">
              {exportWeeks
                .slice(0, 3)
                .map((w) => w.weekOf)
                .join(", ")}
              {exportWeeks.length > 3 && ` … +${exportWeeks.length - 3} more`}
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={handleExport}
            disabled={busy || exportWeeks.length === 0}
          >
            {busy ? "Generating…" : "⬇ Download PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
