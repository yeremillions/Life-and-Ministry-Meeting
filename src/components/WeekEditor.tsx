import { useMemo, useState } from "react";
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

      {SEGMENTS.map((seg) => (
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
  return (
    <div>
      <label className="label">{label}</label>
      <select
        className="input"
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
      >
        <option value="">— unassigned —</option>
        {options.map((a) => {
          const label = [
            a.name,
            privilegeLabel(a) ? `(${privilegeLabel(a)})` : null,
          ]
            .filter(Boolean)
            .join(" ");
          const alreadyUsed = a.id != null && usedIds.has(a.id);
          return (
            <option key={a.id} value={a.id}>
              {alreadyUsed ? "⚠️ " : ""}
              {label}
            </option>
          );
        })}
      </select>
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

