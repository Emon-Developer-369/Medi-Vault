/* Medi Vault - authentication, RBAC permissions, lockout, and audit logging. */
((global) => {
  "use strict";
  const SESSION_KEY = "medivault_session_v1";
  const FLASH_KEY = "medivault_flash_v1";
  const SESSION_TTL_MS = 30 * 60 * 1000;
  const PERMS = {
    clerk: ["register", "upload", "view"],
    doctor: ["view", "edit_doc", "upload", "prescribe"],
    auditor: ["audit", "manage_users"],
    patient: ["portal"]
  };

  const getRawSession = () => { try { const r = localStorage.getItem(SESSION_KEY); return r ? JSON.parse(r) : null; } catch { return null; } };
  const saveSession = (sess) => localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
  const startSession = (u) => saveSession({ username: u.username, role: u.role, session_version: u.session_version || 0, expiresAt: Date.now() + SESSION_TTL_MS });
  const clearSession = () => localStorage.removeItem(SESSION_KEY);

  const queueFlash = (message, category = "info") => {
    try {
      const list = JSON.parse(sessionStorage.getItem(FLASH_KEY) || "[]");
      list.push({ message, category });
      sessionStorage.setItem(FLASH_KEY, JSON.stringify(list));
    } catch {}
  };

  const popFlashes = () => {
    try {
      const list = JSON.parse(sessionStorage.getItem(FLASH_KEY) || "[]");
      sessionStorage.removeItem(FLASH_KEY);
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  };

  const currentUser = () => {
    const sess = getRawSession();
    if (!sess?.username) return { user: null, reason: null };
    if (sess.expiresAt && Date.now() > sess.expiresAt) { clearSession(); return { user: null, reason: "expired" }; }
    const user = global.MediVaultDB.getState().users.find((u) => u.username === sess.username);
    if (!user || user.status !== "approved") { clearSession(); return { user: null, reason: "inactive" }; }
    if ((sess.session_version || 0) !== (user.session_version || 0)) { clearSession(); return { user: null, reason: "version_mismatch" }; }
    sess.role = user.role;
    sess.expiresAt = Date.now() + SESSION_TTL_MS;
    saveSession(sess);
    return { user, reason: null };
  };

  const permsFor = (role) => (PERMS[role] ? PERMS[role].slice() : []);
  const hasPerm = (user, perm) => Boolean(user?.role && permsFor(user.role).includes(perm));
  const landingFor = (role) => (role === "patient" ? "/portal" : role === "auditor" ? "/audit" : "/patients");

  const logAudit = (action, detail = "", outcome = "ok", actorUsername) => {
    const DB = global.MediVaultDB;
    const state = DB.getState();
    const actor = actorUsername || getRawSession()?.username || "anonymous";
    state.audit.push({ id: DB.nextId(state, "audit"), ts: DB.now(), user: actor, action, detail, outcome });
    DB.saveState(state);
  };

  const findLoginUser = (identifier) => {
    const ident = String(identifier || "").trim();
    if (!ident) return null;
    const lower = ident.toLowerCase();
    return global.MediVaultDB.getState().users.find((u) => u.username === ident || u.email?.toLowerCase() === lower) || null;
  };

  const checkLockout = (identifier) => {
    const uname = String(identifier || "").trim().toLowerCase();
    const cutoff = Date.now() - 15 * 60 * 1000;
    return global.MediVaultDB.getState().login_attempts.filter((a) => a.username_lower === uname && a.tsMs >= cutoff).length >= 5;
  };

  const recordFailedAttempt = (identifier) => {
    const DB = global.MediVaultDB;
    const state = DB.getState();
    state.login_attempts.push({ id: DB.nextId(state, "login_attempts"), username_lower: String(identifier || "").trim().toLowerCase(), ts: DB.now(), tsMs: Date.now() });
    DB.saveState(state);
  };

  const uniqueUsernameFromEmail = (email) => {
    let base = String(email || "").split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 24).replace(/^_+|_+$/g, "") || "user";
    if (base.length < 3) base = `${base}_user`.slice(0, 24);
    const users = global.MediVaultDB.getState().users;
    let candidate = base, n = 1;
    while (users.some((u) => u.username === candidate)) candidate = `${base}_${++n}`;
    return candidate;
  };

  const nextFreeMrn = () => {
    const patients = global.MediVaultDB.getState().patients;
    let n = patients.reduce((m, p) => Math.max(m, p.id), 0) + 1001;
    while (patients.some((p) => p.mrn === `MRN-${n}`)) n++;
    return `MRN-${n}`;
  };

  global.MediVaultAuth = {
    PERMS, startSession, clearSession, queueFlash, popFlashes, currentUser, permsFor, hasPerm,
    landingFor, logAudit, findLoginUser, checkLockout, recordFailedAttempt, uniqueUsernameFromEmail, nextFreeMrn
  };
})(window);
