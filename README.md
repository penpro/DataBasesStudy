# CS 330 Study Tool (database edition)

A local web tool that quizzes you on the CS 330 question bank (280 questions, 52 cards, 13 units) with spaced
repetition. The questions, every answer you give, and your progress live in a **MySQL** database (third normal form,
built by migrations); a small Express API sits between the page and the database.

Final project for CS 330 (Databases). The question bank is from Dr. Foster's course:
<https://srfoster.github.io/oc-classes/page.html?class=cs330&page=homepage>.

## Start here if you are studying for the final

[docs/final-exam-study-sheet.md](docs/final-exam-study-sheet.md): the filled-out exam (what the system does, diagrams
for Weeks 7 to 10, the SQL answer) plus drills. Supporting pages: [er-diagram.md](docs/er-diagram.md),
[system-diagram.md](docs/system-diagram.md), [design-notes.md](docs/design-notes.md).

## Setup

Needs Node 24+ and MySQL 8.4.

```bash
mysql -u root -p < db/setup.sql      # creates cs330_study, cs330_study_test and the cs330_app user
cp .env.example .env                 # then set DB_PASSWORD to the password used in db/setup.sql
npm install
npm run migrate                      # builds the tables from db/migrations/
npm run import                       # loads the question bank from data/
npm start                            # http://127.0.0.1:3340
```

## Commands

| Command | What it does |
|---|---|
| `npm run migrate` / `npm run migrate:status` | apply pending migrations / show which are applied |
| `npm run import` | load units, cards, questions, tags and options (safe to run again) |
| `node scripts/fetch-bank.js` | re-download the course question files into `data/yaml/`, then `npm run import` |
| `npm start` | API and study page on 127.0.0.1 only |
| `npm test` | 40 tests against the separate `cs330_study_test` database |
| `npm run db:reset` | drop every table, re-migrate and re-import the bank (**erases all progress**) |

## Layout

```
db/migrations/   numbered schema changes (001 to 007)
db/queries/      named SQL statements the API runs
db/setup.sql     one-time database and user creation
scripts/         migrate, import-bank, fetch-bank, reset-db
server/          Express API (app.js), data layer (store.js), pool (db.js), shared rules (engine.js)
web/             the study page (served by the API)
data/            question files, answer choices, unit titles
test/            integration tests (schema, import, API)
docs/            diagrams, study sheet, design notes
```
