import { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import type { WeekendMeeting } from "../types";
import { weekRangeLabel, nextMondayIso, workbookPeriod } from "../utils";
import WeekendImportModal from "../components/WeekendImportModal";
import ConfirmationModal from "../components/ConfirmationModal";

export default function WeekendPage() {
  const weekendMeetings = useLiveQuery(() => db.weekendMeetings.orderBy("weekOf").reverse().toArray(), []) ?? [];
  const assignees = useLiveQuery(() => db.assignees.orderBy("name").toArray(), []) ?? [];
  const weeks = useLiveQuery(() => db.weeks.toArray(), []) ?? [];

  const [importingOpen, setImportingOpen] = useState(false);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string | null>(null);
  
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void | Promise<void>;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  // Unique list of periods (YYYY-MM) present in weekend meetings
  const periods = useMemo(() => {
    const keys = new Set<string>();
    for (const m of weekendMeetings) {
      keys.add(workbookPeriod(m.weekOf).key);
    }
    const sorted = Array.from(keys).sort((a, b) => b.localeCompare(a));
    return sorted;
  }, [weekendMeetings]);

  // Default selected period key
  useMemo(() => {
    if (!selectedPeriodKey && periods.length > 0) {
      setSelectedPeriodKey(periods[0]);
    }
  }, [periods, selectedPeriodKey]);

  const filteredMeetings = useMemo(() => {
    if (!selectedPeriodKey) return weekendMeetings;
    return weekendMeetings.filter((m) => workbookPeriod(m.weekOf).key === selectedPeriodKey);
  }, [weekendMeetings, selectedPeriodKey]);

  async function handleAddWeek() {
    // Generate next Monday relative to latest weekend week or today
    let nextDateStr = new Date().toISOString().split("T")[0];
    if (weekendMeetings.length > 0) {
      nextDateStr = weekendMeetings[0].weekOf;
    }
    const nextWeekOf = nextMondayIso(nextDateStr);

    const mon = new Date(nextWeekOf + "T00:00:00");
    const sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    const MONTH_NAMES_SHORT = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const mMon = MONTH_NAMES_SHORT[mon.getMonth()];
    const mSun = MONTH_NAMES_SHORT[sun.getMonth()];
    const banner = mMon === mSun
      ? `${mMon} ${mon.getDate()}-${sun.getDate()}`
      : `${mMon} ${mon.getDate()}-${mSun} ${sun.getDate()}`;

    const newMeeting: Omit<WeekendMeeting, "id"> = {
      weekOf: nextWeekOf,
      banner,
      publicTalkSpeakerType: "local",
      createdAt: Date.now(),
    };

    try {
      await db.weekendMeetings.add(newMeeting as WeekendMeeting);
      const pKey = workbookPeriod(nextWeekOf).key;
      setSelectedPeriodKey(pKey);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleUpdateField(meeting: WeekendMeeting, field: keyof WeekendMeeting, value: any) {
    try {
      await db.weekendMeetings.update(meeting.id!, {
        [field]: value,
      });
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeleteMeeting(meeting: WeekendMeeting) {
    setConfirmState({
      isOpen: true,
      title: "Delete Weekend Meeting Schedule",
      message: `Are you sure you want to delete the schedule for the week of ${weekRangeLabel(meeting.weekOf)}?`,
      confirmText: "Delete",
      onConfirm: async () => {
        try {
          await db.weekendMeetings.delete(meeting.id!);
          setConfirmState(prev => ({ ...prev, isOpen: false }));
        } catch (e) {
          console.error(e);
        }
      }
    });
  }

  // Helper to check same-week midweek overlap for an enrollee
  function getMidweekOverlapMessage(weekOf: string, assigneeId?: number): string | null {
    if (assigneeId == null) return null;
    const person = assignees.find((a) => a.id === assigneeId);
    if (!person || person.isWtOverseer) return null; // Exempt WT Overseers

    const midweekWeek = weeks.find((w) => w.weekOf === weekOf);
    if (!midweekWeek || midweekWeek.specialEvent) return null;

    const matchedParts = midweekWeek.assignments.filter(
      (a) => a.assigneeId === assigneeId || a.assistantId === assigneeId
    );

    if (matchedParts.length > 0) {
      const partTitles = matchedParts.map((a) => a.title || a.partType).join(", ");
      return `⚠️ Also scheduled for midweek part(s) (${partTitles}) in this week.`;
    }

    return null;
  }

  return (
    <div className="space-y-5">
      <header className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Weekend Meetings</h2>
          <p className="text-xs text-slate-500 mt-1">
            Upload weekend meeting schedules (Public Talk and Watchtower Study) or enter assignments manually.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setImportingOpen(true)}>
            📥 Import Schedule
          </button>
          <button className="btn" onClick={handleAddWeek}>
            ➕ Add Week
          </button>
        </div>
      </header>

      {/* Period Selection Tabs */}
      {periods.length > 0 && (
        <div className="flex border-b border-slate-200 gap-1 overflow-x-auto pb-1 scrollbar-thin">
          {periods.map((key) => {
            const [y, m] = key.split("-");
            const label = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1).toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            });
            const isActive = selectedPeriodKey === key;
            return (
              <button
                key={key}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200/80"
                }`}
                onClick={() => setSelectedPeriodKey(key)}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Main List */}
      {filteredMeetings.length === 0 ? (
        <div className="card text-center py-10 bg-slate-50 text-slate-500 text-sm">
          No weekend schedules added for this period. Click "Add Week" or "Import Schedule" to get started.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredMeetings.map((meeting) => (
            <div key={meeting.id} className="card border-slate-200 hover:border-slate-300 transition-all space-y-4">
              <div className="flex justify-between border-b border-slate-100 pb-3 items-center">
                <div>
                  <span className="font-bold text-slate-800 text-sm">{weekRangeLabel(meeting.weekOf)}</span>
                  <span className="text-[11px] font-bold text-slate-400 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 ml-2">
                    {meeting.banner}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Meeting Date:</label>
                    <input
                      type="date"
                      className="text-xs p-1 border border-slate-300 rounded bg-white font-medium"
                      value={meeting.meetingDate || ""}
                      onChange={(e) => handleUpdateField(meeting, "meetingDate", e.target.value || undefined)}
                    />
                  </div>
                  <button
                    className="text-xs text-rose-500 hover:text-rose-700 font-semibold cursor-pointer"
                    onClick={() => handleDeleteMeeting(meeting)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Public Talk Speaker & Outline */}
                <div className="border border-slate-100 bg-slate-50/50 rounded p-3 space-y-2">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Public Talk Speaker
                  </span>
                  <div className="space-y-2">
                    <select
                      className="text-xs p-1.5 border border-slate-300 rounded bg-white w-full font-medium text-slate-700"
                      value={meeting.publicTalkSpeakerType}
                      onChange={(e) => {
                        const val = e.target.value as "local" | "visiting";
                        handleUpdateField(meeting, "publicTalkSpeakerType", val);
                      }}
                    >
                      <option value="local">Local Brother</option>
                      <option value="visiting">Guest Speaker</option>
                    </select>

                    {meeting.publicTalkSpeakerType === "local" ? (
                      <div>
                        <select
                          className="text-xs p-1.5 border border-slate-300 rounded bg-white w-full font-semibold text-slate-800"
                          value={meeting.publicTalkSpeakerId || ""}
                          onChange={(e) => {
                            const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                            handleUpdateField(meeting, "publicTalkSpeakerId", val);
                          }}
                        >
                          <option value="">-- Unassigned --</option>
                          {assignees.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                        {getMidweekOverlapMessage(meeting.weekOf, meeting.publicTalkSpeakerId) && (
                          <span className="block text-[9px] font-bold text-rose-600 mt-1">
                            {getMidweekOverlapMessage(meeting.weekOf, meeting.publicTalkSpeakerId)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <input
                          type="text"
                          className="text-xs p-1.5 border border-slate-300 rounded w-full font-semibold text-slate-800"
                          placeholder="Guest Speaker Name"
                          value={meeting.rawSpeaker || ""}
                          onChange={(e) => handleUpdateField(meeting, "rawSpeaker", e.target.value || undefined)}
                        />
                        <input
                          type="text"
                          className="text-[10px] p-1.5 border border-slate-300 rounded w-full text-slate-600"
                          placeholder="Visitor Congregation"
                          value={meeting.rawSpeakerCongregation || ""}
                          onChange={(e) => handleUpdateField(meeting, "rawSpeakerCongregation", e.target.value || undefined)}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Public Talk Details */}
                <div className="border border-slate-100 bg-slate-50/50 rounded p-3 space-y-2">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Talk Title & Outline
                  </span>
                  <div className="space-y-2">
                    <div className="flex gap-1">
                      <input
                        type="number"
                        className="text-xs p-1.5 border border-slate-300 rounded w-16 text-center font-bold text-slate-800"
                        placeholder="No."
                        value={meeting.publicTalkNumber || ""}
                        onChange={(e) => {
                          const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                          handleUpdateField(meeting, "publicTalkNumber", val);
                        }}
                      />
                      <input
                        type="text"
                        className="text-xs p-1.5 border border-slate-300 rounded flex-1 font-semibold text-slate-800"
                        placeholder="Talk Title Outline"
                        value={meeting.publicTalkTitle || ""}
                        onChange={(e) => handleUpdateField(meeting, "publicTalkTitle", e.target.value || undefined)}
                      />
                    </div>
                  </div>
                </div>

                {/* 3. Chairman */}
                <div className="border border-slate-100 bg-slate-50/50 rounded p-3 space-y-2">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Chairman
                  </span>
                  <div>
                    <select
                      className="text-xs p-1.5 border border-slate-300 rounded bg-white w-full font-semibold text-slate-800"
                      value={meeting.publicTalkChairmanId || ""}
                      onChange={(e) => {
                        const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                        handleUpdateField(meeting, "publicTalkChairmanId", val);
                      }}
                    >
                      <option value="">-- Unassigned --</option>
                      {assignees.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    {getMidweekOverlapMessage(meeting.weekOf, meeting.publicTalkChairmanId) && (
                      <span className="block text-[9px] font-bold text-rose-600 mt-1">
                        {getMidweekOverlapMessage(meeting.weekOf, meeting.publicTalkChairmanId)}
                      </span>
                    )}
                  </div>
                </div>

                {/* 4. Watchtower Study Conductor & Reader */}
                <div className="border border-slate-100 bg-slate-50/50 rounded p-3 space-y-2">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Watchtower Study
                  </span>
                  <div className="space-y-2">
                    <div>
                      <select
                        className="text-xs p-1.5 border border-slate-300 rounded bg-white w-full font-semibold text-slate-800"
                        value={meeting.watchtowerConductorId || ""}
                        onChange={(e) => {
                          const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                          handleUpdateField(meeting, "watchtowerConductorId", val);
                        }}
                      >
                        <option value="">-- Conductor --</option>
                        {assignees.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      {getMidweekOverlapMessage(meeting.weekOf, meeting.watchtowerConductorId) && (
                        <span className="block text-[9px] font-bold text-rose-600 mt-1">
                          {getMidweekOverlapMessage(meeting.weekOf, meeting.watchtowerConductorId)}
                        </span>
                      )}
                    </div>
                    <div>
                      <select
                        className="text-xs p-1.5 border border-slate-300 rounded bg-white w-full font-semibold text-slate-800"
                        value={meeting.watchtowerReaderId || ""}
                        onChange={(e) => {
                          const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                          handleUpdateField(meeting, "watchtowerReaderId", val);
                        }}
                      >
                        <option value="">-- Reader --</option>
                        {assignees.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      {getMidweekOverlapMessage(meeting.weekOf, meeting.watchtowerReaderId) && (
                        <span className="block text-[9px] font-bold text-rose-600 mt-1">
                          {getMidweekOverlapMessage(meeting.weekOf, meeting.watchtowerReaderId)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {importingOpen && (
        <WeekendImportModal
          onClose={() => setImportingOpen(false)}
          onImported={(count) => {
            console.log(`Imported ${count} weekend meetings`);
          }}
        />
      )}

      <ConfirmationModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText={confirmState.cancelText}
        type="warning"
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
