-- Questions, and the tags that describe them (a many-to-many relationship).
-- A question belongs to one card. A question has many tags and a tag labels many questions,
-- so the link lives in the junction table question_tag.

CREATE TABLE question (
  question_id     INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  code            VARCHAR(12)      NOT NULL,    -- the course's own id, e.g. c07-4
  card_no         TINYINT UNSIGNED NOT NULL,
  origin          ENUM('direct', 'inferred') NOT NULL,
  prompt          TEXT             NOT NULL,
  prompt_override TEXT             NULL,        -- reworded prompt, used only when the question is shown as choices
  answer          TEXT             NOT NULL,    -- the course's reference answer (markdown)
  PRIMARY KEY (question_id),
  UNIQUE KEY uq_question_code (code),
  KEY ix_question_card (card_no),
  CONSTRAINT fk_question_card FOREIGN KEY (card_no) REFERENCES card (card_no)
) ENGINE=InnoDB;

-- tag groups ("Question type", "Concepts", "SQL operations", "Database type") are their own table
-- so a group's name is stored once, not repeated on every tag.
CREATE TABLE tag_group (
  tag_group_id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name         VARCHAR(30)      NOT NULL,
  PRIMARY KEY (tag_group_id),
  UNIQUE KEY uq_tag_group_name (name)
) ENGINE=InnoDB;

CREATE TABLE tag (
  tag_id       SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name         VARCHAR(40)       NOT NULL,      -- e.g. inner_join
  tag_group_id TINYINT UNSIGNED  NOT NULL,
  PRIMARY KEY (tag_id),
  UNIQUE KEY uq_tag_name (name),
  CONSTRAINT fk_tag_group FOREIGN KEY (tag_group_id) REFERENCES tag_group (tag_group_id)
) ENGINE=InnoDB;

CREATE TABLE question_tag (
  question_id INT UNSIGNED      NOT NULL,
  tag_id      SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (question_id, tag_id),            -- composite key: each pair appears at most once
  KEY ix_question_tag_tag (tag_id),
  CONSTRAINT fk_qt_question FOREIGN KEY (question_id) REFERENCES question (question_id) ON DELETE CASCADE,
  CONSTRAINT fk_qt_tag      FOREIGN KEY (tag_id)      REFERENCES tag (tag_id)
) ENGINE=InnoDB;
