-- The answer options for questions that are shown as multiple choice or select-all.
-- A question with no rows here is a "write it out" question. One correct row makes it multiple
-- choice, two or more make it select-all, so the question's format is derived, never stored.

CREATE TABLE choice_option (
  option_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  question_id INT UNSIGNED NOT NULL,
  text        VARCHAR(400) NOT NULL,
  is_correct  BOOLEAN      NOT NULL,
  PRIMARY KEY (option_id),
  UNIQUE KEY uq_option_text (question_id, text),   -- no duplicate options within a question
  CONSTRAINT fk_option_question FOREIGN KEY (question_id) REFERENCES question (question_id) ON DELETE CASCADE
) ENGINE=InnoDB;
