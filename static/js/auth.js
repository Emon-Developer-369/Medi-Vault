/* Medi Vault - authentication, RBAC permissions, lockout, and audit logging. */
(function (global) {
  "use strict";

  var SESSION_KEY = "medivault_session_v1";
  var FLASH_KEY = "medivault_flash_v1";
  var SESSION_TTL_MS = 30 * 60 * 1000;

  var PERMS = {
    clerk: ["register", "upload", "view"],
    doctor: ["view", "edit_doc", "upload", "prescribe"],
    auditor: ["audit", "manage_users"],
    patient: ["portal"]
  };

  function getRawSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function startSession(user) {
    var sess = {
      username: user.username,
      role: user.role,
      session_version: user.session_version || 0,
      expiresAt: Date.now() + SESSION_TTL_MS
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
  }

  function refreshSession(sess) {
    if (!sess) return;
    sess.expiresAt = Date.now() + SESSION_TTL_MS;
    localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function queueFlash(message, category) {
    try {
      var list = JSON.parse(sessionStorage.getItem(FLASH_KEY) || "[]");
      list.push({ message: message, category: category || "info" });
      sessionStorage.setItem(FLASH_KEY, JSON.stringify(list));
    } catch (e) {
      /* ignore */
    }
  }

  function popFlashes() {
    try {
      var list = JSON.parse(sessionStorage.getItem(FLASH_KEY) || "[]");
      sessionStorage.removeItem(FLASH_KEY);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function currentUser() {
    var sess = getRawSession();
    if (!sess || !sess.username) return { user: null, reason: null };
    if (sess.expiresAt && Date.now() > sess.expiresAt) {
      clearSession();
      return { user: null, reason: "expired" };
    }
    var state = global.MediVaultDB.getState();
    var user = state.users.find(function (u) { return u.username === sess.username; });
    if (!user || user.status !== "approved") {
      clearSession();
      return { user: null, reason: "inactive" };
    }
    if ((sess.session_version || 0) !== (user.session_version || 0)) {
      clearSession();
      return { user: null, reason: "version_mismatch" };
    }
    sess.role = user.role;
    refreshSession(sess);
    return { user: user, reason: null };
  }

  function permsFor(role) {
    return PERMS[role] ? PERMS[role].slice() : [];
  }

  function hasPerm(user, perm) {
    if (!user || !user.role) return false;
    return permsFor(user.role).indexOf(perm) !== -1;
  }

  function landingFor(role) {
    if (role === "patient") return "/portal";
    if (role === "auditor") return "/audit";
    return "/patients";
  }

  function logAudit(action, detail, outcome, actorUsername) {
    var state = global.MediVaultDB.getState();
    var actor = actorUsername;
    if (!actor) {
      var sess = getRawSession();
      actor = (sess && sess.username) ? sess.username : "anonymous";
    }
    state.audit.push({
      id: global.MediVaultDB.nextId(state, "audit"),
      ts: global.MediVaultDB.now(),
      user: actor,
      action: action,
      detail: detail || "",
      outcome: outcome || "ok"
    });
    global.MediVaultDB.saveState(state);
  }

  function findLoginUser(identifier) {
    var ident = String(identifier || "").trim();
    if (!ident) return null;
    var identLower = ident.toLowerCase();
    var state = global.MediVaultDB.getState();
    return state.users.find(function (u) {
      return u.username === ident || (u.email && u.email.toLowerCase() === identLower);
    }) || null;
  }

  function checkLockout(identifier) {
    var uname = String(identifier || "").trim().toLowerCase();
    var state = global.MediVaultDB.getState();
    var cutoff = Date.now() - 15 * 60 * 1000;
    var cnt = state.login_attempts.filter(function (a) {
      return a.username_lower === uname && a.tsMs >= cutoff;
    }).length;
    return cnt >= 5;
  }

  function recordFailedAttempt(identifier) {
    var uname = String(identifier || "").trim().toLowerCase();
    var state = global.MediVaultDB.getState();
    state.login_attempts.push({
      id: global.MediVaultDB.nextId(state, "login_attempts"),
      username_lower: uname,
      ts: global.MediVaultDB.now(),
      tsMs: Date.now()
    });
    global.MediVaultDB.saveState(state);
  }

  function uniqueUsernameFromEmail(email) {
    var local = String(email || "").split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 24).replace(/^_+|_+$/g, "") || "user";
    if (local.length < 3) local = (local + "_user").slice(0, 24);
    var state = global.MediVaultDB.getState();
    var candidate = local;
    var n = 1;
    while (state.users.some(function (u) { return u.username === candidate; })) {
      n++;
      candidate = local + "_" + n;
    }
    return candidate;
  }

  function nextFreeMrn() {
    var state = global.MediVaultDB.getState();
    var maxId = state.patients.reduce(function (m, p) { return Math.max(m, p.id); }, 0);
    var n = maxId + 1001;
    while (state.patients.some(function (p) { return p.mrn === "MRN-" + n; })) {
      n++;
    }
    return "MRN-" + n;
  }

  global.MediVaultAuth = {
    PERMS: PERMS,
    startSession: startSession,
    clearSession: clearSession,
    queueFlash: queueFlash,
    popFlashes: popFlashes,
    currentUser: currentUser,
    permsFor: permsFor,
    hasPerm: hasPerm,
    landingFor: landingFor,
    logAudit: logAudit,
    findLoginUser: findLoginUser,
    checkLockout: checkLockout,
    recordFailedAttempt: recordFailedAttempt,
    uniqueUsernameFromEmail: uniqueUsernameFromEmail,
    nextFreeMrn: nextFreeMrn
  };
})(window);
