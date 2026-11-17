-- question_state is where one learner currently stands on one question (Leitner box, streak, due time).
-- It is written in the same transaction as each attempt. due_at and last_seen are positions on the
-- learner's logical clock (the number of answers so far), not dates.

CREATE TABLE question_state (
  learner_id  INT UNSIGNED      NOT NULL,
  question_id INT UNSIGNED      NOT NULL,
  box         TINYINT UNSIGNED  NOT NULL DEFAULT 1,
  streak      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  correct_cnt SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  wrong_cnt   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  seen_cnt    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  mastered    BOOLEAN           NOT NULL DEFAULT FALSE,
  ever_wrong  BOOLEAN           NOT NULL DEFAULT FALSE,
  due_at      INT UNSIGNED      NOT NULL DEFAULT 0,
  last_seen   INT UNSIGNED      NULL,
  PRIMARY KEY (learner_id, question_id),
  KEY ix_state_question (question_id),
  CONSTRAINT ck_state_box CHECK (box BETWEEN 1 AND 6),
  CONSTRAINT fk_state_learner  FOREIGN KEY (learner_id)  REFERENCES learner (learner_id) ON DELETE CASCADE,
  CONSTRAINT fk_state_question FOREIGN KEY (question_id) REFERENCES question (question_id)
) ENGINE=InnoDB;

-- a question a learner has flagged for help
CREATE TABLE flag (
  learner_id  INT UNSIGNED NOT NULL,
  question_id INT UNSIGNED NOT NULL,
  flagged_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (learner_id, question_id),
  KEY ix_flag_question (question_id),
  CONSTRAINT fk_flag_learner  FOREIGN KEY (learner_id)  REFERENCES learner (learner_id) ON DELETE CASCADE,
  CONSTRAINT fk_flag_question FOREIGN KEY (question_id) REFERENCES question (question_id)
) ENGINE=InnoDB;
