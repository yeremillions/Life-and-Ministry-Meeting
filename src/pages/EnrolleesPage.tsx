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
  UnavailableRange,
} from "../types";
import { parseAssigneeFile, parsedToAssignee, parseTextList } from "../importers";
import { isEligible, normalizePrivileges } from "../meeting";
import ConfirmationModal from "../components/ConfirmationModal";

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
  const [filter, setFilter] = useState<
    "all" | "active" | "inactive" | "M" | "F" | "archived"
  >("active");
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

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    type?: "danger" | "warning" | "info";
    onConfirm: () => void | Promise<void>;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

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
      if (filter === "archived") {
        if (!a.archived) return false;
      } else {
        if (a.archived) return false;
        if (filter === "active" && !a.active) return false;
        if (filter === "inactive" && a.active) return false;
        if (filter === "M" && a.gender !== "M") return false;
        if (filter === "F" && a.gender !== "F") return false;
      }
      if (privFilter !== "all" && !a.privileges?.includes(privFilter)) return false;
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
    
    const weeks = await db.weeks.toArray();
    const activeSelected = assignees.filter((a) => a.id != null && selected.has(a.id));
    
    const toDelete: Assignee[] = [];
    const toArchive: Assignee[] = [];
    
    for (const a of activeSelected) {
      const hasHistory = weeks.some(w => 
        w.assignments.some(assign => assign.assigneeId === a.id || assign.assistantId === a.id)
      );
      if (hasHistory) {
        toArchive.push(a);
      } else {
        toDelete.push(a);
      }
    }
    
    if (toDelete.length > 0 && toArchive.length > 0) {
      const deleteNames = toDelete.map(a => a.name).slice(0, 5).join(", ") + (toDelete.length > 5 ? ", …" : "");
      const archiveNames = toArchive.map(a => a.name).slice(0, 5).join(", ") + (toArchive.length > 5 ? ", …" : "");
      setConfirmState({
        isOpen: true,
        title: "Delete & Archive Publishers",
        message: `You selected ${selected.size} publisher(s) for removal.\n\n` +
          `• The following will be PERMANENTLY DELETED (no past history):\n  ${deleteNames}\n\n` +
          `• The following will be ARCHIVED to preserve historic schedules:\n  ${archiveNames}\n\n` +
          `Do you want to proceed?`,
        confirmText: "Proceed",
        cancelText: "Cancel",
        type: "warning",
        onConfirm: async () => {
          // Bulk delete
          const deleteIds = toDelete.map(a => a.id!).filter(id => id != null);
          await db.assignees.bulkDelete(deleteIds);
          for (const a of toDelete) {
            await addLog("enrollees", `Deleted enrollee: ${a.name}`);
          }
          
          // Bulk archive
          await db.transaction("rw", db.assignees, async () => {
            for (const a of toArchive) {
              await db.assignees.update(a.id!, { archived: true, active: false });
              await addLog("enrollees", `Archived enrollee: ${a.name}`);
            }
          });
          
          setSelected(new Set());
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
        }
      });
    } else if (toArchive.length > 0) {
      const archiveNames = toArchive.map(a => a.name).slice(0, 5).join(", ") + (toArchive.length > 5 ? ", …" : "");
      setConfirmState({
        isOpen: true,
        title: "Archive Publishers",
        message: `"${archiveNames}" ${toArchive.length === 1 ? "has" : "have"} past scheduled assignments. To preserve historic schedules and reports, ${toArchive.length === 1 ? "this publisher" : "these publishers"} will be archived instead of permanently deleted.\n\nDo you want to archive ${toArchive.length === 1 ? "this publisher" : "these publishers"}?`,
        confirmText: "Yes, Archive",
        cancelText: "Cancel",
        type: "warning",
        onConfirm: async () => {
          await db.transaction("rw", db.assignees, async () => {
            for (const a of toArchive) {
              await db.assignees.update(a.id!, { archived: true, active: false });
              await addLog("enrollees", `Archived enrollee: ${a.name}`);
            }
          });
          setSelected(new Set());
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
        }
      });
    } else if (toDelete.length > 0) {
      const deleteNames = toDelete.map(a => a.name).slice(0, 5).join(", ") + (toDelete.length > 5 ? ", …" : "");
      setConfirmState({
        isOpen: true,
        title: "Permanently Delete Publishers",
        message: `Are you sure you want to permanently delete ${toDelete.length} publisher${toDelete.length === 1 ? "" : "s"}? This cannot be undone.\n\n${deleteNames}`,
        confirmText: "Permanently Delete",
        cancelText: "Cancel",
        type: "danger",
        onConfirm: async () => {
          const deleteIds = toDelete.map(a => a.id!).filter(id => id != null);
          await db.assignees.bulkDelete(deleteIds);
          for (const a of toDelete) {
            await addLog("enrollees", `Deleted enrollee: ${a.name}`);
          }
          setSelected(new Set());
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
        }
      });
    }
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
        const updated = normalizePrivileges([...new Set([...(a.privileges ?? []), priv])]);
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
        const updated = normalizePrivileges((a.privileges ?? []).filter((p) => p !== priv));
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
      Privileges: (a.privileges ?? []).join(", ") || "",
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
            <option value="archived">Archived</option>
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
                            (a.privileges ?? []).filter((p) => p === "RP")
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
              <div className="ml-auto flex items-center gap-2">
                {filter === "archived" && (
                  <button
                    className="btn bg-indigo-600 hover:bg-indigo-700 text-white text-xs py-1 px-3 rounded font-semibold flex items-center gap-1 h-[26px]"
                    onClick={() => {
                      if (selected.size === 0) return;
                      setConfirmState({
                        isOpen: true,
                        title: "Unarchive Selected Publishers",
                        message: `Are you sure you want to unarchive and restore the ${selected.size} selected publisher(s) to active status?`,
                        confirmText: "Yes, Restore",
                        cancelText: "Cancel",
                        type: "info",
                        onConfirm: async () => {
                          const ids = [...selected];
                          await db.transaction("rw", db.assignees, async () => {
                            for (const id of ids) {
                              await db.assignees.update(id, { archived: false, active: true });
                              const a = await db.assignees.get(id);
                              if (a) {
                                await addLog("enrollees", `Unarchived enrollee: ${a.name}`);
                              }
                            }
                          });
                          setSelected(new Set());
                          setConfirmState((prev) => ({ ...prev, isOpen: false }));
                        }
                      });
                    }}
                  >
                    🔄 Restore selected
                  </button>
                )}
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
                        <a
                          href={`?tab=profile&profileId=${a.id}`}
                          onClick={(e) => {
                            if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
                              e.preventDefault();
                              onNavigateToProfile(a.id!);
                            }
                          }}
                          className="hover:text-indigo-600 hover:underline transition-colors text-left"
                        >
                          {a.name}
                        </a>
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
                        {((a.privileges ?? []).length === 0 && !a.isSecretary && !a.isServiceOverseer && !a.isHlcMember && !a.isLmmOverseer && !a.isWtOverseer && !a.isOftenAway && !a.isFather && !a.isMother && !a.isHusband && !a.isWife) ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <div className="flex gap-1 flex-wrap">
                            {(a.privileges ?? []).map((p) => (
                              <span
                                key={p}
                                className="pill bg-amber-100 text-amber-800"
                              >
                                {p}
                              </span>
                            ))}
                            {a.isSecretary && <span className="pill bg-indigo-100 text-indigo-800">Secretary</span>}
                            {a.isServiceOverseer && <span className="pill bg-indigo-100 text-indigo-800">Service Overseer</span>}
                            {a.isHlcMember && <span className="pill bg-indigo-100 text-indigo-800">HLC Member</span>}
                            {a.isLmmOverseer && <span className="pill bg-indigo-100 text-indigo-800">LMM Overseer</span>}
                            {a.isWtOverseer && <span className="pill bg-indigo-100 text-indigo-800">WT Overseer</span>}
                            {a.isOftenAway && <span className="pill bg-amber-100 text-amber-800">Often Away</span>}
                            {a.isFather && <span className="pill bg-indigo-100 text-indigo-800">Father</span>}
                            {a.isMother && <span className="pill bg-indigo-100 text-indigo-800">Mother</span>}
                            {a.isHusband && <span className="pill bg-indigo-100 text-indigo-800">Husband</span>}
                            {a.isWife && <span className="pill bg-indigo-100 text-indigo-800">Wife</span>}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {a.archived ? (
                          <span className="pill bg-slate-200 text-slate-700 border border-slate-300">
                            Archived
                          </span>
                        ) : a.active ? (
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
                              <a
                                key={a.id}
                                href={`?tab=profile&profileId=${a.id}`}
                                onClick={(e) => {
                                  if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
                                    e.preventDefault();
                                    onNavigateToProfile(a.id!);
                                  }
                                }}
                                className={
                                  "pill hover:brightness-110 transition-all " +
                                  (a.gender === "M"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-rose-100 text-rose-800")
                                }
                              >
                                {a.name}
                              </a>
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
              const id = editing.id;
              const name = editing.name;
              const weeks = await db.weeks.toArray();
              const hasPastHistory = weeks.some(w => 
                w.assignments.some(assign => assign.assigneeId === id || assign.assistantId === id)
              );
              
              if (!hasPastHistory) {
                setConfirmState({
                  isOpen: true,
                  title: "Permanently Delete Publisher",
                  message: `Are you sure you want to permanently delete the publisher "${name}"? This cannot be undone.`,
                  confirmText: "Permanently Delete",
                  cancelText: "Cancel",
                  type: "danger",
                  onConfirm: async () => {
                    await db.assignees.delete(id);
                    await addLog("enrollees", `Deleted enrollee: ${name}`);
                    setConfirmState((prev) => ({ ...prev, isOpen: false }));
                    setEditing(null);
                  }
                });
              } else {
                setConfirmState({
                  isOpen: true,
                  title: "Archive Publisher",
                  message: `"${name}" has past scheduled assignments. To preserve historic schedules and reports, they will be archived instead of permanently deleted.\n\nDo you want to archive this publisher?`,
                  confirmText: "Yes, Archive",
                  cancelText: "Cancel",
                  type: "warning",
                  onConfirm: async () => {
                    await db.assignees.update(id, { archived: true, active: false });
                    await addLog("enrollees", `Archived enrollee: ${name}`);
                    setConfirmState((prev) => ({ ...prev, isOpen: false }));
                    setEditing(null);
                  }
                });
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
            if (householdEditing.id != null) {
              const id = householdEditing.id;
              const name = householdEditing.name;
              setConfirmState({
                isOpen: true,
                title: "Delete Household",
                message: `Are you sure you want to delete household "${name}"?`,
                confirmText: "Delete",
                cancelText: "Cancel",
                type: "danger",
                onConfirm: async () => {
                  await db.households.delete(id);
                  setConfirmState((prev) => ({ ...prev, isOpen: false }));
                  setHouseholdEditing(null);
                }
              });
            }
          }}
        />
      )}
      <ConfirmationModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText={confirmState.cancelText}
        type={confirmState.type}
        onConfirm={async () => {
          await confirmState.onConfirm();
        }}
        onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
      />
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

export function EnrolleeModal({
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
  const settings = useLiveQuery(() => db.settings.get("app"), []);
  const [name, setName] = useState(initial?.name ?? "");
  const [gender, setGender] = useState<Gender>(initial?.gender ?? "M");
  const [baptised, setBaptised] = useState(initial?.baptised ?? true);
  const [active, setActive] = useState(initial?.active ?? true);
  const [isMinor, setIsMinor] = useState(initial?.isMinor ?? false);
  const [isSecretary, setIsSecretary] = useState(initial?.isSecretary ?? false);
  const [isServiceOverseer, setIsServiceOverseer] = useState(initial?.isServiceOverseer ?? false);
  const [isHlcMember, setIsHlcMember] = useState(initial?.isHlcMember ?? false);
  const [isLmmOverseer, setIsLmmOverseer] = useState(initial?.isLmmOverseer ?? false);
  const [isWtOverseer, setIsWtOverseer] = useState(initial?.isWtOverseer ?? false);
  const [isOftenAway, setIsOftenAway] = useState(initial?.isOftenAway ?? false);
  const [isFather, setIsFather] = useState(initial?.isFather ?? false);
  const [isMother, setIsMother] = useState(initial?.isMother ?? false);
  const [isHusband, setIsHusband] = useState(initial?.isHusband ?? false);
  const [isWife, setIsWife] = useState(initial?.isWife ?? false);
  const [privileges, setPrivileges] = useState<Privilege[]>(
    initial?.privileges ?? []
  );

  useEffect(() => {
    if (gender === "M") {
      setIsMother(false);
      setIsWife(false);
    } else if (gender === "F") {
      setIsFather(false);
      setIsHusband(false);
      setIsWtOverseer(false);
    }
  }, [gender]);

  useEffect(() => {
    if (isMinor) {
      setIsFather(false);
      setIsMother(false);
      setIsHusband(false);
      setIsWife(false);
    }
  }, [isMinor]);

  useEffect(() => {
    const isElder = privileges.includes("E") || privileges.includes("QE");
    if (!isElder) {
      setIsSecretary(false);
      setIsServiceOverseer(false);
      setIsHlcMember(false);
      setIsLmmOverseer(false);
      setIsWtOverseer(false);
    }
  }, [privileges]);

  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [restrictionType, setRestrictionType] = useState<Assignee["restrictionType"]>(
    initial?.restrictionType ?? "none"
  );
  const [allowedParts, setAllowedParts] = useState<PartType[] | undefined>(
    initial?.allowedParts
  );
  const [excludeFromPrayers, setExcludeFromPrayers] = useState(initial?.excludeFromPrayers ?? false);
  const [includeInPrayers, setIncludeInPrayers] = useState(initial?.includeInPrayers ?? false);

  const [unavailableRanges, setUnavailableRanges] = useState<UnavailableRange[]>(initial?.unavailableRanges ?? []);
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newReason, setNewReason] = useState("");

  function handleStartChange(val: string) {
    setNewStart(val);
    if (!val) return;
    const startYear = val.split("-")[0];
    if (!startYear || startYear.length !== 4) return;
    if (newEnd) {
      const parts = newEnd.split("-");
      if (parts.length === 3) {
        const updatedEnd = `${startYear}-${parts[1]}-${parts[2]}`;
        if (updatedEnd < val) {
          setNewEnd(val);
        } else {
          setNewEnd(updatedEnd);
        }
      }
    } else {
      setNewEnd(val);
    }
  }

  const [modalAlert, setModalAlert] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: "",
    message: "",
  });

  function addRange() {
    if (!newStart || !newEnd) return;
    if (newStart > newEnd) {
      setModalAlert({
        isOpen: true,
        title: "Invalid Dates",
        message: "Start date must be before or equal to end date.",
      });
      return;
    }
    setUnavailableRanges((prev) => [
      ...prev,
      { start: newStart, end: newEnd, reason: newReason.trim() || undefined }
    ]);
    setNewStart("");
    setNewEnd("");
    setNewReason("");
  }

  function removeRange(index: number) {
    setUnavailableRanges((prev) => prev.filter((_, i) => i !== index));
  }

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

        {((privileges.includes("E") || privileges.includes("QE")) || !isMinor) && (
          <div>
            <label className="label">Special Roles & Relationships</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
              {(privileges.includes("E") || privileges.includes("QE")) && (
                <>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded p-1.5 cursor-pointer hover:bg-slate-100/50">
                    <input
                      type="checkbox"
                      checked={isSecretary}
                      onChange={(e) => setIsSecretary(e.target.checked)}
                    />
                    Secretary
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded p-1.5 cursor-pointer hover:bg-slate-100/50">
                    <input
                      type="checkbox"
                      checked={isServiceOverseer}
                      onChange={(e) => setIsServiceOverseer(e.target.checked)}
                    />
                    Service Overseer
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded p-1.5 cursor-pointer hover:bg-slate-100/50">
                    <input
                      type="checkbox"
                      checked={isHlcMember}
                      onChange={(e) => setIsHlcMember(e.target.checked)}
                    />
                    HLC Member
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded p-1.5 cursor-pointer hover:bg-slate-100/50">
                    <input
                      type="checkbox"
                      checked={isLmmOverseer}
                      onChange={(e) => setIsLmmOverseer(e.target.checked)}
                    />
                    LMM Overseer
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded p-1.5 cursor-pointer hover:bg-slate-100/50">
                    <input
                      type="checkbox"
                      checked={isWtOverseer}
                      onChange={(e) => setIsWtOverseer(e.target.checked)}
                    />
                    WT Overseer
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded p-1.5 cursor-pointer hover:bg-slate-100/50" title="Exempt from same-week weekend conflict rule to fit assignments when available">
                    <input
                      type="checkbox"
                      checked={isOftenAway}
                      onChange={(e) => setIsOftenAway(e.target.checked)}
                    />
                    Often Away
                  </label>
                </>
              )}
              {gender === "M" && !isMinor && (
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded p-1.5 cursor-pointer hover:bg-slate-100/50">
                  <input
                    type="checkbox"
                    checked={isFather}
                    onChange={(e) => setIsFather(e.target.checked)}
                  />
                  Father
                </label>
              )}
              {gender === "F" && !isMinor && (
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded p-1.5 cursor-pointer hover:bg-slate-100/50">
                  <input
                    type="checkbox"
                    checked={isMother}
                    onChange={(e) => setIsMother(e.target.checked)}
                  />
                  Mother
                </label>
              )}
              {gender === "M" && !isMinor && (
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded p-1.5 cursor-pointer hover:bg-slate-100/50">
                  <input
                    type="checkbox"
                    checked={isHusband}
                    onChange={(e) => setIsHusband(e.target.checked)}
                  />
                  Husband
                </label>
              )}
              {gender === "F" && !isMinor && (
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded p-1.5 cursor-pointer hover:bg-slate-100/50">
                  <input
                    type="checkbox"
                    checked={isWife}
                    onChange={(e) => setIsWife(e.target.checked)}
                  />
                  Wife
                </label>
              )}
            </div>
          </div>
        )}
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

        {gender === "M" && (
          <div className="pt-3 border-t border-slate-100 space-y-2">
            <label className="label mb-1">Prayer Qualification Override</label>
            <div className="flex gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-sm cursor-pointer hover:text-slate-900 select-none">
                <input
                  type="checkbox"
                  className="checkbox w-4 h-4"
                  checked={excludeFromPrayers}
                  onChange={(e) => {
                    setExcludeFromPrayers(e.target.checked);
                    if (e.target.checked) setIncludeInPrayers(false);
                  }}
                />
                Exclude from Opening/Closing Prayer
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer hover:text-slate-900 select-none">
                <input
                  type="checkbox"
                  className="checkbox w-4 h-4"
                  checked={includeInPrayers}
                  onChange={(e) => {
                    setIncludeInPrayers(e.target.checked);
                    if (e.target.checked) setExcludeFromPrayers(false);
                  }}
                />
                Include in Opening/Closing Prayer
              </label>
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Assignment Restrictions</label>
            <select
              className="text-xs border rounded px-1 py-0.5 bg-slate-50"
              value={restrictionType ?? "none"}
              onChange={(e) => {
                const val = e.target.value as Assignee["restrictionType"];
                setRestrictionType(val);
                if (val === "none") {
                  setAllowedParts(undefined);
                } else if (val === "infirmed" || val === "investigation") {
                  const ideal: PartType[] =
                    val === "infirmed"
                      ? [
                          "Opening Prayer",
                          "Closing Prayer",
                          "Local Needs",
                          "Spiritual Gems",
                          "Starting a Conversation",
                          "Following Up",
                        ]
                      : [
                          "Bible Reading",
                          "Starting a Conversation",
                          "Following Up",
                        ];

                  // Filter by actual global eligibility rules (gender, privileges, etc.)
                  const rules = settings?.assignmentRules;
                  const person: Assignee = {
                    name: "TEMPLATE",
                    gender,
                    baptised,
                    isMinor,
                    active: true,
                    privileges: normalizePrivileges(privileges),
                    createdAt: 0,
                  };

                  const filtered = ideal.filter((p) =>
                    isEligible(person, p, "main", "manual", rules)
                  );
                  setAllowedParts(filtered);
                } else if (val === "elderly") {
                  if (!allowedParts) setAllowedParts(undefined);
                }
              }}
            >
              <option value="none">No Restrictions</option>
              <option value="infirmed">Infirmed (Throttled & Limited Parts)</option>
              <option value="elderly">Elderly (Throttled Frequency)</option>
              <option value="investigation">Pending Investigation (Limited Parts)</option>
              <option value="custom">Custom Whitelist...</option>
            </select>
          </div>

          {(allowedParts !== undefined || restrictionType === "custom") && (
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Allowed Parts:
                </p>
                {restrictionType !== "custom" && restrictionType !== "none" && (
                  <button
                    type="button"
                    className="text-[10px] text-indigo-600 font-semibold hover:underline"
                    onClick={() => setRestrictionType("custom")}
                  >
                    Customise...
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {ALL_PARTS.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-xs cursor-pointer hover:text-indigo-600 transition-colors">
                    <input
                      type="checkbox"
                      className="checkbox w-3 h-3"
                      checked={allowedParts?.includes(p) ?? true}
                      onChange={(e) => {
                        const current = allowedParts ?? ALL_PARTS;
                        const next = e.target.checked
                          ? [...current, p]
                          : current.filter((x) => x !== p);
                        setAllowedParts(next);
                        if (restrictionType !== "custom") setRestrictionType("custom");
                      }}
                    />
                    {p === "Talk" ? "Treasures Talk" : p}
                  </label>
                ))}
              </div>
            </div>
          )}
          <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
            {restrictionType === "infirmed" || restrictionType === "elderly"
              ? "⚡ Frequency throttling active: This person will be assigned much less often."
              : "Use this to limit assignments due to health, age, or special circumstances."}
          </p>
        </div>

        {/* Travel/Availability Ranges */}
        <div className="pt-3 border-t border-slate-100 space-y-3">
          <div className="space-y-2">
            <label className="label mb-1">
              {settings?.availabilityMode === "available"
                ? "Available & In-Town Dates"
                : "Travel & Vacation Ranges"}
            </label>
            
            {unavailableRanges.length > 0 && (
              <div className="space-y-1.5 max-h-36 overflow-y-auto border border-slate-100 rounded-lg p-2 bg-slate-50/50 custom-scrollbar">
                {unavailableRanges.map((range, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded border border-slate-200/60 shadow-sm text-xs">
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-700">
                        {settings?.availabilityMode === "available" ? "✅" : "✈️"} {range.start} to {range.end}
                      </span>
                      {range.reason && (
                        <span className="text-[10px] text-slate-500 font-medium">{range.reason}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRange(idx)}
                      className="text-rose-500 hover:text-rose-700 font-bold hover:bg-rose-50 px-2 py-0.5 rounded transition-colors text-[11px]"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="p-3 border border-slate-200/80 rounded-xl bg-slate-50/30 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] uppercase font-bold text-slate-400">Start Date</label>
                  <input
                    type="date"
                    className="input text-xs py-1"
                    value={newStart}
                    onChange={(e) => handleStartChange(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-bold text-slate-400">End Date</label>
                  <input
                    type="date"
                    className="input text-xs py-1"
                    value={newEnd}
                    onChange={(e) => setNewEnd(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="text-[9px] uppercase font-bold text-slate-400">
                  {settings?.availabilityMode === "available" ? "Description (optional)" : "Reason (optional)"}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder={
                      settings?.availabilityMode === "available"
                        ? "e.g. In town, business trip back"
                        : "e.g. Vacation, Work trip"
                    }
                    className="input text-xs py-1"
                    value={newReason}
                    onChange={(e) => setNewReason(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={!newStart || !newEnd}
                    onClick={addRange}
                    className={
                      "btn px-3 py-1 text-xs shrink-0 " +
                      ((!newStart || !newEnd) ? "opacity-50 cursor-not-allowed" : "")
                    }
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
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
                isSecretary,
                isServiceOverseer,
                isHlcMember,
                isLmmOverseer,
                isWtOverseer,
                isOftenAway,
                isFather,
                isMother,
                isHusband,
                isWife,
                privileges:
                  gender === "M"
                    ? normalizePrivileges(privileges)
                    : normalizePrivileges(privileges.filter((p) => p === "RP")),
                notes: notes.trim() || undefined,
                allowedParts,
                restrictionType,
                excludeFromPrayers: gender === "M" ? excludeFromPrayers : false,
                includeInPrayers: gender === "M" ? includeInPrayers : false,
                unavailableRanges: unavailableRanges.length > 0 ? unavailableRanges : undefined,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
      <ConfirmationModal
        isOpen={modalAlert.isOpen}
        title={modalAlert.title}
        message={modalAlert.message}
        confirmText="OK"
        showCancel={false}
        type="warning"
        onConfirm={() => setModalAlert((prev) => ({ ...prev, isOpen: false }))}
      />
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
                      {(p.privileges ?? []).join(", ") || "—"}
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

