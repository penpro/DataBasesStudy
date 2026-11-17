-- attempt is the history: one row for every answer a learner gives.
-- Counts, accuracy, and streaks are computed from it with queries and never stored,
-- so they cannot drift out of sync with the log.

CREATE TABLE attempt (
  attempt_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  learner_id  INT UNSIGNED    NOT NULL,
  question_id INT UNSIGNED    NOT NULL,
  correct     BOOLEAN         NOT NULL,
  answered_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (attempt_id),
  KEY ix_attempt_learner (learner_id, attempt_id),
  KEY ix_attempt_question (question_id),
  CONSTRAINT fk_attempt_learner  FOREIGN KEY (learner_id)  REFERENCES learner (learner_id) ON DELETE CASCADE,
  CONSTRAINT fk_attempt_question FOREIGN KEY (question_id) REFERENCES question (question_id)
) ENGINE=InnoDB;
