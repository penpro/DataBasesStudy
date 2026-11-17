-- Learners, their settings, and the units they opened by hand.

-- name: learner_by_username
SELECT learner_id, username, mode, ramp, master_streak, unlock_threshold, theme, created_at
  FROM learner
 WHERE username = ?;

-- name: create_learner
INSERT INTO learner (username) VALUES (?);

-- name: lock_learner
-- serializes concurrent answers from the same learner for the length of a transaction
SELECT learner_id, master_streak FROM learner WHERE learner_id = ? FOR UPDATE;

-- name: update_settings
-- COALESCE keeps the old value for any setting that was not sent
UPDATE learner
   SET mode             = COALESCE(?, mode),
       ramp             = COALESCE(?, ramp),
       master_streak    = COALESCE(?, master_streak),
       unlock_threshold = COALESCE(?, unlock_threshold),
       theme            = COALESCE(?, theme)
 WHERE learner_id = ?;

-- name: reset_settings
UPDATE learner
   SET mode = 'guided', ramp = TRUE, master_streak = 3, unlock_threshold = 0.90, theme = 'light'
 WHERE learner_id = ?;

-- name: learner_unlocks
SELECT unit_id FROM learner_unit_unlock WHERE learner_id = ? ORDER BY unit_id;

-- name: add_unlock
-- opening a unit twice is harmless. (INSERT IGNORE would also hide a bad unit_id, so it is not used.)
INSERT INTO learner_unit_unlock (learner_id, unit_id) VALUES (?, ?)
ON DUPLICATE KEY UPDATE learner_id = learner_id;

-- name: remove_unlock
DELETE FROM learner_unit_unlock WHERE learner_id = ? AND unit_id = ?;
