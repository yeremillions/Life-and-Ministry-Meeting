import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { db, addLog } from "../db";
import type {
  Assignee,
  Gender,
  Household,
  PartType,
  Privilege,
} from "../types";
import { parseAssigneeFile, parsedToAssignee, parseTextList } from "../importers";
import { normalizePrivileges } from "../meeting";

const ALL_PRIVS: Privilege[] = ["E", "QE", "MS", "QMS", "RP", "CBSR"];

const PRIV_LABELS: Record<Privilege, string> = {
  E: "Elder (E)",
  QE: "Qualified Elder (QE)",
  MS: "Ministerial Servant (MS)",
  QMS: "Qualified MS (QMS)",
  RP: "Regular Pioneer (RP)",
  CBSR: "CBS Reader (CBSR)",
};

const ALL_PARTS: PartType[] = [
  "Chairman",
  "Opening Prayer",
  "Talk",
  "Spiritual Gems",
  "Bible Reading",
  "Starting a Conversation",
  "Following Up",
  "Making Disciples",
  "Explaining Your Beliefs",
  "Initial Call",
  "Talk (Ministry)",
  "Living Part",
  "Local Needs",
  "Governing Body Update",
  "Congregation Bible Study",
  "Closing Prayer",
];

export default function EnrolleesPage({
  onNavigateToProfile,
}: {
  onNavigateToProfile: (id: number) => void;
}) {
  const assignees =
    useLiveQuery(() => db.assignees.orderBy("name").toArray(), []) ?? [];
  const households =
    useLiveQuery(() => db.households.orderBy("name").toArray(), []) ?? [];

  const [tab, setTab] = useState<"enrollees" | "households">("enrollees");
  const [filter, setFilter] = useState<"all" | "active" | "inactive" | "M" | "F">(
    "active"
  );
  const [privFilter, setPrivFilter] = useState<"all" | Privilege>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Assignee | null>(null);
  const [adding, setAdding] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<
    Omit<Assignee, "id">[] | null
  >(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const [householdEditing, setHouseholdEditing] = useState<Household | null>(null);
  const [householdAdding, setHouseholdAdding] = useState(false);

  // Map enrollee id → household name for badge display
  const enrolleeHouseholdMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const h of households) {
      for (const id of h.memberIds) map.set(id, h.name);
    }
    return map;
  }, [households]);

  const filtered = useMemo(() => {
    return assignees.filter((a) => {
      if (filter === "active" && !a.active) return false;
      if (filter === "inactive" && a.active) return false;
      if (filter === "M" && a.gender !== "M") return false;
      if (filter === "F" && a.gender !== "F") return false;
      if (privFilter !== "all" && !a.privileges.includes(privFilter)) return false;
      if (
        search.trim() &&
        !a.name.toLowerCase().includes(search.trim().toLowerCase())
      )
        return false;
      return true;
    });
  }, [assignees, filter, privFilter, search]);

  // Drop selections only when the enrollee no longer exists (was deleted).
  // Selections persist across search/filter changes so bulk actions work
  // on names picked from different search queries.
  useEffect(() => {
    const existing = new Set(
      assignees.map((a) => a.id).filter((id): id is number => id != null)
    );
    setSelected((cur) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of cur) {
        if (existing.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : cur;
    });
  }, [assignees]);

  const filteredIds = useMemo(
    () => filtered.map((a) => a.id).filter((id): id is number => id != null),
    [filtered]
  );
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const someFilteredSelected =
    !allFilteredSelected && filteredIds.some((id) => selected.has(id));

  function toggleOne(id: number) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((cur) => {
      const next = new Set(cur);
      if (allFilteredSelected) {
        for (const id of filteredIds) next.delete(id);
      } else {
        for (const id of filteredIds) next.add(id);
      }
      return next;
    });
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    const names = assignees
      .filter((a) => a.id != null && selected.has(a.id))
      .map((a) => a.name);
    const preview = names.slice(0, 5).join(", ") + (names.length > 5 ? ", …" : "");
    if (
      !confirm(
        `Delete ${selected.size} enrollee${selected.size === 1 ? "" : "s"}?\n\n${preview}\n\nThis cannot be undone.`
      )
    )
      return;
    await db.assignees.bulkDelete([...selected]);
    setSelected(new Set());
  }

  async function bulkUpdate(changes: Partial<Omit<Assignee, "id" | "createdAt">>) {
    if (selected.size === 0) return;
    const ids = [...selected];
    await db.transaction("rw", db.assignees, async () => {
      for (const id of ids) {
        await db.assignees.update(id, changes);
      }
    });
  }

  async function bulkSetPrivileges(privs: Privilege[]) {
    if (selected.size === 0) return;
    const ids = [...selected];
    await db.transaction("rw", db.assignees, async () => {
      for (const id of ids) {
        const a = await db.assignees.get(id);
        if (!a) continue;
        const allowed =
          a.gender === "M" ? privs : privs.filter((p) => p === "RP");
        await db.assignees.update(id, {
          privileges: normalizePrivileges(allowed),
        });
      }
    });
  }

  async function bulkAddPrivilege(priv: Privilege) {
    if (selected.size === 0) return;
    const ids = [...selected];
    await db.transaction("rw", db.assignees, async () => {
      for (const id of ids) {
        const a = await db.assignees.get(id);
        if (!a) continue;
        if (priv !== "RP" && a.gender !== "M") continue;
        const updated = normalizePrivileges([...new Set([...a.privileges, priv])]);
        await db.assignees.update(id, { privileges: updated });
      }
    });
  }

  async function bulkRemovePrivilege(priv: Privilege) {
    if (selected.size === 0) return;
    const ids = [...selected];
    await db.transaction("rw", db.assignees, async () => {
      for (const id of ids) {
        const a = await db.assignees.get(id);
        if (!a) continue;
        const updated = normalizePrivileges(a.privileges.filter((p) => p !== priv));
        await db.assignees.update(id, { privileges: updated });
      }
    });
  }

  // ---- Export helpers ----

  function buildRows(list: Assignee[]) {
    return list.map((a) => ({
      Name: a.name,
      Gender: a.gender === "M" ? "Brother" : "Sister",
      Age: a.isMinor ? "Minor" : "Adult",
      Baptised: a.baptised ? "Yes" : "No",
      Privileges: a.privileges.join(", ") || "",
      Status: a.active ? "Active" : "Inactive",
      Notes: a.notes ?? "",
    }));
  }

  function exportCSV() {
    const rows = buildRows(filtered);
    const headers = Object.keys(rows[0] ?? {}) as (keyof (typeof rows)[0])[];
    const csvLines = [
      headers.join(","),
      ...rows.map((r) =>
        headers
          .map((h) => {
            const val = String(r[h]);
            return val.includes(",") || val.includes('"') || val.includes("\n")
              ? `"${val.replace(/"/g, '""')}"`
              : val;
          })
          .join(",")
      ),
    ];
    const blob = new Blob([csvLines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `enrollees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportExcel() {
    const rows = buildRows(filtered);
    const ws = XLSX.utils.json_to_sheet(rows);
    // Auto-width columns
    const colWidths = Object.keys(rows[0] ?? {}).map((key) => ({
      wch: Math.max(
        key.length,
        ...rows.map((r) => String(r[key as keyof typeof r]).length)
      ),
    }));
    ws["!cols"] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Enrollees");
    XLSX.writeFile(
      wb,
      `enrollees-${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  }

  // ---- Import handler ----

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
        <button
          className="btn-secondary"
          onClick={exportCSV}
          disabled={filtered.length === 0}
          title="Export visible enrollees as CSV"
        >
          Export CSV
        </button>
        <button
          className="btn-secondary"
          onClick={exportExcel}
          disabled={filtered.length === 0}
          title="Export visible enrollees as Excel"
        >
          Export Excel
        </button>
        <button className="btn" onClick={() => setAdding(true)}>
          Add enrollee
        </button>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-1 border-b border-slate-200">
        {(["enrollees", "households"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors " +
              (tab === t
                ? "border-indigo-500 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-800")
            }
          >
            {t === "enrollees" ? `Enrollees (${assignees.length})` : `Households (${households.length})`}
          </button>
        ))}
      </div>

      {tab === "enrollees" && (
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
          <select
            className="input max-w-xs"
            value={privFilter}
            onChange={(e) => setPrivFilter(e.target.value as typeof privFilter)}
            title="Filter by privilege"
          >
            <option value="all">All privileges</option>
            <option value="all" disabled style={{ borderTop: "1px solid #e2e8f0" }}></option>
            {ALL_PRIVS.map((p) => (
              <option key={p} value={p}>
                {PRIV_LABELS[p]}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500 ml-auto">
            {filtered.length} of {assignees.length}
          </span>
        </div>

        {selected.size > 0 && (
          <div className="mb-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">
                {selected.size} selected
              </span>
              <button
                className="text-slate-600 hover:text-slate-900 underline text-xs"
                onClick={() => setSelected(new Set())}
              >
                clear selection
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="text-xs text-slate-500 mr-1">Actions:</span>
              <select
                className="input py-1 text-xs w-auto"
                value=""
                onChange={async (e) => {
                  const v = e.target.value as Gender;
                  if (!v) return;
                  if (v === "F") {
                    const ids = [...selected];
                    await db.transaction("rw", db.assignees, async () => {
                      for (const id of ids) {
                        const a = await db.assignees.get(id);
                        if (!a) continue;
                        await db.assignees.update(id, {
                          gender: "F",
                          privileges: normalizePrivileges(
                            a.privileges.filter((p) => p === "RP")
                          ),
                        });
                      }
                    });
                  } else {
                    bulkUpdate({ gender: "M" });
                  }
                }}
              >
                <option value="" disabled>Set gender…</option>
                <option value="M">Brother</option>
                <option value="F">Sister</option>
              </select>
              <select
                className="input py-1 text-xs w-auto"
                value=""
                onChange={(e) => {
                  if (e.target.value) bulkUpdate({ baptised: e.target.value === "yes" });
                }}
              >
                <option value="" disabled>Set baptised…</option>
                <option value="yes">Baptised</option>
                <option value="no">Not baptised</option>
              </select>
              <select
                className="input py-1 text-xs w-auto"
                value=""
                onChange={(e) => {
                  if (e.target.value) bulkUpdate({ active: e.target.value === "active" });
                }}
              >
                <option value="" disabled>Set status…</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <select
                className="input py-1 text-xs w-auto"
                value=""
                onChange={(e) => {
                  if (e.target.value) bulkUpdate({ isMinor: e.target.value === "minor" });
                }}
              >
                <option value="" disabled>Set age…</option>
                <option value="adult">Adult</option>
                <option value="minor">Minor</option>
              </select>
              <select
                className="input py-1 text-xs w-auto"
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  if (v === "clear") bulkSetPrivileges([]);
                  else if (v.startsWith("+")) bulkAddPrivilege(v.slice(1) as Privilege);
                  else if (v.startsWith("-")) bulkRemovePrivilege(v.slice(1) as Privilege);
                }}
              >
                <option value="" disabled>Privileges…</option>
                <optgroup label="Add privilege">
                  <option value="+E">+ Elder</option>
                  <option value="+QE">+ Qualified Elder</option>
                  <option value="+MS">+ Ministerial Servant</option>
                  <option value="+QMS">+ Qualified MS</option>
                  <option value="+RP">+ Regular Pioneer</option>
                  <option value="+CBSR">+ CBS Reader</option>
                </optgroup>
                <optgroup label="Remove privilege">
                  <option value="-E">- Elder</option>
                  <option value="-QE">- Qualified Elder</option>
                  <option value="-MS">- Ministerial Servant</option>
                  <option value="-QMS">- Qualified MS</option>
                  <option value="-RP">- Regular Pioneer</option>
                  <option value="-CBSR">- CBS Reader</option>
                </optgroup>
                <optgroup label="Reset">
                  <option value="clear">Clear all privileges</option>
                </optgroup>
              </select>
              <div className="ml-auto">
                <button className="btn-danger text-xs py-1" onClick={deleteSelected}>
                  Delete selected
                </button>
              </div>
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500">
            No enrollees match the current filter. Click <b>Add enrollee</b> or{" "}
            <b>Import file</b> to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm table-zebra">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3 w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all visible"
                      checked={allFilteredSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someFilteredSelected;
                      }}
                      onChange={toggleAllVisible}
                    />
                  </th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Gender</th>
                  <th className="py-2 pr-3">Age</th>
                  <th className="py-2 pr-3">Baptised</th>
                  <th className="py-2 pr-3">Privileges</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Household</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const isSelected = a.id != null && selected.has(a.id);
                  return (
                    <tr
                      key={a.id}
                      className={
                        "border-t border-slate-100 " +
                        (isSelected ? "bg-slate-50" : "")
                      }
                    >
                      <td className="py-2 pr-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${a.name}`}
                          checked={isSelected}
                          onChange={() => a.id != null && toggleOne(a.id)}
                        />
                      </td>
                      <td className="py-2 pr-3 font-medium">
                        <button
                          onClick={() => onNavigateToProfile(a.id!)}
                          className="hover:text-indigo-600 hover:underline transition-colors text-left"
                        >
                          {a.name}
                        </button>
                      </td>
                      <td className="py-2 pr-3">
                        {a.gender === "M" ? "Brother" : "Sister"}
                      </td>
                      <td className="py-2 pr-3">
                        {a.isMinor ? (
                          <span className="pill bg-blue-100 text-blue-800">Minor</span>
                        ) : (
                          <span className="text-slate-400">Adult</span>
                        )}
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
                      <td className="py-2 pr-3">
                        {a.id != null && enrolleeHouseholdMap.has(a.id) ? (
                          <span
                            className="pill bg-indigo-50 text-indigo-700"
                            title={enrolleeHouseholdMap.get(a.id)}
                          >
                            🏠 {enrolleeHouseholdMap.get(a.id)}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )} {/* end enrollees tab */}

      {/* ── Households tab ── */}
      {tab === "households" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button className="btn" onClick={() => setHouseholdAdding(true)}>
              + New household
            </button>
          </div>
          {households.length === 0 ? (
            <div className="card">
              <p className="text-sm text-slate-500">
                No households yet. Click <b>+ New household</b> to group family members
                together. Household members can be paired as main/assistant in Apply
                Yourself parts regardless of gender.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {households.map((h) => {
                const members = h.memberIds
                  .map((id) => assignees.find((a) => a.id === id))
                  .filter((a): a is Assignee => a != null);
                return (
                  <li key={h.id} className="card">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium flex items-center gap-1.5">
                          <span>🏠</span> {h.name}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {members.length === 0 ? (
                            <span className="text-xs text-slate-400">No members</span>
                          ) : (
                            members.map((a) => (
                              <button
                                key={a.id}
                                onClick={() => onNavigateToProfile(a.id!)}
                                className={
                                  "pill hover:brightness-110 transition-all " +
                                  (a.gender === "M"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-rose-100 text-rose-800")
                                }
                              >
                                {a.name}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                      <button
                        className="btn-secondary shrink-0"
                        onClick={() => setHouseholdEditing(h)}
                      >
                        Edit
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {adding && (
        <EnrolleeModal
          onClose={() => setAdding(false)}
          onSave={async (a) => {
            await db.assignees.add({ ...a, createdAt: Date.now() });
            await addLog("enrollees", `Added enrollee: ${a.name}`);
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
              await addLog("enrollees", `Updated enrollee: ${a.name}`);
            }
            setEditing(null);
          }}
          onDelete={async () => {
            if (editing.id != null) {
              const name = editing.name;
              if (confirm(`Remove ${name}?`)) {
                await db.assignees.delete(editing.id);
                await addLog("enrollees", `Deleted enrollee: ${name}`);
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

      {householdAdding && (
        <HouseholdModal
          assignees={assignees}
          onClose={() => setHouseholdAdding(false)}
          onSave={async (data) => {
            await db.households.add({ ...data, createdAt: Date.now() });
            setHouseholdAdding(false);
          }}
        />
      )}
      {householdEditing && (
        <HouseholdModal
          initial={householdEditing}
          assignees={assignees}
          onClose={() => setHouseholdEditing(null)}
          onSave={async (data) => {
            if (householdEditing.id != null)
              await db.households.update(householdEditing.id, data);
            setHouseholdEditing(null);
          }}
          onDelete={async () => {
            if (
              householdEditing.id != null &&
              confirm(`Delete household "${householdEditing.name}"?`)
            ) {
              await db.households.delete(householdEditing.id);
              setHouseholdEditing(null);
            }
          }}
        />
      )}
    </div>
  );
}

/* ----------------------- modals ----------------------- */

function HouseholdModal({
  initial,
  assignees,
  onClose,
  onSave,
  onDelete,
}: {
  initial?: Household;
  assignees: Assignee[];
  onClose: () => void;
  onSave: (data: Omit<Household, "id" | "createdAt">) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [memberIds, setMemberIds] = useState<number[]>(initial?.memberIds ?? []);
  const [search, setSearch] = useState("");

  const canSubmit = name.trim().length > 0;

  // Suggest a name from selected members' surnames
  const suggestedName = useMemo(() => {
    if (name) return null;
    const surnames = [...new Set(
      memberIds
        .map((id) => assignees.find((a) => a.id === id))
        .filter((a): a is Assignee => a != null)
        .map((a) => a.name.trim().split(" ").slice(-1)[0])
    )];
    if (surnames.length === 1) return `${surnames[0]} Family`;
    if (surnames.length === 2) return `${surnames[0]} / ${surnames[1]} Family`;
    return null;
  }, [memberIds, assignees, name]);

  const filteredAssignees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assignees.filter(
      (a) => !q || a.name.toLowerCase().includes(q)
    );
  }, [assignees, search]);

  function toggleMember(id: number) {
    setMemberIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );
  }

  return (
    <Modal
      onClose={onClose}
      title={initial ? "Edit household" : "New household"}
    >
      <div className="space-y-4">
        <div>
          <label className="label">Household name</label>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Smith Family"
              autoFocus
            />
            {suggestedName && (
              <button
                type="button"
                className="btn-secondary text-xs px-2 shrink-0"
                onClick={() => setName(suggestedName)}
                title="Use suggested name"
              >
                Use “{suggestedName}”
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="label">Members</label>
          <input
            type="search"
            className="input mb-2"
            placeholder="Search enrollees…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
            {filteredAssignees.length === 0 ? (
              <p className="p-3 text-sm text-slate-400">No enrollees match.</p>
            ) : (
              filteredAssignees.map((a) => {
                const checked = memberIds.includes(a.id!);
                return (
                  <label
                    key={a.id}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => a.id != null && toggleMember(a.id)}
                    />
                    <span className="text-sm flex-1">{a.name}</span>
                    <span
                      className={
                        "pill text-xs " +
                        (a.gender === "M"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-rose-100 text-rose-700")
                      }
                    >
                      {a.gender === "M" ? "Bro" : "Sis"}
                    </span>
                  </label>
                );
              })
            )}
          </div>
          {memberIds.length > 0 && (
            <p className="text-xs text-slate-500 mt-1">
              {memberIds.length} member{memberIds.length > 1 ? "s" : ""} selected
            </p>
          )}
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
            onClick={() => onSave({ name: name.trim(), memberIds })}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

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
  const [isMinor, setIsMinor] = useState(initial?.isMinor ?? false);
  const [privileges, setPrivileges] = useState<Privilege[]>(
    initial?.privileges ?? []
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [allowedParts, setAllowedParts] = useState<PartType[] | undefined>(
    initial?.allowedParts
  );

  const canSubmit = name.trim().length > 0;

  function togglePriv(p: Privilege) {
    setPrivileges((cur) => {
      const set = new Set(cur);
      if (set.has(p)) {
        // Removing a parent (E or MS) is blocked while its child (QE/QMS)
        // is set, since QE implies E and QMS implies MS.
        if (p === "E" && set.has("QE")) return cur;
        if (p === "MS" && set.has("QMS")) return cur;
        set.delete(p);
      } else {
        set.add(p);
      }
      return normalizePrivileges([...set]);
    });
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
          <div>
            <label className="label">Age group</label>
            <select
              className="input"
              value={isMinor ? "minor" : "adult"}
              onChange={(e) => setIsMinor(e.target.value === "minor")}
            >
              <option value="adult">Adult</option>
              <option value="minor">Minor (under 18)</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={baptised}
              onChange={(e) => setBaptised(e.target.checked)}
            />
            Baptised
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active
          </label>
        </div>
        <div>
          <label className="label">Privileges</label>
          <div className="flex gap-2 flex-wrap">
            {(gender === "M" ? ALL_PRIVS : (["RP"] as Privilege[])).map((p) => (
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
            E = Elder, QE = Qualified Elder, MS = Ministerial Servant,
            QMS = Qualified Ministerial Servant, RP = Regular Pioneer.
            {gender === "M" && " Every QE is also an E and every QMS is also an MS, so checking QE / QMS automatically checks the parent."}
            {" "}RP can be held by brothers and sisters.
          </p>
        </div>

        <div className="pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Assignment Restrictions</label>
            <select
              className="text-xs border rounded px-1 py-0.5 bg-slate-50"
              value={
                !allowedParts
                  ? "none"
                  : allowedParts.length === 1 && allowedParts[0] === "Bible Reading"
                  ? "investigation"
                  : "custom"
              }
              onChange={(e) => {
                const val = e.target.value;
                if (val === "none") setAllowedParts(undefined);
                else if (val === "investigation") setAllowedParts(["Bible Reading"]);
              }}
            >
              <option value="none">No Restrictions (All Eligible)</option>
              <option value="investigation">Pending Investigation (Bible Reading Only)</option>
              <option value="custom">Custom Whitelist...</option>
            </select>
          </div>

          {allowedParts !== undefined && (
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
              <p className="text-[10px] uppercase font-bold text-slate-400 mb-2 tracking-wider">
                Only allow these specific parts:
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {ALL_PARTS.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-xs cursor-pointer hover:text-indigo-600 transition-colors">
                    <input
                      type="checkbox"
                      className="checkbox w-3 h-3"
                      checked={allowedParts.includes(p)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...allowedParts, p]
                          : allowedParts.filter((x) => x !== p);
                        setAllowedParts(next);
                      }}
                    />
                    {p === "Talk" ? "Treasures Talk" : p}
                  </label>
                ))}
              </div>
            </div>
          )}
          <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
            Use this to limit assignments due to health, age, or special circumstances.
            If active, the scheduler will strictly ignore this person for any part not checked above.
          </p>
        </div>

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
                isMinor,
                privileges:
                  gender === "M"
                    ? normalizePrivileges(privileges)
                    : normalizePrivileges(privileges.filter((p) => p === "RP")),
                notes: notes.trim() || undefined,
                allowedParts,
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
        className="bg-white rounded-lg shadow-xl max-w-lg w-full flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button
            className="text-slate-500 hover:text-slate-800 text-xl leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1 custom-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
}

