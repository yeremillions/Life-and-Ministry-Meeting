/**
 * CompletionModal.tsx
 *
 * A celebration modal shown when a workbook period is fully assigned.
 */

import type { Assignee, Week } from "../types";
import { exportSchedulePdf } from "../pdfExport";

interface Props {
  period: { key: string; label: string; weeks: Week[] };
  assignees: Assignee[];
  congregationName: string;
  onClose: () => void;
}

export default function CompletionModal({
  period,
  assignees,
  congregationName,
  onClose,
}: Props) {
  function handleDownload() {
    exportSchedulePdf({
      weeks: period.weeks,
      assignees,
      congregationName,
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-[100] animate-in fade-in duration-300"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8 text-center relative overflow-hidden animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Decorative background elements */}
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-400 via-teal-500 to-emerald-400" />
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-emerald-50 rounded-full blur-3xl opacity-50" />
        <div className="absolute -bottom-12 -left-12 w-32 h-32 bg-teal-50 rounded-full blur-3xl opacity-50" />

        {/* Celebration Icon */}
        <div className="inline-flex items-center justify-center w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full mb-6 relative">
          <span className="text-4xl">🎉</span>
          <div className="absolute inset-0 rounded-full border-4 border-emerald-500/20 animate-ping" />
        </div>

        <h3 className="text-2xl font-bold text-slate-800 mb-2">Well Done!</h3>
        <p className="text-slate-600 mb-6 leading-relaxed">
          The schedule for <span className="font-bold text-slate-800">{period.label}</span> is now fully assigned and ready to go.
        </p>

        <div className="space-y-3">
          <button
            onClick={handleDownload}
            className="btn w-full py-3 bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-200 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download S-140 Schedule
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 text-sm font-semibold text-slate-400 hover:text-slate-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
