-- Everything the app asks the attempt log. The table itself is db/migrations/005_create_attempt.sql.

-- name: attempt_count
-- how many answers a learner has given (WHERE + COUNT). This is their logical clock.
SELECT COUNT(*) AS clock FROM attempt WHERE learner_id = ?;

-- name: record_attempt
-- log one answer (INSERT)
INSERT INTO attempt (learner_id, question_id, correct) VALUES (?, ?, ?);

-- name: missed_questions
-- the questions this learner gets wrong most often (JOIN + WHERE + GROUP BY with COUNT)
SELECT q.code, COUNT(*) AS misses
  FROM attempt a
  JOIN question q ON q.question_id = a.question_id
 WHERE a.learner_id = ? AND a.correct = 0
 GROUP BY q.question_id, q.code
 ORDER BY misses DESC, q.code
 LIMIT 10;

-- name: never_attempted
-- how many questions this learner has never answered (subquery with NOT EXISTS)
SELECT COUNT(*) AS never_attempted
  FROM question q
 WHERE NOT EXISTS (SELECT 1 FROM attempt a
                    WHERE a.learner_id = ? AND a.question_id = q.question_id);

-- name: attempt_totals
SELECT COUNT(*) AS answered,
       COALESCE(SUM(correct), 0) AS correct,
       UNIX_TIMESTAMP(MIN(answered_at)) * 1000 AS first_ms
  FROM attempt
 WHERE learner_id = ?;
