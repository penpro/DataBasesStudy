// The HTTP API and the static web page. createApp takes the database pool as an argument,
// so the tests can run the exact same app against a test database.
const express = require('express');
const store = require('./store');
const { HttpError } = store;

const CODE = /^c\d{2}-\d{1,2}$/;
const USERNAME = /^[a-z0-9_-]{1,40}$/i;

function bad(message) {
  return new HttpError(400, message);
}
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// ---- input validation: every body and parameter is checked before it reaches the database -----

function parseSettings(body) {
  const allowed = ['mode', 'ramp', 'masterStreak', 'unlockThreshold', 'theme'];
  const keys = Object.keys(body || {});
  if (!keys.length) throw bad('no settings given');
  for (const k of keys) if (!allowed.includes(k)) throw bad(`unknown setting: ${k}`);
  const s = {};
  if ('mode' in body) { if (!['guided', 'free'].includes(body.mode)) throw bad('mode must be guided or free'); s.mode = body.mode; }
  if ('theme' in body) { if (!['light', 'dark'].includes(body.theme)) throw bad('theme must be light or dark'); s.theme = body.theme; }
  if ('ramp' in body) { if (typeof body.ramp !== 'boolean') throw bad('ramp must be true or false'); s.ramp = body.ramp; }
  if ('masterStreak' in body) { if (!isInt(body.masterStreak, 2, 5)) throw bad('masterStreak must be a whole number from 2 to 5'); s.masterStreak = body.masterStreak; }
  if ('unlockThreshold' in body) {
    const t = body.unlockThreshold;
    if (typeof t !== 'number' || !(t >= 0.5 && t <= 0.98)) throw bad('unlockThreshold must be a number from 0.5 to 0.98');
    s.unlockThreshold = Math.round(t * 100) / 100;
  }
  return s;
}

function parseAttempt(body) {
  if (!body || !CODE.test(body.code || '')) throw bad('code must look like c07-4');
  if (typeof body.correct !== 'boolean') throw bad('correct must be true or false');
  return { code: body.code, correct: body.correct };
}

function parseExam(body) {
  if (!body || typeof body.scope !== 'string' || !body.scope.trim() || body.scope.length > 80) throw bad('scope must be 1 to 80 characters');
  if (!isInt(body.minutes, 1, 600)) throw bad('minutes must be a whole number from 1 to 600');
  if (typeof body.startedAtMs !== 'number' || !Number.isFinite(body.startedAtMs) || body.startedAtMs < 0) throw bad('startedAtMs must be a timestamp in milliseconds');
  if (!Array.isArray(body.results) || body.results.length < 1 || body.results.length > 100) throw bad('results must list 1 to 100 questions');
  const results = body.results.map((r) => {
    if (!r || !CODE.test(r.code || '') || typeof r.correct !== 'boolean') throw bad('each result needs a question code and correct true/false');
    return { code: r.code, correct: r.correct };
  });
  return { scope: body.scope.trim(), minutes: body.minutes, startedAtMs: body.startedAtMs, results };
}

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  });
  next();
}

function createApp({ pool, defaultLearner = 'wes', webDir }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '100kb' }));

  // ---- the question bank and health -------------------------------------------------------
  const api = express.Router();
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  api.get('/health', async (req, res) => {
    const [[row]] = await pool.query('SELECT COUNT(*) AS questions FROM question');
    res.json({ ok: true, questions: row.questions });
  });

  api.get('/bank', async (req, res) => {
    res.json(await store.getBank(pool));
  });

  // ---- everything about one learner -------------------------------------------------------
  const learners = express.Router({ mergeParams: true });

  // "me" means the default learner; any other name must already exist.
  learners.use(async (req, res, next) => {
    const name = req.params.learner === 'me' ? defaultLearner : req.params.learner;
    if (!USERNAME.test(name)) throw bad('invalid learner name');
    const learner = await store.findLearner(pool, name);
    if (!learner) throw new HttpError(404, `no such learner: ${name}`);
    req.learner = learner;
    next();
  });

  learners.get('/state', async (req, res) => {
    res.json(await store.getState(pool, req.learner));
  });

  learners.post('/attempts', async (req, res) => {
    const { code, correct } = parseAttempt(req.body);
    const progress = await store.recordAttempt(pool, req.learner, code, correct);
    res.status(201).json({ code, progress });
  });

  learners.patch('/settings', async (req, res) => {
    await store.updateSettings(pool, req.learner, parseSettings(req.body));
    res.json({ ok: true });
  });

  learners.put('/flags/:code', async (req, res) => {
    if (!CODE.test(req.params.code)) throw bad('code must look like c07-4');
    await store.setFlag(pool, req.learner, req.params.code, true);
    res.json({ ok: true });
  });
  learners.delete('/flags/:code', async (req, res) => {
    if (!CODE.test(req.params.code)) throw bad('code must look like c07-4');
    await store.setFlag(pool, req.learner, req.params.code, false);
    res.json({ ok: true });
  });

  const unitParam = (req) => {
    const unit = Number(req.params.unit);
    if (!isInt(unit, 1, 255)) throw bad('unit must be a whole number');
    return unit;
  };
  learners.put('/unlocks/:unit', async (req, res) => {
    await store.setUnlock(pool, req.learner, unitParam(req), true);
    res.json({ ok: true });
  });
  learners.delete('/unlocks/:unit', async (req, res) => {
    await store.setUnlock(pool, req.learner, unitParam(req), false);
    res.json({ ok: true });
  });

  learners.delete('/progress', async (req, res) => {
    await store.resetProgress(pool, req.learner);
    res.json({ ok: true });
  });

  learners.post('/exams', async (req, res) => {
    res.status(201).json(await store.saveExam(pool, req.learner, parseExam(req.body)));
  });

  learners.get('/reports', async (req, res) => {
    res.json(await store.getReports(pool, req.learner));
  });

  api.use('/learners/:learner', learners);
  api.use((req, res) => { throw new HttpError(404, 'not found'); });
  app.use('/api', api);

  // ---- the web page -----------------------------------------------------------------------
  if (webDir) app.use(express.static(webDir, { index: 'index.html' }));

  // ---- errors: the client gets a short message, the console gets the detail ---------------
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'request body is not valid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'request body too large' });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

module.exports = { createApp };
