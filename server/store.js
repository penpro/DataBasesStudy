// Data access: every function that reads or writes the database lives here, so the routes stay thin.
// Queries come from db/queries/*.sql and always use placeholders, never string-built SQL.
const Q = require('./queries');
const engine = require('./engine');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bit = (b) => (b ? 1 : 0);

// ---- converting between database rows and the shape the page uses ----------------------------

function blankProgress() {
  return { box: 1, streak: 0, correct: 0, wrong: 0, seen: 0, mastered: false, everWrong: false, due: 0, lastSeen: null };
}

function rowToProgress(r) {
  return {
    box: r.box, streak: r.streak, correct: r.correct_cnt, wrong: r.wrong_cnt, seen: r.seen_cnt,
    mastered: !!r.mastered, everWrong: !!r.ever_wrong, due: r.due_at, lastSeen: r.last_seen
  };
}

function progressToParams(p) {
  return [p.box, p.streak, p.correct, p.wrong, p.seen, bit(p.mastered), bit(p.everWrong), p.due, p.lastSeen];
}

// ---- learners ---------------------------------------------------------------------------------

async function findLearner(db, username) {
  const [rows] = await db.execute(Q.learner_by_username, [username]);
  return rows[0] || null;
}

async function ensureLearner(db, username) {
  let learner = await findLearner(db, username);
  if (!learner) {
    await db.execute(Q.create_learner, [username]);
    learner = await findLearner(db, username);
  }
  return learner;
}

// ---- the question bank ------------------------------------------------------------------------

async function getBank(db) {
  const [units] = await db.execute(Q.units);
  const [questions] = await db.execute(Q.bank_questions);
  const [optionRows] = await db.execute(Q.bank_options);
  const choices = {};
  for (const o of optionRows) {
    const c = choices[o.code] || (choices[o.code] = { r: [], w: [] });
    if (o.prompt_override) c.p = o.prompt_override;
    (o.is_correct ? c.r : c.w).push(o.text);
  }
  return {
    units,
    questions: questions.map((q) => ({
      id: q.code, card: q.card, cardTitle: q.cardTitle, origin: q.origin, tags: q.tags || [], prompt: q.prompt, answer: q.answer
    })),
    choices
  };
}

// ---- a learner's whole state, in the shape the page keeps in memory --------------------------

async function getState(db, learner) {
  const id = learner.learner_id;
  const [stateRows] = await db.execute(Q.learner_states, [id]);
  const [flagRows] = await db.execute(Q.learner_flags, [id]);
  const [unlockRows] = await db.execute(Q.learner_unlocks, [id]);
  const [[totals]] = await db.execute(Q.attempt_totals, [id]);
  const [[streaks]] = await db.execute(Q.streaks, [id]);
  const [examRows] = await db.execute(Q.exam_history, [id]);

  const progress = {};
  for (const r of stateRows) progress[r.code] = rowToProgress(r);
  for (const f of flagRows) (progress[f.code] = progress[f.code] || blankProgress()).flagged = true;

  return {
    settings: {
      masterStreak: learner.master_streak,
      unlockThreshold: learner.unlock_threshold,
      mode: learner.mode,
      ramp: !!learner.ramp,
      theme: learner.theme,
      unlocked: unlockRows.map((u) => u.unit_id)
    },
    progress,
    stats: {
      answered: totals.answered,
      correct: totals.correct,
      clock: totals.answered,
      streak: streaks.current_streak,
      bestStreak: streaks.best_streak,
      started: totals.first_ms || new Date(learner.created_at).getTime()
    },
    exams: examRows.map((e) => ({ when: e.finished_ms, scope: e.scope_label, n: e.questions, correct: e.correct })).reverse()
  };
}

// ---- recording one answer ---------------------------------------------------------------------
// One transaction: log the attempt, run the engine, store the question's new state.
// The learner row is locked first, so two answers from one learner can never interleave.

async function recordAttempt(pool, learner, code, correct) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[locked]] = await conn.execute(Q.lock_learner, [learner.learner_id]);
    const [qRows] = await conn.execute(Q.question_id_by_code, [code]);
    if (!qRows.length) throw new HttpError(404, `no such question: ${code}`);
    const questionId = qRows[0].question_id;

    const [[{ clock }]] = await conn.execute(Q.attempt_count, [learner.learner_id]);
    const [stateRows] = await conn.execute(Q.state_for_update, [learner.learner_id, questionId]);
    const progress = {};
    if (stateRows.length) progress[code] = rowToProgress(stateRows[0]);

    engine.onAnswer(progress, code, correct, clock, { masterStreak: locked.master_streak });

    await conn.execute(Q.record_attempt, [learner.learner_id, questionId, bit(correct)]);
    await conn.execute(Q.save_state, [learner.learner_id, questionId, ...progressToParams(progress[code])]);
    await conn.commit();
    return progress[code];
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ---- settings, flags, unlocks -----------------------------------------------------------------

async function updateSettings(db, learner, s) {
  await db.execute(Q.update_settings, [
    s.mode ?? null, s.ramp === undefined ? null : bit(s.ramp), s.masterStreak ?? null,
    s.unlockThreshold ?? null, s.theme ?? null, learner.learner_id
  ]);
}

async function questionIdOrThrow(db, code) {
  const [rows] = await db.execute(Q.question_id_by_code, [code]);
  if (!rows.length) throw new HttpError(404, `no such question: ${code}`);
  return rows[0].question_id;
}

async function setFlag(db, learner, code, on) {
  const questionId = await questionIdOrThrow(db, code);
  await db.execute(on ? Q.set_flag : Q.clear_flag, [learner.learner_id, questionId]);
}

async function setUnlock(db, learner, unitId, on) {
  try {
    await db.execute(on ? Q.add_unlock : Q.remove_unlock, [learner.learner_id, unitId]);
  } catch (e) {
    if (e.code === 'ER_NO_REFERENCED_ROW_2') throw new HttpError(404, `no such unit: ${unitId}`);
    throw e;
  }
}

// ---- reset ------------------------------------------------------------------------------------

async function resetProgress(pool, learner) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const q of [Q.reset_attempts, Q.reset_states, Q.reset_flags, Q.reset_unlocks, Q.reset_exams, Q.reset_settings]) {
      await conn.execute(q, [learner.learner_id]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ---- mock exams -------------------------------------------------------------------------------

async function saveExam(pool, learner, exam) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ids = [];
    for (const r of exam.results) ids.push(await questionIdOrThrow(conn, r.code));
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'a question appears twice in the exam');
    const [res] = await conn.execute(Q.create_exam, [
      learner.learner_id, exam.scope, exam.minutes, Math.floor(exam.startedAtMs / 1000)
    ]);
    for (let i = 0; i < exam.results.length; i++) {
      await conn.execute(Q.add_exam_question, [res.insertId, ids[i], i + 1, bit(exam.results[i].correct)]);
    }
    await conn.commit();
    return { examId: res.insertId, n: exam.results.length, correct: exam.results.filter((r) => r.correct).length };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ---- reports computed by the database ---------------------------------------------------------

async function getReports(db, learner) {
  const id = learner.learner_id;
  const [unitMastery] = await db.execute(Q.unit_mastery, [id]);
  const [weakTags] = await db.execute(Q.weak_tags, [id]);
  const [missed] = await db.execute(Q.missed_questions, [id]);
  const [[never]] = await db.execute(Q.never_attempted, [id]);
  const [[streaks]] = await db.execute(Q.streaks, [id]);
  return { unitMastery, weakTags, missedQuestions: missed, neverAttempted: never.never_attempted, streaks };
}

module.exports = {
  HttpError, findLearner, ensureLearner, getBank, getState, recordAttempt,
  updateSettings, setFlag, setUnlock, resetProgress, saveExam, getReports
};
