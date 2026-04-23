/**
 * Test the parser against the exact extracted text the user reported.
 */

// --- replicate the normalisation + parsing logic from workbookParser.ts ---
const MONTHS = {
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6,
  JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
};
const MONTHS_RE = Object.keys(MONTHS).join("|");

const WEEK_RE = new RegExp(
  `(${MONTHS_RE})\\s*(\\d{1,2})\\s*[-\\u2010-\\u2015\\u2212~]\\s*(?:(${MONTHS_RE})\\s*)?(\\d{1,2})`,
  "gi"
);

const SEGMENT_RE = {
  treasures: /TREASURES[\s\S]*?FROM\s+GOD['''\u2019]?S?\s+WORD/i,
  ministry: /APPLY\s*YOURSELF[\s\S]*?TO\s+THE\s+FIELD\s+MINISTRY/i,
  living: /LIVING[\s\S]*?AS\s+CHRISTIANS/i,
};

function normalise(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    // Month name normalisation (handles both letter-spaced and glyph-split)
    .replace(/J\s*A\s*N\s*U\s*A\s*R\s*Y/gi, "JANUARY")
    .replace(/F\s*E\s*B\s*R\s*U\s*A\s*R\s*Y/gi, "FEBRUARY")
    .replace(/M\s*A\s*R\s*C\s*H/gi, "MARCH")
    .replace(/A\s*P\s*R\s*I\s*L/gi, "APRIL")
    .replace(/J\s*U\s*N\s*E/gi, "JUNE")
    .replace(/J\s*U\s*L\s*Y/gi, "JULY")
    .replace(/A\s*U\s*G\s*U\s*S\s*T/gi, "AUGUST")
    .replace(/S\s*E\s*P\s*T\s*E\s*M\s*B\s*E\s*R/gi, "SEPTEMBER")
    .replace(/O\s*C\s*T\s*O\s*B\s*E\s*R/gi, "OCTOBER")
    .replace(/N\s*O\s*V\s*E\s*M\s*B\s*E\s*R/gi, "NOVEMBER")
    .replace(/D\s*E\s*C\s*E\s*M\s*B\s*E\s*R/gi, "DECEMBER")
    // Collapse remaining letter-spaced uppercase words
    .replace(/(?<![A-Za-z])(?:[A-Z] ){2,}[A-Z](?![A-Za-z])/g, m => m.replace(/ /g, ""))
    // Collapse letter-spaced digit runs
    .replace(/(?<=\b)(\d) (\d)(?=\b)/g, "$1$2")
    .replace(/(?<=\b)(\d) (\d)(?=\b)/g, "$1$2")
    // Fix "MONTH DD -DD" → "MONTH DD-DD"
    .replace(/([A-Z]{3,}) (\d{1,2}) [-\u2013\u2014](\d{1,2})/gi, "$1 $2-$3")
    // Year fix "20 25" → "2025"
    .replace(/\b(20)\s(\d{2})\b/g, "$1$2");
}

// The exact text the user copied from the "Show extracted text" panel
const userText = `OUR CHRISTIAN
LIFE AND MINISTRY
M E E T I N G WO R K BO O K
S E PTE M B E R- O CTO B E R 202 5

SEPTEMB ER 1 -7 PR OVE R B S 29 2
Song 28 and Prayer Opening Comments (1 min.)

TREASURES
 FROM GOD'S WORD

1. Reject Unscriptural Beliefs and Customs
(10 min.)

2. Spiritual Gems (10 min.) 5. Starting a Conversation (4 min.)

LIVING
3. Bible Reading (4 min.)  AS CHRISTIANS

Pr 29:1-18 (th study 5)
Song 159

APPLY YOURSELF 7. Local Needs (15 min.)
TO THE FIELD MINISTRY

4. Starting a Conversation (3 min.) lfb intro to section 4 and lessons 14-15

Concluding Comments (3 min.) Song 31 and Prayer


3 SEPTEMB ER 8 -14 PR OVE R B S 3 0
Song 136 and Prayer Opening Comments (1 min.)

TREASURES
 FROM GOD'S WORD

1. "Give Me Neither Poverty Nor Riches" (10 min.)

2. Spiritual Gems (10 min.) 6. Explaining Your Beliefs (4 min.)
LIVING
What spiritual gems?  AS CHRISTIANS

Song 80

3. Bible Reading (4 min.)
Pr 30:1-14 (th study 2)

APPLY YOURSELF
TO THE FIELD MINISTRY

4. Starting a Conversation (4 min.)

5. Following Up (4 min.)

Concluding Comments (3 min.) Song 128 and Prayer


SEPTEMB ER 1 5 - 2 1 PR OVE R B S 3 1 4
Song 135 and Prayer Opening Comments (1 min.)

TREASURES
 FROM GOD'S WORD

1. Lessons From a Mother's Loving Instructions (10 min.)

2. Spiritual Gems (10 min.) APPLY YOURSELF
TO THE FIELD MINISTRY

3. Bible Reading (4 min.)
Pr 31:10-31 (th study 10)

5
LIVING
 AS CHRISTIANS

Song 121

Concluding Comments (3 min.) Song 2 and Prayer


SEPTEMB ER 2 2 - 28 ECC LE S IASTE S 1 - 2 6
Song 103 and Prayer Opening Comments (1 min.)

TREASURES
 FROM GOD'S WORD

1. Continue to Train the Next Generation (10 min.)

2. Spiritual Gems (10 min.) APPLY YOURSELF
TO THE FIELD MINISTRY

3. Bible Reading (4 min.)
Ec 1:1-18 (th study 11)

7
LIVING
 AS CHRISTIANS

Song 84

Concluding Comments (3 min.) Song 148 and Prayer


SEPTEMB ER 2 9 – OCTOB ER 5 ECC LE S IASTE S 3 - 4 8
Song 93 and Prayer Opening Comments (1 min.)

TREASURES
 FROM GOD'S WORD

1. Strengthen Your Threefold Cord (10 min.)

2. Spiritual Gems (10 min.) APPLY YOURSELF
TO THE FIELD MINISTRY

3. Bible Reading (4 min.)
Ec 4:1-16 (th study 2)

9
LIVING
 AS CHRISTIANS

Song 131

Concluding Comments (3 min.) Song 51 and Prayer


OCTOB ER 6 -1 2 ECC LE S IASTE S 5 - 6 10
Song 42 and Prayer Opening Comments (1 min.)

TREASURES
 FROM GOD'S WORD

1. How We Show Reverence for Our Great God (10 min.)

2. Spiritual Gems (10 min.) APPLY YOURSELF
TO THE FIELD MINISTRY

3. Bible Reading (4 min.)
Ec 5:1-17 (th study 12)

11
LIVING
 AS CHRISTIANS

Song 160

Concluding Comments (3 min.) Song 34 and Prayer


OCTOB ER 1 3 -19 ECC LE S IASTE S 7- 8 12
Song 39 and Prayer Opening Comments (1 min.)

TREASURES
 FROM GOD'S WORD

1. "Go to the House of Mourning" (10 min.)

2. Spiritual Gems (10 min.) APPLY YOURSELF
TO THE FIELD MINISTRY

3. Bible Reading (4 min.)
Ec 8:1-13 (th study 10)

13
LIVING
 AS CHRISTIANS

Song 151

Concluding Comments (3 min.) Song 124 and Prayer


OCTOB ER 2 0 - 2 6 ECC LE S IASTE S 9 - 10 14
Song 30 and Prayer Opening Comments (1 min.)

TREASURES
 FROM GOD'S WORD

1. Keep a Proper View of Your Trials (10 min.)

2. Spiritual Gems (10 min.) APPLY YOURSELF
TO THE FIELD MINISTRY

3. Bible Reading (4 min.)
Ec 10:1-20 (th study 11)

15
LIVING
 AS CHRISTIANS

Song 47

Concluding Comments (3 min.) Song 28 and Prayer


OCTOB ER 2 7–N OVEMB ER 2 ECC LE S IASTE S 1 1 - 1 2 16
Song 155 and Prayer Opening Comments (1 min.)

TREASURES
 FROM GOD'S WORD

1. Enjoy a Happy, Healthy Life (10 min.)

2. Spiritual Gems (10 min.) 5. Following Up (4 min.)

3. Bible Reading (4 min.) LIVING
 AS CHRISTIANS
Ec 12:1-14 (th study 12)
Song 111

APPLY YOURSELF
7. Local Needs (15 min.)
TO THE FIELD MINISTRY

4. Following Up (3 min.)
lfb lessons 30-31

Concluding Comments (3 min.) Song 8 and Prayer`;

const text = normalise(userText);

// Verify month name fixes
console.log("=== Month name checks ===");
console.log("Contains SEPTEMBER:", text.includes("SEPTEMBER"));
console.log("Contains OCTOBER:", text.includes("OCTOBER"));
console.log("Contains NOVEMBER:", text.includes("NOVEMBER"));

// Find TREASURES positions
const treasuresGlobal = new RegExp(SEGMENT_RE.treasures.source, "gi");
const treasuresPositions = [];
let tm;
while ((tm = treasuresGlobal.exec(text))) treasuresPositions.push(tm.index);
console.log(`\nTREASURES headings found: ${treasuresPositions.length}`);

// Find week banners
WEEK_RE.lastIndex = 0;
const banners = [];
let m;
while ((m = WEEK_RE.exec(text))) {
  const startDay = parseInt(m[2], 10);
  const endDay   = parseInt(m[4], 10);
  if (startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31) continue;
  banners.push({ text: m[0].trim(), startMonth: m[1].toUpperCase(), startDay, endMonth: (m[3]??m[1]).toUpperCase(), endDay });
}
console.log(`Week banners found: ${banners.length}`);
banners.forEach(b => console.log("  ", b.text));

// Segment detection per week
console.log("\n=== Segment detection per week ===");
for (let i = 0; i < treasuresPositions.length; i++) {
  const sliceStart = i > 0 ? treasuresPositions[i - 1] : 0;
  const sliceEnd   = i + 1 < treasuresPositions.length ? treasuresPositions[i + 1] : text.length;
  const slice = text.slice(sliceStart, sliceEnd);
  const hasT = SEGMENT_RE.treasures.test(slice);
  const hasM = SEGMENT_RE.ministry.test(slice);
  const hasL = SEGMENT_RE.living.test(slice);
  console.log(`Week ${i + 1}: T=${hasT} M=${hasM} L=${hasL}`);
}
