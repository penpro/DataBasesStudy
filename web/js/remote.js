/* The page's connection to the database, through the API (server/app.js).
   Reads happen when the page loads. Every change is sent to the server one at a time, in the order
   it happened, and a failure is reported instead of being swallowed. */
(function (root) {
  var CS = (root.CS = root.CS || {});
  var BASE = "/api/learners/me";

  var queue = Promise.resolve();      // changes wait their turn here, so they reach the database in order
  var errorHandler = function () {};
  var settingsTimer = null;

  function request(method, url, body) {
    // On the public GitHub Pages copy there is no server: demo.js answers the same calls from browser storage.
    if (CS.demo && CS.demo.active) return CS.demo.handle(method, url, body);
    return fetch(url, {
      method: method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
        return data;
      });
    });
  }

  // Send a change. Never rejects: a failure goes to the error handler and the caller gets null.
  function send(method, url, body) {
    var p = queue.then(function () { return request(method, url, body); }).catch(function (e) {
      errorHandler(e);
      return null;
    });
    queue = p;
    return p;
  }

  function download(name, data) {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  CS.remote = {
    state: null,
    demo: !!(CS.demo && CS.demo.active),

    // Load the bank (units, questions, choices) and this learner's state.
    init: function () {
      return request("GET", "/api/bank").then(function (bank) {
        CS.setUnits(bank.units);
        CS.addQuestions(bank.questions);
        CS.addChoices(bank.choices);
        return request("GET", BASE + "/state");
      }).then(function (state) { CS.remote.state = state; return state; });
    },

    onError: function (fn) { errorHandler = fn; },

    recordAttempt: function (code, correct) { return send("POST", BASE + "/attempts", { code: code, correct: correct }); },
    setFlag: function (code, on) { return send(on ? "PUT" : "DELETE", BASE + "/flags/" + encodeURIComponent(code)); },
    setUnlock: function (unit, on) { return send(on ? "PUT" : "DELETE", BASE + "/unlocks/" + unit); },
    saveExam: function (exam) { return send("POST", BASE + "/exams", exam); },

    // Sliders fire many times a second; wait until they stop moving, then send the final values.
    saveSettings: function (s) {
      clearTimeout(settingsTimer);
      settingsTimer = setTimeout(function () {
        send("PATCH", BASE + "/settings", {
          mode: s.mode, ramp: s.ramp !== false, masterStreak: s.masterStreak,
          unlockThreshold: Math.round(s.unlockThreshold * 100) / 100, theme: s.theme
        });
      }, 300);
    },

    reset: function () {
      return send("DELETE", BASE + "/progress").then(function () { return request("GET", BASE + "/state").catch(function (e) { errorHandler(e); return null; }); });
    },

    reports: function () { return request("GET", BASE + "/reports"); },

    exportState: function () {
      request("GET", BASE + "/state").then(function (s) { download("cs330-progress.json", s); }).catch(errorHandler);
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
