import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { AppSettings, Assignee, Week, Assignment, PartType } from "../types";
import { segmentOf, isEligible } from "../meeting";
import { todayIso } from "../utils";
import { buildStats, AssigneeStats } from "../scheduler";

export default function EnrolleeProfile({
  id,
  onBack,
  onNavigateToProfile,
}: {
  id: number;
  onBack: () => void;
  onNavigateToProfile: (id: number) => void;
}) {
  const enrollee = useLiveQuery(() => db.assignees.get(id), [id]);
  const allAssignees = useLiveQuery(() => db.assignees.toArray(), []);
  const weeks = useLiveQuery(() => db.weeks.orderBy("weekOf").toArray(), []);
  const households = useLiveQuery(() => db.households.toArray(), []);
  const settings = useLiveQuery(() => db.settings.get("app"), []) || null;

  if (!enrollee || !weeks || !allAssignees || !households) return <div className="p-8 text-center text-slate-500">Loading...</div>;

  const myHouseholds = households.filter((h) => h.memberIds.includes(enrollee.id!));
  const housemates = Array.from(new Set(myHouseholds.flatMap(h => h.memberIds))).filter(mid => mid !== enrollee.id);

  // Find all assignments
  const history: { week: Week; assignment: Assignment; role: "main" | "assistant" }[] = [];
  weeks.forEach((w) => {
    w.assignments.forEach((a) => {
      if (a.assigneeId === id) {
        history.push({ week: w, assignment: a, role: "main" });
      } else if (a.assistantId === id) {
        history.push({ week: w, assignment: a, role: "assistant" });
      }
    });
  });

  // Sort history descending
  history.sort((a, b) => b.week.weekOf.localeCompare(a.week.weekOf));

  const stats = buildStats([enrollee], weeks).get(id)!;

  // Calculate insights
  const insights = calculateInsights(enrollee, history, stats, settings);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="btn-secondary">
          &larr; Back
        </button>
        <h1 className="text-2xl font-bold">{enrollee.name}</h1>
        {enrollee.active ? (
          <span className="pill bg-emerald-100 text-emerald-800 border border-emerald-200">Active</span>
        ) : (
          <span className="pill bg-slate-100 text-slate-800 border border-slate-200">Inactive</span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Basic Info */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-900 border-b border-slate-100 pb-2">Information</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Gender</span>
              <span className="font-medium">{enrollee.gender === "M" ? "Brother" : "Sister"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Baptised</span>
              <span className="font-medium">{enrollee.baptised ? "Yes" : "No"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Minor</span>
              <span className="font-medium">{enrollee.isMinor ? "Yes" : "No"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Privileges</span>
              <div className="flex flex-wrap justify-end gap-1">
                {enrollee.privileges.length > 0 ? (
                    enrollee.privileges.map(p => (
                        <span key={p} className="pill bg-blue-50 text-blue-700 text-[10px] border border-blue-100">{p}</span>
                    ))
                ) : <span className="text-slate-400">—</span>}
              </div>
            </div>
            {myHouseholds.length > 0 && (
                <div className="pt-2">
                    <span className="text-slate-500 block mb-1">Housemates</span>
                    <div className="flex flex-wrap gap-1">
                        {housemates.map(mid => {
                            const person = allAssignees?.find(a => a.id === mid);
                            if (!person) return null;
                            return (
                                <button 
                                    key={mid}
                                    onClick={() => onNavigateToProfile(mid)}
                                    className="pill bg-indigo-50 text-indigo-700 text-[10px] border border-indigo-100 hover:bg-indigo-100 transition-colors"
                                >
                                    {person.name}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}
          </div>
          {enrollee.notes && (
            <div className="pt-4 border-t border-slate-100">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase mb-2 tracking-wider">Notes</h3>
              <p className="text-sm text-slate-600 italic leading-relaxed">"{enrollee.notes}"</p>
            </div>
          )}
        </div>

        {/* Statistics */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-900 border-b border-slate-100 pb-2">Summary</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-slate-50 rounded-xl text-center border border-slate-100">
              <div className="text-2xl font-bold text-indigo-600">{stats.totalMain}</div>
              <div className="text-[10px] uppercase text-slate-400 font-bold tracking-tight">Main Parts</div>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl text-center border border-slate-100">
              <div className="text-2xl font-bold text-slate-600">{stats.totalAssistant}</div>
              <div className="text-[10px] uppercase text-slate-400 font-bold tracking-tight">Assistant</div>
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">By Segment</h3>
            <div className="space-y-1.5">
                {Object.entries(stats.bySegmentMain).map(([seg, count]) => {
                    const s = segmentOf(seg as any);
                    return (
                        <div key={seg} className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }}></div>
                            <span className="text-xs text-slate-600 flex-1">{s.label}</span>
                            <span className="text-xs font-bold text-slate-900">{count}</span>
                        </div>
                    )
                })}
            </div>
          </div>
        </div>

        {/* Insights */}
        <div className="card space-y-4 border-amber-200 bg-amber-50/20">
          <h2 className="font-semibold text-amber-900 border-b border-amber-100 pb-2">Utilization Insights</h2>
          <div className="space-y-3">
            {insights.map((insight, idx) => (
                <div key={idx} className="flex gap-2.5 text-sm">
                    <span className="text-amber-500 font-bold text-lg leading-none">✦</span>
                    <p className="text-slate-700 leading-snug">{insight}</p>
                </div>
            ))}
            {insights.length === 0 && <p className="text-sm text-slate-500 italic">No specific insights at this time.</p>}
          </div>
        </div>
      </div>

      <div className="card shadow-sm border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
            <h2 className="font-semibold text-slate-800">Activity History</h2>
        </div>
        {history.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-slate-400 italic">No activity recorded yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Week</th>
                  <th className="px-4 py-3 text-left">Part</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left">Segment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map(({ week, assignment, role }, idx) => {
                  const seg = segmentOf(assignment.segment);
                  return (
                    <tr key={idx} className="hover:bg-indigo-50/30 transition-colors">
                      <td className="px-4 py-4 whitespace-nowrap font-medium text-slate-600">{week.weekOf}</td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col">
                            <span className="font-bold text-slate-900">{assignment.partType}</span>
                            <span className="text-[11px] text-slate-500 truncate max-w-[250px]">{assignment.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`pill text-[11px] px-2 py-0.5 font-bold ${role === 'main' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'bg-slate-50 text-slate-600 border border-slate-100'}`}>
                            {role === 'main' ? 'MAIN' : 'ASSISTANT'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: seg.color }}></div>
                            <span className="text-slate-600 font-medium">{seg.label}</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function calculateInsights(enrollee: Assignee, history: any[], stats: AssigneeStats, settings: AppSettings | null): string[] {
    const insights: string[] = [];
    const today = todayIso();

    // 1. Last assigned
    if (!stats.lastWeekMain) {
        insights.push(`${enrollee.name} has never been assigned a main part. They should be considered for one soon.`);
    } else {
        const lastDate = new Date(stats.lastWeekMain);
        const diffMs = new Date(today).getTime() - lastDate.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays > 60) {
            insights.push(`It has been ${Math.floor(diffDays / 7)} weeks since their last main assignment.`);
        }
    }

    // 2. Suggestions based on eligibility
    const allParts: PartType[] = [
        "Chairman", "Opening Prayer", "Talk", "Spiritual Gems", "Bible Reading",
        "Starting a Conversation", "Following Up", "Making Disciples", "Explaining Your Beliefs",
        "Initial Call", "Talk (Ministry)", "Living Part", "Local Needs", "Governing Body Update",
        "Congregation Bible Study", "Closing Prayer"
    ];

    const eligibleFor = allParts.filter(p => isEligible(enrollee, p, "main", "manual", settings?.assignmentRules));
    
    // Find parts they haven't done
    const doneParts = new Set(history.filter(h => h.role === 'main').map(h => h.assignment.partType));
    const neverDone = eligibleFor.filter(p => !doneParts.has(p));

    if (neverDone.length > 0) {
        const sample = neverDone.slice(0, 3).join(", ");
        insights.push(`Eligible for but hasn't yet handled: ${sample}.`);
    }

    // 3. Specific suggestions
    if (enrollee.gender === 'M' && enrollee.baptised && !enrollee.privileges.includes('MS')) {
        insights.push(`As a baptised brother, he could be encouraged toward Spiritual Gems or Bible Reading parts.`);
    }

    if (enrollee.isMinor) {
        insights.push(`As a minor, they should preferably be paired with experienced adult assistants.`);
    }

    // 4. Overutilization check
    if (stats.totalMain > 0) {
        // Simple heuristic: if they have more than 4 main parts and the average gap is small
        const totalWeeks = history.length > 0 ? (new Date(today).getTime() - new Date(history[history.length-1].week.weekOf).getTime()) / (1000 * 60 * 60 * 24 * 7) : 1;
        const freq = stats.totalMain / (totalWeeks || 1);
        if (freq > 0.4) {
            insights.push(`Being assigned frequently (approx. every ${Math.max(2, Math.round(1/freq))} weeks). Consider a longer break.`);
        }
    }

    return insights;
}
