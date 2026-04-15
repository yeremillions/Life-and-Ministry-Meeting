# Life and Ministry Meeting Scheduler

A small, private, **fully client-side** web app for scheduling weekly Life and
Ministry Meeting assignments. Data is stored in your browser (IndexedDB) — no
server, no accounts, no cloud.

## Features

- **Enrollees** — add names manually or import from **CSV / Excel (.xlsx) /
  Word or Google Docs (.docx) / plain text**. Mark gender, baptism status, and
  privileges (E, QE, MS, QMS).
- **Weekly schedule editor** — three segments out of the box:
  - *Treasures From God's Word* — always Talk (1), Spiritual Gems (2), Bible
    Reading (3), in that order.
  - *Apply Yourself to the Field Ministry* — pick any combination of Starting
    a Conversation, Following Up, Making Disciples, Explaining Your Beliefs,
    Initial Call, or Talk (minimum 3 parts).
  - *Living as Christians* — flexible number of parts (min 2); the last part
    is normally the Congregation Bible Study.
- **Smart auto-assignment** — honours eligibility rules (e.g. Treasures Talk
  to elders/MS, Bible Reading to any baptised brother, demos same-sex
  pairings, Congregation Bible Study conductor to elders) and balances the
  rotation by preferring enrollees with the longest time since last assigned
  and fewest total assignments. A configurable cap (default 10%) limits how
  often privileged brothers take Field Ministry parts.
- **Dashboard** — upcoming weeks, recent history, and "who should be assigned
  soon" panel.
- **Reports & export** — per-enrollee assignment counts per segment, last
  assignment date; export enrollee report and the full schedule to CSV.
- **Backup / restore** — download a JSON backup and restore it on any device.

## Running locally

```bash
npm install
npm run dev
```

Open <http://localhost:5173> in your browser.

To produce a production build:

```bash
npm run build
npm run preview
```

## Import file format (spreadsheets)

First row should contain headers. Recognised columns (case-insensitive):

| column        | values                                                 |
| ------------- | ------------------------------------------------------ |
| `name`        | full name (required)                                    |
| `gender`      | `M` / `F` (or `brother`/`sister`)                       |
| `baptised`    | `yes` / `no`                                            |
| `privileges`  | any combination of `E`, `QE`, `MS`, `QMS` (comma/space) |
| `active`      | `yes` / `no` (defaults to yes)                          |
| `notes`       | free text                                               |

For Word / Google Doc (.docx) and plain text imports, one name per line. You
can append tags in parentheses, e.g.:

```
John Adams (E)
Mary Smith (F)
Samuel Okafor (MS)
Ada Nwankwo (F, unbaptised)
```

## Privacy

All data is stored in your browser's IndexedDB. Clearing site data (or using
private browsing) will erase it. Use **Settings → Download backup** to keep a
copy.
