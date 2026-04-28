import { useState, useRef, useEffect } from "react";
import { db, ensureSettings } from "../db";
import { extractPdfText, parseWorkbookText } from "../workbookParser";
import { autoAssignWeek } from "../scheduler";
import { exportSchedulePdf } from "../pdfExport";
import { ensureRequiredParts } from "../meeting";
import { DEFAULT_SETTINGS, type Week, type Assignee, type AppSettings, type Assignment } from "../types";
import { weekRangeLabel, uid } from "../utils";
import * as pdfjsLib from "pdfjs-dist";

// @ts-ignore
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export default function QuickStartWizard({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (tab: "enrollees" | "schedule" | "reports", weekId?: number) => void;
}) {
  const [step, setStep] = useState(1);
  const totalSteps = 4;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // App data
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    ensureSettings().then(setSettings).catch(console.error);
  }, []);

  // Step 1: Enrollees
  const [namesText, setNamesText] = useState("");

  async function handleAddEnrollees() {
    setError(null);
    const names = namesText.split("\n").map((n) => n.trim()).filter(Boolean);
    if (names.length === 0) {
      setStep(2); // Skip if empty
      return;
    }
    setBusy(true);
    try {
      const newAssignees: Assignee[] = names.map((name) => ({
        name,
        gender: "M", // Default, users can edit later
        baptised: true,
        active: true,
        isMinor: false,
        privileges: [],
        createdAt: Date.now(),
      }));
      await db.assignees.bulkAdd(newAssignees);
      setStep(2);
    } catch (err: any) {
      setError(err.message || "Failed to add enrollees");
    } finally {
      setBusy(false);
    }
  }

  // Step 2: Workbook Import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importedWeeks, setImportedWeeks] = useState<Week[]>([]);
  
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const text = await extractPdfText(file);
      const parsed = parseWorkbookText(text);
      if (parsed.length === 0) {
        throw new Error("No valid meeting weeks found in this PDF.");
      }
      
      const newWeeks: Week[] = parsed.map((p) => {
        const parsedAssignments: Assignment[] = p.parts.map((part) => ({
          uid: uid(),
          segment: part.segment,
          order: part.number,
          partType: part.partType,
          title: part.title,
        }));
        const assignments = ensureRequiredParts(parsedAssignments, uid);
        const now = Date.now();
        return {
          weekOf: p.weekOf,
          weeklyBibleReading: p.bibleReading,
          assignments,
          createdAt: now,
          updatedAt: now,
        };
      });
      
      setImportedWeeks(newWeeks);
    } catch (err: any) {
      setError(err.message || "Failed to parse PDF");
    } finally {
      setBusy(false);
      // Reset input so the same file can be chosen again if needed
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSaveWorkbook() {
    if (importedWeeks.length === 0) {
      setStep(3);
      return;
    }
    setBusy(true);
    try {
      const weeksToSave = [];
      for (const w of importedWeeks) {
        const existing = await db.weeks.where("weekOf").equals(w.weekOf).first();
        if (existing) continue; // Skip existing
        weeksToSave.push(w);
      }
      if (weeksToSave.length > 0) {
        await db.weeks.bulkAdd(weeksToSave);
        const saved = await db.weeks.where("weekOf").anyOf(weeksToSave.map(w => w.weekOf)).toArray();
        setImportedWeeks(saved);
      }
      setStep(3);
    } catch (err: any) {
      setError("Database error: " + err.message);
    } finally {
      setBusy(false);
    }
  }

  // Step 3: Auto-Assign
  const [generatedWeeks, setGeneratedWeeks] = useState<Week[]>([]);

  async function handleAutoAssign() {
    setBusy(true);
    setError(null);
    try {
      const allAssignees = await db.assignees.toArray();
      if (allAssignees.length === 0) {
        throw new Error("You must have enrollees to auto-assign parts.");
      }
      
      const historicalWeeks = await db.weeks.toArray();
      const updatedWeeks = [];
      
      for (const w of importedWeeks) {
        if (!w.id) continue;
        const freshWeek = await db.weeks.get(w.id);
        if (!freshWeek) continue;
        
        const autoAssigned = autoAssignWeek(
          freshWeek,
          allAssignees,
          historicalWeeks,
          { 
            ...settings, 
            preserveExisting: true,
            minGapWeeks: settings.minGapWeeks ?? 2,
            chairmanGapWeeks: settings.chairmanGapWeeks ?? 3,
            catchUpIntensity: settings.catchUpIntensity ?? 3,
            maxAssignmentsPerMonth: settings.maxAssignmentsPerMonth ?? 2,
          }
        );
        
        await db.weeks.put(autoAssigned);
        historicalWeeks.push(autoAssigned); // Append so the next week knows about this week's assignments
        updatedWeeks.push(autoAssigned);
      }
      
      setGeneratedWeeks(updatedWeeks);
      setStep(4);
    } catch (err: any) {
      setError(err.message || "Failed to auto-assign");
    } finally {
      setBusy(false);
    }
  }

  // Step 4: Export
  async function handleExport() {
    setBusy(true);
    try {
      const assignees = await db.assignees.toArray();
      exportSchedulePdf({
        weeks: generatedWeeks.length > 0 ? generatedWeeks : importedWeeks,
        assignees,
        congregationName: settings.congregationName || "Congregation"
      });
      // Complete!
      onNavigate("schedule");
      onClose();
    } catch (err: any) {
      setError("PDF Export failed: " + err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Quick Start Wizard</h2>
            <p className="text-sm text-slate-500 mt-1">
              Step {step} of {totalSteps}: {" "}
              {step === 1 && "Add Enrollees"}
              {step === 2 && "Import Workbook"}
              {step === 3 && "Auto-Assign Parts"}
              {step === 4 && "Export Schedule"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Progress Bar */}
        <div className="h-1 w-full bg-slate-100 shrink-0">
          <div 
            className="h-full bg-indigo-600 transition-all duration-300" 
            style={{ width: `${(step / totalSteps) * 100}%` }}
          />
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
              <h3 className="font-semibold text-lg">Let's add some enrollees.</h3>
              <p className="text-slate-600 text-sm">
                Paste a list of names below, one per line. We will create basic profiles for them so you can start scheduling immediately. You can edit their gender and privileges later in the <strong>Enrollees</strong> tab.
              </p>
              <textarea
                className="input w-full h-48 font-mono text-sm"
                placeholder="John Doe&#10;Jane Smith&#10;Brother Yeremi"
                value={namesText}
                onChange={(e) => setNamesText(e.target.value)}
                disabled={busy}
              />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
              <h3 className="font-semibold text-lg">Import a Workbook</h3>
              <p className="text-slate-600 text-sm">
                Upload a <strong>Life and Ministry Meeting Workbook (S-140) PDF</strong>. The system will automatically read the curriculum and generate the meeting parts for those weeks.
              </p>
              
              {!importedWeeks.length ? (
                <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 transition-colors">
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    disabled={busy}
                  />
                  <button
                    className="btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                  >
                    {busy ? "Parsing PDF..." : "Select PDF File"}
                  </button>
                </div>
              ) : (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                  <h4 className="font-bold text-emerald-800 mb-2">Successfully parsed {importedWeeks.length} weeks!</h4>
                  <ul className="text-sm text-emerald-700 space-y-1">
                    {importedWeeks.map(w => (
                      <li key={w.weekOf}>• {weekRangeLabel(w.weekOf)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
              <h3 className="font-semibold text-lg">Generate Assignments</h3>
              <p className="text-slate-600 text-sm">
                Now that we have your enrollees and the workbook structure, the system can automatically assign people to every available part. It uses a smart fairness algorithm to distribute assignments evenly.
              </p>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-center">
                <button 
                  className="btn" 
                  onClick={handleAutoAssign}
                  disabled={busy}
                >
                  {busy ? "Assigning..." : "Auto-Assign All Weeks"}
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 text-center py-6">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
                ✓
              </div>
              <h3 className="font-bold text-2xl text-slate-800">You're All Set!</h3>
              <p className="text-slate-600 text-sm max-w-md mx-auto">
                Your schedule has been successfully generated. You can now download it as a beautifully formatted PDF to print or share.
              </p>
              <div className="mt-8 flex justify-center gap-3">
                <button
                  className="btn-secondary"
                  onClick={() => {
                    onNavigate("schedule");
                    onClose();
                  }}
                >
                  View in Editor
                </button>
                <button
                  className="btn bg-emerald-600 hover:bg-emerald-700"
                  onClick={handleExport}
                  disabled={busy}
                >
                  {busy ? "Exporting..." : "Download S-140 PDF"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {step < 4 && (
          <div className="p-5 border-t border-slate-100 bg-slate-50 shrink-0 flex justify-between items-center rounded-b-xl">
            <button
              className="text-slate-500 text-sm font-medium hover:text-slate-800"
              onClick={onClose}
              disabled={busy}
            >
              Skip Wizard
            </button>
            <div className="flex gap-2">
              {step === 1 && (
                <button className="btn" onClick={handleAddEnrollees} disabled={busy}>
                  {namesText.trim() ? "Add Enrollees & Continue" : "Skip this step"}
                </button>
              )}
              {step === 2 && (
                <button 
                  className="btn" 
                  onClick={handleSaveWorkbook} 
                  disabled={busy || importedWeeks.length === 0}
                >
                  Continue
                </button>
              )}
              {/* Step 3 advances internally when auto-assign finishes */}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
