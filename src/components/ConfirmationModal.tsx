/**
 * ConfirmationModal.tsx
 *
 * A premium, reusable confirmation modal designed to replace browser-default alert/confirm popups.
 */

import React from "react";

interface Props {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  type?: "danger" | "warning" | "info";
  showCancel?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

export default function ConfirmationModal({
  isOpen,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  type = "info",
  showCancel = true,
  onConfirm,
  onCancel,
}: Props) {
  if (!isOpen) return null;

  const btnClass = 
    type === "danger" 
      ? "bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-200" 
      : type === "warning" 
      ? "bg-amber-600 hover:bg-amber-700 text-white shadow-lg shadow-amber-200" 
      : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200";

  const iconEmoji = 
    type === "danger" ? "⚠️" : type === "warning" ? "🔔" : "ℹ️";

  const handleOverlayClick = () => {
    if (showCancel && onCancel) {
      onCancel();
    } else {
      onConfirm();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-[150] animate-in fade-in duration-200"
      onClick={handleOverlayClick}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 text-center relative overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Decorative Top Border based on type */}
        <div className={`absolute top-0 left-0 w-full h-1.5 ${
          type === "danger" ? "bg-rose-500" : type === "warning" ? "bg-amber-500" : "bg-indigo-500"
        }`} />

        {/* Modal Icon Header */}
        <div className={`inline-flex items-center justify-center w-14 h-14 rounded-full mb-4 ${
          type === "danger" ? "bg-rose-50 text-rose-600" : type === "warning" ? "bg-amber-50 text-amber-600" : "bg-indigo-50 text-indigo-600"
        }`}>
          <span className="text-2xl">{iconEmoji}</span>
        </div>

        <h3 className="text-xl font-bold text-slate-800 mb-2">{title}</h3>
        <div className="text-slate-600 mb-6 text-sm leading-relaxed whitespace-pre-line text-center">
          {message}
        </div>

        <div className="flex gap-3 justify-center">
          {showCancel && onCancel && (
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 transition-all cursor-pointer"
            >
              {cancelText}
            </button>
          )}
          <button
            onClick={onConfirm}
            className={`px-5 py-2 text-sm font-semibold rounded-xl transition-all cursor-pointer ${btnClass}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
