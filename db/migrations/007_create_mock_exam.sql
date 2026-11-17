-- Mock exams: one row per exam, and one row per question on it.
-- The score is never stored: it is COUNT of correct rows, computed when you ask for it.
-- Mock exams do not touch spaced-repetition state, so they have their own tables.

CREATE TABLE mock_exam (
  exam_id     INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  learner_id  INT UNSIGNED      NOT NULL,
  scope_label VARCHAR(80)       NOT NULL,       -- e.g. "Check-in 1 (cards 1-12)"
  minutes     SMALLINT UNSIGNED NOT NULL,
  started_at  DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME          NULL,
  PRIMARY KEY (exam_id),
  KEY ix_exam_learner (learner_id, exam_id),
  CONSTRAINT ck_exam_minutes  CHECK (minutes > 0),
  CONSTRAINT ck_exam_finished CHECK (finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT fk_exam_learner FOREIGN KEY (learner_id) REFERENCES learner (learner_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE mock_exam_question (
  exam_id     INT UNSIGNED      NOT NULL,
  question_id INT UNSIGNED      NOT NULL,
  position    SMALLINT UNSIGNED NOT NULL,       -- 1-based order on the sheet
  correct     BOOLEAN           NULL,           -- NULL until the exam is graded
  PRIMARY KEY (exam_id, question_id),
  UNIQUE KEY uq_exam_position (exam_id, position),
  KEY ix_meq_question (question_id),
  CONSTRAINT fk_meq_exam     FOREIGN KEY (exam_id)     REFERENCES mock_exam (exam_id) ON DELETE CASCADE,
  CONSTRAINT fk_meq_question FOREIGN KEY (question_id) REFERENCES question (question_id)
) ENGINE=InnoDB;
