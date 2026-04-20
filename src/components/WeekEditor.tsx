import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Assignee,
  Assignment,
  PartType,
  SegmentId,
  Week,
} from "../types";
import {
  SEGMENTS,
  SEGMENT_PART_TYPES,
  isEligible,
  needsAssistant,
  privilegeLabel,
  segmentOf,
} from "../meeting";
import { weekRangeLabel } from "../utils";
export interface WeekEditorProps {
  week: Week;
  assignees: Assignee[];
  onSave: (w: Week) => void | Promise<void>;
  onDelete: () => void;
  onAutoFill: (preserveExisting: boolean) => void;
  onClear: () => void;
  onAddPart: (segment: SegmentId, partType: PartType) => void;
  onRemovePart: (uid: string) => void;
  onUpdateAssignment: (a: Assignment) => void;
}

export default function WeekEditor(props: WeekEditorProps) {
  const { week, assignees } = props;

  const bySegment = useMemo(() => {
    const map: Record<SegmentId, Assignment[]> = {
      opening: [],
      treasures: [],
      ministry: [],
      living: [],
    };
    for (const a of week.assignments) map[a.segment].push(a);
    for (const id of Object.keys(map) as SegmentId[]) {
      map[id].sort((a, b) => a.order - b.order);
    }
    return map;
  }, [week.assignments]);

  return (
    <div className="space-y-5">
      <header className="card">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="font-semibold text-lg">{weekRangeLabel(week.weekOf)}</h2>
            <div className="text-xs text-slate-500">
              {week.weeklyBibleReading
                ? <span className="font-medium text-slate-600">{week.weeklyBibleReading} &middot; </span>
                : null}
              {week.assignments.length} parts &middot;{" "}
              {week.assignments.filter((a) => a.assigneeId).length} assigned
            </div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              onClick={() => props.onClear()}
            >
              Clear all
            </button>
            <button
              className="btn-secondary"
              onClick={() => props.onAutoFill(true)}
              title="Fill empty slots only"
            >
              Auto-fill empty
            </button>
            <button
              className="btn"
              onClick={() => props.onAutoFill(false)}
              title="Reassign everything from scratch"
            >
              Auto-assign all
            </button>
            <button className="btn-danger" onClick={() => props.onDelete()}>
              Delete
            </button>
          </div>
        </div>
        <div className="mt-3">
          <label className="label">Weekly Bible reading (optional)</label>
          <input
            className="input max-w-md"
            value={week.weeklyBibleReading ?? ""}
            onChange={(e) =>
              props.onSave({
                ...week,
                weeklyBibleReading: e.target.value,
              })
            }
            placeholder="e.g. Matthew 5-7"
          />
        </div>
      </header>

      {/* Opening segment — always first, single Chairman slot */}
      <SegmentCard
        key="opening"
        segment="opening"
        title="Opening"
        accent="#64748b"
        assignments={bySegment.opening}
        assignees={assignees}
        week={week}
        onAddPart={(t) => props.onAddPart("opening", t)}
        onRemovePart={props.onRemovePart}
        onUpdateAssignment={props.onUpdateAssignment}
      />
      {SEGMENTS.filter((s) => s.id !== "opening").map((seg) => (
        <SegmentCard
          key={seg.id}
          segment={seg.id}
          title={seg.label}
          accent={seg.color}
          assignments={bySegment[seg.id]}
          assignees={assignees}
          week={week}
          onAddPart={(t) => props.onAddPart(seg.id, t)}
          onRemovePart={props.onRemovePart}
          onUpdateAssignment={props.onUpdateAssignment}
        />
      ))}
    </div>
  );
}

function SegmentCard({
  segment,
  title,
  accent,
  assignments,
  assignees,
  week,
  onAddPart,
  onRemovePart,
  onUpdateAssignment,
}: {
  segment: SegmentId;
  title: string;
  accent: string;
  assignments: Assignment[];
  assignees: Assignee[];
  week: Week;
  onAddPart: (t: PartType) => void;
  onRemovePart: (uid: string) => void;
  onUpdateAssignment: (a: Assignment) => void;
}) {
  const [pickerType, setPickerType] = useState<PartType>(
    SEGMENT_PART_TYPES[segment][0]
  );

  const minGuard =
    segment === "ministry"
      ? assignments.length < 3
      : segment === "living"
      ? assignments.length < 2
      : false;

  return (
    <section className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: accent }}
          />
          {title}
        </h3>
        <div className="flex gap-2 items-center">
          <select
            className="input w-auto"
            value={pickerType}
            onChange={(e) => setPickerType(e.target.value as PartType)}
          >
            {SEGMENT_PART_TYPES[segment].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            className="btn-secondary"
            onClick={() => onAddPart(pickerType)}
          >
            + Part
          </button>
        </div>
      </div>
      {minGuard && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
          {segment === "ministry"
            ? "This segment should have at least 3 parts."
            : "This segment should have at least 2 parts."}
        </p>
      )}
      {assignments.length === 0 ? (
        <p className="text-sm text-slate-500">No parts added yet.</p>
      ) : (
        <ul className="space-y-3">
          {assignments.map((a) => (
            <PartRow
              key={a.uid}
              assignment={a}
              assignees={assignees}
              week={week}
              onRemove={() => onRemovePart(a.uid)}
              onUpdate={onUpdateAssignment}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PartRow({
  assignment,
  assignees,
  week,
  onRemove,
  onUpdate,
}: {
  assignment: Assignment;
  assignees: Assignee[];
  week: Week;
  onRemove: () => void;
  onUpdate: (a: Assignment) => void;
}) {
  const eligibleMain = useMemo(
    () => assignees.filter((a) => isEligible(a, assignment.partType, "main")),
    [assignees, assignment.partType]
  );
  const eligibleAssistant = useMemo(
    () =>
      assignees.filter((a) => isEligible(a, assignment.partType, "assistant")),
    [assignees, assignment.partType]
  );

  const seg = segmentOf(assignment.segment);
  const showAssistant = needsAssistant(assignment.partType);
  const mainPerson = assignees.find((a) => a.id === assignment.assigneeId);

  // Flag if already used in this meeting (helpful hint)
  const usedIds = new Set(
    week.assignments
      .filter((a) => a.uid !== assignment.uid)
      .flatMap((a) =>
        [a.assigneeId, a.assistantId].filter((x): x is number => x != null)
      )
  );

  return (
    <li
      className="border border-slate-200 rounded-md p-3"
      style={{ borderLeft: `4px solid ${seg.color}` }}
    >
      <div className="flex flex-wrap gap-2 items-start">
        <div className="flex-1 min-w-[160px]">
          <label className="label">Part type</label>
          <select
            className="input"
            value={assignment.partType}
            onChange={(e) =>
              onUpdate({
                ...assignment,
                partType: e.target.value as PartType,
              })
            }
          >
            {SEGMENT_PART_TYPES[assignment.segment].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-[2] min-w-[220px]">
          <label className="label">Title</label>
          <input
            className="input"
            value={assignment.title}
            placeholder={titlePlaceholder(assignment.partType)}
            onChange={(e) =>
              onUpdate({ ...assignment, title: e.target.value })
            }
          />
        </div>
        <div className="pt-5">
          <button
            className="text-slate-400 hover:text-red-600 text-sm"
            onClick={onRemove}
            title="Remove part"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <AssigneePicker
          label={showAssistant ? "Main / publisher" : "Assigned to"}
          value={assignment.assigneeId}
          options={eligibleMain}
          usedIds={usedIds}
          onChange={(id) => onUpdate({ ...assignment, assigneeId: id })}
        />
        {showAssistant && (
          <AssigneePicker
            label={
              assignment.partType === "Congregation Bible Study"
                ? "Reader"
                : "Householder / assistant"
            }
            value={assignment.assistantId}
            options={
              assignment.partType === "Congregation Bible Study"
                ? eligibleAssistant
                : // For demo parts, prefer same gender as main.
                  eligibleAssistant.filter(
                    (a) =>
                      !mainPerson ||
                      a.gender === mainPerson.gender ||
                      mainPerson.gender == null
                  )
            }
            usedIds={usedIds}
            onChange={(id) => onUpdate({ ...assignment, assistantId: id })}
          />
        )}
      </div>
      <div className="mt-2">
        <input
          className="input"
          placeholder="Scheduler note (optional)"
          value={assignment.note ?? ""}
          onChange={(e) =>
            onUpdate({ ...assignment, note: e.target.value || undefined })
          }
        />
      </div>
    </li>
  );
}

function AssigneePicker({
  label,
  value,
  options,
  usedIds,
  onChange,
}: {
  label: string;
  value?: number;
  options: Assignee[];
  usedIds: Set<number>;
  onChange: (id: number | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close when clicking outside
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const selected = options.find((a) => a.id === value);
  const displayValue = selected
    ? [selected.name, privilegeLabel(selected) ? `(${privilegeLabel(selected)})` : null]
        .filter(Boolean)
        .join(" ")
    : "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      (privilegeLabel(a) ?? "").toLowerCase().includes(q)
    );
  }, [options, query]);

  function selectOption(id: number | undefined) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <label className="label">{label}</label>
      {/* Trigger input */}
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          className="input"
          style={{ paddingRight: "2rem", cursor: "text" }}
          placeholder="— unassigned —"
          value={open ? query : displayValue}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setOpen(false); setQuery(""); }
            if (e.key === "Enter" && filtered.length === 1) {
              selectOption(filtered[0].id);
            }
          }}
          autoComplete="off"
        />
        {/* Chevron icon */}
        <span
          style={{
            position: "absolute",
            right: "0.5rem",
            top: "50%",
            transform: "translateY(-50%)",
            pointerEvents: "none",
            color: "#94a3b8",
            fontSize: "0.75rem",
          }}
        >
          ▾
        </span>
      </div>

      {/* Dropdown list */}
      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 50,
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "2px",
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            maxHeight: "220px",
            overflowY: "auto",
          }}
        >
          {/* Unassigned option */}
          <div
            onMouseDown={(e) => { e.preventDefault(); selectOption(undefined); }}
            style={{
              padding: "0.45rem 0.75rem",
              cursor: "pointer",
              fontSize: "0.875rem",
              color: "#64748b",
              borderBottom: "1px solid #f1f5f9",
              background: value === undefined ? "#eef2ff" : undefined,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
            onMouseLeave={(e) => (e.currentTarget.style.background = value === undefined ? "#eef2ff" : "")}
          >
            — unassigned —
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: "0.5rem 0.75rem", fontSize: "0.8rem", color: "#94a3b8" }}>
              No matches
            </div>
          ) : (
            filtered.map((a) => {
              const optLabel = [
                a.name,
                privilegeLabel(a) ? `(${privilegeLabel(a)})` : null,
              ]
                .filter(Boolean)
                .join(" ");
              const alreadyUsed = a.id != null && usedIds.has(a.id);
              const isSelected = a.id === value;
              return (
                <div
                  key={a.id}
                  onMouseDown={(e) => { e.preventDefault(); selectOption(a.id); }}
                  style={{
                    padding: "0.45rem 0.75rem",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                    background: isSelected ? "#eef2ff" : undefined,
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = isSelected ? "#eef2ff" : "")}
                >
                  {alreadyUsed && (
                    <span title="Already assigned this week" style={{ fontSize: "0.85rem" }}>⚠️</span>
                  )}
                  <span style={{ color: isSelected ? "#4f46e5" : undefined }}>{optLabel}</span>
                </div>
              );
            })
          )}
        </div>
      )}

      {options.length === 0 && (
        <p className="text-xs text-amber-700 mt-1">
          No eligible enrollees for this part. Check privileges / baptism /
          active status.
        </p>
      )}
    </div>
  );
}

function titlePlaceholder(t: PartType): string {
  switch (t) {
    case "Chairman":
      return "Chairman";
    case "Opening Prayer":
      return "Opening Prayer";
    case "Closing Prayer":
      return "Closing Prayer";
    case "Talk":
      return 'e.g. "Endure With Joy"';
    case "Bible Reading":
      return "e.g. Job 10:1-22";
    case "Living Part":
      return "e.g. Strengthen Your Faith";
    case "Local Needs":
      return "Local Needs";
    case "Governing Body Update":
      return "Governing Body Update";
    case "Congregation Bible Study":
      return "e.g. jy chap. 43";
    default:
      return "Scenario / description (optional)";
  }
}

