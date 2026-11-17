-- Saving a finished mock exam.

-- name: create_exam
-- LEAST keeps started_at from ever being later than now, even if the browser's clock is ahead
INSERT INTO mock_exam (learner_id, scope_label, minutes, started_at, finished_at)
VALUES (?, ?, ?, LEAST(FROM_UNIXTIME(?), NOW()), NOW());

-- name: add_exam_question
INSERT INTO mock_exam_question (exam_id, question_id, position, correct) VALUES (?, ?, ?, ?);
