-- The course is 52 cards, grouped into units of four cards.
-- unit and card hold that structure once, so a card's unit is never repeated on each question.

CREATE TABLE unit (
  unit_id TINYINT UNSIGNED NOT NULL,            -- 1..13, numbered by the course, so not AUTO_INCREMENT
  title   VARCHAR(80)      NOT NULL,
  blurb   VARCHAR(255)     NOT NULL,
  PRIMARY KEY (unit_id),
  UNIQUE KEY uq_unit_title (title)
) ENGINE=InnoDB;

CREATE TABLE card (
  card_no TINYINT UNSIGNED NOT NULL,            -- 1..52, numbered by the course
  title   VARCHAR(120)     NOT NULL,
  unit_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (card_no),
  CONSTRAINT fk_card_unit FOREIGN KEY (unit_id) REFERENCES unit (unit_id),
  CONSTRAINT ck_card_no CHECK (card_no > 0)
) ENGINE=InnoDB;
