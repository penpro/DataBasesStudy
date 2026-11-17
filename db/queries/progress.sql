-- Recording answers and reading study progress.

-- name: state_for_update
SELECT box, streak, correct_cnt, wrong_cnt, seen_cnt, mastered, ever_wrong, due_at, last_seen
  FROM question_state
 WHERE learner_id = ? AND question_id = ?
   FOR UPDATE;

-- name: save_state
-- insert the first time a learner meets a question, update it every time after
INSERT INTO question_state
       (learner_id, question_id, box, streak, correct_cnt, wrong_cnt, seen_cnt, mastered, ever_wrong, due_at, last_seen)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS new
ON DUPLICATE KEY UPDATE
       box = new.box, streak = new.streak, correct_cnt = new.correct_cnt, wrong_cnt = new.wrong_cnt,
       seen_cnt = new.seen_cnt, mastered = new.mastered, ever_wrong = new.ever_wrong,
       due_at = new.due_at, last_seen = new.last_seen;

-- name: learner_states
SELECT q.code, s.box, s.streak, s.correct_cnt, s.wrong_cnt, s.seen_cnt, s.mastered, s.ever_wrong, s.due_at, s.last_seen
  FROM question_state s
  JOIN question q ON q.question_id = s.question_id
 WHERE s.learner_id = ?;

-- name: learner_flags
SELECT q.code
  FROM flag f
  JOIN question q ON q.question_id = f.question_id
 WHERE f.learner_id = ?;

-- name: set_flag
-- flagging twice keeps the original time
INSERT INTO flag (learner_id, question_id) VALUES (?, ?)
ON DUPLICATE KEY UPDATE flagged_at = flagged_at;

-- name: clear_flag
DELETE FROM flag WHERE learner_id = ? AND question_id = ?;

-- name: reset_attempts
DELETE FROM attempt WHERE learner_id = ?;

-- name: reset_states
DELETE FROM question_state WHERE learner_id = ?;

-- name: reset_flags
DELETE FROM flag WHERE learner_id = ?;

-- name: reset_unlocks
DELETE FROM learner_unit_unlock WHERE learner_id = ?;

-- name: reset_exams
-- the exam's questions are deleted with it (ON DELETE CASCADE)
DELETE FROM mock_exam WHERE learner_id = ?;
