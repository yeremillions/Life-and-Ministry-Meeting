import React, { Component, type ErrorInfo } from "react";
import { db } from "../db";
import { DEFAULT_SETTINGS } from "../types";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  
  // Custom Rescue Screen Modal State
  dialogOpen: boolean;
  dialogTitle: string;
  dialogMessage: string;
  dialogType: "danger" | "warning" | "info";
  dialogConfirmText: string;
  dialogShowCancel: boolean;
  dialogOnConfirm: (() => void | Promise<void>) | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    
    dialogOpen: false,
    dialogTitle: "",
    dialogMessage: "",
    dialogType: "info",
    dialogConfirmText: "Confirm",
    dialogShowCancel: true,
    dialogOnConfirm: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("Uncaught error caught by ErrorBoundary:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private showDialog = (params: {
    title: string;
    message: string;
    type: "danger" | "warning" | "info";
    confirmText?: string;
    showCancel?: boolean;
    onConfirm: () => void | Promise<void>;
  }) => {
    this.setState({
      dialogOpen: true,
      dialogTitle: params.title,
      dialogMessage: params.message,
      dialogType: params.type,
      dialogConfirmText: params.confirmText ?? "Confirm",
      dialogShowCancel: params.showCancel ?? true,
      dialogOnConfirm: params.onConfirm,
    });
  };

  private closeDialog = () => {
    this.setState({
      dialogOpen: false,
      dialogOnConfirm: null,
    });
  };

  private handleResetSettings = () => {
    this.showDialog({
      title: "Reset Settings to Defaults?",
      message: "Are you sure you want to reset settings to defaults? Your enrollees and schedules will not be touched.",
      type: "warning",
      confirmText: "Reset Settings",
      showCancel: true,
      onConfirm: async () => {
        this.closeDialog();
        try {
          await db.settings.put(DEFAULT_SETTINGS);
          this.showDialog({
            title: "Settings Reset",
            message: "Settings successfully reset to defaults. The page will now reload.",
            type: "info",
            confirmText: "OK",
            showCancel: false,
            onConfirm: () => {
              window.location.reload();
            }
          });
        } catch (e) {
          this.showDialog({
            title: "Error Resetting Settings",
            message: "Failed to reset settings: " + String(e),
            type: "danger",
            confirmText: "OK",
            showCancel: false,
            onConfirm: () => this.closeDialog()
          });
        }
      }
    });
  };

  private handleWipeDB = () => {
    this.showDialog({
      title: "CRITICAL WARNING: Wipe All Data?",
      message: "This will permanently erase ALL enrollees, meeting weeks, and settings. This cannot be undone. Are you absolutely sure?",
      type: "danger",
      confirmText: "Permanently Wipe Everything",
      showCancel: true,
      onConfirm: async () => {
        this.closeDialog();
        try {
          await db.transaction("rw", db.assignees, db.weeks, db.settings, async () => {
            await db.assignees.clear();
            await db.weeks.clear();
            await db.settings.clear();
          });
          this.showDialog({
            title: "Database Wiped",
            message: "Database wiped successfully. The page will now reload.",
            type: "info",
            confirmText: "OK",
            showCancel: false,
            onConfirm: () => {
              window.location.reload();
            }
          });
        } catch (e) {
          this.showDialog({
            title: "Error Wiping Database",
            message: "Failed to wipe database: " + String(e),
            type: "danger",
            confirmText: "OK",
            showCancel: false,
            onConfirm: () => this.closeDialog()
          });
        }
      }
    });
  };

  private handleExportBackup = async () => {
    try {
      const [assignees, weeks, settings] = await Promise.all([
        db.assignees.toArray(),
        db.weeks.toArray(),
        db.settings.toArray(),
      ]);
      const blob = new Blob(
        [JSON.stringify({ assignees, weeks, settings }, null, 2)],
        { type: "application/json" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `life_and_ministry_scheduler_rescue_backup_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      this.showDialog({
        title: "Error Exporting Backup",
        message: "Failed to export backup: " + String(e),
        type: "danger",
        confirmText: "OK",
        showCancel: false,
        onConfirm: () => this.closeDialog()
      });
    }
  };

  public render() {
    if (this.state.hasError) {
      const {
        dialogOpen,
        dialogTitle,
        dialogMessage,
        dialogType,
        dialogConfirmText,
        dialogShowCancel,
        dialogOnConfirm
      } = this.state;

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6 relative">
          <div className="w-full max-w-2xl card bg-white shadow-xl border-t-4 border-rose-500 space-y-6">
            <div className="flex items-center gap-4 border-b border-slate-100 pb-4">
              <span className="text-4xl">⚠️</span>
              <div>
                <h2 className="text-xl font-bold text-slate-800 leading-tight">
                  Application Crash Detected
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Life &amp; Ministry Scheduler encountered an unhandled error.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                To prevent data corruption, rendering has been halted. You can attempt to reload, export a rescue backup of your current data, or reset the app configurations.
              </p>
              
              <div className="p-4 bg-slate-50 rounded border border-slate-200/60 text-xs font-mono overflow-auto max-h-60 text-slate-700">
                <div className="font-bold text-rose-700 mb-1">
                  {this.state.error?.name}: {this.state.error?.message}
                </div>
                {this.state.error?.stack && (
                  <pre className="whitespace-pre overflow-x-auto mt-2 leading-relaxed">
                    {this.state.error.stack}
                  </pre>
                )}
                {this.state.errorInfo?.componentStack && (
                  <pre className="whitespace-pre overflow-x-auto mt-2 text-slate-500 leading-relaxed">
                    Component stack:
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 flex flex-wrap gap-2">
              <button
                onClick={this.handleReload}
                className="btn bg-[#4a6da7] hover:bg-[#3d5b8e] text-white text-xs font-semibold py-2 px-4 rounded"
              >
                Reload Application
              </button>
              <button
                onClick={this.handleExportBackup}
                className="btn bg-[#006064] hover:opacity-90 text-white text-xs font-semibold py-2 px-4 rounded"
              >
                Export Rescue Backup
              </button>
              <button
                onClick={this.handleResetSettings}
                className="btn bg-[#c4952a] hover:opacity-90 text-white text-xs font-semibold py-2 px-4 rounded"
              >
                Reset Settings to Defaults
              </button>
              <button
                onClick={this.handleWipeDB}
                className="btn bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold py-2 px-4 rounded ml-auto"
              >
                Wipe All Database Data
              </button>
            </div>
          </div>

          {/* Fallback inline Rescue Dialog */}
          {dialogOpen && (
            <div
              className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-[150] animate-in fade-in duration-200"
              onClick={() => {
                if (dialogShowCancel) {
                  this.closeDialog();
                } else if (dialogOnConfirm) {
                  dialogOnConfirm();
                }
              }}
            >
              <div
                className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 text-center relative overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Decorative Top Border based on type */}
                <div className={`absolute top-0 left-0 w-full h-1.5 ${
                  dialogType === "danger" ? "bg-rose-500" : dialogType === "warning" ? "bg-amber-500" : "bg-indigo-500"
                }`} />

                {/* Modal Icon Header */}
                <div className={`inline-flex items-center justify-center w-14 h-14 rounded-full mb-4 ${
                  dialogType === "danger" ? "bg-rose-50 text-rose-600" : dialogType === "warning" ? "bg-amber-50 text-amber-600" : "bg-indigo-50 text-indigo-600"
                }`}>
                  <span className="text-2xl">
                    {dialogType === "danger" ? "⚠️" : dialogType === "warning" ? "🔔" : "ℹ️"}
                  </span>
                </div>

                <h3 className="text-xl font-bold text-slate-800 mb-2">{dialogTitle}</h3>
                <div className="text-slate-600 mb-6 text-sm leading-relaxed whitespace-pre-line text-center">
                  {dialogMessage}
                </div>

                <div className="flex gap-3 justify-center">
                  {dialogShowCancel && (
                    <button
                      onClick={this.closeDialog}
                      className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (dialogOnConfirm) {
                        dialogOnConfirm();
                      }
                    }}
                    className={`px-5 py-2 text-sm font-semibold rounded-xl transition-all cursor-pointer text-white shadow-lg ${
                      dialogType === "danger"
                        ? "bg-rose-600 hover:bg-rose-700 shadow-rose-200"
                        : dialogType === "warning"
                        ? "bg-amber-600 hover:bg-amber-700 shadow-amber-200"
                        : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200"
                    }`}
                  >
                    {dialogConfirmText}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
