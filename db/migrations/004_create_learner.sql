-- A learner and their settings. Settings depend only on the learner, so they are columns here.
-- Units a learner has opened by hand are a many-to-many link (learner <-> unit).

CREATE TABLE learner (
  learner_id       INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  username         VARCHAR(40)   NOT NULL,
  mode             ENUM('guided', 'free') NOT NULL DEFAULT 'guided',
  ramp             BOOLEAN       NOT NULL DEFAULT TRUE,
  master_streak    TINYINT UNSIGNED NOT NULL DEFAULT 3,       -- "got it" answers in a row to master a question
  unlock_threshold DECIMAL(3, 2) NOT NULL DEFAULT 0.90,       -- mastery needed to unlock the next unit
  theme            ENUM('light', 'dark') NOT NULL DEFAULT 'light',
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (learner_id),
  UNIQUE KEY uq_learner_username (username),
  CONSTRAINT ck_learner_master_streak CHECK (master_streak BETWEEN 2 AND 5),
  CONSTRAINT ck_learner_threshold     CHECK (unlock_threshold BETWEEN 0.50 AND 0.98)
) ENGINE=InnoDB;

CREATE TABLE learner_unit_unlock (
  learner_id INT UNSIGNED     NOT NULL,
  unit_id    TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (learner_id, unit_id),
  CONSTRAINT fk_unlock_learner FOREIGN KEY (learner_id) REFERENCES learner (learner_id) ON DELETE CASCADE,
  CONSTRAINT fk_unlock_unit    FOREIGN KEY (unit_id)    REFERENCES unit (unit_id)
) ENGINE=InnoDB;
