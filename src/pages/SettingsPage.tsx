import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState, useRef, useMemo } from "react";
import { db, ensureSettings } from "../db";
import {
  DEFAULT_ASSIGNMENT_RULES,
  DEFAULT_SETTINGS,
  type AppSettings,
  type AssignmentRule,
  type Gender,
  type Privilege,
  type SegmentId,
} from "../types";
import { addLog } from "../db";
import { isPrivileged, SEGMENT_PART_TYPES } from "../meeting";
import ConfirmationModal from "../components/ConfirmationModal";

const SEGMENT_LABELS: Record<SegmentId, string> = {
  opening: "Opening Section",
  treasures: "Treasures from God's Word",
  ministry: "Apply Yourself to the Field Ministry",
  living: "Living as Christians",
};

function getDefaultRuleForCustomPart(partType: string, customPartTypes: Record<string, string[]> | undefined): AssignmentRule {
  let segment: SegmentId = "living";
  if (customPartTypes) {
    for (const seg of Object.keys(customPartTypes) as SegmentId[]) {
      if (customPartTypes[seg]?.includes(partType)) {
        segment = seg;
        break;
      }
    }
  }

  if (segment === "ministry") {
    return {
      allowedGenders: ["M", "F"],
      requiredPrivileges: [],
      mustBeBaptized: false,
      assistant: {
        allowedGenders: ["M", "F"],
        requiredPrivileges: [],
        mustBeBaptized: false,
      }
    };
  } else {
    return {
      allowedGenders: ["M"],
      requiredPrivileges: [],
      mustBeBaptized: true
    };
  }
}

function sanitizeSettings(raw: any): AppSettings {
  const base = { ...DEFAULT_SETTINGS, ...raw };
  base.assignmentRules = { ...DEFAULT_SETTINGS.assignmentRules };
  
  base.msTreasuresRatio = typeof raw?.msTreasuresRatio === "number" ? raw.msTreasuresRatio : DEFAULT_SETTINGS.msTreasuresRatio;
  base.qmsTreasuresRatio = typeof raw?.qmsTreasuresRatio === "number" ? raw.qmsTreasuresRatio : DEFAULT_SETTINGS.qmsTreasuresRatio;
  base.qeLivingRatio = typeof raw?.qeLivingRatio === "number" ? raw.qeLivingRatio : DEFAULT_SETTINGS.qeLivingRatio;
  base.eLivingRatio = typeof raw?.eLivingRatio === "number" ? raw.eLivingRatio : DEFAULT_SETTINGS.eLivingRatio;
  base.qmsLivingRatio = typeof raw?.qmsLivingRatio === "number" ? raw.qmsLivingRatio : DEFAULT_SETTINGS.qmsLivingRatio;
  base.privilegedBibleReadingRatio = typeof raw?.privilegedBibleReadingRatio === "number" ? raw.privilegedBibleReadingRatio : DEFAULT_SETTINGS.privilegedBibleReadingRatio;
  base.pairingAvoidance = ["strict", "relaxed", "off"].includes(raw?.pairingAvoidance) ? raw.pairingAvoidance : "strict";
  
  const ruleLevels = ["off", "weak", "medium", "strong", "strict"];
  base.ruleMinGap = ruleLevels.includes(raw?.ruleMinGap) ? raw.ruleMinGap : DEFAULT_SETTINGS.ruleMinGap;
  base.ruleChairmanGap = ruleLevels.includes(raw?.ruleChairmanGap) ? raw.ruleChairmanGap : DEFAULT_SETTINGS.ruleChairmanGap;
  base.ruleMinistryAlternation = ruleLevels.includes(raw?.ruleMinistryAlternation) ? raw.ruleMinistryAlternation : DEFAULT_SETTINGS.ruleMinistryAlternation;
  base.ruleMinorAssistantToAdult = ruleLevels.includes(raw?.ruleMinorAssistantToAdult) ? raw.ruleMinorAssistantToAdult : DEFAULT_SETTINGS.ruleMinorAssistantToAdult;
  base.ruleAdultAssistantForMinor = ruleLevels.includes(raw?.ruleAdultAssistantForMinor) ? raw.ruleAdultAssistantForMinor : DEFAULT_SETTINGS.ruleAdultAssistantForMinor;
  base.ruleMainWorkload = ruleLevels.includes(raw?.ruleMainWorkload) ? raw.ruleMainWorkload : DEFAULT_SETTINGS.ruleMainWorkload;
  base.ruleAssistantWorkload = ruleLevels.includes(raw?.ruleAssistantWorkload) ? raw.ruleAssistantWorkload : DEFAULT_SETTINGS.ruleAssistantWorkload;
  base.ruleSegmentBalancing = ruleLevels.includes(raw?.ruleSegmentBalancing) ? raw.ruleSegmentBalancing : DEFAULT_SETTINGS.ruleSegmentBalancing;
  base.rulePreventAssistantTwice = ruleLevels.includes(raw?.rulePreventAssistantTwice) ? raw.rulePreventAssistantTwice : DEFAULT_SETTINGS.rulePreventAssistantTwice;
  base.ruleInfirmedThrottling = ruleLevels.includes(raw?.ruleInfirmedThrottling) ? raw.ruleInfirmedThrottling : DEFAULT_SETTINGS.ruleInfirmedThrottling;
  base.ruleSameSexDemogenders = ruleLevels.includes(raw?.ruleSameSexDemogenders) ? raw.ruleSameSexDemogenders : DEFAULT_SETTINGS.ruleSameSexDemogenders;
  
  base.customPartTypes = raw?.customPartTypes && typeof raw.customPartTypes === "object"
    ? {
        opening: Array.isArray(raw.customPartTypes.opening) ? raw.customPartTypes.opening : [],
        treasures: Array.isArray(raw.customPartTypes.treasures) ? raw.customPartTypes.treasures : [],
        ministry: Array.isArray(raw.customPartTypes.ministry) ? raw.customPartTypes.ministry : [],
        living: Array.isArray(raw.customPartTypes.living) ? raw.customPartTypes.living : [],
      }
    : {
        opening: [],
        treasures: [],
        ministry: [],
        living: [],
      };

  const rawRules = raw?.assignmentRules && typeof raw.assignmentRules === "object"
    ? raw.assignmentRules
    : {};
    
  const allPartTypes = new Set<string>();
  for (const pt of Object.keys(DEFAULT_SETTINGS.assignmentRules)) {
    allPartTypes.add(pt);
  }
  if (base.customPartTypes) {
    for (const seg of Object.keys(base.customPartTypes) as SegmentId[]) {
      for (const pt of base.customPartTypes[seg] || []) {
        allPartTypes.add(pt);
      }
    }
  }

  for (const partType of allPartTypes) {
    const defaultRule = DEFAULT_SETTINGS.assignmentRules[partType] || getDefaultRuleForCustomPart(partType, base.customPartTypes);
    const rawRule = rawRules[partType];
    
    const rule: AssignmentRule = {
      allowedGenders: Array.isArray(rawRule?.allowedGenders)
        ? rawRule.allowedGenders
        : [...defaultRule.allowedGenders],
      requiredPrivileges: Array.isArray(rawRule?.requiredPrivileges)
        ? rawRule.requiredPrivileges
        : [...defaultRule.requiredPrivileges],
      mustBeBaptized: typeof rawRule?.mustBeBaptized === "boolean"
        ? rawRule.mustBeBaptized
        : defaultRule.mustBeBaptized,
    };
    
    const hasAssistant = defaultRule.assistant !== undefined || rawRule?.assistant !== undefined;
    if (hasAssistant) {
      const defaultAsst = defaultRule.assistant || {
        allowedGenders: [...defaultRule.allowedGenders],
        requiredPrivileges: [],
        mustBeBaptized: false,
      };
      const rawAsst = rawRule?.assistant;
      rule.assistant = {
        allowedGenders: Array.isArray(rawAsst?.allowedGenders)
          ? rawAsst.allowedGenders
          : [...defaultAsst.allowedGenders],
        requiredPrivileges: Array.isArray(rawAsst?.requiredPrivileges)
          ? rawAsst.requiredPrivileges
          : [...defaultAsst.requiredPrivileges],
        mustBeBaptized: typeof rawAsst?.mustBeBaptized === "boolean"
          ? rawAsst.mustBeBaptized
          : defaultAsst.mustBeBaptized,
      };
    }
    
    base.assignmentRules[partType] = rule;
  }
  
  return base as AppSettings;
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T00:00:00");
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function invertRanges(
  ranges: { start: string; end: string; reason?: string }[],
  startLimit: string,
  endLimit: string,
  toAvailable: boolean
): { start: string; end: string; reason?: string }[] {
  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
  const merged: { start: string; end: string; reason?: string }[] = [];
  
  for (const r of sorted) {
    if (merged.length === 0) {
      merged.push({ ...r });
    } else {
      const last = merged[merged.length - 1];
      if (r.start <= addDays(last.end, 1)) {
        if (r.end > last.end) {
          last.end = r.end;
        }
      } else {
        merged.push({ ...r });
      }
    }
  }

  const inverted: { start: string; end: string; reason?: string }[] = [];
  let currentStart = startLimit;
  const defaultReason = toAvailable ? "Available (Converted)" : "Away (Converted)";

  for (const r of merged) {
    if (r.start > currentStart) {
      const endPrev = addDays(r.start, -1);
      if (endPrev >= currentStart) {
        inverted.push({
          start: currentStart,
          end: endPrev,
          reason: defaultReason,
        });
      }
    }
    currentStart = r.end >= currentStart ? addDays(r.end, 1) : currentStart;
  }

  if (currentStart <= endLimit) {
    inverted.push({
      start: currentStart,
      end: endLimit,
      reason: defaultReason,
    });
  }

  return inverted;
}


export default function SettingsPage({
  onNavigateToAdmin,
}: {
  onNavigateToAdmin?: () => void;
}) {
  const settings = useLiveQuery(() => db.settings.get("app"), []);
  const logs = useLiveQuery(() => db.logs.orderBy("timestamp").reverse().toArray(), []) ?? [];
  const assignees = useLiveQuery(() => db.assignees.orderBy("name").toArray(), []) ?? [];
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "customizer" | "shares" | "customParts" | "eligibility">("general");

  const renderRuleCustomizerRow = (
    label: string,
    description: string,
    field: keyof AppSettings,
    hasStrict: boolean = true
  ) => {
    if (!draft) return null;
    const value = draft[field] as string || "off";
    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white rounded-xl border border-slate-100 shadow-sm hover:border-slate-200 transition-all gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800 text-sm">{label}</span>
            <span className={`pill text-[10px] font-bold uppercase ${
              value === "strict" ? "bg-rose-50 text-rose-700 border border-rose-100" :
              value === "strong" ? "bg-amber-50 text-amber-700 border border-amber-100" :
              value === "medium" ? "bg-blue-50 text-blue-700 border border-blue-100" :
              value === "weak" ? "bg-slate-50 text-slate-600 border border-slate-200" :
              "bg-gray-50 text-gray-400 border border-gray-150"
            }`}>
              {value}
            </span>
          </div>
          <p className="text-xs text-slate-500 max-w-xl">{description}</p>
        </div>
        <select
          className="input text-xs py-1.5 max-w-[150px]"
          value={value}
          onChange={(e) => setDraft({ ...draft, [field]: e.target.value as any })}
        >
          <option value="off">Off (Disabled)</option>
          <option value="weak">Weak Enforcement</option>
          <option value="medium">Medium Enforcement</option>
          <option value="strong">Strong Enforcement</option>
          {hasStrict && <option value="strict">Strict (Hard Limit)</option>}
        </select>
      </div>
    );
  };

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    type?: "danger" | "warning" | "info";
    showCancel?: boolean;
    onConfirm: () => void | Promise<void>;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  // Prayer overrides states
  const [excludeSearch, setExcludeSearch] = useState("");
  const [includeSearch, setIncludeSearch] = useState("");
  const [excludeDropdownOpen, setExcludeDropdownOpen] = useState(false);
  const [includeDropdownOpen, setIncludeDropdownOpen] = useState(false);

  const excludeRef = useRef<HTMLDivElement>(null);
  const includeRef = useRef<HTMLDivElement>(null);

  // Custom part types states
  const [renamedParts, setRenamedParts] = useState<Record<string, string>>({});
  const [editingPart, setEditingPart] = useState<{ segment: SegmentId; oldName: string; name: string } | null>(null);
  const [addingSegment, setAddingSegment] = useState<SegmentId | null>(null);
  const [newPartName, setNewPartName] = useState("");
  const [newPartNeedsAssistant, setNewPartNeedsAssistant] = useState(false);
  const [customPartsError, setCustomPartsError] = useState<Record<SegmentId, string>>({
    opening: "",
    treasures: "",
    ministry: "",
    living: ""
  });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (excludeRef.current && !excludeRef.current.contains(event.target as Node)) {
        setExcludeDropdownOpen(false);
      }
      if (includeRef.current && !includeRef.current.contains(event.target as Node)) {
        setIncludeDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    ensureSettings().then((s) => setDraft(sanitizeSettings(s)));
  }, []);

  useEffect(() => {
    if (settings) setDraft(sanitizeSettings(settings));
  }, [settings]);

  async function save() {
    if (!draft) return;

    // Check if availability tracking mode was changed
    const previousMode = settings?.availabilityMode ?? "unavailable";
    const currentMode = draft.availabilityMode ?? "unavailable";
    const isModeChanged = currentMode !== previousMode;

    if (isModeChanged) {
      const allAssignees = await db.assignees.toArray();
      
      // Determine the range limits for inversion (current year start to next year end)
      let earliest = new Date().toISOString().slice(0, 4) + "-01-01";
      let latest = (new Date().getFullYear() + 1) + "-12-31";
      
      for (const a of allAssignees) {
        for (const range of a.unavailableRanges ?? []) {
          if (range.start < earliest) earliest = range.start.slice(0, 4) + "-01-01";
          if (range.end > latest) latest = range.end.slice(0, 4) + "-12-31";
        }
      }
      
      // Run the conversion in a transaction
      await db.transaction("rw", db.assignees, async () => {
        for (const a of allAssignees) {
          const oldRanges = a.unavailableRanges ?? [];
          if (oldRanges.length === 0) continue;
          
          const newRanges = invertRanges(
            oldRanges,
            earliest,
            latest,
            currentMode === "available"
          );
          
          a.unavailableRanges = newRanges;
          await db.assignees.put(a);
        }
      });

      await addLog(
        "settings",
        `Converted enrollee calendar dates to match ${currentMode} mode (${earliest} to ${latest})`
      );
    }

    // Rename any custom part types in weeks assignments
    if (Object.keys(renamedParts).length > 0) {
      await db.transaction("rw", db.weeks, async () => {
        const allWeeks = await db.weeks.toArray();
        for (const week of allWeeks) {
          let weekDirty = false;
          const updatedAssignments = week.assignments.map((a) => {
            const newName = renamedParts[a.partType];
            if (newName) {
              weekDirty = true;
              return { ...a, partType: newName };
            }
            return a;
          });
          if (weekDirty) {
            await db.weeks.update(week.id as number, { assignments: updatedAssignments });
          }
        }
      });
      const renameDetails = Object.entries(renamedParts)
        .map(([oldN, newN]) => `"${oldN}" -> "${newN}"`)
        .join(", ");
      await addLog("settings", `Renamed custom part types: ${renameDetails}`);
      setRenamedParts({});
    }

    await db.settings.put(draft);
    await addLog("settings", "Saved settings changes");
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function validatePartTypeName(name: string, oldName?: string): string {
    const trimmed = name.trim();
    if (!trimmed) {
      return "Name cannot be empty.";
    }
    
    // Check built-in part types across all segments
    for (const seg of Object.keys(SEGMENT_PART_TYPES) as SegmentId[]) {
      if (SEGMENT_PART_TYPES[seg].some(pt => pt.toLowerCase() === trimmed.toLowerCase())) {
        return `"${trimmed}" conflicts with a built-in part type.`;
      }
    }
    
    // Check existing custom part types across all segments (excluding itself if renaming)
    const customTypes = draft?.customPartTypes || {
      opening: [],
      treasures: [],
      ministry: [],
      living: [],
    };
    for (const seg of Object.keys(customTypes) as SegmentId[]) {
      const parts = customTypes[seg] || [];
      for (const pt of parts) {
        if (oldName && pt === oldName) continue;
        if (pt.toLowerCase() === trimmed.toLowerCase()) {
          return `A custom part type named "${trimmed}" already exists.`;
        }
      }
    }
    
    return "";
  }

  const handleAddCustomPart = (segment: SegmentId) => {
    if (!draft) return;
    const error = validatePartTypeName(newPartName);
    if (error) {
      setCustomPartsError(prev => ({ ...prev, [segment]: error }));
      return;
    }
    
    const trimmedName = newPartName.trim();
    const currentCustom = draft.customPartTypes?.[segment] || [];
    const updatedCustom: Record<SegmentId, string[]> = {
      opening: draft.customPartTypes?.opening || [],
      treasures: draft.customPartTypes?.treasures || [],
      ministry: draft.customPartTypes?.ministry || [],
      living: draft.customPartTypes?.living || [],
      [segment]: [...currentCustom, trimmedName]
    };
    
    // Determine default rule
    const defaultRule: AssignmentRule = segment === "ministry"
      ? {
          allowedGenders: ["M", "F"],
          requiredPrivileges: [],
          mustBeBaptized: false
        }
      : {
          allowedGenders: ["M"],
          requiredPrivileges: [],
          mustBeBaptized: true
        };
        
    if (newPartNeedsAssistant) {
      defaultRule.assistant = {
        allowedGenders: segment === "ministry" ? ["M", "F"] : ["M"],
        requiredPrivileges: [],
        mustBeBaptized: false
      };
    }
    
    const updatedRules = {
      ...draft.assignmentRules,
      [trimmedName]: defaultRule
    };
    
    setDraft({
      ...draft,
      customPartTypes: updatedCustom,
      assignmentRules: updatedRules
    });
    
    // Reset add state
    setAddingSegment(null);
    setNewPartName("");
    setNewPartNeedsAssistant(false);
    setCustomPartsError(prev => ({ ...prev, [segment]: "" }));
  };

  const handleRenameCustomPart = (segment: SegmentId) => {
    if (!draft || !editingPart) return;
    const { oldName, name } = editingPart;
    
    const error = validatePartTypeName(name, oldName);
    if (error) {
      setCustomPartsError(prev => ({ ...prev, [segment]: error }));
      return;
    }
    
    const trimmedNewName = name.trim();
    if (trimmedNewName === oldName) {
      setEditingPart(null);
      setCustomPartsError(prev => ({ ...prev, [segment]: "" }));
      return;
    }
    
    const currentCustom = draft.customPartTypes?.[segment] || [];
    const updatedCustom: Record<SegmentId, string[]> = {
      opening: draft.customPartTypes?.opening || [],
      treasures: draft.customPartTypes?.treasures || [],
      ministry: draft.customPartTypes?.ministry || [],
      living: draft.customPartTypes?.living || [],
      [segment]: currentCustom.map(p => p === oldName ? trimmedNewName : p)
    };
    
    const updatedRules = { ...draft.assignmentRules };
    if (updatedRules[oldName]) {
      updatedRules[trimmedNewName] = updatedRules[oldName];
      delete updatedRules[oldName];
    } else {
      updatedRules[trimmedNewName] = segment === "ministry"
        ? { allowedGenders: ["M", "F"], requiredPrivileges: [], mustBeBaptized: false }
        : { allowedGenders: ["M"], requiredPrivileges: [], mustBeBaptized: true };
    }
    
    setDraft({
      ...draft,
      customPartTypes: updatedCustom,
      assignmentRules: updatedRules
    });
    
    setRenamedParts(prev => {
      const next = { ...prev };
      for (const [src, dest] of Object.entries(next)) {
        if (dest === oldName) {
          next[src] = trimmedNewName;
          return next;
        }
      }
      next[oldName] = trimmedNewName;
      return next;
    });
    
    setEditingPart(null);
    setCustomPartsError(prev => ({ ...prev, [segment]: "" }));
  };

  const handleToggleAssistant = (partType: string, segment: SegmentId, checked: boolean) => {
    if (!draft) return;
    const updatedRules = { ...draft.assignmentRules };
    const currentRule = updatedRules[partType];
    
    if (currentRule) {
      if (checked) {
        currentRule.assistant = {
          allowedGenders: segment === "ministry" ? ["M", "F"] : ["M"],
          requiredPrivileges: [],
          mustBeBaptized: false
        };
      } else {
        delete currentRule.assistant;
      }
      updatedRules[partType] = { ...currentRule };
    }
    
    setDraft({
      ...draft,
      assignmentRules: updatedRules
    });
  };

  const handleDeleteCustomPart = (partType: string, segment: SegmentId) => {
    if (!draft) return;
    const currentCustom = draft.customPartTypes?.[segment] || [];
    const updatedCustom: Record<SegmentId, string[]> = {
      opening: draft.customPartTypes?.opening || [],
      treasures: draft.customPartTypes?.treasures || [],
      ministry: draft.customPartTypes?.ministry || [],
      living: draft.customPartTypes?.living || [],
      [segment]: currentCustom.filter(p => p !== partType)
    };
    
    const updatedRules = { ...draft.assignmentRules };
    delete updatedRules[partType];
    
    setDraft({
      ...draft,
      customPartTypes: updatedCustom,
      assignmentRules: updatedRules
    });
    
    setRenamedParts(prev => {
      const next = { ...prev };
      delete next[partType];
      for (const [src, dest] of Object.entries(next)) {
        if (dest === partType) {
          delete next[src];
        }
      }
      return next;
    });
  };

  async function wipeAll() {
    setConfirmState({
      isOpen: true,
      title: "Wipe Database",
      message: "CRITICAL WARNING: This will permanently erase ALL enrollees, meeting schedules, and custom settings. This action cannot be undone. Are you absolutely sure?",
      confirmText: "Wipe Database",
      cancelText: "Cancel",
      type: "danger",
      onConfirm: async () => {
        await db.transaction("rw", db.assignees, db.weeks, db.settings, async () => {
          await db.assignees.clear();
          await db.weeks.clear();
          await db.settings.clear();
        });
        await ensureSettings();
        window.location.reload();
      },
    });
  }

  async function restoreDefaults() {
    setConfirmState({
      isOpen: true,
      title: "Reset Settings",
      message: "Are you sure you want to reset all settings to defaults? Your custom rules will be restored to original platform values, but your enrollees and weekly schedules will not be touched.",
      confirmText: "Reset Defaults",
      cancelText: "Cancel",
      type: "warning",
      onConfirm: async () => {
        setDraft(DEFAULT_SETTINGS);
        await db.settings.put(DEFAULT_SETTINGS);
        await addLog("settings", "Restored default settings");
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
      },
    });
  }

  async function exportBackup() {
    const [assignees, weeks, s] = await Promise.all([
      db.assignees.toArray(),
      db.weeks.toArray(),
      db.settings.toArray(),
    ]);
    const blob = new Blob(
      [JSON.stringify({ assignees, weeks, settings: s }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting-scheduler-backup-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function restoreBackup(file: File) {
    const text = await file.text();
    let parsed: { assignees: unknown[]; weeks: unknown[]; settings: unknown[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      setConfirmState({
        isOpen: true,
        title: "Invalid Backup File",
        message: "The selected backup file appears to be corrupted or invalid.",
        confirmText: "OK",
        showCancel: false,
        type: "danger",
        onConfirm: () => setConfirmState((prev) => ({ ...prev, isOpen: false }))
      });
      return;
    }

    setConfirmState({
      isOpen: true,
      title: "Restore Backup",
      message: "Are you sure you want to replace all current data with the contents of this backup? This will overwrite all enrollees, weeks, and custom settings.",
      confirmText: "Restore Backup",
      cancelText: "Cancel",
      type: "danger",
      onConfirm: async () => {
        await db.transaction("rw", db.assignees, db.weeks, db.settings, async () => {
          await db.assignees.clear();
          await db.weeks.clear();
          await db.settings.clear();
          if (Array.isArray(parsed.assignees))
            await db.assignees.bulkAdd(parsed.assignees as any[]);
          if (Array.isArray(parsed.weeks))
            await db.weeks.bulkAdd(parsed.weeks as any[]);
          if (Array.isArray(parsed.settings))
            await db.settings.bulkAdd(parsed.settings as any[]);
        });
        await ensureSettings();
        window.location.reload();
      }
    });
  }

  // Filter out and sanitize any potential null/undefined records
  const validAssignees = useMemo(() => {
    try {
      return assignees
        .filter((a): a is any => a != null)
        .map((a) => ({
          ...a,
          id: typeof a.id === "number" ? a.id : undefined,
          name: typeof a.name === "string" ? a.name : "Unknown Enrollee",
          gender: a.gender === "M" || a.gender === "F" ? a.gender : "M",
          baptised: typeof a.baptised === "boolean" ? a.baptised : false,
          privileges: Array.isArray(a.privileges) ? a.privileges : [],
          active: typeof a.active === "boolean" ? a.active : true,
          excludeFromPrayers: typeof a.excludeFromPrayers === "boolean" ? a.excludeFromPrayers : false,
          includeInPrayers: typeof a.includeInPrayers === "boolean" ? a.includeInPrayers : false,
        }));
    } catch (e) {
      console.error("Error sanitizing assignees in Settings:", e);
      return [];
    }
  }, [assignees]);

  const validLogs = useMemo(() => {
    try {
      return logs
        .filter((l): l is any => l != null)
        .map((l) => ({
          id: typeof l.id === "number" ? l.id : Math.random(),
          timestamp: typeof l.timestamp === "number" ? l.timestamp : Date.now(),
          category: typeof l.category === "string" ? l.category : "system",
          action: typeof l.action === "string" ? l.action : "System event",
          details: typeof l.details === "string" ? l.details : undefined,
        }));
    } catch (e) {
      console.error("Error sanitizing logs in Settings:", e);
      return [];
    }
  }, [logs]);

  // Prayer overrides lists and candidates
  let excludedBrothers: any[] = [];
  let includedBrothers: any[] = [];
  let excludeCandidates: any[] = [];
  let includeCandidates: any[] = [];

  // Pagination calculations
  let totalItems = 0;
  let totalPages = 1;
  let startIndex = 0;
  let endIndex = 0;
  let paginatedLogs: any[] = [];
  let pageNumbers: number[] = [];

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  if (!draft) {
    return (
      <div className="card p-12 text-center flex flex-col items-center justify-center space-y-4">
        <div 
          className="animate-spin rounded-full h-10 w-10 border-2 border-slate-300 border-t-slate-600"
          style={{ borderTopColor: 'var(--color-primary, #1e3a8a)' }}
        ></div>
        <p className="text-slate-500 text-sm font-medium">Loading settings...</p>
      </div>
    );
  }

  try {
    excludedBrothers = validAssignees.filter((a: any) => a.gender === "M" && a.excludeFromPrayers);
    includedBrothers = validAssignees.filter((a: any) => a.gender === "M" && a.includeInPrayers);

    excludeCandidates = validAssignees.filter((a: any) => {
      if (a.gender !== "M" || !a.active) return false;
      const hasPriv = isPrivileged(a) || a.privileges?.includes("CBSR");
      if (!hasPriv) return false;
      if (a.excludeFromPrayers) return false;
      if (!excludeSearch.trim()) return true;
      return a.name.toLowerCase().includes(excludeSearch.toLowerCase());
    });

    includeCandidates = validAssignees.filter((a: any) => {
      if (a.gender !== "M" || !a.active) return false;
      const hasPriv = isPrivileged(a) || a.privileges?.includes("CBSR");
      if (hasPriv) return false;
      if (a.includeInPrayers) return false;
      if (!includeSearch.trim()) return true;
      return a.name.toLowerCase().includes(includeSearch.toLowerCase());
    });

    totalItems = validLogs.length;
    totalPages = Math.ceil(totalItems / pageSize) || 1;

    startIndex = (currentPage - 1) * pageSize;
    endIndex = startIndex + pageSize;
    paginatedLogs = validLogs.slice(startIndex, endIndex);

    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    for (let i = startPage; i <= endPage; i++) {
      pageNumbers.push(i);
    }

    return (
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-200 pb-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Congregation Settings</h1>
            <p className="text-sm text-slate-500">Configure scheduling options, customizable rules, publisher ratios, and custom part eligibility.</p>
          </div>
          <div className="flex items-center gap-2 mt-4 md:mt-0">
            <button className="btn" onClick={save}>Save changes</button>
            {saved && (
              <span className="text-sm text-green-600 font-semibold animate-fade-in">✓ Saved</span>
            )}
          </div>
        </div>

        {/* Tab Headers */}
        <div className="flex border-b border-slate-200 mb-6 overflow-x-auto whitespace-nowrap scrollbar-none gap-1 bg-white p-1.5 rounded-lg shadow-sm border border-slate-150">
          <button
            className={`py-2 px-4 font-semibold text-sm rounded-md transition-all ${
              activeTab === "general"
                ? "bg-indigo-50 text-indigo-700 shadow-sm font-bold border border-indigo-100"
                : "border border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50/50"
            }`}
            onClick={() => setActiveTab("general")}
          >
            General &amp; System
          </button>
          <button
            className={`py-2 px-4 font-semibold text-sm rounded-md transition-all ${
              activeTab === "customizer"
                ? "bg-indigo-50 text-indigo-700 shadow-sm font-bold border border-indigo-100"
                : "border border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50/50"
            }`}
            onClick={() => setActiveTab("customizer")}
          >
            Rule Customizer
          </button>
          <button
            className={`py-2 px-4 font-semibold text-sm rounded-md transition-all ${
              activeTab === "shares"
                ? "bg-indigo-50 text-indigo-700 shadow-sm font-bold border border-indigo-100"
                : "border border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50/50"
            }`}
            onClick={() => setActiveTab("shares")}
          >
            Publisher Shares &amp; Splits
          </button>
          <button
            className={`py-2 px-4 font-semibold text-sm rounded-md transition-all ${
              activeTab === "customParts"
                ? "bg-indigo-50 text-indigo-700 shadow-sm font-bold border border-indigo-100"
                : "border border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50/50"
            }`}
            onClick={() => setActiveTab("customParts")}
          >
            Custom Parts &amp; Prayers
          </button>
          <button
            className={`py-2 px-4 font-semibold text-sm rounded-md transition-all ${
              activeTab === "eligibility"
                ? "bg-indigo-50 text-indigo-700 shadow-sm font-bold border border-indigo-100"
                : "border border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50/50"
            }`}
            onClick={() => setActiveTab("eligibility")}
          >
            Assignment Eligibility Table
          </button>
        </div>

        {activeTab === "general" && (
          <div className="card space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-800">General Settings</h2>
              <button className="btn-secondary text-xs" onClick={restoreDefaults}>
                Restore Defaults
              </button>
            </div>
            <div>
              <label className="label">Congregation name</label>
              <input
                className="input max-w-md"
                value={draft.congregationName ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, congregationName: e.target.value })
                }
              />
            </div>
            <div>
              <label className="label">Midweek Meeting Night</label>
              <select
                className="input max-w-md"
                value={draft.midweekMeetingDay ?? "Thursday"}
                onChange={(e) =>
                  setDraft({ ...draft, midweekMeetingDay: e.target.value as any })
                }
              >
                <option value="Monday">Monday</option>
                <option value="Tuesday">Tuesday</option>
                <option value="Wednesday">Wednesday</option>
                <option value="Thursday">Thursday</option>
                <option value="Friday">Friday</option>
                <option value="Saturday">Saturday</option>
                <option value="Sunday">Sunday</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Select the weekday your midweek meeting is held. The system uses this to verify publisher availability for meeting dates.
              </p>
            </div>
            <div>
              <label className="label">Availability Tracking Mode</label>
              <select
                className="input max-w-md"
                value={draft.availabilityMode ?? "unavailable"}
                onChange={(e) =>
                  setDraft({ ...draft, availabilityMode: e.target.value as any })
                }
              >
                <option value="unavailable">Track when they are Away / Out of town (Default)</option>
                <option value="available">Track when they are Available / In town</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Choose whether you prefer to record periods when publishers are out of town (default) or when they are in town/available.
              </p>
            </div>
            <div className="pt-4 border-t border-slate-100 flex items-center">
              <button className="btn" onClick={save}>
                Save settings
              </button>
              {saved && (
                <span className="text-sm text-green-600 font-semibold ml-3 animate-fade-in">✓ Settings saved</span>
              )}
            </div>
          </div>
        )}
        {activeTab === "customizer" && (
          <div className="card space-y-4 animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-xl font-bold text-slate-800">Rule Enforcement Customizer</h2>
                <p className="text-xs text-slate-500">Fine-tune the enforcement level for every scheduling rule. Strict rules act as hard boundaries, while other levels apply graduated scoring penalties.</p>
              </div>
              <button className="btn-secondary text-xs" onClick={restoreDefaults}>
                Restore Defaults
              </button>
            </div>

            <div className="space-y-4">
              {renderRuleCustomizerRow(
                "Student Main Assignment Gap",
                "Enforces a minimum period of weeks that must pass before a publisher can receive another main assignment.",
                "ruleMinGap"
              )}

              {draft.ruleMinGap !== "off" && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50/50 rounded-xl border border-slate-100 gap-4 ml-6 animate-fade-in">
                  <div className="space-y-1">
                    <span className="font-semibold text-slate-700 text-sm">Gap Duration (Weeks)</span>
                    <p className="text-xs text-slate-500">Specify the number of weeks for the student main assignment gap.</p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={8}
                    className="input max-w-[150px]"
                    value={draft.minGapWeeks ?? 2}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        minGapWeeks: clamp(parseInt(e.target.value || "0", 10), 0, 8),
                      })
                    }
                  />
                </div>
              )}

              {renderRuleCustomizerRow(
                "Chairman Assignment Rotation Gap",
                "Prevents the same elder from being assigned to chair the midweek meeting too frequently.",
                "ruleChairmanGap"
              )}

              {draft.ruleChairmanGap !== "off" && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50/50 rounded-xl border border-slate-100 gap-4 ml-6 animate-fade-in">
                  <div className="space-y-1">
                    <span className="font-semibold text-slate-705 text-sm">Chairman Gap Duration (Weeks)</span>
                    <p className="text-xs text-slate-500">Specify the number of weeks for the chairman rotation gap.</p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    className="input max-w-[150px]"
                    value={draft.chairmanGapWeeks ?? 3}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        chairmanGapWeeks: clamp(parseInt(e.target.value || "1", 10), 1, 8),
                      })
                    }
                  />
                </div>
              )}

              {renderRuleCustomizerRow(
                "Field Ministry Segment Alternation",
                "Promotes fairness by ensuring a student who did a main assignment in the Apply Yourself segment gets an assistant role in their next part, and vice versa.",
                "ruleMinistryAlternation"
              )}

              {renderRuleCustomizerRow(
                "Minor Assistant to Adult",
                "Restricts minors from assisting adults in the Field Ministry segment to protect boundaries.",
                "ruleMinorAssistantToAdult"
              )}

              {renderRuleCustomizerRow(
                "Prefer Adult Assistant for Minor",
                "Attempts to assign an adult assistant when a minor is scheduled for a main field ministry part.",
                "ruleAdultAssistantForMinor",
                false
              )}

              {renderRuleCustomizerRow(
                "Main Assignment Workload Balancing",
                "Distributes midweek assignments evenly by penalizing recent main assignments in the scoring system.",
                "ruleMainWorkload",
                false
              )}

              {renderRuleCustomizerRow(
                "Assistant Assignment Workload Balancing",
                "Distributes assistant assignments evenly by penalizing recent assistant assignments in the scoring system.",
                "ruleAssistantWorkload",
                false
              )}

              {renderRuleCustomizerRow(
                "Meeting Segment Diversity",
                "Reduces repetition by penalizing scheduling a publisher in the same meeting segment too close together.",
                "ruleSegmentBalancing",
                false
              )}

              {renderRuleCustomizerRow(
                "Prevent Assistant Twice in a Row",
                "Prevents the same publisher from being scheduled as an assistant in consecutive assignments.",
                "rulePreventAssistantTwice"
              )}

              {renderRuleCustomizerRow(
                "Elderly / Infirmed Publisher Throttling",
                "Protects publishers marked as elderly or infirmed from being scheduled too frequently.",
                "ruleInfirmedThrottling",
                false
              )}

              {renderRuleCustomizerRow(
                "Same-Sex Demonstration Pairing",
                "Enforces same-sex pairings for ministry demonstrations, except when the main assignee and assistant belong to the same household.",
                "ruleSameSexDemogenders"
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white rounded-xl border border-slate-100 shadow-sm hover:border-slate-200 transition-all gap-4">
                <div className="space-y-1">
                  <span className="font-semibold text-slate-800 text-sm">Main/Assistant Pairing Avoidance</span>
                  <p className="text-xs text-slate-500">Controls pairing repetition: avoids pairing a publisher with the same assistant (or main assignee) within their last 2 or next 2 parts.</p>
                </div>
                <select
                  className="input text-xs py-1.5 max-w-[150px]"
                  value={draft.pairingAvoidance || "strict"}
                  onChange={(e) =>
                    setDraft({ ...draft, pairingAvoidance: e.target.value as any })
                  }
                >
                  <option value="strict">Strict (Hard Limit)</option>
                  <option value="relaxed">Relaxed (Warning)</option>
                  <option value="off">Off (Disabled)</option>
                </select>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center">
              <button className="btn" onClick={save}>
                Save settings
              </button>
              {saved && (
                <span className="text-sm text-green-600 font-semibold ml-3 animate-fade-in">✓ Settings saved</span>
              )}
            </div>
          </div>
        )}

        {activeTab === "shares" && (
          <div className="card space-y-4 animate-fade-in">
            <h2 className="text-xl font-bold text-slate-800">Congregation Shares &amp; Ratios</h2>
            <div>
              <h4 className="font-semibold text-slate-800 text-sm mb-3">Field Ministry Parts Shares</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 max-w-4xl bg-slate-50 p-4 border border-slate-200 rounded-md">
              <div>
                <label className="label">QE (Qualified Elders) Share (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input w-full"
                  value={draft.shareMinistryQE ?? 2}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      shareMinistryQE: clamp(parseInt(e.target.value || "0", 10), 0, 100),
                    })
                  }
                />
              </div>
              <div>
                <label className="label">E (Elders) Share (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input w-full"
                  value={draft.shareMinistryE ?? 2}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      shareMinistryE: clamp(parseInt(e.target.value || "0", 10), 0, 100),
                    })
                  }
                />
              </div>
              <div>
                <label className="label">QMS Share (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input w-full"
                  value={draft.shareMinistryQMS ?? 2}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      shareMinistryQMS: clamp(parseInt(e.target.value || "0", 10), 0, 100),
                    })
                  }
                />
              </div>
              <div>
                <label className="label">MS Share (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input w-full"
                  value={draft.shareMinistryMS ?? 2}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      shareMinistryMS: clamp(parseInt(e.target.value || "0", 10), 0, 100),
                    })
                  }
                />
              </div>
              <div>
                <label className="label">Baptised Brothers Share (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input w-full"
                  value={draft.shareMinistryBrothers ?? 2}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      shareMinistryBrothers: clamp(parseInt(e.target.value || "0", 10), 0, 100),
                    })
                  }
                />
              </div>
              <div className="flex flex-col justify-end">
                <div className="bg-indigo-50 border border-indigo-200 rounded p-2 text-xs text-indigo-800">
                  <span className="font-semibold">Sisters Share (Autocalculated):</span>{" "}
                  {Math.max(
                    0,
                    100 -
                      ((draft.shareMinistryQE ?? 2) +
                        (draft.shareMinistryE ?? 2) +
                        (draft.shareMinistryQMS ?? 2) +
                        (draft.shareMinistryMS ?? 2) +
                        (draft.shareMinistryBrothers ?? 2))
                  )}
                  %
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Specify the maximum percentage share of student Ministry demonstrations allocated to each brother category. 
              The remaining autocalculated portion is automatically allocated to sisters.
            </p>
          </div>

          <hr className="border-slate-200" />
          <h3 className="font-semibold text-slate-700">Scheduler Fairness</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 text-xs text-indigo-900 leading-relaxed sm:col-span-2 animate-fade-in">
              <strong className="font-semibold text-indigo-950 block mb-1">ℹ️ Date-Based Rotation Mark System Active</strong>
              The scheduler enforces category-based rotation: when a publisher is assigned a part type, they are marked with that assignment date. They will not be reassigned that same part type until all other eligible candidates have had a turn.
            </div>


            <div>
              <label className="label">Catch-up priority for overlooked publishers</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={5}
                  className="flex-1"
                  value={draft.catchUpIntensity ?? 1}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      catchUpIntensity: parseInt(e.target.value, 10),
                    })
                  }
                />
                <span className="text-sm font-mono w-6 text-center">
                  {draft.catchUpIntensity ?? 1}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                <strong>1 = equal rotation</strong> (default) — overlooked
                publishers simply join the normal pool alongside everyone
                else.{" "}
                <strong>3 = moderate</strong> — gives them a noticeable
                boost.{" "}
                <strong>5 = aggressive</strong> — fast-tracks them to the
                front of the queue. Increase only if you deliberately want
                to prioritise members who haven't had a part in a while.
              </p>
            </div>

            <div className="space-y-4 border-t border-slate-100 pt-4">
              <h4 className="text-sm font-semibold text-slate-700">Treasures Talk & Spiritual Gems Assignments Balance</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Control the percentage split of combined 10-min opening Talks and Spiritual Gems parts. The remaining portion is automatically allocated to Elders. Default is 0% for both (100% to Elders).
              </p>

              <div className="space-y-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
                {/* MS Slider */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-medium text-slate-600">Ministerial Servants (MS) Share</span>
                    <span className="text-xs font-semibold text-slate-700 bg-white px-2 py-0.5 rounded shadow-sm border border-slate-200 min-w-[3rem] text-center font-mono">
                      {draft.msTreasuresRatio ?? 0}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    value={draft.msTreasuresRatio ?? 0}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      const clampedQms = Math.min(draft.qmsTreasuresRatio ?? 0, 100 - val);
                      setDraft({
                        ...draft,
                        msTreasuresRatio: val,
                        qmsTreasuresRatio: clampedQms,
                      });
                    }}
                  />
                </div>

                {/* QMS Slider */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-medium text-slate-600">Qualified MS (QMS) Share</span>
                    <span className="text-xs font-semibold text-slate-700 bg-white px-2 py-0.5 rounded shadow-sm border border-slate-200 min-w-[3rem] text-center font-mono">
                      {draft.qmsTreasuresRatio ?? 0}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    value={draft.qmsTreasuresRatio ?? 0}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      const clampedMs = Math.min(draft.msTreasuresRatio ?? 0, 100 - val);
                      setDraft({
                        ...draft,
                        qmsTreasuresRatio: val,
                        msTreasuresRatio: clampedMs,
                      });
                    }}
                  />
                </div>

                {/* Elders Read-only Share */}
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-xs font-medium text-slate-600">
                  <span>Calculated Elders Share</span>
                  <span className="font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 min-w-[3rem] text-center font-mono">
                    {Math.max(0, 100 - (draft.msTreasuresRatio ?? 0) - (draft.qmsTreasuresRatio ?? 0))}%
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4 border-t border-slate-100 pt-4">
              <h4 className="text-sm font-semibold text-slate-700">Living Parts Assignments Balance</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Control the percentage split of Living Parts among Qualified Elders, Elders, and Qualified Ministerial Servants. The remaining portion is automatically allocated to Ministerial Servants. Default is 25% each.
              </p>

              <div className="space-y-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
                {/* QE Slider */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-medium text-slate-600">Qualified Elders (QE) Share</span>
                    <span className="text-xs font-semibold text-slate-700 bg-white px-2 py-0.5 rounded shadow-sm border border-slate-200 min-w-[3rem] text-center font-mono">
                      {draft.qeLivingRatio ?? 0}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    value={draft.qeLivingRatio ?? 0}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      const remaining = 100 - val;
                      const clampedE = Math.min(draft.eLivingRatio ?? 25, remaining);
                      const clampedQms = Math.min(draft.qmsLivingRatio ?? 25, remaining - clampedE);
                      setDraft({
                        ...draft,
                        qeLivingRatio: val,
                        eLivingRatio: clampedE,
                        qmsLivingRatio: clampedQms,
                      });
                    }}
                  />
                </div>

                {/* E Slider */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-medium text-slate-600">Elders (E) Share</span>
                    <span className="text-xs font-semibold text-slate-700 bg-white px-2 py-0.5 rounded shadow-sm border border-slate-200 min-w-[3rem] text-center font-mono">
                      {draft.eLivingRatio ?? 0}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    value={draft.eLivingRatio ?? 0}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      const remaining = 100 - val;
                      const clampedQe = Math.min(draft.qeLivingRatio ?? 25, remaining);
                      const clampedQms = Math.min(draft.qmsLivingRatio ?? 25, remaining - clampedQe);
                      setDraft({
                        ...draft,
                        eLivingRatio: val,
                        qeLivingRatio: clampedQe,
                        qmsLivingRatio: clampedQms,
                      });
                    }}
                  />
                </div>

                {/* QMS Slider */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-medium text-slate-600">Qualified MS (QMS) Share</span>
                    <span className="text-xs font-semibold text-slate-700 bg-white px-2 py-0.5 rounded shadow-sm border border-slate-200 min-w-[3rem] text-center font-mono">
                      {draft.qmsLivingRatio ?? 0}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    value={draft.qmsLivingRatio ?? 0}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      const remaining = 100 - val;
                      const clampedQe = Math.min(draft.qeLivingRatio ?? 25, remaining);
                      const clampedE = Math.min(draft.eLivingRatio ?? 25, remaining - clampedQe);
                      setDraft({
                        ...draft,
                        qmsLivingRatio: val,
                        qeLivingRatio: clampedQe,
                        eLivingRatio: clampedE,
                      });
                    }}
                  />
                </div>

                {/* MS Read-only Share */}
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-xs font-medium text-slate-600">
                  <span>Calculated Ministerial Servants (MS) Share</span>
                  <span className="font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 min-w-[3rem] text-center font-mono">
                    {Math.max(0, 100 - (draft.qeLivingRatio ?? 0) - (draft.eLivingRatio ?? 0) - (draft.qmsLivingRatio ?? 0))}%
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4 border-t border-slate-100 pt-4">
              <h4 className="text-sm font-semibold text-slate-700">Bible Reading Assignments Balance</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Control the maximum percentage of weekly Bible Reading assignments that should be allocated to privileged brothers (Elders, Qualified Elders, Ministerial Servants, Qualified Ministerial Servants). The remaining portion is automatically allocated to non-privileged brothers. Default is 10%.
              </p>

              <div className="space-y-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
                {/* Privileged slider */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-medium text-slate-600">Privileged Brothers (E/QE/MS/QMS) Share</span>
                    <span className="text-xs font-semibold text-slate-700 bg-white px-2 py-0.5 rounded shadow-sm border border-slate-200 min-w-[3rem] text-center font-mono">
                      {draft.privilegedBibleReadingRatio ?? 10}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    value={draft.privilegedBibleReadingRatio ?? 10}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setDraft({
                        ...draft,
                        privilegedBibleReadingRatio: val,
                      });
                    }}
                  />
                </div>

                {/* Non-privileged Read-only Share */}
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-xs font-medium text-slate-600">
                  <span>Calculated Non-Privileged Brothers Share</span>
                  <span className="font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 min-w-[3rem] text-center font-mono">
                    {Math.max(0, 100 - (draft.privilegedBibleReadingRatio ?? 10))}%
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label className="label">Max assignments per month</label>
              <input
                type="number"
                min={0}
                max={8}
                className="input max-w-xs"
                value={draft.maxAssignmentsPerMonth ?? 2}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    maxAssignmentsPerMonth: clamp(
                      parseInt(e.target.value || "0", 10),
                      0,
                      8
                    ),
                  })
                }
              />
              <p className="text-xs text-slate-500 mt-1">
                Limits the total main assignments any one person can receive in a
                rolling 4-week window. Set to 0 to disable.
              </p>
            </div>

            <div>
              <label className="label">Optimization Threshold (Main Role)</label>
              <input
                type="number"
                min={0}
                max={100}
                className="input max-w-xs"
                value={draft.optimizationThresholdMain ?? 50}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    optimizationThresholdMain: clamp(
                      parseInt(e.target.value || "50", 10),
                      0,
                      100
                    ),
                  })
                }
              />
              <p className="text-xs text-slate-500 mt-1">
                Minimum score difference required for the system to suggest replacing a main assignee. Higher values mean fewer, more impactful suggestions. Default is 50.
              </p>
            </div>

            <div>
              <label className="label">Optimization Threshold (Assistant Role)</label>
              <input
                type="number"
                min={0}
                max={100}
                className="input max-w-xs"
                value={draft.optimizationThresholdAssistant ?? 40}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    optimizationThresholdAssistant: clamp(
                      parseInt(e.target.value || "40", 10),
                      0,
                      100
                    ),
                  })
                }
              />
              <p className="text-xs text-slate-500 mt-1">
                Minimum score difference required for the system to suggest replacing an assistant. Default is 40.
              </p>
            </div>


          </div>

          <div>
            <button className="btn" onClick={save}>
              Save settings
            </button>
            {saved && (
              <span
                className="inline-flex items-center gap-1 text-sm font-medium ml-3 animate-fade-in"
                style={{ color: 'var(--treasures)' }}
              >
                ✓ Settings saved
              </span>
            )}
          </div>
        </div>
      )}

        {/* ── Prayer Overrides Section ── */}
        {activeTab === "customParts" && (
          <div className="space-y-6 animate-fade-in">
            <div className="card space-y-4 relative">
          <h2 className="text-xl font-bold text-slate-800">Manual Prayer Qualifications</h2>
          <p className="text-sm text-slate-500">
            Only Elders, Ministerial Servants, and Congregation Bible Study Readers (CBSR) are qualified to offer Opening and Closing Prayer by default. You can manually exclude privileged brothers, or manually include non-privileged brothers.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            {/* Exclude List */}
            <div className="space-y-3 p-4 bg-slate-50/50 rounded-xl border border-slate-100 flex flex-col">
              <h3 className="font-semibold text-slate-800 flex items-center justify-between">
                <span>Manually Excluded (Privileged)</span>
                <span className="pill bg-rose-50 text-rose-700 text-xs font-bold border border-rose-100">
                  {excludedBrothers.length} Excluded
                </span>
              </h3>
              
              {/* Search and Add */}
              <div ref={excludeRef} className="relative">
                <input
                  type="text"
                  placeholder="Search privileged brothers to exclude..."
                  className="input text-sm"
                  value={excludeSearch}
                  onChange={(e) => {
                    setExcludeSearch(e.target.value);
                    setExcludeDropdownOpen(true);
                  }}
                  onFocus={() => setExcludeDropdownOpen(true)}
                />
                {excludeDropdownOpen && excludeSearch.trim() && (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {excludeCandidates.length === 0 ? (
                      <div className="p-3 text-xs text-slate-400">No eligible brothers found.</div>
                    ) : (
                      excludeCandidates.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between"
                          onClick={async () => {
                            if (a.id != null) {
                              await db.assignees.update(a.id, { excludeFromPrayers: true, includeInPrayers: false });
                              await addLog("settings", `Manually excluded ${a.name} from prayers`);
                            }
                            setExcludeSearch("");
                            setExcludeDropdownOpen(false);
                          }}
                        >
                          <span className="font-medium text-slate-700">{a.name}</span>
                          <div className="flex gap-1">
                            {(a.privileges ?? []).map((p: string) => (
                              <span key={p} className="pill bg-slate-100 text-slate-600 text-[10px] font-semibold border border-slate-200">
                                {p}
                              </span>
                            ))}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* List of currently excluded */}
              <div className="min-h-[100px] max-h-56 overflow-y-auto border border-slate-200 rounded-lg bg-white divide-y divide-slate-100 custom-scrollbar flex-1">
                {excludedBrothers.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400 italic">No manual exclusions.</div>
                ) : (
                  excludedBrothers.map((a) => (
                    <div key={a.id} className="flex items-center justify-between p-2.5 hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-700">{a.name}</span>
                        <div className="flex gap-0.5">
                          {(a.privileges ?? []).map((p: string) => (
                            <span key={p} className="pill bg-amber-50 text-amber-700 text-[9px] font-bold border border-amber-100">
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="text-xs text-rose-500 hover:text-rose-700 font-semibold px-2 py-1 rounded hover:bg-rose-50 transition-colors"
                        onClick={async () => {
                          if (a.id != null) {
                            await db.assignees.update(a.id, { excludeFromPrayers: false });
                            await addLog("settings", `Removed prayer exclusion for ${a.name}`);
                          }
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Include List */}
            <div className="space-y-3 p-4 bg-slate-50/50 rounded-xl border border-slate-100 flex flex-col">
              <h3 className="font-semibold text-slate-800 flex items-center justify-between">
                <span>Manually Included (Non-Privileged)</span>
                <span className="pill bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-100">
                  {includedBrothers.length} Included
                </span>
              </h3>
              
              {/* Search and Add */}
              <div ref={includeRef} className="relative">
                <input
                  type="text"
                  placeholder="Search non-privileged brothers to include..."
                  className="input text-sm"
                  value={includeSearch}
                  onChange={(e) => {
                    setIncludeSearch(e.target.value);
                    setIncludeDropdownOpen(true);
                  }}
                  onFocus={() => setIncludeDropdownOpen(true)}
                />
                {includeDropdownOpen && includeSearch.trim() && (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {includeCandidates.length === 0 ? (
                      <div className="p-3 text-xs text-slate-400">No eligible brothers found.</div>
                    ) : (
                      includeCandidates.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between"
                          onClick={async () => {
                            if (a.id != null) {
                              await db.assignees.update(a.id, { includeInPrayers: true, excludeFromPrayers: false });
                              await addLog("settings", `Manually included ${a.name} in prayers`);
                            }
                            setIncludeSearch("");
                            setIncludeDropdownOpen(false);
                          }}
                        >
                          <span className="font-medium text-slate-700">{a.name}</span>
                          <span className="text-[10px] text-slate-400">Publisher</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* List of currently included */}
              <div className="min-h-[100px] max-h-56 overflow-y-auto border border-slate-200 rounded-lg bg-white divide-y divide-slate-100 custom-scrollbar flex-1">
                {includedBrothers.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400 italic">No manual inclusions.</div>
                ) : (
                  includedBrothers.map((a) => (
                    <div key={a.id} className="flex items-center justify-between p-2.5 hover:bg-slate-50 transition-colors">
                      <span className="text-sm font-medium text-slate-700">{a.name}</span>
                      <button
                        type="button"
                        className="text-xs text-rose-500 hover:text-rose-700 font-semibold px-2 py-1 rounded hover:bg-rose-50 transition-colors"
                        onClick={async () => {
                          if (a.id != null) {
                            await db.assignees.update(a.id, { includeInPrayers: false });
                            await addLog("settings", `Removed prayer inclusion for ${a.name}`);
                          }
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Custom Part Types Section ── */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-800">Custom Part Types Manager</h2>
            <p className="text-xs text-slate-500">
              Manage custom assignments for each midweek meeting segment.
            </p>
          </div>
          <p className="text-sm text-slate-500">
            Define custom meeting parts that will appear in the scheduling dropdowns under each segment. You can toggle whether they require an assistant, rename them (which automatically updates past schedules), or delete them.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            {(["opening", "treasures", "ministry", "living"] as SegmentId[]).map((segment) => {
              const label = SEGMENT_LABELS[segment];
              const parts = draft.customPartTypes?.[segment] || [];
              const isAdding = addingSegment === segment;
              const error = customPartsError[segment];

              return (
                <div key={segment} className="space-y-3 p-4 bg-slate-50/50 rounded-xl border border-slate-100 flex flex-col justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-800 flex items-center justify-between mb-2 pb-1 border-b border-slate-100">
                      <span>{label}</span>
                      <span className="pill bg-slate-100 text-slate-600 text-xs font-bold border border-slate-200">
                        {parts.length} Custom
                      </span>
                    </h3>

                    {/* List of custom parts for this segment */}
                    <div className="space-y-2 mb-3 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                      {parts.length === 0 ? (
                        <p className="text-xs text-slate-400 italic py-2">No custom part types defined for this segment.</p>
                      ) : (
                        parts.map((partType) => {
                          const isEditing = editingPart?.segment === segment && editingPart?.oldName === partType;
                          const rule = draft.assignmentRules?.[partType];
                          const hasAssistant = rule?.assistant !== undefined;

                          if (isEditing) {
                            return (
                              <div key={partType} className="flex flex-col gap-1.5 p-2 bg-white rounded-lg border border-indigo-200 shadow-sm animate-fade-in">
                                <input
                                  type="text"
                                  className="input text-xs py-1"
                                  value={editingPart.name}
                                  onChange={(e) => setEditingPart({ ...editingPart, name: e.target.value })}
                                  placeholder="Part name..."
                                  autoFocus
                                />
                                <div className="flex justify-end gap-1">
                                  <button
                                    type="button"
                                    className="btn-secondary text-[11px] py-0.5 px-2"
                                    onClick={() => {
                                      setEditingPart(null);
                                      setCustomPartsError(prev => ({ ...prev, [segment]: "" }));
                                    }}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className="btn text-[11px] py-0.5 px-2 bg-indigo-600 text-white hover:bg-indigo-700"
                                    onClick={() => handleRenameCustomPart(segment)}
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div key={partType} className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-100 hover:border-slate-200 shadow-sm transition-all">
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-medium text-slate-700">{partType}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                                  <input
                                    type="checkbox"
                                    className="checkbox w-3.5 h-3.5"
                                    checked={hasAssistant}
                                    onChange={(e) => handleToggleAssistant(partType, segment, e.target.checked)}
                                  />
                                  <span>Needs Assistant</span>
                                </label>
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    className="text-xs text-slate-500 hover:text-slate-800 font-medium px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors"
                                    onClick={() => setEditingPart({ segment, oldName: partType, name: partType })}
                                  >
                                    Rename
                                  </button>
                                  <button
                                    type="button"
                                    className="text-xs text-rose-500 hover:text-rose-700 font-semibold px-1.5 py-0.5 rounded hover:bg-rose-50 transition-colors"
                                    onClick={() => {
                                      setConfirmState({
                                        isOpen: true,
                                        title: "Delete Custom Part Type",
                                        message: `Are you sure you want to delete "${partType}"? Past schedule entries using this part type will not be affected, but you won't be able to assign it or configure eligibility rules for it anymore.`,
                                        confirmText: "Delete",
                                        cancelText: "Cancel",
                                        type: "danger",
                                        onConfirm: () => {
                                          handleDeleteCustomPart(partType, segment);
                                          setConfirmState(prev => ({ ...prev, isOpen: false }));
                                        }
                                      });
                                    }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Add Custom Part Form */}
                  <div className="mt-auto pt-2 border-t border-slate-100">
                    {isAdding ? (
                      <div className="space-y-2 p-2 bg-white rounded-lg border border-slate-200 shadow-sm animate-fade-in">
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-slate-400">Part Type Name</label>
                          <input
                            type="text"
                            className="input text-xs py-1"
                            value={newPartName}
                            onChange={(e) => setNewPartName(e.target.value)}
                            placeholder="e.g. Memorial Invitation"
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            id={`add-assistant-${segment}`}
                            className="checkbox w-3.5 h-3.5"
                            checked={newPartNeedsAssistant}
                            onChange={(e) => setNewPartNeedsAssistant(e.target.checked)}
                          />
                          <label htmlFor={`add-assistant-${segment}`} className="text-xs text-slate-600 cursor-pointer">
                            Needs Assistant
                          </label>
                        </div>
                        <div className="flex justify-end gap-1.5 pt-1">
                          <button
                            type="button"
                            className="btn-secondary text-[11px] py-0.5 px-2"
                            onClick={() => {
                              setAddingSegment(null);
                              setNewPartName("");
                              setNewPartNeedsAssistant(false);
                              setCustomPartsError(prev => ({ ...prev, [segment]: "" }));
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn text-[11px] py-0.5 px-2 bg-indigo-600 text-white hover:bg-indigo-700 font-semibold"
                            onClick={() => handleAddCustomPart(segment)}
                          >
                            Add Part Type
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1.5 py-1 px-2 rounded hover:bg-indigo-50 transition-all"
                        onClick={() => {
                          setAddingSegment(segment);
                          setNewPartNeedsAssistant(segment === "ministry");
                        }}
                      >
                        + Add Custom Part Type
                      </button>
                    )}
                    {error && (
                      <p className="text-[10px] text-rose-500 font-medium mt-1 animate-shake">{error}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center">
            <button className="btn" onClick={save}>
              Save settings
            </button>
            {saved && (
              <span
                className="inline-flex items-center gap-1 text-sm font-medium ml-3 animate-fade-in"
                style={{ color: 'var(--treasures)' }}
              >
                ✓ Settings saved
              </span>
            )}
          </div>
        </div>
      </div>
    )}

      {activeTab === "eligibility" && (
        <div className="card space-y-4 animate-fade-in">
          <h2 className="text-xl font-bold text-slate-800">Assignment Eligibility Rules</h2>
          <p className="text-sm text-slate-500">
            Configure who can be assigned to each part type. "Main" refers to the primary person (e.g. Conductor, Speaker), and "Assistant" refers to the secondary person (e.g. Reader, Householder).
          </p>

          <div className="overflow-x-auto -mx-6 sm:mx-0">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase font-bold border-y border-slate-100">
                  <th className="py-2 px-6">Part Type</th>
                  <th className="py-2 px-6">Role</th>
                  <th className="py-2 px-6">Allowed Genders</th>
                  <th className="py-2 px-6">Must be Baptized</th>
                  <th className="py-2 px-6">Required Privileges</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-slate-50">
                {Object.keys(draft.assignmentRules || DEFAULT_ASSIGNMENT_RULES).map((partType) => (
                  <RuleRows
                    key={partType}
                    partType={partType}
                    rule={draft.assignmentRules?.[partType] || DEFAULT_ASSIGNMENT_RULES[partType]}
                    onChange={(r) => {
                      setDraft({
                        ...draft,
                        assignmentRules: { ...draft.assignmentRules, [partType]: r },
                      });
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center">
            <button className="btn" onClick={save}>
              Save settings
            </button>
            {saved && (
              <span
                className="inline-flex items-center gap-1 text-sm font-medium ml-3 animate-fade-in"
                style={{ color: 'var(--treasures)' }}
              >
                ✓ Settings saved
              </span>
            )}
          </div>
        </div>
      )}

      {activeTab === "general" && (
        <>
          <div className="card space-y-3">
          <h2 className="font-semibold">Backup &amp; restore</h2>
          <p className="text-sm text-slate-600">
            All data lives in your browser. Use backup + restore to move between
            devices or keep a safety copy.
          </p>
          <div className="flex gap-2 flex-wrap">
            <button className="btn-secondary" onClick={exportBackup}>
              Download backup (.json)
            </button>
            <label className="btn-secondary cursor-pointer">
              Restore from backup
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) restoreBackup(f);
                }}
              />
            </label>
            <button className="btn-danger ml-auto" onClick={wipeAll}>
              Erase all data
            </button>
          </div>
        </div>

        <section id="changelog" className="mt-12 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-slate-800">Change Log</h2>
            <span className="pill bg-slate-100 text-slate-600 text-xs font-semibold">
              Page {currentPage} of {totalPages} ({validLogs.length} entries)
            </span>
          </div>

          <div className="card p-0 overflow-hidden border-slate-200 shadow-sm">
            {validLogs.length === 0 ? (
              <div className="p-12 text-center">
                <div className="text-4xl mb-3">📋</div>
                <p className="text-slate-500">No activity logged yet.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="py-3 px-5 text-left font-semibold text-slate-600 w-48">Date & Time</th>
                        <th className="py-3 px-5 text-left font-semibold text-slate-600 w-32">Category</th>
                        <th className="py-3 px-5 text-left font-semibold text-slate-600">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="py-3 px-5 text-slate-500 font-mono text-[13px]">
                            {new Date(log.timestamp).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="py-3 px-5">
                            <span className={`pill text-[10px] font-bold uppercase tracking-wider ${
                              log.category === "settings" ? "bg-amber-50 text-amber-700 border border-amber-100" :
                              log.category === "schedule" ? "bg-indigo-50 text-indigo-700 border border-indigo-100" :
                              log.category === "enrollees" ? "bg-emerald-50 text-emerald-700 border border-emerald-100" :
                              "bg-slate-50 text-slate-600 border border-slate-200"
                            }`}>
                              {log.category}
                            </span>
                          </td>
                          <td className="py-3 px-5">
                            <div className="font-medium text-slate-800">{log.action}</div>
                            {log.details && (
                              <div className="text-xs text-slate-500 mt-0.5">{log.details}</div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Clean and beautiful pagination footer */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-4 py-3 sm:px-6">
                    <div className="flex flex-1 justify-between sm:hidden">
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                        disabled={currentPage === 1}
                        className="btn-secondary text-xs py-1"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                        disabled={currentPage === totalPages}
                        className="btn-secondary text-xs py-1"
                      >
                        Next
                      </button>
                    </div>
                    <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs text-slate-500">
                          Showing <span className="font-semibold text-slate-700">{startIndex + 1}</span> to{" "}
                          <span className="font-semibold text-slate-700">
                            {Math.min(endIndex, totalItems)}
                          </span>{" "}
                          of <span className="font-semibold text-slate-700">{totalItems}</span> entries
                        </p>
                      </div>
                      <div>
                        <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm bg-white" aria-label="Pagination">
                          <button
                            onClick={() => setCurrentPage(1)}
                            disabled={currentPage === 1}
                            className="relative inline-flex items-center rounded-l-md px-2 py-1.5 text-xs font-semibold text-slate-500 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed bg-white"
                          >
                            « First
                          </button>
                          <button
                            onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                            disabled={currentPage === 1}
                            className="relative inline-flex items-center px-2 py-1.5 text-xs font-semibold text-slate-500 border-y border-r border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed bg-white"
                          >
                            ‹ Prev
                          </button>
                          {pageNumbers.map((page) => (
                            <button
                              key={page}
                              onClick={() => setCurrentPage(page)}
                              style={page === currentPage ? { backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)' } : undefined}
                              className={`relative inline-flex items-center px-3 py-1.5 text-xs font-semibold border-y border-r ${
                                page === currentPage
                                  ? "z-10 text-white"
                                  : "text-slate-700 border-slate-200 hover:bg-slate-50 bg-white"
                              }`}
                            >
                              {page}
                            </button>
                          ))}
                          <button
                            onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                            disabled={currentPage === totalPages}
                            className="relative inline-flex items-center px-2 py-1.5 text-xs font-semibold text-slate-500 border-y border-r border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed bg-white"
                          >
                            Next ›
                          </button>
                          <button
                            onClick={() => setCurrentPage(totalPages)}
                            disabled={currentPage === totalPages}
                            className="relative inline-flex items-center rounded-r-md px-2 py-1.5 text-xs font-semibold text-slate-500 border-y border-r border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed bg-white"
                          >
                            Last »
                          </button>
                        </nav>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <p className="text-center text-[10px] text-slate-400 mt-4 italic">
            The change log automatically prunes old entries beyond 500 records.
          </p>
        </section>
      </>
    )}

        {onNavigateToAdmin && (
          <div className="text-right">
            <button
              className="text-xs text-gray-400 hover:text-gray-600 hover:underline transition-colors"
              onClick={onNavigateToAdmin}
            >
              Admin
            </button>
          </div>
        )}

        <ConfirmationModal
          isOpen={confirmState.isOpen}
          title={confirmState.title}
          message={confirmState.message}
          confirmText={confirmState.confirmText}
          cancelText={confirmState.cancelText}
          type={confirmState.type}
          showCancel={confirmState.showCancel}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
        />
      </div>
    );
  } catch (renderError: any) {
    console.error("Crash during SettingsPage render:", renderError);
    return (
      <div className="card p-6 border-[#4a6da7]/20 bg-slate-50 text-[#3d5b8e] space-y-4 shadow-md">
        <div className="flex items-start gap-3">
          <span className="text-2xl text-[#4a6da7]">⚠️</span>
          <div>
            <h3 className="text-lg font-bold text-[#4a6da7]">Settings Page Diagnostic Panel</h3>
            <p className="text-xs text-slate-500 mt-1">
              A rendering anomaly was caught and isolated. Your settings remain completely safe.
            </p>
          </div>
        </div>
        <p className="text-sm text-slate-700">Please review the technical diagnostic details below. You can try reloading the page or restoring default settings to clear any corruption:</p>
        <pre className="p-4 bg-slate-100 rounded-lg text-xs font-mono overflow-auto max-h-80 border border-slate-200 text-slate-800 leading-relaxed">
          {renderError?.stack || renderError?.message || String(renderError)}
        </pre>
        <div className="flex gap-2">
          <button 
            className="btn text-xs py-1.5 px-3 bg-[#4a6da7] hover:bg-[#3d5b8e] text-white" 
            onClick={() => window.location.reload()}
          >
            Reload Page
          </button>
          <button 
            className="btn-secondary text-xs py-1.5 px-3 border border-[#4a6da7]/35 text-[#4a6da7] hover:bg-slate-100" 
            onClick={restoreDefaults}
          >
            Restore Default Settings
          </button>
        </div>
      </div>
    );
  }
}

function RuleRows({
  partType,
  rule,
  onChange,
}: {
  partType: string;
  rule: AssignmentRule;
  onChange: (r: AssignmentRule) => void;
}) {
  const ALL_PRIVILEGES: Privilege[] = ["QE", "E", "QMS", "MS", "RP", "CBSR"];

  const renderRow = (
    label: string,
    target: {
      allowedGenders: Gender[];
      mustBeBaptized: boolean;
      requiredPrivileges: Privilege[];
    },
    update: (fields: Partial<typeof target>) => void
  ) => (
    <tr>
      <td className="py-2 px-6 font-medium text-slate-700">{label === "Talk" ? "Treasures Talk" : label === "Congregation Bible Study-assistant" ? "Congregation Bible Study Reader" : label}</td>
      <td className="py-2 px-6 text-slate-500 italic">
        {label === partType ? "Main" : "Assistant"}
      </td>
      <td className="py-2 px-6">
        <div className="flex gap-3">
          {["M", "F"].map((g) => (
            <label
              key={g}
              className="inline-flex items-center gap-1.5 cursor-pointer"
            >
              <input
                type="checkbox"
                className="checkbox"
                checked={(target?.allowedGenders ?? []).includes(g as Gender)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...(target?.allowedGenders ?? []), g as Gender]
                    : (target?.allowedGenders ?? []).filter((x) => x !== g);
                  update({ allowedGenders: next });
                }}
              />
              <span className="text-xs font-bold">{g}</span>
            </label>
          ))}
        </div>
      </td>
      <td className="py-2 px-6">
        <input
          type="checkbox"
          className="checkbox"
          checked={target?.mustBeBaptized ?? false}
          onChange={(e) => update({ mustBeBaptized: e.target.checked })}
        />
      </td>
      <td className="py-2 px-6">
        <div className="flex flex-wrap gap-2">
          {ALL_PRIVILEGES.map((p) => (
            <label
              key={p}
              className="inline-flex items-center gap-1 cursor-pointer"
            >
              <input
                type="checkbox"
                className="checkbox w-3 h-3"
                checked={(target?.requiredPrivileges ?? []).includes(p)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...(target?.requiredPrivileges ?? []), p]
                    : (target?.requiredPrivileges ?? []).filter((x) => x !== p);
                  update({ requiredPrivileges: next });
                }}
              />
              <span className="text-[10px] font-mono">{p}</span>
            </label>
          ))}
        </div>
      </td>
    </tr>
  );

  return (
    <>
      {renderRow(partType, rule, (fields) => onChange({ ...rule, ...fields }))}
      {rule?.assistant &&
        renderRow(partType + "-assistant", rule.assistant, (fields) =>
          onChange({
            ...rule,
            assistant: { ...rule.assistant!, ...fields },
          })
        )}
    </>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
