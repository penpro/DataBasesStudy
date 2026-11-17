-- Reading the question bank. Loaded by name; see server/queries.js.

-- name: units
-- each unit with the first and last card it covers (GROUP BY with MIN and MAX)
SELECT u.unit_id, u.title, u.blurb,
       MIN(c.card_no) AS first_card,
       MAX(c.card_no) AS last_card
  FROM unit u
  JOIN card c ON c.unit_id = u.unit_id
 GROUP BY u.unit_id, u.title, u.blurb
 ORDER BY u.unit_id;

-- name: bank_questions
-- every question with its card title and its tags (a correlated subquery over the junction table)
SELECT q.code,
       q.card_no AS card,
       c.title   AS cardTitle,
       q.origin,
       q.prompt,
       q.answer,
       (SELECT JSON_ARRAYAGG(t.name)
          FROM question_tag qt
          JOIN tag t ON t.tag_id = qt.tag_id
         WHERE qt.question_id = q.question_id) AS tags
  FROM question q
  JOIN card c ON c.card_no = q.card_no
 ORDER BY q.question_id;

-- name: bank_options
-- the answer options of the questions that are shown as choices
SELECT q.code, q.prompt_override, o.text, o.is_correct
  FROM choice_option o
  JOIN question q ON q.question_id = o.question_id
 ORDER BY o.option_id;

-- name: question_id_by_code
SELECT question_id FROM question WHERE code = ?;
