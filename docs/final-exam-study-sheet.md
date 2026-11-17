# CS 330 final exam: filled-out study sheet

Project: **CS 330 Study Tool** (this repo). Exam source: the course "final exam" page (closed book, 40% of the grade,
answers are compared to this GitHub repo).

**How to use this sheet.** It is the answer key *and* the drill. Read a section, cover it, redraw or rewrite it from
memory on blank paper, then check. Every claim here can be checked in the repo; the file names are given so you can.

> **Things to confirm before you rely on this sheet** (marked **[CONFIRM]** below).
> The Week 9 and Week 10 diagrams show what the repo really contains. Which pieces belong to which week is my split
> by dependency order (the schema first, the app after); compare it with your own git history
> (`git log --date=short --format="%ad %s"`) and move things if your real order was different.
> Weeks 7 and 8 predate the database: the tool was a static website then (see those diagrams).
> Draw what you actually had; do not draw tables you did not have yet.

---

## 1(a) What the system does, in one sentence

> A web study tool that quizzes me on the 280 CS 330 questions with spaced repetition, and keeps the question bank,
> every answer I give, and my progress in a MySQL database that a small API reads and writes.

Shorter fallback if you blank: *"It teaches me the course questions and remembers what I got wrong, using a database."*

---

## 1(b) Diagrams at the end of Weeks 7, 8, 9 and 10

Notation for the hand drawings: boxes for apps/scripts, a cylinder (or `(( ))`) for the database, **arrows labeled with
what they do**, and **`*NEW*`** on everything added that week. Entities are written `table (PK, other columns)`;
`PK` primary key, `FK` foreign key, `──<` is "one to many" (the `<` end holds the foreign key).

### Week 7: static study tool, no database yet

```
  [Course website]                         [Browser: study page]
   question files  ──download (by hand)──>   index.html + app.js + engine.js
                       |                         |
                       v                         |  reads questions
              questions.js (a file)  ────────────┘  (loaded as a script)
                                                |
                                                |  saves my progress
                                                v
                                       [localStorage in the browser]
                                       (one blob of JSON, no tables)
```

**What changed and why:** Built the first version of the study tool as plain files: questions in a data file, progress in
the browser's `localStorage`. Nothing relational yet, which is exactly the problem the database later fixes
(no structure, no constraints, one browser only). **[CONFIRM against what you had in Week 7.]**

### Week 8: same tool, put on the website, still no database

```
  (everything from Week 7)

  [Browser] ──HTTPS GET──> [nginx on EC2 server]  *NEW*
                              serves the static files
  [deploy script]  *NEW*  ──copy files──> [server]
```

**What changed and why:** Published the tool on my website (nginx serves the files, a deploy script copies them), so I
could study from any computer. Progress still lived only in each browser, which showed that the data needs a real
home: a database. **[CONFIRM.]**

### Week 9: the database exists (schema, migrations, import)

ER diagram (new parts marked):

```
  unit ──< card ──< question ──< choice_option                *NEW*
  (PK unit_id,        (PK card_no,   (PK question_id,         (PK option_id,
   title UK, blurb)    FK unit_id)    code UK, FK card_no,     FK question_id,
                                      prompt, answer)          text, is_correct)

                      question ──< question_tag >── tag >── tag_group       *NEW*
                                   (PK question_id+tag_id)  (PK tag_id,     (PK tag_group_id,
                                                             FK tag_group_id) name)

  learner  (PK learner_id, username UK, mode, ramp,         *NEW*
            master_streak CHECK 2..5, unlock_threshold CHECK .50..98)
  learner ──< learner_unit_unlock >── unit                  *NEW*
```

System diagram:

```
  [Course website] ──download question files──> [fetch-bank.js] *NEW* ──write──> [data/ YAML + choices.json]
                                                                                        |
                                                                                    read|
                                                                                        v
  [db/migrations/*.sql] ──read──> [migrate.js] *NEW* ──CREATE TABLE──>  (( MySQL cs330_study )) *NEW*
                                                                                        ^
                              [import-bank.js] *NEW* ──INSERT/UPDATE units, cards, ─────┘
                                                        questions, tags, options (one transaction)
```

**What changed and why:** Added the relational database: the course content split into `unit`, `card`, `question`,
`choice_option`, `tag_group`, `tag`, `question_tag` (third normal form, so nothing is stored twice and the question format
is *derived* from its options, not stored), plus `learner` and `learner_unit_unlock`. The schema is built by numbered
migrations (001 to 004) that `migrate.js` applies once each, and `import-bank.js` loads the questions in one transaction
so a failed import leaves nothing half-loaded. **[CONFIRM which of these were done by the end of Week 9.]**

### Week 10: the app runs on the database (final system)

ER diagram (full schema; new tables marked):

```
  THE BANK (from Week 9)
    unit ──< card ──< question ──< choice_option
                         └──< question_tag >── tag >── tag_group

  ONE LEARNER (all *NEW* this week, all pointing back at the bank)
    learner ──< attempt >── question                 attempt: PK attempt_id, FK learner_id,
       |                                                       FK question_id, correct, answered_at
       ├──< question_state >── question              PK (learner_id, question_id), box CHECK 1..6, streak, due_at...
       ├──< flag >── question                        PK (learner_id, question_id)
       ├──< learner_unit_unlock >── unit             (from Week 9)
       └──< mock_exam ──< mock_exam_question >── question
```

System diagram (the numbers **1** and **2** mark where the exam code lives, see question 2):

```
  [Browser: study page]  *NEW wiring*
     |  ^
     |  | JSON: questions, my state, reports
     |  |
     |  GET bank and state; POST each answer; POST mock exam;
     |  PUT/DELETE flags and unlocks; PATCH settings; DELETE progress
     v  |
  [API server: Express (server/)]  *NEW* ── loads named queries ── [db/queries/*.sql]
     |                          \                                      ◄── 2 = attempts.sql
     |  SELECT/INSERT/UPDATE/DELETE;           [engine.js: spaced-repetition rules,
     |  one answer = one locked transaction     same file runs in browser and API]
     v
  (( MySQL cs330_study ))  ◄── CREATE TABLE ── [migrate.js] ◄── [db/migrations/*.sql]
                                                                      ◄── 1 = 005_create_attempt.sql
     ^
     |  INSERT/UPDATE the bank (from Week 9)
  [import-bank.js]  ◄── [data/]  ◄── [fetch-bank.js]  ◄── [Course website]

  [test suite] *NEW* ──run the real API and scripts──> (( MySQL cs330_study_test ))
```

**What changed and why:** Added everything that records what I do: `attempt` (a log, one row per answer),
`question_state` (where I stand on each question, kept in the *same transaction* as the log row), `flag`, and the
mock-exam tables. Added the API server so the browser no longer keeps its own data, and the Dashboard reports
(streaks, unit mastery, weakest topics, most-missed questions), which are computed by queries and never stored. Added a test suite
(43 tests) that runs against a separate test database, so I can prove constraints and transactions really work.

Prettier versions of both Week 10 diagrams (Mermaid, GitHub draws them): [er-diagram.md](er-diagram.md) and
[system-diagram.md](system-diagram.md).

---

## 2. One SQL file from the project, written out

Two small files that belong together: the table definition (Migration 005) and the queries that use that table.
Rewrite them from memory; the exact spelling is less important than getting every labeled part in.

### File A: `db/migrations/005_create_attempt.sql`

```sql
CREATE TABLE attempt (
  attempt_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  learner_id  INT UNSIGNED    NOT NULL,
  question_id INT UNSIGNED    NOT NULL,
  correct     BOOLEAN         NOT NULL,
  answered_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (attempt_id),                                   -- (A1) PRIMARY KEY
  CONSTRAINT fk_attempt_learner  FOREIGN KEY (learner_id)     -- (A2) FOREIGN KEY
      REFERENCES learner (learner_id) ON DELETE CASCADE,
  CONSTRAINT fk_attempt_question FOREIGN KEY (question_id)
      REFERENCES question (question_id)
) ENGINE=InnoDB;
```

(The real file also has two `KEY` index lines for speed; leaving them out of the exam answer is fine.)

### File B: `db/queries/attempts.sql`

```sql
-- (B1) WHERE: how many answers a learner has given
SELECT COUNT(*) AS clock FROM attempt WHERE learner_id = ?;

-- (B2) INSERT: log one answer
INSERT INTO attempt (learner_id, question_id, correct) VALUES (?, ?, ?);

-- (B3) JOIN + GROUP BY with an aggregate: the questions missed most
SELECT q.code, COUNT(*) AS misses
  FROM attempt a
  JOIN question q ON q.question_id = a.question_id
 WHERE a.learner_id = ? AND a.correct = 0
 GROUP BY q.question_id, q.code
 ORDER BY misses DESC, q.code
 LIMIT 10;

-- (B4) Subquery: how many questions never answered
SELECT COUNT(*) AS never_attempted
  FROM question q
 WHERE NOT EXISTS (SELECT 1 FROM attempt a
                    WHERE a.learner_id = ? AND a.question_id = q.question_id);
```

(The `?` marks are filled in by the program, so the values can never be mistaken for SQL code.)

### Where it lives on the Week 10 diagram

- **1** = `005_create_attempt.sql`, run once by **migrate.js**, creating the `attempt` table **in MySQL**.
- **2** = `attempts.sql`, loaded by the **API server**, whose queries run **against MySQL** (the arrow between the API and the database).

### What each construct is and why it is there

| # | Construct | One or two sentences |
|---|---|---|
| A1 | **Table definition + primary key** | `CREATE TABLE attempt` defines the log of answers. `attempt_id` is the primary key: it uniquely names each row and `AUTO_INCREMENT` makes MySQL hand out the next number, so two identical answers are still two rows. |
| A2 | **Foreign key** | `learner_id` must match a row in `learner`, and `question_id` a row in `question`, so an answer can never point at a person or question that does not exist. `ON DELETE CASCADE` on the learner means deleting a learner also deletes their answers; the question side has no cascade, so a question that has answers cannot be deleted by accident. |
| B1 | **WHERE** | Keeps only the rows for one learner, then `COUNT(*)` counts them. That count is the "logical clock" the spaced-repetition rules use to decide when a question is due again. |
| B2 | **Data-changing statement (INSERT)** | Adds one row to the log each time I answer. The API runs it in the same transaction as the `question_state` update, so both happen or neither does. |
| B3 | **Join + GROUP BY aggregate** | The join attaches each attempt to its question's code; `WHERE` keeps only this learner's wrong answers; `GROUP BY` makes one group per question; `COUNT(*)` counts misses in each group; so the result is a "most missed questions" list for the Dashboard. |
| B4 | **Subquery** | The inner `SELECT` is run per question and asks "did this learner ever answer it?"; `NOT EXISTS` keeps the questions where the answer is no, and the outer query counts them. |

### Why attempt is built this way (be ready if asked)

- It is an **event log**: rows are only ever added. Streaks, accuracy and counts are *computed* from it, never stored,
  so they can never disagree with the log (this is the third-normal-form reason: no value that is derivable is stored).
- The **current standing** (box, streak, due date) *is* stored, in `question_state`, because recomputing the rules over
  a long log on every page load would be slow. It is a cache of the log, and one test replays the whole log through
  `engine.js` and proves it rebuilds `question_state` exactly.

---

## Self-test drills

Do these on paper with the sheet covered.

1. **Say** the one sentence from 1(a).
2. **Draw** the 14 tables as boxes from memory and connect them with `──<`. Check against the Week 10 ER drawing.
   Hardest to remember: the five tables with a two-column primary key (`question_tag`, `learner_unit_unlock`,
   `question_state`, `flag`, `mock_exam_question`).
3. **Draw** the system diagram and label every arrow with a verb (download, read, INSERT, migrate, GET/POST, ...).
4. **Write** File A from memory. Check: primary key present? two foreign keys with `REFERENCES`? Each column `NOT NULL`?
5. **Write** B1 to B4 from memory. For each, say its label out loud: WHERE, INSERT, join, GROUP BY + aggregate, subquery.
6. **Explain** the life of one answer in ten steps ([system-diagram.md](system-diagram.md), bottom).
7. **Answer cold:**
   - Why is the format of a question not stored? (derivable from `choice_option` rows: 3NF)
   - Why is `question_tag` its own table? (many-to-many needs a junction table with a composite primary key)
   - What does a foreign key prevent? (rows pointing at rows that do not exist)
   - What is a migration and why numbered? (an ordered, one-time schema change; the runner records which have run)
   - Why a transaction when answering? (log row and state row must succeed or fail together)
   - Why `FOR UPDATE`? (two answers arriving at once must not both read the old state)
   - Why `?` placeholders? (the data is never part of the SQL text, so it cannot inject SQL)

More design reasoning: [design-notes.md](design-notes.md).
