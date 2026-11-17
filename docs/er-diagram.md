# Entity-relationship diagram

The database is MySQL, in third normal form, built by seven migrations (`db/migrations/`). It has
**14 tables** (plus `schema_migrations`, which only records which migrations were applied),
**17 foreign keys**, and **6 CHECK constraints**.

## The full diagram

GitHub draws this automatically. `PK` is a primary key, `FK` a foreign key, `UK` a unique column.
Crow's feet show how many: `||` exactly one, `o|` zero or one, `|{` one or many, `o{` zero or many.

```mermaid
erDiagram
    UNIT ||--|{ CARD : "has"
    CARD ||--|{ QUESTION : "has"
    QUESTION ||--o{ CHOICE_OPTION : "offers"
    QUESTION ||--o{ QUESTION_TAG : "has"
    TAG ||--o{ QUESTION_TAG : "labels"
    TAG_GROUP ||--|{ TAG : "groups"
    LEARNER ||--o{ LEARNER_UNIT_UNLOCK : "opens"
    UNIT ||--o{ LEARNER_UNIT_UNLOCK : "opened by"
    LEARNER ||--o{ ATTEMPT : "gives"
    QUESTION ||--o{ ATTEMPT : "answered in"
    LEARNER ||--o{ QUESTION_STATE : "has"
    QUESTION ||--o{ QUESTION_STATE : "tracked by"
    LEARNER ||--o{ FLAG : "sets"
    QUESTION ||--o{ FLAG : "flagged in"
    LEARNER ||--o{ MOCK_EXAM : "takes"
    MOCK_EXAM ||--|{ MOCK_EXAM_QUESTION : "lists"
    QUESTION ||--o{ MOCK_EXAM_QUESTION : "appears in"

    UNIT {
        tinyint unit_id PK
        varchar title UK
        varchar blurb
    }
    CARD {
        tinyint card_no PK
        varchar title
        tinyint unit_id FK
    }
    QUESTION {
        int question_id PK
        varchar code UK "the course id, e.g. c07-4"
        tinyint card_no FK
        enum origin
        text prompt
        text prompt_override "reworded prompt for choices"
        text answer
    }
    TAG_GROUP {
        tinyint tag_group_id PK
        varchar name UK
    }
    TAG {
        smallint tag_id PK
        varchar name UK
        tinyint tag_group_id FK
    }
    QUESTION_TAG {
        int question_id PK, FK
        smallint tag_id PK, FK
    }
    CHOICE_OPTION {
        int option_id PK
        int question_id FK
        varchar text "unique within a question"
        boolean is_correct
    }
    LEARNER {
        int learner_id PK
        varchar username UK
        enum mode
        boolean ramp
        tinyint master_streak "CHECK 2 to 5"
        decimal unlock_threshold "CHECK 0.50 to 0.98"
        enum theme
        datetime created_at
    }
    LEARNER_UNIT_UNLOCK {
        int learner_id PK, FK
        tinyint unit_id PK, FK
    }
    ATTEMPT {
        bigint attempt_id PK
        int learner_id FK
        int question_id FK
        boolean correct
        datetime answered_at
    }
    QUESTION_STATE {
        int learner_id PK, FK
        int question_id PK, FK
        tinyint box "CHECK 1 to 6"
        smallint streak
        smallint correct_cnt
        smallint wrong_cnt
        smallint seen_cnt
        boolean mastered
        boolean ever_wrong
        int due_at
        int last_seen
    }
    FLAG {
        int learner_id PK, FK
        int question_id PK, FK
        datetime flagged_at
    }
    MOCK_EXAM {
        int exam_id PK
        int learner_id FK
        varchar scope_label
        smallint minutes "CHECK above 0"
        datetime started_at
        datetime finished_at "CHECK not before started_at"
    }
    MOCK_EXAM_QUESTION {
        int exam_id PK, FK
        int question_id PK, FK
        smallint position UK "unique within an exam"
        boolean correct "NULL until graded"
    }
```

## The same schema, small enough to draw by hand

Only the tables and how they connect. Read `A ──< B` as "one A has many B" and `B >── A` as "each B belongs to one A".
Every `<` is a foreign key stored on the table at the `<` end (the "many" side).

```
THE BANK (the course content)

  unit ──< card ──< question ──< choice_option
                       │
                       └──< question_tag >── tag >── tag_group


ONE LEARNER (progress, all pointing back at the bank)

  learner ──< attempt >── question
     │
     ├──< question_state >── question
     ├──< flag >── question
     ├──< learner_unit_unlock >── unit
     └──< mock_exam ──< mock_exam_question >── question
```

Many-to-many relationships are drawn as a junction table with `>` on both sides:
`question <-> tag` through `question_tag`, and `learner <-> unit` through `learner_unit_unlock`.
Tables whose primary key is made of two columns: `question_tag`, `learner_unit_unlock`, `question_state`, `flag`, `mock_exam_question`.

## One-line purpose of each table

| Table | Primary key | Foreign keys | What it holds |
|---|---|---|---|
| `unit` | `unit_id` | | the 13 units of the course |
| `card` | `card_no` | `unit_id` | the 52 cards; each belongs to one unit |
| `question` | `question_id` | `card_no` | the 280 questions, prompt and reference answer |
| `tag_group` | `tag_group_id` | | 4 groups of tags ("Question type", "Concepts", ...) |
| `tag` | `tag_id` | `tag_group_id` | the 35 tags |
| `question_tag` | `(question_id, tag_id)` | both | which tags label which question (many-to-many) |
| `choice_option` | `option_id` | `question_id` | the answer options of choice questions |
| `learner` | `learner_id` | | a person and their settings |
| `learner_unit_unlock` | `(learner_id, unit_id)` | both | units a learner opened by hand (many-to-many) |
| `attempt` | `attempt_id` | `learner_id`, `question_id` | the log: one row per answer |
| `question_state` | `(learner_id, question_id)` | both | where a learner stands on a question (box, streak, due) |
| `flag` | `(learner_id, question_id)` | both | questions flagged for help |
| `mock_exam` | `exam_id` | `learner_id` | one row per mock exam |
| `mock_exam_question` | `(exam_id, question_id)` | both | the questions on an exam and whether each was right |
