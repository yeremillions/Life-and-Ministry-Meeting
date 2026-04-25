import { useState } from "react";

type Section =
  | "overview"
  | "getting-started"
  | "settings"
  | "enrollees"
  | "schedule"
  | "auto-assign"
  | "export"
  | "reports"
  | "tips"
  | "faq";

const SECTIONS: { id: Section; title: string }[] = [
  { id: "overview", title: "Overview" },
  { id: "getting-started", title: "Getting Started" },
  { id: "settings", title: "Step 1: Settings" },
  { id: "enrollees", title: "Step 2: Enrollees" },
  { id: "schedule", title: "Step 3: Schedule" },
  { id: "auto-assign", title: "Step 4: Auto-Assign" },
  { id: "export", title: "Step 5: Export PDF" },
  { id: "reports", title: "Reports" },
  { id: "tips", title: "Tips & Best Practices" },
  { id: "faq", title: "FAQ" },
];

export default function HelpPage() {
  const [active, setActive] = useState<Section>("overview");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px,1fr] gap-6">
      {/* ── Side navigation ── */}
      <nav className="card p-0 overflow-hidden self-start lg:sticky lg:top-4">
        <div
          className="px-4 py-3 font-semibold text-sm border-b"
          style={{ borderColor: "#ddd" }}
        >
          User Guide
        </div>
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => setActive(s.id)}
                className={
                  "w-full text-left px-4 py-2 text-sm transition-colors border-l-2 " +
                  (active === s.id
                    ? "bg-gray-50 font-semibold border-l-2"
                    : "text-gray-600 hover:bg-gray-50 border-transparent")
                }
                style={
                  active === s.id
                    ? { borderLeftColor: "var(--color-primary)", color: "var(--color-primary)" }
                    : {}
                }
              >
                {s.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* ── Content ── */}
      <div className="card">
        {active === "overview" && <OverviewSection />}
        {active === "getting-started" && <GettingStartedSection />}
        {active === "settings" && <SettingsSection />}
        {active === "enrollees" && <EnrolleesSection />}
        {active === "schedule" && <ScheduleSection />}
        {active === "auto-assign" && <AutoAssignSection />}
        {active === "export" && <ExportSection />}
        {active === "reports" && <ReportsSection />}
        {active === "tips" && <TipsSection />}
        {active === "faq" && <FaqSection />}
      </div>
    </div>
  );
}

/* ── Reusable components ───────────────────────────────────────────── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold mb-4" style={{ color: "#333" }}>{children}</h2>;
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-bold mt-5 mb-2" style={{ color: "#555" }}>{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-600 mb-3 leading-relaxed">{children}</p>;
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 mb-4">
      <div
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-xs font-bold text-white"
        style={{ backgroundColor: "var(--color-primary)", borderRadius: "2px" }}
      >
        {n}
      </div>
      <div className="text-sm text-gray-600 leading-relaxed flex-1">{children}</div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-sm text-gray-600 p-3 my-3"
      style={{ borderLeft: "3px solid var(--color-primary)", backgroundColor: "#f5f7fa", borderRadius: "2px" }}
    >
      <strong className="text-gray-700">Note: </strong>
      {children}
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-sm text-gray-600 p-3 my-3"
      style={{ borderLeft: "3px solid var(--treasures)", backgroundColor: "#f0fafa", borderRadius: "2px" }}
    >
      <strong style={{ color: "var(--treasures)" }}>Tip: </strong>
      {children}
    </div>
  );
}

function KeyValue({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="flex gap-2 mb-2 text-sm">
      <span className="font-semibold text-gray-700 flex-shrink-0">{label}:</span>
      <span className="text-gray-600">{desc}</span>
    </div>
  );
}

/* ── Section content ───────────────────────────────────────────────── */

function OverviewSection() {
  return (
    <div>
      <SectionTitle>Life &amp; Ministry Meeting Scheduler</SectionTitle>
      <P>
        This application helps the Life and Ministry Meeting overseer manage weekly meeting assignments
        efficiently. It automates the process of assigning brothers and sisters to meeting parts while
        ensuring fair rotation, proper privilege-based eligibility, and balanced workload distribution.
      </P>

      <SubTitle>What This App Does</SubTitle>
      <ul className="text-sm text-gray-600 space-y-2 mb-4 ml-4 list-disc">
        <li>Manages a registry of all congregation members enrolled for meeting parts (enrollees)</li>
        <li>Creates weekly meeting schedules with all standard segments (Opening, Treasures, Ministry, Living)</li>
        <li>Imports meeting parts directly from the Meeting Workbook PDF or an existing S-140 schedule</li>
        <li>Automatically assigns qualified enrollees to parts, respecting eligibility rules and fair rotation</li>
        <li>Exports completed schedules as S-140 Meeting Schedule PDFs ready for printing</li>
        <li>Tracks assignment history and provides reports on workload distribution</li>
      </ul>

      <SubTitle>Meeting Segments</SubTitle>
      <P>The meeting is divided into four colour-coded segments, matching the official workbook:</P>
      <div className="space-y-2 mb-4">
        <SegmentBadge color="var(--opening)" label="Opening" desc="Chairman and Opening Prayer" />
        <SegmentBadge color="var(--treasures)" label="Treasures From God's Word" desc="Talk, Spiritual Gems, Bible Reading" />
        <SegmentBadge color="var(--ministry)" label="Apply Yourself to the Field Ministry" desc="Demonstrations and student talks" />
        <SegmentBadge color="var(--living)" label="Living as Christians" desc="Living Parts, CBS, Closing Prayer" />
      </div>

      <SubTitle>Data Storage</SubTitle>
      <P>
        All data is stored locally in your browser using IndexedDB. Nothing is sent to any server.
        You can back up your data from the Settings page and restore it on another device or browser.
      </P>
    </div>
  );
}

function SegmentBadge({ color, label, desc }: { color: string; label: string; desc: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-3 h-3 flex-shrink-0" style={{ backgroundColor: color, borderRadius: "2px" }} />
      <div>
        <span className="text-sm font-semibold" style={{ color }}>{label}</span>
        <span className="text-xs text-gray-500 ml-2">— {desc}</span>
      </div>
    </div>
  );
}

function GettingStartedSection() {
  return (
    <div>
      <SectionTitle>Getting Started</SectionTitle>
      <P>
        Follow these five steps to go from an empty app to a printed S-140 Meeting Schedule.
        Each step has its own detailed section in this guide.
      </P>

      <div className="space-y-1">
        <Step n={1}>
          <strong>Configure Settings</strong> — Enter your congregation name and adjust the scheduler
          fairness controls to match your congregation's needs.
        </Step>
        <Step n={2}>
          <strong>Add Enrollees</strong> — Register all brothers and sisters who are enrolled for
          meeting parts, including their gender, baptism status, and privileges.
        </Step>
        <Step n={3}>
          <strong>Create Meeting Weeks</strong> — Import weeks from a Meeting Workbook PDF, import
          an existing S-140 schedule, or create weeks manually.
        </Step>
        <Step n={4}>
          <strong>Auto-Assign (or Manual)</strong> — Let the scheduler automatically fill empty slots,
          or manually select each assignee from the dropdown menus.
        </Step>
        <Step n={5}>
          <strong>Export PDF</strong> — Generate the official S-140 Midweek Meeting Schedule PDF for
          printing and posting on the information board.
        </Step>
      </div>

      <Tip>
        The most common workflow is: Import Workbook PDF → Auto-Assign → Review & Adjust → Export PDF.
        This can be done in under 5 minutes per two-month workbook period.
      </Tip>
    </div>
  );
}

function SettingsSection() {
  return (
    <div>
      <SectionTitle>Step 1: Settings</SectionTitle>
      <P>
        Visit the <strong>Settings</strong> tab before anything else.
        Here you configure your congregation and control how the auto-assignment algorithm behaves.
      </P>

      <SubTitle>Congregation Name</SubTitle>
      <P>
        Enter your congregation's official name. This appears in the header of every
        exported S-140 PDF schedule.
      </P>

      <SubTitle>Privileged Ministry Share</SubTitle>
      <P>
        Controls what percentage of Apply Yourself to the Field Ministry parts may go to elders
        and ministerial servants. The default is 10%. These brothers typically handle Treasures
        and Living as Christians parts instead, so this keeps ministry demos available for
        other publishers.
      </P>

      <SubTitle>Scheduler Fairness Controls</SubTitle>
      <P>These settings give you precise control over how the auto-assignment algorithm distributes work:</P>

      <KeyValue
        label="Minimum gap between assignments"
        desc="How many weeks must pass before the same person gets another main part. Default: 2 weeks."
      />
      <KeyValue
        label="Chairman rotation gap"
        desc="How many weeks before the same elder can serve as chairman again. Default: 3 weeks."
      />
      <KeyValue
        label="Catch-up intensity (1–5)"
        desc="How quickly brothers/sisters who haven't had assignments recently are prioritised. 1 = very gradual, 5 = immediate. Default: 3."
      />
      <KeyValue
        label="Max assignments per month"
        desc="Maximum number of main parts a person can receive in any rolling 4-week period. Default: 2."
      />

      <Note>
        Always click <strong>Save settings</strong> after making changes. Settings are applied the next
        time you run auto-assign.
      </Note>

      <SubTitle>Backup &amp; Restore</SubTitle>
      <P>
        Since all data lives in your browser, it is important to regularly download a backup.
        Use <strong>Download backup (.json)</strong> to save a copy, and <strong>Restore from backup</strong> to
        load it on another device or after clearing your browser data.
      </P>
    </div>
  );
}

function EnrolleesSection() {
  return (
    <div>
      <SectionTitle>Step 2: Enrollees</SectionTitle>
      <P>
        The <strong>Enrollees</strong> tab is where you register everyone in the congregation
        who is enrolled for meeting parts.
      </P>

      <SubTitle>Adding Enrollees</SubTitle>
      <P>Click <strong>+ Add enrollee</strong> and fill in the following:</P>
      <KeyValue label="Name" desc="Full name as it should appear on the printed schedule." />
      <KeyValue label="Gender" desc="Male or Female. This determines which parts they are eligible for." />
      <KeyValue label="Baptised" desc="Whether the person is a baptised publisher. Required for certain parts." />
      <KeyValue label="Minor" desc="Check this for those under 18. The scheduler prefers adult assistants for minors." />
      <KeyValue label="Privileges" desc="Select all that apply: Elder (E), Qualified Elder (QE), Ministerial Servant (MS), Qualified MS (QMS), Regular Pioneer (RP), CBS Reader (CBSR)." />
      <KeyValue label="Active" desc="Inactive enrollees are skipped by the auto-assigner but remain in the system." />

      <SubTitle>Privilege Rules</SubTitle>
      <P>Privileges determine eligibility for specific parts:</P>
      <ul className="text-sm text-gray-600 space-y-1.5 mb-4 ml-4 list-disc">
        <li><strong>Chairman</strong> — Qualified Elder (QE) only</li>
        <li><strong>Talk / Spiritual Gems</strong> — Baptised brothers who are MS or above</li>
        <li><strong>Bible Reading</strong> — Any active male (baptism not required)</li>
        <li><strong>Ministry demonstrations</strong> — Any active enrollee (male or female)</li>
        <li><strong>Living Part / Local Needs</strong> — Baptised brothers who are MS or above</li>
        <li><strong>CBS Conductor</strong> — Qualified Elder (QE) only</li>
        <li><strong>CBS Reader</strong> — Must have the CBSR privilege</li>
        <li><strong>Opening/Closing Prayer</strong> — Any baptised brother (auto-assign prefers MS+ and CBSR)</li>
      </ul>

      <SubTitle>Bulk Import</SubTitle>
      <P>
        Click <strong>Import</strong> to upload a spreadsheet (Excel or CSV) containing multiple enrollees
        at once. The file should have columns for Name, Gender, Baptised, and Privileges.
        You can also paste a plain text list of names.
      </P>

      <SubTitle>Households</SubTitle>
      <P>
        Switch to the <strong>Households</strong> tab to group family members together. Members of the
        same household can be paired as main and assistant in ministry demonstrations, even if
        they are of different genders (e.g. a husband and wife demonstrating a return visit).
      </P>

      <SubTitle>Exporting the Enrollee List</SubTitle>
      <P>
        Use the <strong>Export</strong> button to download the enrollee list as an Excel (.xlsx) or CSV file
        for record-keeping or sharing with other elders.
      </P>
    </div>
  );
}

function ScheduleSection() {
  return (
    <div>
      <SectionTitle>Step 3: Schedule</SectionTitle>
      <P>
        The <strong>Schedule</strong> tab is where you create, manage, and fill meeting weeks.
      </P>

      <SubTitle>Creating Weeks</SubTitle>
      <P>There are three ways to create meeting weeks:</P>

      <Step n={1}>
        <strong>Import Workbook PDF</strong> (recommended) — Click <strong>Import workbook PDF</strong> and
        upload the Meeting Workbook PDF downloaded from jw.org. The parser extracts all weeks and
        parts automatically, including talk titles and student assignment types.
      </Step>
      <Step n={2}>
        <strong>Import S-140 Schedule</strong> — If you have a previously filled S-140 schedule PDF, you can
        import it to bring in both the parts and any existing assignee names. The importer will try to
        match names to your enrollees.
      </Step>
      <Step n={3}>
        <strong>New week (manual)</strong> — Click <strong>+ New week</strong> to create a blank week.
        You will need to add parts manually for each segment.
      </Step>

      <SubTitle>The Week Editor</SubTitle>
      <P>
        Click any week in the left sidebar to open it in the editor. The editor shows all meeting parts
        grouped by segment. For each part you can:
      </P>
      <ul className="text-sm text-gray-600 space-y-1.5 mb-4 ml-4 list-disc">
        <li>Select a main assignee from the searchable dropdown</li>
        <li>Select an assistant (for demonstration parts and CBS Reader)</li>
        <li>Drag and drop parts to reorder them within or across segments</li>
        <li>Add or remove parts using the segment controls</li>
      </ul>

      <SubTitle>Sidebar Navigation</SubTitle>
      <P>
        The sidebar groups weeks by two-month workbook periods (Jan–Feb, Mar–Apr, etc.)
        and works as an accordion — only one period is expanded at a time.
        Use the year selector at the top to navigate between years.
        Each period shows a progress bar and fill fraction so you can see at a glance
        which periods still need attention.
      </P>

      <Note>
        The dropdowns only show eligible assignees for each part type. If someone is missing,
        check their privileges and active status in the Enrollees tab.
      </Note>
    </div>
  );
}

function AutoAssignSection() {
  return (
    <div>
      <SectionTitle>Step 4: Auto-Assign</SectionTitle>
      <P>
        Once a week's parts are in place (either imported or manually added), you can let the
        scheduler fill all empty slots automatically.
      </P>

      <SubTitle>How to Auto-Assign</SubTitle>
      <Step n={1}>Select a week in the Schedule tab.</Step>
      <Step n={2}>Click <strong>Auto-fill empty</strong> to assign only empty slots (preserving any manual selections).</Step>
      <Step n={3}>Or click <strong>Auto-fill all</strong> to reassign every slot from scratch.</Step>

      <SubTitle>How the Algorithm Works</SubTitle>
      <P>The scheduler considers the following factors when choosing a candidate:</P>
      <ul className="text-sm text-gray-600 space-y-1.5 mb-4 ml-4 list-disc">
        <li><strong>Eligibility</strong> — Only people with the right privileges and gender are considered</li>
        <li><strong>Recency</strong> — People who had a recent assignment are penalised (configurable gap)</li>
        <li><strong>Total workload</strong> — People with fewer lifetime assignments are preferred</li>
        <li><strong>Monthly cap</strong> — No one receives more than the configured max per 4-week window</li>
        <li><strong>Segment balance</strong> — The scheduler avoids giving the same person the same type of part repeatedly</li>
        <li><strong>Chairman rotation</strong> — Elders must wait the configured number of weeks before chairing again</li>
        <li><strong>Same-meeting uniqueness</strong> — No person is assigned two main parts in the same meeting</li>
      </ul>

      <Tip>
        After auto-filling, review the assignments and make any manual adjustments. The scheduler provides
        a strong starting point, but your knowledge of the congregation may lead you to swap certain names.
      </Tip>

      <SubTitle>Clearing Assignments</SubTitle>
      <P>
        Click <strong>Clear all</strong> to remove every assignment from the current week while keeping the
        part structure intact. This is useful if you want to start over.
      </P>
    </div>
  );
}

function ExportSection() {
  return (
    <div>
      <SectionTitle>Step 5: Export PDF</SectionTitle>
      <P>
        Once your weeks are fully assigned, you can generate the official <strong>S-140 Midweek Meeting
        Assignment Schedule</strong> as a PDF for printing.
      </P>

      <SubTitle>How to Export</SubTitle>
      <Step n={1}>Click <strong>Export PDF</strong> in the Schedule sidebar.</Step>
      <Step n={2}>Select the workbook period you want to export (e.g. "May – June 2026"). The current period is pre-selected.</Step>
      <Step n={3}>Review the preview showing all weeks that will be included.</Step>
      <Step n={4}>Click <strong>Download PDF</strong> to generate and save the file.</Step>

      <SubTitle>PDF Contents</SubTitle>
      <P>The exported PDF follows the official S-140 format and includes:</P>
      <ul className="text-sm text-gray-600 space-y-1.5 mb-4 ml-4 list-disc">
        <li>Your congregation name in the header</li>
        <li>Each week with its date range</li>
        <li>Chairman and prayer assignments</li>
        <li>All Treasures, Ministry, and Living as Christians parts with sequential numbering</li>
        <li>Assignee and assistant names for each part</li>
        <li>CBS Conductor and Reader</li>
      </ul>

      <Note>
        The PDF is generated entirely in your browser — no data is uploaded anywhere.
        Make sure all assignments are complete before exporting. Any unfilled slots will
        appear blank on the printed schedule.
      </Note>

      <Tip>
        Print the schedule and post it on the congregation information board at least two weeks
        before the meeting dates. This gives all participants time to prepare.
      </Tip>
    </div>
  );
}

function ReportsSection() {
  return (
    <div>
      <SectionTitle>Reports</SectionTitle>
      <P>
        The <strong>Reports</strong> tab provides a comprehensive view of assignment history
        and workload distribution across all enrollees.
      </P>

      <SubTitle>Assignment History Table</SubTitle>
      <P>
        The main table shows every enrollee with their total assignment count and last assignment
        date. You can sort by name, total assignments, or last assigned date. Click any name to
        view their detailed profile.
      </P>

      <SubTitle>Filtering by Time Range</SubTitle>
      <P>
        Use the range filter to view statistics for all time, the last 6 months, or the last year.
        This helps you see recent trends without historical data skewing the picture.
      </P>

      <SubTitle>CSV Export</SubTitle>
      <P>
        Click <strong>Export CSV</strong> to download the full assignment schedule as a spreadsheet.
        This includes every week, part, assignee, and assistant — useful for records or sharing
        with the body of elders.
      </P>

      <SubTitle>Enrollee Profiles</SubTitle>
      <P>
        Click on any enrollee's name (in Reports, Dashboard, or the Schedule) to see their
        detailed profile page. This shows their complete assignment history, segment distribution,
        and any insights about their usage patterns.
      </P>
    </div>
  );
}

function TipsSection() {
  return (
    <div>
      <SectionTitle>Tips &amp; Best Practices</SectionTitle>

      <SubTitle>Regular Workflow</SubTitle>
      <ul className="text-sm text-gray-600 space-y-2 mb-4 ml-4 list-disc">
        <li>
          When the new workbook is available on jw.org, download the PDF and import it into the
          Schedule tab. This creates all the weeks and parts in one go.
        </li>
        <li>
          Run auto-assign on each week, then review and adjust as needed. Pay special attention
          to weeks with special events (circuit overseer visit, memorial, etc.).
        </li>
        <li>
          Export the PDF and print it at least two weeks before the first meeting date.
        </li>
      </ul>

      <SubTitle>Keeping Data Current</SubTitle>
      <ul className="text-sm text-gray-600 space-y-2 mb-4 ml-4 list-disc">
        <li>
          When a brother is appointed as a ministerial servant or elder, update his privileges in
          the Enrollees tab immediately. This affects what parts he is eligible for.
        </li>
        <li>
          Mark enrollees as inactive when they move away, become ill for an extended period, or
          are no longer available. They remain in the system for historical records.
        </li>
        <li>
          Download a backup regularly from Settings. This protects your data if your browser
          storage is cleared.
        </li>
      </ul>

      <SubTitle>Fair Rotation</SubTitle>
      <ul className="text-sm text-gray-600 space-y-2 mb-4 ml-4 list-disc">
        <li>
          The scheduler is designed to be fair, but the overseer should always review the output.
          Consider personal circumstances the algorithm cannot know about (e.g., someone preparing
          for a convention part, going on vacation, or dealing with a personal matter).
        </li>
        <li>
          If a brother or sister hasn't been assigned in a long time, check the Dashboard's
          "Due for Assignment" list. The scheduler will try to include them, but a very large
          congregation may have natural gaps.
        </li>
        <li>
          Adjust the "Catch-up intensity" setting if neglected publishers are being brought back
          too quickly or too slowly.
        </li>
      </ul>

      <SubTitle>Households</SubTitle>
      <P>
        Setting up households is optional but useful. When a married couple is in the same household,
        the assistant picker for ministry demonstrations will show the spouse as an option, even if
        they are of a different gender. Without a household, the scheduler defaults to same-gender pairings.
      </P>
    </div>
  );
}

function FaqSection() {
  return (
    <div>
      <SectionTitle>Frequently Asked Questions</SectionTitle>

      <FaqItem q="Why is someone not showing up in the dropdown for a part?">
        The dropdown only shows eligible enrollees. Check that the person: (1) is marked as Active,
        (2) has the correct gender, (3) has the required privileges for that part type, and
        (4) is not already assigned to another part in the same week (for main assignments).
      </FaqItem>

      <FaqItem q="Can sisters be assigned to any part?">
        Sisters can be assigned to Apply Yourself to the Field Ministry demonstrations (Starting a
        Conversation, Following Up, Making Disciples, Explaining Your Beliefs). They are not eligible
        for talks, Bible Reading, or Living as Christians parts, as these are brothers-only parts
        per theocratic arrangement.
      </FaqItem>

      <FaqItem q="Why does the auto-assigner keep choosing the same people?">
        Check the Settings page. Ensure the "Minimum gap between assignments" and "Max assignments
        per month" values are set appropriately for your congregation size. A very small congregation
        with few qualified brothers may have limited options for certain parts like Chairman or CBS
        Conductor.
      </FaqItem>

      <FaqItem q="Will I lose my data if I clear my browser history?">
        It depends on your browser settings. Clearing "cookies and site data" or "storage" will
        delete your IndexedDB data. Clearing only "browsing history" is usually safe. To be safe,
        download regular backups from the Settings page.
      </FaqItem>

      <FaqItem q="Can I use this app on my phone?">
        Yes. The app is fully responsive and works on mobile browsers. The navigation switches to a
        compact dropdown on small screens. For the best experience, use a tablet or desktop when
        working with the Week Editor.
      </FaqItem>

      <FaqItem q="Can two people use the app on different devices?">
        Each device maintains its own local database. To sync data, one person should export a backup
        (Settings → Download backup) and share the .json file with the other person, who can then
        restore it (Settings → Restore from backup).
      </FaqItem>

      <FaqItem q="What is the CBSR privilege?">
        CBSR stands for "Congregation Bible Study Reader." This is a custom privilege flag that
        marks a brother as qualified to serve as the reader during the Congregation Bible Study.
        Only brothers with this privilege will be auto-assigned as CBS Reader.
      </FaqItem>

      <FaqItem q="Can I edit a week after exporting the PDF?">
        Absolutely. The export does not lock anything. You can continue editing assignments and
        export a new PDF at any time.
      </FaqItem>
    </div>
  );
}

function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b" style={{ borderColor: "#eee" }}>
      <button
        className="w-full text-left py-3 flex items-start gap-2 text-sm"
        onClick={() => setOpen(!open)}
      >
        <span
          className="text-[10px] mt-0.5 flex-shrink-0 transition-transform duration-150"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", color: "#999" }}
        >
          ▶
        </span>
        <span className="font-semibold text-gray-700">{q}</span>
      </button>
      {open && (
        <div className="pb-3 pl-5 text-sm text-gray-600 leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}
