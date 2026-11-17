-- Reports computed by the database. Nothing here is stored; it is always worked out from the log.

-- name: streaks
-- Longest and current run of correct answers, using a window function.
-- misses_so_far goes up by one at every wrong answer, so all the correct answers between two
-- misses share the same number. Counting each group gives the runs.
WITH ordered AS (
  SELECT attempt_id, correct,
         SUM(correct = 0) OVER (ORDER BY attempt_id) AS misses_so_far
    FROM attempt
   WHERE learner_id = ?
),
runs AS (
  SELECT misses_so_far, COUNT(*) AS run_length
    FROM ordered
   WHERE correct = 1
   GROUP BY misses_so_far
)
SELECT COALESCE(MAX(run_length), 0) AS best_streak,
       COALESCE((SELECT run_length FROM runs
                  WHERE misses_so_far = (SELECT MAX(misses_so_far) FROM ordered)), 0) AS current_streak
  FROM runs;

-- name: unit_mastery
-- mastered questions per unit; LEFT JOIN keeps units the learner has not started
SELECT u.unit_id, u.title,
       COUNT(q.question_id)         AS questions,
       COALESCE(SUM(s.mastered), 0) AS mastered
  FROM unit u
  JOIN card c     ON c.unit_id = u.unit_id
  JOIN question q ON q.card_no = c.card_no
  LEFT JOIN question_state s ON s.question_id = q.question_id AND s.learner_id = ?
 GROUP BY u.unit_id, u.title
 ORDER BY u.unit_id;

-- name: weak_tags
-- the topics (tags) with the lowest mastery, among questions the learner has seen
SELECT t.name,
       COUNT(*)                          AS seen,
       SUM(s.mastered)                   AS mastered,
       ROUND(SUM(s.mastered) / COUNT(*), 2) AS mastery
  FROM question_state s
  JOIN question_tag qt ON qt.question_id = s.question_id
  JOIN tag t           ON t.tag_id = qt.tag_id
 WHERE s.learner_id = ?
   AND s.seen_cnt > 0
 GROUP BY t.tag_id, t.name
HAVING COUNT(*) >= 2
 ORDER BY mastery ASC, seen DESC, t.name
 LIMIT 8;

-- name: exam_history
-- finished mock exams with their score, newest first
SELECT e.exam_id, e.scope_label, e.minutes,
       UNIX_TIMESTAMP(e.finished_at) * 1000 AS finished_ms,
       COUNT(m.question_id)                 AS questions,
       COALESCE(SUM(m.correct), 0)          AS correct
  FROM mock_exam e
  JOIN mock_exam_question m ON m.exam_id = e.exam_id
 WHERE e.learner_id = ?
   AND e.finished_at IS NOT NULL
 GROUP BY e.exam_id, e.scope_label, e.minutes, e.finished_at
 ORDER BY e.exam_id DESC
 LIMIT 30;
