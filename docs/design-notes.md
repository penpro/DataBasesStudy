# Design notes

Why the database looks the way it does. Read this to be able to *explain* the project, not just redraw it.

## Third normal form, applied

Rule of thumb: every column describes the key, the whole key, and nothing but the key; nothing derivable is stored.

| Decision | Why it is 3NF |
|---|---|
| `unit` -> `card` -> `question` are three tables | A card's unit and a question's card are facts about the card / question, not repeated on every row below. Change a unit's title in one place. |
| A question's **format** (single / multi / written) is not a column | It is derived from its `choice_option` rows (none = written, one correct = single, several = select all). Storing it could contradict the options. |
| `tag_group` split from `tag` | A tag's group ("Concepts", "Question type") is a fact about the tag, so it lives with the tag, not on every `question_tag` row. |
| `question_tag`, `learner_unit_unlock` are junction tables | Many-to-many relationships need their own table with a composite primary key; a comma-separated column would break the first normal form. |
| Counts, accuracy, streaks, unit mastery are never stored | They are computed from `attempt` / `question_state` by queries (`reports.sql`), so they cannot disagree with the data. |
| `learner` holds settings | Settings depend only on the learner's key; fine in the same row. |

## attempt versus question_state

- `attempt` is an **append-only event log**: one row per answer, never updated.
- `question_state` is the **current standing** per (learner, question): Leitner box, streak, due date.
  It is technically derivable from the log, and is kept as a deliberate, documented cache so the page does not replay
  the whole history on every load. Both are written in **one transaction**, and a test replays the log through
  `engine.js` and checks it rebuilds `question_state` exactly, so the cache can be trusted.

## Questions you should be able to answer

**Why is `FOREIGN KEY` written as its own clause?** MySQL silently ignores an inline `col INT REFERENCES t(id)`.
Only the separate `FOREIGN KEY (...) REFERENCES ...` clause is enforced. I found this the hard way, then proved
enforcement with probe inserts that are rejected (`test/schema.test.js`).

**`ON DELETE CASCADE` or not?** Learner-owned rows (`attempt`, `question_state`, `flag`, `mock_exam`, unlocks) cascade:
deleting a learner removes their data. A question's own parts (`choice_option`, `question_tag`) cascade with it, but
`attempt`, `question_state`, `flag` and `mock_exam_question` do not cascade from `question`: you cannot delete a
question that someone has answered by accident.

**Why a transaction per answer, and why `SELECT ... FOR UPDATE`?** An answer touches two tables (log + state) and the
state depends on the previous state. The transaction makes both writes succeed or fail together. `FOR UPDATE` locks the
learner's row, so two answers arriving at the same instant are handled one after the other instead of both reading the
old state (a lost update). `test/api.test.js` fires concurrent answers to prove it.

**Why `INSERT ... ON DUPLICATE KEY UPDATE` and not `INSERT IGNORE`?** `INSERT IGNORE` turns errors, including
foreign-key violations, into silent warnings. A test caught it letting a nonexistent unit through, so it was replaced.

**What are the CHECK constraints for?** Rules the database enforces no matter which program writes (box 1 to 6,
streak setting 2 to 5, threshold .50 to .98, exam minutes above 0, exam finish not before start). Six in total.

**Why migrations?** Each schema change is a numbered file applied once, in order; `schema_migrations` records the
name and a checksum, and the runner refuses to run if an applied file was edited. Anyone can rebuild the database
from nothing with `npm run migrate`.

**Why named SQL files?** `db/queries/*.sql` keeps every statement in plain SQL, readable on its own and labeled
`-- name: ...`; `server/queries.js` loads them and throws on an unknown name, so a typo fails loudly. All values are
passed as `?` parameters, so user input is never part of the SQL text (checked by a test that sends an injection string).

**Why one `engine.js` for browser and server?** The scheduling rules exist in exactly one file. The browser uses it
for an instant screen update; the server uses it for the stored result. The database's answer is the one the page keeps.

**Why a least-privilege user?** The app connects as `cs330_app`, which can touch only the two project databases, not
the whole MySQL server. The server listens on `127.0.0.1` only.

## What I would do next (honest limits)

- One local learner (`wes`) today; the schema already supports many, but there is no login.
- No pagination on the bank endpoint (280 questions is small enough).
- The course question files are downloaded from the course website; the tool credits Dr. Foster's course page.

## About AI use

The course allows AI for the project and for studying, not on the exam. The point of this document and
[final-exam-study-sheet.md](final-exam-study-sheet.md) is that I can redraw and explain every part without help.
