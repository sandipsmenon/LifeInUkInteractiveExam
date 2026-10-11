# Life in the UK — personal revision system

A private, single-user study site that turns your own mock-test notes (a Word document of highlighted
questions and answers) into a revision system: question bank, eight practice modes, spaced repetition,
weak-area targeting, memory-training drills, progress analytics, and a safe import workflow for each new
batch of mock tests (built to grow from 3 to 40+ mock exams).

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · PostgreSQL (Supabase recommended) ·
deployed on Vercel.

---

## Contents

1. [What's in the app](#whats-in-the-app)
2. [Your initial dataset](#your-initial-dataset)
3. [Architecture & data model](#architecture--data-model)
4. [Local development](#local-development)
5. [Deploying to Vercel with Supabase](#deploying-to-vercel-with-supabase)
6. [Importing future mock exams](#importing-future-mock-exams)
7. [Backups](#backups)
8. [Testing](#testing)
9. [Security notes](#security-notes)
10. [Design decisions](#design-decisions)

---

## What's in the app

| Area | What it does |
| --- | --- |
| **Dashboard** | Totals, mock exams imported, practice accuracy, original mock scores, mastered / learning / needs-revision counts, weakest categories and topics, 14-day activity, recent sessions, and ranked "what to study next" recommendations. Everything is computed from your data. |
| **Question bank** | Search and filter by category, topic, mock exam, import batch, revision status, personal difficulty, question type, and markers (important, confusing, flagged, edited, wrong-in-mock). Sort by exam order, hardest, most practised, due date. Bulk-assign questions to a mock exam. |
| **Question editor** | Edit wording, options, correct answers, explanation, categories, topics, notes and memory aids; mark important or confusing; flag possible errors. The **original imported text is kept** and can be restored. Changing a correct answer regrades past attempts. |
| **Practice** | Quick · Category · Mock exam (by exam or import batch) · Weak areas (with "why this question?") · Revision (due now) · Rapid recall · Mixed · Exam simulation (24 questions, 45 min, 18/24 to pass). Optional confidence rating, reveal-then-self-mark, override a mis-tap, flag a question, keyboard shortcuts, resume an unfinished session. |
| **Memory training** | Date timeline (ordering + match event to date) · Number drill (typed recall) · Name recall · Question↔answer matching · Similar-fact comparison · Flashcards (Again/Hard/Good/Easy). Generated only from your questions; each item links to its source question. |
| **Progress** | Accuracy by category and by mock exam, right-first-time rate, retention by week, frequently missed and repeatedly-wrong questions, daily practice with table view, and session-over-session change. |
| **Import** | Upload `.docx` (or `.md`/`.txt`) → confirm how it was read → review/edit/approve each record → import, with a report of imported, skipped, duplicate and flagged records. |
| **Backup** | Full JSON backup (questions, originals, history, schedules, flags), CSV export, merge-restore, and per-batch deletion. |

### How weak-area revision works (explainable spaced repetition)

`src/lib/srs.ts` contains the whole algorithm (a lightly modified SM-2):

- **Wrong answer:** streak resets, interval resets, the question is due again in 10 minutes, and its "ease" drops.
- **Correct answer:** next review in 1 day, then 3 days, then the previous gap × ease (≈2.5).
- **Confidence:** a correct *guess* is treated as barely known (due tomorrow). *Unsure* shortens the gap by 30%. *Sure* raises the ease slightly.
- **Repeats in one sitting** are recorded but do not speed up the schedule, so drilling a question five times in a row can't fake mastery.
- **Mastered:** 3+ correct in a row, a gap of 7+ days, and the last answer was not a guess.

Weak-areas mode ranks questions by: wrong last time (+40), each time forgotten (+15, capped), low hit rate,
wrong in your original mock and not yet answered correctly here (+25), days overdue, a correct guess or
uncertainty last time, a long time since the last correct recall, a "confusing" flag. Consecutive correct
answers lower the score. Each question shows its reasons in the practice screen.

The schedule is **derived from the attempt log** (replayed in order), so it can't drift out of sync after
edits or overrides.

---

## Your initial dataset

`data/initial/LifeInUk-mock-1-8.md` is your Word document for mock tests 1–8 (192 questions, 24 per test; the earlier 75-question version is kept as `LifeInUk-mock-1-3.md` for the tests) (exported as Markdown). It
contains **75 questions**: correct options are in bold, and each question has a *Correct*/*Incorrect* line
recording your mock-test result (33 correct, 42 incorrect), followed by an explanation.

What the importer found, and what still needs your input:

- All 75 questions parse with every question/answer pair intact. There are 6 multiple-answer questions and
  5 true/false questions, and no parsing errors.
- **The document has no "Mock test 1/2/3" headings**, so the importer cannot know where one test ends and
  the next begins. It does not guess. You can:
  - choose *Split in order: every N questions* on the import screen (75 = 3 × 25, if each of your tests had 25), or
  - import them unassigned and use **Question bank → Not assigned → select → Assign to Mock N**
    (question numbers follow the document order).
- Your *Correct*/*Incorrect* results are kept as each question's *original mock result*. They feed the
  weak-area ranking and the mock-score figures. They are **not** counted as practice attempts.
- The text is imported exactly as written. A few things you might want to correct yourself (use
  *Flag* or *Edit*; the original stays available):
  - the options say "Camila" (Queen Camilla);
  - one option reads "April's Fool Day", but the explanation says "April Fool's Day";
  - "When did the Conservative government called a referendum…" (grammar).
- The importer reads the `.docx` format directly. It was tested against generated Word files built from
  this same content (bold, highlight, bullet lists and headings). When you upload the real `.docx` of your
  next batch, check the preview screen carefully the first time.

---

## Architecture & data model

```
src/
  app/                    pages (server components) and API route handlers
  components/             UI (practice runner, import wizard, editors, training drills)
  lib/
    parser/               .docx + Markdown → paragraphs → questions (format-agnostic)
    categorize.ts         rule-based categories and topic tags (explainable regexes)
    srs.ts                spaced repetition, revision priority, difficulty
    facts.ts              memory-training item extraction (dates, numbers, names, look-alikes)
    server/               database access: questions, importer, practice, stats, backup
    auth/session.ts       password login + HMAC-signed cookie
  proxy.ts                auth + CSRF origin check on every request (Next 16 "proxy", formerly middleware)
migrations/               plain SQL migrations, applied in order
data/initial/             your initial dataset
scripts/                  migrate / seed
tests/                    unit + database integration tests, end-to-end smoke test
```

The schema (`migrations/0001_init.sql`) keeps separate layers:

| Layer | Tables |
| --- | --- |
| Source content | `import_batches` (file hash, interpretation, stats) · `questions` (prompt, options JSON, correct keys, explanation, mock exam + question number, document position, original mock result, **immutable `original` snapshot**, content hash) · `mock_exams` (1–40 pre-created, more on demand) |
| Categorisation | `categories` · `question_categories` (auto vs manual source) · `questions.topics` |
| Practice | `practice_sessions` (mode, config, ordered question ids, time limit) · `attempts` (selected keys, correct?, confidence, self-marked, response time) |
| Scheduling | `review_states` (ease, interval, due date, streak, lapses, status), derived from attempts |
| Data quality | `question_flags` (possible error / confusing / duplicate, resolvable) |

Duplicate protection uses `questions.content_hash`, a hash of the normalised prompt plus the
order-independent set of options. It has a unique index, so a duplicate cannot be inserted even by two
simultaneous imports. Re-uploading the same file is detected by `import_batches.file_hash`. Indexes cover
exam/question lookups, categories, topics (GIN), attempts per question, due dates and status. For a
1,000-question bank every page needs only a handful of indexed queries.

---

## Local development

Requirements: Node.js 20.9+ and a PostgreSQL 14+ database (local Postgres, Docker, or a free Supabase project).

```bash
npm install
cp .env.example .env.local          # then edit the values
# e.g. local Postgres:  DATABASE_URL="postgres://user:pass@localhost:5432/lifeuk"
npm run db:migrate                  # creates the schema (also runs automatically on first request)
npm run dev                         # http://localhost:3000
```

Then open **Import → Preview initial dataset** to review and import your 75 questions. Or run
`npm run db:seed` to import them without the review screen (safe to repeat).

If `APP_PASSWORD` is not set, **development** runs without a login. Production always requires it.

Useful scripts: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

---

## Deploying to Vercel with Supabase

> These steps need your own accounts. Deployment was **not** performed from this repository's build
> environment because no Vercel or Supabase credentials were available. The production build, migrations
> and full workflow were verified locally against PostgreSQL 16.

### 1. Create the database (Supabase)

1. Sign in at <https://supabase.com> → **New project**. Choose a region near you (e.g. *London, eu-west-2*) and a strong database password (save it in your password manager).
2. When it's ready, open **Connect** (top bar), or **Project Settings → Database → Connection string**.
3. Copy the **Transaction pooler** URI (port **6543**). It looks like
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`.
   Replace `[YOUR-PASSWORD]` with the database password.
4. Optional but recommended: in **Project Settings → Database → SSL Configuration** download the CA
   certificate and paste its contents into `DATABASE_CA_CERT` (below) to verify the server certificate.

You don't need to run SQL by hand. The migrations run during the Vercel build (`vercel-build` script), and
again automatically on first request if needed. To run them yourself:
`DATABASE_URL="…" npm run db:migrate`.

> The app connects server-side only and never exposes the database to the browser, so Supabase's public
> API keys are not used. Supabase's Data API (PostgREST) can be disabled in **Project Settings → API** for
> extra safety; the app doesn't need it.

### 2. Push the code to GitHub

This repository is already GitHub-ready (`.env*` files are git-ignored; only `.env.example` is committed).

### 3. Create the Vercel project

1. Go to <https://vercel.com/new> → **Import Git Repository** → pick this repository.
2. Framework preset: **Next.js** (auto-detected). Leave the build command alone. Vercel automatically
   uses `npm run vercel-build`, which runs migrations and then `next build`.
3. Under **Environment Variables**, add for *Production* (and *Preview* if you use preview deployments):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | the Supabase transaction-pooler URI from step 1 |
   | `APP_PASSWORD` | the password you'll use to sign in (long passphrase) |
   | `AUTH_SECRET` | 64 random hex characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `DATABASE_CA_CERT` | *(optional)* the Supabase CA certificate PEM |

4. Click **Deploy**.

### 4. Verify the deployment

1. Open `https://<your-project>.vercel.app/api/health`. It should return `{"ok":true,"database":"ok"}`.
2. Open the site, sign in with `APP_PASSWORD`, go to **Import → Preview initial dataset**, review, and import.
3. Answer a few questions, refresh, and open the site on your phone. Your progress should be there.
4. Optionally run the end-to-end smoke test against the live site using a **fresh, empty database** (it
   imports the dataset through the UI):
   `BASE_URL=https://<your-project>.vercel.app APP_PASSWORD=… node tests/e2e/smoke.mjs`

Troubleshooting:
- *503 "This site is not configured"*: `APP_PASSWORD` or `AUTH_SECRET` (32+ chars) is missing in Vercel.
- *Health check says unreachable*: check `DATABASE_URL` (password, port 6543, project ref). Look at
  **Vercel → Deployments → Functions logs**.
- *TLS errors with `DATABASE_CA_CERT`*: paste the full PEM including the BEGIN/END lines. You can use `\n`
  for line breaks.

---

## Importing future mock exams

1. Keep using your Word document the same way: the question, the options as a **bulleted list**, the correct
   option(s) in **bold** (or highlighted), then optionally *Correct*/*Incorrect* and the explanation.
2. **Tip:** put a heading line such as `Mock Test 4` before each test. Questions are then assigned to the
   right exam and numbered Q1, Q2, … automatically.
3. You can upload a document with only the new tests, or your whole growing document. Questions already in
   your bank are recognised (same wording and options) and skipped, so nothing is duplicated and existing
   progress, edits and categories are untouched.
4. On **Import**:
   - Check *How are correct answers marked?* If the document mixes bold and highlight, the importer says so
     and asks you to choose.
   - Check *Which mock exam?* Use the headings, a single exam number, or split in order every N questions.
   - Review records. Use the *Issues* tab: errors (e.g. no answer marked) are unticked by default; open
     *Fix this record* to correct them. *Duplicates* are unticked by default.
   - Tick the confirmation box and import. The report shows imported / skipped / duplicates / flagged.
     Records imported with warnings get a flag, so you can find them later under *Question bank → Flagged*.
5. Uploading exactly the same file twice is detected and needs an explicit confirmation.
6. If a batch went wrong: **Backup → Import batches → Delete batch** removes it and its questions. Then
   re-import.

Supported formats: `.docx` (Word 2007+), `.md`, `.txt`. Old `.doc` files must be re-saved as `.docx`.
Uploads are limited to 5 MB, parsed in memory and never stored.

---

## Backups

- **Backup → Download full backup (.json)** exports every table: questions, original imported text,
  categories, attempts, schedules and flags. Do this before big imports and every so often.
- **Questions as spreadsheet (.csv)** for reading or printing.
- **Restore** merges a backup into the database and never overwrites existing rows, so it's safe to repeat
  and useful for moving to a new database.
- Supabase also takes automatic daily database backups on paid plans. On the free plan, rely on the JSON
  export, or `pg_dump "$DATABASE_URL" > backup.sql`.

---

## Testing

```bash
# unit + integration tests (needs a database whose name ends in _test; it is wiped)
createdb lifeuk_test
TEST_DATABASE_URL="postgres://user:pass@localhost:5432/lifeuk_test" npm test

# end-to-end smoke test (desktop + mobile) against a running server with an EMPTY database
npm run build && DATABASE_URL=… APP_PASSWORD=… AUTH_SECRET=… npm start &
BASE_URL=http://localhost:3000 APP_PASSWORD=… node tests/e2e/smoke.mjs   # uses playwright-core + Chromium
```

What's verified:
- the initial dataset parses to 75 intact question/answer pairs, and `.docx` input (bold or highlighted
  answers, bullet lists, mock headings) parses identically;
- ambiguous marking is reported rather than guessed;
- re-importing creates no duplicates, and the same file needs confirmation;
- category and search filters return the expected questions;
- correct and incorrect answers update attempts, schedule, status and dashboard figures;
- weak-area mode ranks repeatedly-missed questions first, with reasons;
- edits keep the original snapshot and regrade history;
- backup → restore round-trips into an empty database;
- through the browser: login, import, practice, exam simulation (with refresh), training drills, editing,
  progress, backup download, persistence across sessions, and no horizontal overflow at 390 px mobile width.

---

## Security notes

- Every page and API route requires sign-in (`src/proxy.ts`). The session cookie is httpOnly, `SameSite=Lax`,
  `Secure` in production, HMAC-SHA256 signed, and valid for 30 days. Wrong passwords are slowed down.
- Mutating API requests from another origin are rejected (CSRF protection).
- Database credentials live only in server-side environment variables. Nothing secret is committed, and
  the database is never exposed to the browser.
- All inputs are validated with Zod. SQL is fully parameterised. Uploads are size-limited and parsed in
  memory with a decompressed-size guard against zip bombs.
- Security headers: no framing, `nosniff`, strict referrer, HSTS, `noindex`.
- CSV exports are protected against spreadsheet formula injection.

---

## Design decisions

- **Postgres via `pg`, not the Supabase JS client.** Plain SQL keeps the schema, migrations and queries
  explicit and portable (any Postgres works: Supabase, Neon, RDS, local). Supabase is recommended only as a
  convenient managed Postgres.
- **One password instead of full user accounts.** This is a personal study site. A single signed-cookie
  password is simpler and has fewer moving parts than an OAuth or magic-link setup, while still protecting
  the data on the public internet. Multi-user support would need a `user_id` on attempts, sessions and
  review states.
- **Native, semantic HTML controls with Tailwind** rather than a component library. Buttons, radio/checkbox
  roles, labels, focus rings, `aria-*` and keyboard shortcuts give accessible controls without an extra
  dependency.
- **Classic dynamic rendering** (`cacheComponents: false`): every page shows private, per-request data, so
  nothing is cached or prerendered.
- **Browser storage is never the source of truth.** It holds only a UI preference and in-progress exam
  answers (restored after a refresh). All results are saved in the database.

---

## Hosted version (claude.ai Artifact)

`artifact/` holds a single-page build of the same app that runs as a private claude.ai Artifact. It needs no
server, database account or hosting. It reuses the parser, categoriser, scheduler and drill logic from
`src/lib`, and stores data in the Artifact's own database (readable and writable only by its owner).

- Build: `node artifact/build.mjs` → `artifact/dist/life-in-uk-revision.html` (React, ReactDOM and JSZip load from cdnjs).
- Seed documents for the initial dataset: `npx tsx artifact/seed.ts <out-dir>`.
- Differences from the Next.js version: `.docx` files are read in the browser; there is no password page,
  because access is your claude.ai login; backups are JSON/CSV files from the Backup page.
