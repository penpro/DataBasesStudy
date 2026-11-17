# System diagram: the database in context

Everything that reads or writes the database, and what each arrow does with the data.

```mermaid
flowchart LR
    subgraph OUTSIDE["Outside"]
        COURSE[("Course website<br/>published question files")]
    end

    subgraph FILES["Project files"]
        DATA["data/<br/>questions (YAML),<br/>choices.json, units.json"]
        SQLQ["db/queries/*.sql<br/>named queries"]
        MIGF["db/migrations/*.sql"]
    end

    subgraph APP["Running on the computer"]
        BROWSER["Browser<br/>the study page (web/)"]
        API["API server<br/>Express (server/)"]
        ENGINE["engine.js<br/>spaced-repetition rules<br/>(same file used by both)"]
        FETCH["fetch-bank.js"]
        IMPORT["import-bank.js"]
        MIGRATE["migrate.js"]
        TESTS["test suite"]
    end

    DB[("MySQL<br/>cs330_study")]
    TESTDB[("MySQL<br/>cs330_study_test")]

    COURSE -- "download question files" --> FETCH
    FETCH -- "write" --> DATA
    DATA -- "read" --> IMPORT
    IMPORT -- "INSERT or UPDATE units, cards,<br/>questions, tags, options<br/>(one transaction)" --> DB
    MIGF -- "read" --> MIGRATE
    MIGRATE -- "CREATE TABLE,<br/>record applied migrations" --> DB

    BROWSER -- "GET the bank and my state<br/>POST each answer, mock exam<br/>PUT / DELETE flags, unlocks<br/>PATCH settings, DELETE progress" --> API
    API -- "JSON: questions, state,<br/>reports" --> BROWSER
    SQLQ -- "loaded by name" --> API
    API -- "SELECT, INSERT, UPDATE, DELETE<br/>an answer = one locked transaction" --> DB
    ENGINE -. "runs inside" .-> BROWSER
    ENGINE -. "runs inside" .-> API

    TESTS -- "run the real API and scripts" --> TESTDB
```

**Numbers for the exam (question 2).** Mark the code you write out on the diagram:

- **1** = `db/migrations/005_create_attempt.sql`: it runs in **migrate.js**, which creates the `attempt` table **in MySQL**.
- **2** = `db/queries/attempts.sql`: it is loaded by the **API server**, which runs its queries **against MySQL** (the arrow from the API to the database).

## The life of one answer

What happens when you click an answer on the page, in order:

1. **Browser.** `app.js` grades the answer (auto for choice questions, your own click for written ones) and
   runs `engine.js` on its own copy of the state, so the screen updates instantly.
2. **Browser to API.** `remote.js` sends `POST /api/learners/me/attempts` with `{ code, correct }`. Changes go out
   one at a time, in order.
3. **API checks the input.** `server/app.js` rejects anything that is not a question code like `c07-4` and a true/false.
4. **Start a transaction.** `store.recordAttempt` begins a transaction and locks your `learner` row (`SELECT ... FOR UPDATE`),
   so two answers can never be processed at the same moment.
5. **Read.** It looks up the question, counts your earlier attempts (that count is your logical clock),
   and reads your current `question_state` row for that question.
6. **Run the rules.** It calls the same `engine.js` the browser used: wrong answer, box 1; right answer, next box;
   three right in a row, mastered; it works out when the question is due again.
7. **Write twice.** `INSERT INTO attempt` (the log) and `INSERT ... ON DUPLICATE KEY UPDATE` on `question_state` (where you stand now).
8. **Commit.** Both writes become permanent together, or neither does (a failure rolls both back).
9. **API to browser.** The new state comes back as JSON; the page keeps it (the database's answer is the one that counts).
10. **Later.** Streaks, mastery per unit, weakest topics and most-missed questions are never stored: the Dashboard
    asks the database to work them out from `attempt` and `question_state` each time (`reports.sql`, `attempts.sql`).
