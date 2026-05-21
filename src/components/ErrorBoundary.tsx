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
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
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

  private handleResetSettings = async () => {
    if (!confirm("Are you sure you want to reset settings to defaults? Your enrollees and schedules will not be touched.")) return;
    try {
      await db.settings.put(DEFAULT_SETTINGS);
      alert("Settings successfully reset to defaults. The page will now reload.");
      window.location.reload();
    } catch (e) {
      alert("Failed to reset settings: " + String(e));
    }
  };

  private handleWipeDB = async () => {
    if (!confirm("CRITICAL WARNING: This will permanently erase ALL enrollees, meeting weeks, and settings. This cannot be undone. Are you absolutely sure?")) return;
    try {
      await db.transaction("rw", db.assignees, db.weeks, db.settings, async () => {
        await db.assignees.clear();
        await db.weeks.clear();
        await db.settings.clear();
      });
      alert("Database wiped successfully. The page will now reload.");
      window.location.reload();
    } catch (e) {
      alert("Failed to wipe database: " + String(e));
    }
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
      alert("Failed to export backup: " + String(e));
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
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
        </div>
      );
    }

    return this.props.children;
  }
}
