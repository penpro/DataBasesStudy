/* Demo mode, for the public GitHub Pages copy of the tool.

   GitHub Pages can only serve files: it cannot run Node or MySQL. So on that site this file answers the
   same API calls that server/app.js answers, using the browser's own storage instead of MySQL. The page
   (app.js, remote.js) does not know the difference. The scheduling rules are the very same engine.js.

   The real version (npm start) never uses this file. Demo mode is on only on a github.io address or
   when the URL has ?demo=1. Progress in demo mode lives in this browser only. */
(function (root) {
  var KEY = "cs330-demo-v1";
  var CODE = /^c\d{2}-\d{1,2}$/;

  function fail(status, message) { var e = new Error(message); e.status = status; return e; }
  function isInt(v, min, max) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= min && v <= max; }

  function defaults() {
    return {
      created: Date.now(),
      settings: { mode: "guided", ramp: true, masterStreak: 3, unlockThreshold: 0.9, theme: "light" },
      log: [],          // one [code, correct, timeMs] per answer: the same role as the attempt table
      progress: {},     // code -> engine progress: the same role as question_state
      flags: [],
      unlocked: [],
      exams: []         // { when, scope, minutes, results: [{code, correct}] }
    };
  }

  // storage: anything with getItem/setItem/removeItem. engine: the shared engine.js. loadBank: () => Promise<bank>.
  function create(storage, engine, loadBank) {
    var bank = null;

    function load() {
      try {
        var raw = storage.getItem(KEY);
        if (raw) { var d = JSON.parse(raw); if (d && d.settings && d.log) return d; }
      } catch (e) { /* unreadable: start fresh */ }
      return defaults();
    }
    function save(d) {
      try { storage.setItem(KEY, JSON.stringify(d)); }
      catch (e) { throw fail(500, "This browser would not save your progress (storage is full or blocked)."); }
    }
    function questionByCode(code) {
      for (var i = 0; i < bank.questions.length; i++) if (bank.questions[i].id === code) return bank.questions[i];
      return null;
    }
    function needQuestion(code) {
      if (!CODE.test(code || "")) throw fail(400, "code must look like c07-4");
      if (!questionByCode(code)) throw fail(404, "no such question: " + code);
    }

    // ---- reports: worked out from the log every time, never stored ------------------------
    function streaks(log) {
      var best = 0, run = 0;
      log.forEach(function (a) { if (a[1]) { run++; if (run > best) best = run; } else run = 0; });
      return { best_streak: best, current_streak: run };
    }

    function state(d) {
      var progress = {};
      Object.keys(d.progress).forEach(function (c) { progress[c] = JSON.parse(JSON.stringify(d.progress[c])); });
      d.flags.forEach(function (c) {
        if (!progress[c]) progress[c] = { box: 1, streak: 0, correct: 0, wrong: 0, seen: 0, mastered: false, everWrong: false, due: 0, lastSeen: null };
        progress[c].flagged = true;
      });
      var s = streaks(d.log);
      var correct = d.log.filter(function (a) { return a[1]; }).length;
      return {
        settings: {
          masterStreak: d.settings.masterStreak, unlockThreshold: d.settings.unlockThreshold, mode: d.settings.mode,
          ramp: d.settings.ramp, theme: d.settings.theme, unlocked: d.unlocked.slice().sort(function (a, b) { return a - b; })
        },
        progress: progress,
        stats: {
          answered: d.log.length, correct: correct, clock: d.log.length,
          streak: s.current_streak, bestStreak: s.best_streak, started: d.log.length ? d.log[0][2] : d.created
        },
        exams: d.exams.slice(-30).map(function (e) {
          return { when: e.when, scope: e.scope, n: e.results.length, correct: e.results.filter(function (r) { return r.correct; }).length };
        })
      };
    }

    function reports(d) {
      var s = streaks(d.log);
      var unitMastery = bank.units.map(function (u) {
        var qs = bank.questions.filter(function (q) { return q.card >= u.first_card && q.card <= u.last_card; });
        var mastered = qs.filter(function (q) { return d.progress[q.id] && d.progress[q.id].mastered; }).length;
        return { unit_id: u.unit_id, title: u.title, questions: qs.length, mastered: mastered };
      });
      var byTag = {};
      bank.questions.forEach(function (q) {
        var p = d.progress[q.id];
        if (!p || !(p.seen > 0)) return;
        q.tags.forEach(function (t) {
          var g = byTag[t] || (byTag[t] = { name: t, seen: 0, mastered: 0 });
          g.seen++; if (p.mastered) g.mastered++;
        });
      });
      var weakTags = Object.keys(byTag).map(function (k) {
        var g = byTag[k]; g.mastery = Math.round(100 * g.mastered / g.seen) / 100; return g;
      }).filter(function (g) { return g.seen >= 2; }).sort(function (a, b) {
        return a.mastery - b.mastery || b.seen - a.seen || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      }).slice(0, 8);
      var misses = {};
      d.log.forEach(function (a) { if (!a[1]) misses[a[0]] = (misses[a[0]] || 0) + 1; });
      var missed = Object.keys(misses).map(function (c) { return { code: c, misses: misses[c] }; }).sort(function (a, b) {
        return b.misses - a.misses || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
      }).slice(0, 10);
      var seen = {};
      d.log.forEach(function (a) { seen[a[0]] = true; });
      var never = bank.questions.filter(function (q) { return !seen[q.id]; }).length;
      return { unitMastery: unitMastery, weakTags: weakTags, missedQuestions: missed, neverAttempted: never, streaks: s };
    }

    // ---- the routes, same paths and same JSON as server/app.js --------------------------------
    function route(method, url, body) {
      var d = load();
      if (method === "GET" && url === "/api/bank") return bank;
      var m = /^\/api\/learners\/me\/([a-z]+)(?:\/([^/]+))?$/.exec(url);
      if (!m) throw fail(404, "no such route: " + url);
      var what = m[1], arg = m[2] ? decodeURIComponent(m[2]) : null;

      if (what === "state" && method === "GET") return state(d);
      if (what === "reports" && method === "GET") return reports(d);

      if (what === "attempts" && method === "POST") {
        if (!body || typeof body.correct !== "boolean") throw fail(400, "correct must be true or false");
        needQuestion(body.code);
        var progress = {};
        if (d.progress[body.code]) progress[body.code] = JSON.parse(JSON.stringify(d.progress[body.code]));
        engine.onAnswer(progress, body.code, body.correct, d.log.length, { masterStreak: d.settings.masterStreak });
        d.log.push([body.code, body.correct, Date.now()]);
        d.progress[body.code] = progress[body.code];
        save(d);
        return { code: body.code, progress: progress[body.code] };
      }

      if (what === "settings" && method === "PATCH") {
        var keys = Object.keys(body || {});
        if (!keys.length) throw fail(400, "no settings given");
        keys.forEach(function (k) {
          if (["mode", "ramp", "masterStreak", "unlockThreshold", "theme"].indexOf(k) < 0) throw fail(400, "unknown setting: " + k);
        });
        if ("mode" in body && ["guided", "free"].indexOf(body.mode) < 0) throw fail(400, "mode must be guided or free");
        if ("theme" in body && ["light", "dark"].indexOf(body.theme) < 0) throw fail(400, "theme must be light or dark");
        if ("ramp" in body && typeof body.ramp !== "boolean") throw fail(400, "ramp must be true or false");
        if ("masterStreak" in body && !isInt(body.masterStreak, 2, 5)) throw fail(400, "masterStreak must be a whole number from 2 to 5");
        if ("unlockThreshold" in body && !(typeof body.unlockThreshold === "number" && body.unlockThreshold >= 0.5 && body.unlockThreshold <= 0.98)) throw fail(400, "unlockThreshold must be a number from 0.5 to 0.98");
        keys.forEach(function (k) { d.settings[k] = k === "unlockThreshold" ? Math.round(body[k] * 100) / 100 : body[k]; });
        save(d);
        return { ok: true };
      }

      if (what === "flags" && (method === "PUT" || method === "DELETE")) {
        needQuestion(arg);
        d.flags = d.flags.filter(function (c) { return c !== arg; });
        if (method === "PUT") d.flags.push(arg);
        save(d);
        return { ok: true };
      }

      if (what === "unlocks" && (method === "PUT" || method === "DELETE")) {
        var unit = Number(arg);
        if (!isInt(unit, 1, 255)) throw fail(400, "unit must be a whole number");
        if (!bank.units.some(function (u) { return u.unit_id === unit; })) throw fail(404, "no such unit: " + unit);
        d.unlocked = d.unlocked.filter(function (u) { return u !== unit; });
        if (method === "PUT") d.unlocked.push(unit);
        save(d);
        return { ok: true };
      }

      if (what === "progress" && method === "DELETE") {
        var fresh = defaults();
        fresh.created = d.created;
        save(fresh);
        return { ok: true };
      }

      if (what === "exams" && method === "POST") {
        if (!body || typeof body.scope !== "string" || !body.scope.trim() || body.scope.length > 80) throw fail(400, "scope must be 1 to 80 characters");
        if (!isInt(body.minutes, 1, 600)) throw fail(400, "minutes must be a whole number from 1 to 600");
        if (!Array.isArray(body.results) || body.results.length < 1 || body.results.length > 100) throw fail(400, "results must list 1 to 100 questions");
        var seenCodes = {};
        body.results.forEach(function (r) {
          if (!r || typeof r.correct !== "boolean") throw fail(400, "each result needs a question code and correct true/false");
          needQuestion(r.code);
          if (seenCodes[r.code]) throw fail(400, "a question appears twice in the exam");
          seenCodes[r.code] = true;
        });
        d.exams.push({ when: Date.now(), scope: body.scope.trim(), minutes: body.minutes,
          results: body.results.map(function (r) { return { code: r.code, correct: r.correct }; }) });
        save(d);
        return { examId: d.exams.length, n: body.results.length, correct: body.results.filter(function (r) { return r.correct; }).length };
      }

      throw fail(404, "no such route: " + method + " " + url);
    }

    return {
      active: true,
      handle: function (method, url, body) {
        return Promise.resolve(bank ? null : loadBank().then(function (b) { bank = b; })).then(function () {
          return JSON.parse(JSON.stringify(route(method, url, body)));
        });
      }
    };
  }

  function isDemoHere() {
    try {
      var loc = root.location;
      return /\.github\.io$/i.test(loc.hostname) || /[?&]demo=1(&|$)/.test(loc.search);
    } catch (e) { return false; }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { create: create };
  if (typeof window !== "undefined") {
    var CS = (root.CS = root.CS || {});
    CS.demo = { active: false };
    if (isDemoHere()) {
      var store;
      try { store = root.localStorage; store.getItem(KEY); } catch (e) { store = null; }
      var memory = {};
      var storage = store || {
        getItem: function (k) { return k in memory ? memory[k] : null; },
        setItem: function (k, v) { memory[k] = v; },
        removeItem: function (k) { delete memory[k]; }
      };
      CS.demo = create(storage, CS.engine, function () {
        return fetch("demo/bank.json").then(function (r) {
          if (!r.ok) throw new Error("Could not load the question bank (HTTP " + r.status + ").");
          return r.json();
        });
      });
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
