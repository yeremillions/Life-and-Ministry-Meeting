import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useRef, useState } from "react";
import { db } from "../db";
import type { Assignee, Gender, Privilege } from "../types";
import { parseAssigneeFile, parsedToAssignee, parseTextList } from "../importers";

const PRIV_OPTIONS: Privilege[] = ["E", "QE", "MS", "QMS"];

export default function EnrolleesPage() {
  const assignees =
    useLiveQuery(() => db.assignees.orderBy("name").toArray(), []) ?? [];

  const [filter, setFilter] = useState<"all" | "active" | "inactive" | "M" | "F">(
    "active"
  );
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Assignee | null>(null);
  const [adding, setAdding] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<
    Omit<Assignee, "id">[] | null
  >(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    return assignees.filter((a) => {
      if (filter === "active" && !a.active) return false;
      if (filter === "inactive" && a.active) return false;
      if (filter === "M" && a.gender !== "M") return false;
      if (filter === "F" && a.gender !== "F") return false;
      if (
        search.trim() &&
        !a.name.toLowerCase().includes(search.trim().toLowerCase())
      )
        return false;
      return true;
    });
  }, [assignees, filter, search]);

  async function handleFile(file: File) {
    setImportError(null);
    try {
      const parsed = await parseAssigneeFile(file);
      if (parsed.length === 0) {
        setImportError("No assignees found. Make sure the file has a 'name' column.");
        return;
      }
      setImportPreview(parsed.map(parsedToAssignee));
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : "Failed to parse file.");
    }
  }

  async function savePreview() {
    if (!importPreview) return;
    // Skip duplicates on name (case-insensitive).
    const existing = new Set(
      assignees.map((a) => a.name.trim().toLowerCase())
    );
    const fresh = importPreview.filter(
      (p) => !existing.has(p.name.trim().toLowerCase())
    );
    await db.assignees.bulkAdd(fresh);
    setImportPreview(null);
    setImportOpen(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <h2 className="text-lg font-semibold mr-auto">Enrollees</h2>
        <button className="btn-secondary" onClick={() => setImportOpen(true)}>
          Import file
        </button>
        <button className="btn" onClick={() => setAdding(true)}>
          Add enrollee
        </button>
      </div>

      <div className="card">
        <div className="flex flex-wrap gap-3 items-center mb-3">
          <input
            type="search"
            className="input max-w-xs"
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input max-w-xs"
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
            <option value="all">All</option>
            <option value="M">Brothers</option>
            <option value="F">Sisters</option>
          </select>
          <span className="text-xs text-slate-500 ml-auto">
            {filtered.length} of {assignees.length}
          </span>
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500">
            No enrollees match the current filter. Click <b>Add enrollee</b> or{" "}
            <b>Import file</b> to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Gender</th>
                  <th className="py-2 pr-3">Baptised</th>
                  <th className="py-2 pr-3">Privileges</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="py-2 pr-3 font-medium">{a.name}</td>
                    <td className="py-2 pr-3">
                      {a.gender === "M" ? "Brother" : "Sister"}
                    </td>
                    <td className="py-2 pr-3">
                      {a.baptised ? "Yes" : "No"}
                    </td>
                    <td className="py-2 pr-3">
                      {a.privileges.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <div className="flex gap-1 flex-wrap">
                          {a.privileges.map((p) => (
                            <span
                              key={p}
                              className="pill bg-amber-100 text-amber-800"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {a.active ? (
                        <span className="pill bg-emerald-100 text-emerald-800">
                          Active
                        </span>
                      ) : (
                        <span className="pill bg-slate-100 text-slate-600">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        className="btn-secondary"
                        onClick={() => setEditing(a)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adding && (
        <EnrolleeModal
          onClose={() => setAdding(false)}
          onSave={async (a) => {
            await db.assignees.add({ ...a, createdAt: Date.now() });
            setAdding(false);
          }}
        />
      )}
      {editing && (
        <EnrolleeModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (a) => {
            if (editing.id != null) {
              await db.assignees.update(editing.id, a);
            }
            setEditing(null);
          }}
          onDelete={async () => {
            if (editing.id != null) {
              if (confirm(`Remove ${editing.name}?`)) {
                await db.assignees.delete(editing.id);
                setEditing(null);
              }
            }
          }}
        />
      )}

      {importOpen && (
        <ImportModal
          error={importError}
          preview={importPreview}
          onClose={() => {
            setImportOpen(false);
            setImportPreview(null);
            setImportError(null);
          }}
          onFile={(f) => handleFile(f)}
          onPasteText={(text) => {
            const parsed = parseTextList(text);
            if (parsed.length === 0) {
              setImportError("Couldn't find any names in the pasted text.");
              return;
            }
            setImportPreview(parsed.map(parsedToAssignee));
            setImportError(null);
          }}
          onConfirm={savePreview}
          fileRef={fileRef}
        />
      )}
    </div>
  );
}

/* ----------------------- modals ----------------------- */

function EnrolleeModal({
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  initial?: Assignee;
  onClose: () => void;
  onSave: (a: Omit<Assignee, "id" | "createdAt">) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [gender, setGender] = useState<Gender>(initial?.gender ?? "M");
  const [baptised, setBaptised] = useState(initial?.baptised ?? true);
  const [active, setActive] = useState(initial?.active ?? true);
  const [privileges, setPrivileges] = useState<Privilege[]>(
    initial?.privileges ?? []
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const canSubmit = name.trim().length > 0;

  function togglePriv(p: Privilege) {
    setPrivileges((cur) =>
      cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]
    );
  }

  return (
    <Modal onClose={onClose} title={initial ? "Edit enrollee" : "Add enrollee"}>
      <div className="space-y-3">
        <div>
          <label className="label">Name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Gender</label>
            <select
              className="input"
              value={gender}
              onChange={(e) => setGender(e.target.value as Gender)}
            >
              <option value="M">Brother</option>
              <option value="F">Sister</option>
            </select>
          </div>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-sm mb-1">
              <input
                type="checkbox"
                checked={baptised}
                onChange={(e) => setBaptised(e.target.checked)}
              />
              Baptised
            </label>
            <label className="flex items-center gap-2 text-sm mb-1">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active
            </label>
          </div>
        </div>
        {gender === "M" && (
          <div>
            <label className="label">Privileges</label>
            <div className="flex gap-2 flex-wrap">
              {PRIV_OPTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePriv(p)}
                  className={
                    "px-2.5 py-1 rounded-full text-xs font-medium border " +
                    (privileges.includes(p)
                      ? "bg-amber-500 border-amber-600 text-white"
                      : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50")
                  }
                >
                  {p}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              E = Elder, QE = Qualified (to be) Elder, MS = Ministerial Servant,
              QMS = Qualified (to be) MS.
            </p>
          </div>
        )}
        <div>
          <label className="label">Notes (optional)</label>
          <textarea
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-5 flex gap-2">
        {onDelete && (
          <button className="btn-danger" onClick={onDelete}>
            Delete
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            disabled={!canSubmit}
            onClick={() =>
              onSave({
                name: name.trim(),
                gender,
                baptised,
                active,
                privileges: gender === "M" ? privileges : [],
                notes: notes.trim() || undefined,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ImportModal({
  error,
  preview,
  onClose,
  onFile,
  onPasteText,
  onConfirm,
  fileRef,
}: {
  error: string | null;
  preview: Omit<Assignee, "id">[] | null;
  onClose: () => void;
  onFile: (f: File) => void;
  onPasteText: (text: string) => void;
  onConfirm: () => void;
  fileRef: React.RefObject<HTMLInputElement>;
}) {
  const [pasteText, setPasteText] = useState("");

  return (
    <Modal onClose={onClose} title="Import enrollees">
      {!preview ? (
        <div className="space-y-4 text-sm">
          <p>
            Upload a <b>CSV</b>, <b>Excel (.xlsx)</b>, <b>Word / Google Doc
            (.docx)</b> or <b>TXT</b> file of names. For spreadsheets, the
            first row should have column headers (e.g.{" "}
            <code>name, gender, baptised, privileges</code>).
          </p>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls,.docx,.txt"
              className="block text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
            <p className="text-xs text-slate-500 mt-1">
              Supported headers: <code>name</code>, <code>gender</code>,{" "}
              <code>baptised</code>, <code>privileges</code>, <code>notes</code>,{" "}
              <code>active</code>.
            </p>
          </div>
          <div className="border-t border-slate-200 pt-3">
            <label className="label">Or paste a list (one name per line):</label>
            <textarea
              className="input"
              rows={5}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"John Doe (E)\nJane Doe (F)\nMark Smith (MS)"}
            />
            <button
              className="btn mt-2"
              onClick={() => onPasteText(pasteText)}
              disabled={pasteText.trim().length === 0}
            >
              Parse pasted list
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            Preview — {preview.length} enrollees will be added (existing names
            are skipped).
          </p>
          <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-md">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 px-2 text-left">Name</th>
                  <th className="py-1 px-2 text-left">Gender</th>
                  <th className="py-1 px-2 text-left">Baptised</th>
                  <th className="py-1 px-2 text-left">Privileges</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1 px-2">{p.name}</td>
                    <td className="py-1 px-2">
                      {p.gender === "M" ? "Brother" : "Sister"}
                    </td>
                    <td className="py-1 px-2">{p.baptised ? "Y" : "N"}</td>
                    <td className="py-1 px-2">
                      {p.privileges.join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" onClick={onConfirm}>
              Import {preview.length}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function Modal({
  children,
  title,
  onClose,
}: {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">{title}</h3>
          <button
            className="text-slate-500 hover:text-slate-800 text-xl leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

