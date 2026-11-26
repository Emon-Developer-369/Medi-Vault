/* Medi Vault - client-side router, form handlers, and interactive UI. */
((global) => {
  "use strict";
  const DB = global.MediVaultDB, Auth = global.MediVaultAuth, Views = global.MediVaultViews;
  const byId = (id) => document.getElementById(id);
  let activeBlobUrl = null, confirmCallback = null;

  document.addEventListener("DOMContentLoaded", async () => {
    await DB.init();
    initConfirmModal();
    initGlobalClickDelegation();
    addEventListener("popstate", renderCurrentRoute);
    renderCurrentRoute();
  });

  const showToast = (message, type) => {
    const box = byId("toast-container");
    if (!box) return;
    const icons = { success: "bi-check-circle-fill", error: "bi-exclamation-octagon-fill", info: "bi-info-circle-fill" };
    const cat = icons[type] ? type : "info";
    const el = document.createElement("div");
    el.className = `toast mv-toast toast-${cat}`;
    el.setAttribute("role", cat === "error" ? "alert" : "status");
    el.innerHTML = `<div class="toast-body"><i class="bi ${icons[cat]} fs-5" aria-hidden="true"></i><span class="flex-grow-1"></span><button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close notification"></button></div>`;
    el.querySelector("span").textContent = message;
    box.appendChild(el);
    el.addEventListener("hidden.bs.toast", () => el.remove());
    bootstrap.Toast.getOrCreateInstance(el, { delay: 4500 }).show();
  };

  const navigate = (pathWithQuery, replace = false) => {
    const u = new URL(pathWithQuery, location.origin);
    history[replace ? "replaceState" : "pushState"]({}, "", u.pathname + u.search + u.hash);
    renderCurrentRoute();
  };

  const setPage = (title, html, isLanding, user, currentPath) => {
    document.title = title;
    const main = byId("main");
    main.className = isLanding ? "landing" : "container py-4 py-lg-5";
    main.innerHTML = html;
    const pending = DB.getState().users.filter((u) => u.status === "pending").length;
    byId("nav-root").innerHTML = Views.renderNav(user, currentPath, pending);
    if (global.MediVaultTheme) {
      const lbl = `Switch to ${global.MediVaultTheme.get() === "dark" ? "light" : "dark"} theme`;
      const btn = byId("theme-toggle");
      if (btn) { btn.setAttribute("aria-label", lbl); btn.setAttribute("title", lbl); }
    }
    initDynamicBehaviors();
    Auth.popFlashes().forEach((f) => showToast(f.message, f.category));
    if (location.hash) byId(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
    else scrollTo({ top: 0, behavior: "instant" });
  };

  const renderErrorPage = (code, title, msg, user, path) => setPage(`${code} ${title} - Medi Vault`, Views.renderError(code, title, msg), false, user, path);
  const notFound = (user, path, msg = "The requested patient record or document was not found.") => renderErrorPage(404, "Not Found", msg, user, path);

  const renderCurrentRoute = () => {
    const url = new URL(location.href), path = url.pathname.replace(/\/+$/, "") || "/", params = url.searchParams;
    const { user, reason } = Auth.currentUser();
    const reasons = {
      inactive: ["Your account is no longer active or your session has expired.", "error"],
      version_mismatch: ["Your session has ended because you were logged out or credentials changed.", "info"],
      expired: ["Your session has expired after inactivity. Please sign in again.", "info"]
    };
    if (reasons[reason]) Auth.queueFlash(...reasons[reason]);
    if (user?.must_change_password === 1 && path !== "/account/password") {
      Auth.queueFlash("You must set a new password before continuing.", "info");
      return navigate("/account/password", true);
    }

    if (path === "/") {
      if (user) return navigate(Auth.landingFor(user.role), true);
      const s = DB.getState();
      return setPage("Medi Vault | Secure healthcare platform", Views.renderHome({ patients: s.patients.length, documents: s.documents.length, audit: s.audit.length }), true, null, "/");
    }
    if (path === "/login") return user ? navigate("/", true) : setPage("Staff Login - Medi Vault", Views.renderLogin({}), false, null, "/login");
    if (path === "/patient-login") return user ? navigate("/", true) : setPage("Patient Login - Medi Vault", Views.renderPatientLogin({}), false, null, "/patient-login");
    if (path === "/signup") return user ? navigate("/", true) : setPage("Sign Up - Medi Vault", Views.renderSignup({ signup_type: params.get("type") === "staff" ? "staff" : "patient" }, {}, DB.todayIso()), false, null, "/signup");
    if (path === "/account/password") {
      if (!user) return navigate("/login", true);
      const hasPw = (user.password_set ?? 1) === 1;
      return setPage(`${hasPw ? "Change" : "Set"} Password - Medi Vault`, Views.renderPasswordChange({}, user.must_change_password === 1, hasPw), false, user, "/account/password");
    }

    const needPerm = (perm) => {
      if (!user) { navigate("/login", true); return false; }
      if (Auth.hasPerm(user, perm)) return true;
      Auth.logAudit("denied", `GET ${path} needs '${perm}'`, "denied", user.username);
      renderErrorPage(403, "Access Denied", "Your current role does not have permission for this action. This attempt has been logged.", user, path);
      return false;
    };

    if (path === "/patients") {
      if (!needPerm("view")) return;
      const q = (params.get("q") || "").trim().slice(0, 50), ql = q.toLowerCase();
      let st = DB.getState();
      const rows = st.patients.filter((p) => !ql || (p.name || "").toLowerCase().includes(ql) || (p.mrn || "").toLowerCase().includes(ql))
        .sort((a, b) => b.id - a.id).slice(0, 100)
        .map((p) => ({ ...p, doc_count: st.documents.filter((d) => d.patient_id === p.id).length }));
      if (q) { Auth.logAudit("search", q, "ok", user.username); st = DB.getState(); }
      const today = DB.todayIso();
      return setPage("Patients - Medi Vault", Views.renderPatients(q, rows, {
        patients: st.patients.length, documents: st.documents.length,
        active_rx: st.prescriptions.filter((r) => r.status === "active").length,
        today: st.patients.filter((p) => (p.created_at || "").slice(0, 10) === today).length
      }, user, Auth.permsFor(user.role)), false, user, "/patients");
    }
    if (path === "/patients/new") {
      if (!needPerm("register")) return;
      const t = DB.todayIso();
      return setPage("Register Patient - Medi Vault", Views.renderPatientNew({ registered_on: t }, {}, t), false, user, "/patients/new");
    }

    let m = path.match(/^\/patients\/(\d+)$/);
    if (m) {
      if (!needPerm("view")) return;
      const pid = +m[1], st = DB.getState(), pat = st.patients.find((p) => p.id === pid);
      if (!pat) return notFound(user, path);
      Auth.logAudit("view_patient", pat.mrn, "ok", user.username);
      return setPage(`${pat.name} - Medi Vault`, Views.renderPatientDetail(
        pat, st.documents.filter((d) => d.patient_id === pid).sort((a, b) => b.id - a.id),
        st.prescriptions.filter((r) => r.patient_id === pid).sort((a, b) => b.id - a.id), Auth.permsFor(user.role)
      ), false, user, path);
    }

    if ((m = path.match(/^\/documents\/(\d+)\/edit$/))) {
      if (!needPerm("edit_doc")) return;
      const did = +m[1], st = DB.getState(), doc = st.documents.find((d) => d.id === did), pat = doc && st.patients.find((p) => p.id === doc.patient_id);
      if (!doc || !pat) return notFound(user, path);
      const hist = st.document_history.filter((h) => h.document_id === did).sort((a, b) => (b.version - a.version) || (b.id - a.id));
      return setPage("Edit Document - Medi Vault", Views.renderDocumentEdit(doc, pat, hist), false, user, path);
    }

    if ((m = path.match(/^\/patients\/(\d+)\/prescriptions\/new$/))) {
      if (!needPerm("prescribe")) return;
      const pat = DB.getState().patients.find((p) => p.id === +m[1]);
      return pat ? setPage("New Prescription - Medi Vault", Views.renderPrescriptionNew(pat, { frequency_select: "Once daily" }, {}), false, user, path) : notFound(user, path);
    }

    if ((m = path.match(/^\/prescriptions\/(\d+)\/print$/))) {
      if (!user) return navigate("/login", true);
      const st = DB.getState(), rx = st.prescriptions.find((r) => r.id === +m[1]), pat = rx && st.patients.find((p) => p.id === rx.patient_id);
      if (!rx || !pat) return notFound(user, path);
      if (user.role === "doctor" || (user.role === "patient" && user.patient_id === rx.patient_id)) {
        return setPage("Print Prescription - Medi Vault", Views.renderPrescriptionPrint(rx, pat, user.role), false, user, path);
      }
      Auth.logAudit("denied", `GET ${path}`, "denied", user.username);
      return renderErrorPage(403, "Access Denied", "Your current role does not have permission for this action. This attempt has been logged.", user, path);
    }

    if (path === "/portal") {
      if (!needPerm("portal")) return;
      const st = DB.getState(), pat = user.patient_id && st.patients.find((p) => p.id === user.patient_id);
      if (!pat) return notFound(user, path);
      const activeRx = st.prescriptions.filter((r) => r.patient_id === pat.id && r.status === "active").sort((a, b) => b.id - a.id);
      const pastRx = st.prescriptions.filter((r) => r.patient_id === pat.id && r.status === "stopped").sort((a, b) => b.id - a.id);
      // Omit internal doctor notes, version history, or uploader usernames
      const docs = st.documents.filter((d) => d.patient_id === pat.id).sort((a, b) => b.id - a.id)
        .map(({ id, patient_id, title, doc_type, original_name, created_at }) => ({ id, patient_id, title, doc_type, original_name, created_at }));
      const updates = [
        ...docs.map((d) => ({ date: d.created_at, label: `Document added: ${d.title}`, docId: d.id, url: "#" })),
        ...[...activeRx, ...pastRx].map((r) => ({ date: r.prescribed_at, label: `Prescription added: ${r.medicine}`, url: "/portal?view=prescriptions" }))
      ].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      Auth.logAudit("portal_view", pat.mrn, "ok", user.username);
      return setPage("My patient portal | Medi Vault", Views.renderPortal(params.get("view") || "dashboard", pat, activeRx, pastRx, docs, updates), false, user, "/portal");
    }

    if (path === "/portal/profile") {
      if (!needPerm("portal")) return;
      const pat = user.patient_id && DB.getState().patients.find((p) => p.id === user.patient_id);
      return pat ? setPage("My Profile - Medi Vault", Views.renderPortalProfile(pat, user, {}, DB.todayIso()), false, user, "/portal/profile") : notFound(user, path);
    }

    if (path === "/audit") {
      if (!needPerm("audit")) return;
      const rows = DB.getState().audit.slice().sort((a, b) => b.id - a.id).slice(0, 200);
      const oc = { ok: 0, failed: 0, denied: 0, rejected: 0, blocked: 0 };
      rows.forEach((r) => { if (Object.hasOwn(oc, r.outcome)) oc[r.outcome]++; });
      return setPage("Audit Log - Medi Vault", Views.renderAudit(rows, oc), false, user, "/audit");
    }

    if (path === "/users") {
      if (!needPerm("manage_users")) return;
      let tab = (params.get("tab") || "pending").toLowerCase();
      if (!["pending", "active", "declined", "disabled", "deleted"].includes(tab)) tab = "pending";
      const st = DB.getState();
      const countStatus = (s) => st.users.filter((u) => u.status === s).length;
      const counts = { pending: countStatus("pending"), active: countStatus("approved"), declined: countStatus("declined"), disabled: countStatus("disabled"), deleted: countStatus("deleted") };
      const users = st.users.filter((u) => u.status === (tab === "active" ? "approved" : tab)).sort((a, b) => b.id - a.id)
        .map((u) => ({ ...u, patient_mrn: u.patient_id ? st.patients.find((p) => p.id === u.patient_id)?.mrn || null : null }));
      return setPage("Manage Users - Medi Vault", Views.renderUsers(users, tab, counts, user.username), false, user, "/users");
    }

    if (path === "/users/new") {
      if (!needPerm("manage_users")) return;
      return setPage("Create User - Medi Vault", Views.renderUserNew(getAvailablePatients(), {}, {}), false, user, "/users/new");
    }
    notFound(user, path);
  };

  const getAvailablePatients = () => {
    const st = DB.getState(), linked = new Set(st.users.map((u) => u.patient_id).filter(Boolean));
    return st.patients.filter((p) => !linked.has(p.id)).sort((a, b) => a.mrn.localeCompare(b.mrn));
  };

  /* ---------- Event Delegation ---------- */
  const initGlobalClickDelegation = () => {
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (t.closest(".js-google-btn")) { e.preventDefault(); return showToast("Google sign-in requires a server OAuth client. Use password sign-in or demo accounts.", "info"); }
      if (t.closest("#logout-btn")) {
        e.preventDefault();
        const cur = Auth.currentUser().user;
        if (cur) Auth.logAudit("logout", "", "ok", cur.username);
        Auth.clearSession();
        Auth.queueFlash("You have been signed out.", "info");
        return navigate(cur?.role === "patient" ? "/patient-login" : "/login");
      }
      if (t.closest("#reset-demo-btn")) {
        e.preventDefault();
        return openConfirmModal("Reset Demo Data", "Restore the original synthetic demo accounts, sample patients, lab report, and clear local changes?", false, async () => {
          await DB.reset(); Auth.clearSession(); Auth.queueFlash("Demo data restored.", "success"); navigate("/");
        });
      }
      if (t.closest(".js-back")) { e.preventDefault(); return history.length > 1 ? history.back() : navigate("/"); }
      if (t.closest("#print-btn")) { e.preventDefault(); return print(); }

      const docBtn = t.closest("[data-open-doc],[data-open-history]");
      if (docBtn) { e.preventDefault(); return openStaffDocument(+(docBtn.dataset.openDoc || docBtn.dataset.openHistory), Boolean(docBtn.dataset.openHistory)); }
      const portalBtn = t.closest("[data-open-portal-doc]");
      if (portalBtn) { e.preventDefault(); return openPortalDocument(+portalBtn.dataset.openPortalDoc); }
      const stopBtn = t.closest("[data-stop-rx]");
      if (stopBtn) {
        e.preventDefault();
        return openConfirmModal(stopBtn.dataset.confirmTitle || "Stop Prescription", stopBtn.dataset.confirm || "Stop this prescription?", true, (reason) => handleStopPrescription(+stopBtn.dataset.stopRx, reason));
      }
      const actBtn = t.closest("[data-user-action]");
      if (actBtn) {
        e.preventDefault();
        return openConfirmModal(actBtn.dataset.confirmTitle || "Confirm Action", actBtn.dataset.confirm || "Are you sure?", false, () => handleUserAction(actBtn.dataset.userAction, +actBtn.dataset.uid, actBtn.dataset.tab || "active"));
      }
      const dirBtn = t.closest("[data-user-action-direct]");
      if (dirBtn) { e.preventDefault(); return handleUserAction(dirBtn.dataset.userActionDirect, +dirBtn.dataset.uid, dirBtn.dataset.tab || "disabled"); }

      const a = t.closest("a[href]");
      if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0 && !a.hasAttribute("download") && a.target !== "_blank") {
        const href = a.getAttribute("href");
        if (!href || /^(http|mailto:|blob:|#)/.test(href)) return;
        e.preventDefault();
        const u = new URL(href, location.origin);
        if (u.pathname === location.pathname && u.search === location.search && u.hash) {
          history.pushState({}, "", u.pathname + u.search + u.hash);
          byId(u.hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
        } else navigate(href);
      }
    });

    document.addEventListener("submit", (e) => {
      const form = e.target;
      if (form?.tagName !== "FORM") return;
      e.preventDefault();
      const map = {
        "staff-login-form": () => handlePasswordLogin(form, (r) => r !== "patient"),
        "patient-login-form": () => handlePasswordLogin(form, (r) => r === "patient"),
        "signup-form": () => handleSignup(form),
        "password-change-form": () => handlePasswordChange(form),
        "patient-search-form": () => { const q = (form.q.value || "").trim().slice(0, 50); navigate(q ? `/patients?q=${encodeURIComponent(q)}` : "/patients"); },
        "patient-new-form": () => handlePatientNew(form),
        "upload-doc-form": () => handleDocumentUpload(form),
        "doc-edit-form": () => handleDocumentEdit(form),
        "rx-new-form": () => handlePrescriptionNew(form),
        "portal-profile-form": () => handlePortalProfile(form),
        "user-new-form": () => handleUserNew(form)
      };
      if (map[form.id]) return map[form.id]();
      if (form.classList.contains("user-role-form")) handleUserAction("change_role", +form.dataset.uid, form.dataset.tab, { role: form.role.value });
      else if (form.classList.contains("user-approve-form")) handleUserAction("approve", +form.dataset.uid, form.dataset.tab, { role: form.role.value, mrn: (form.mrn?.value || "").trim() });
    });
  };

  /* ---------- Handlers ---------- */
  const validateDob = (dob, today) => !/^\d{4}-\d{2}-\d{2}$/.test(dob) ? "Please enter a valid date of birth." : dob > today ? "Date of birth must be today or earlier." : +dob.slice(0, 4) < 1900 ? "Please enter a realistic date of birth." : null;

  const validateAndSaveUpload = async (file, auditDetail, sizeErrPath, user) => {
    if (file && file.size > 5 * 1024 * 1024) { renderErrorPage(413, "File Too Large", "The uploaded file exceeds the 5 MB size limit.", user, sizeErrPath); return null; }
    const ext = file?.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
    const bytes = file ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(0);
    if (!file || !DB.hasMagicSignature(bytes, ext)) {
      Auth.logAudit("upload_rejected", auditDetail, "rejected", user.username);
      showToast("Rejected: only real PDF, PNG or JPG files are allowed", "error");
      return null;
    }
    const stored = `${DB.randomHex(16)}.${ext}`;
    await DB.saveFile(stored, bytes, DB.mimeForExt(ext));
    return { stored, bytes, sha: await DB.sha256Hex(bytes), original: DB.sanitizeFilename(file.name) };
  };

  const handlePasswordLogin = async (form, allowedFn) => {
    const ident = (form.username.value || "").trim(), pw = form.password.value || "";
    if (Auth.checkLockout(ident)) { Auth.logAudit("login_locked", ident.slice(0, 30), "blocked"); return showToast("Too many attempts. Try again later.", "error"); }
    const u = Auth.findLoginUser(ident);
    if (!u || !(await DB.verifyPassword(pw, u.pw_hash)) || !allowedFn(u.role)) {
      Auth.recordFailedAttempt(ident);
      if (Auth.checkLockout(ident)) Auth.logAudit("login_locked", ident.slice(0, 30), "blocked");
      Auth.logAudit("login_failed", ident.slice(0, 30), "failed");
      return showToast("Wrong username or password", "error");
    }
    if (u.status !== "approved") {
      Auth.logAudit("login_blocked", u.username.slice(0, 30), "blocked");
      const msg = { pending: ["Your account is pending approval by an auditor.", "info"], declined: ["Your account request has been declined.", "error"], disabled: ["Your account has been disabled.", "error"] }[u.status];
      return showToast(...(msg || ["Wrong username or password", "error"]));
    }
    Auth.startSession(u);
    Auth.logAudit("login", "", "ok", u.username);
    if (u.must_change_password === 1) { Auth.queueFlash("Please set a new password before continuing.", "info"); return navigate("/account/password"); }
    Auth.queueFlash(u.role === "patient" ? `Welcome to your health portal, ${u.full_name || u.username}!` : `Welcome back, ${u.username}!`, "success");
    navigate(Auth.landingFor(u.role));
  };

  const handleSignup = async (form) => {
    const signupType = form.querySelector("#signup-type-staff").checked ? "staff" : "patient";
    const fullName = (form.full_name.value || "").trim(), email = (form.email.value || "").trim().toLowerCase();
    let username = (form.username.value || "").trim();
    const password = form.password.value || "", confirm = form.confirm_password.value || "", dobRaw = (form.dob?.value || "").trim();
    const state = DB.getState(), today = DB.todayIso(), errors = {};

    if (fullName.length < 2 || fullName.length > 100) errors.full_name = "Please enter your full name (2-100 characters).";
    if (email.length > 254 || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) errors.email = "Please enter a valid email address.";
    else if (state.users.some((u) => u.email?.toLowerCase() === email)) errors.email = "An account with this email already exists. Try signing in instead.";
    if (username) {
      if (!/^[a-z0-9_]{3,30}$/.test(username)) errors.username = "Username must be 3-30 lowercase letters, digits, or underscores.";
      else if (state.users.some((u) => u.username === username)) errors.username = "This username is already taken.";
    }
    if (password.length < 10) errors.password = "Password must be at least 10 characters long.";
    else if (password !== confirm) errors.confirm_password = "Passwords do not match.";
    if (signupType === "patient") { const dErr = validateDob(dobRaw, today); if (dErr) errors.dob = dErr; }
    if (Object.keys(errors).length) return setPage("Sign Up - Medi Vault", Views.renderSignup({ signup_type: signupType, full_name: fullName, email, username, dob: dobRaw }, errors, today), false, null, "/signup");

    if (!username) username = Auth.uniqueUsernameFromEmail(email);
    const pw_hash = await DB.hashPassword(password), ts = DB.now();
    const baseUser = { id: DB.nextId(state, "users"), username, email, full_name: fullName, pw_hash, claimed_mrn: null, must_change_password: 0, session_version: 0, password_set: 1, created_at: ts };

    if (signupType === "patient") {
      const mrn = Auth.nextFreeMrn(), patId = DB.nextId(state, "patients");
      state.patients.push({ id: patId, mrn, name: fullName, dob: dobRaw, registered_on: today, created_by: "self-signup", created_at: ts });
      const newUser = { ...baseUser, role: "patient", status: "approved", requested_role: "patient", patient_id: patId, reviewed_by: "self-signup", reviewed_at: ts };
      state.users.push(newUser); DB.saveState(state); Auth.startSession(newUser);
      Auth.logAudit("patient_self_signup", `${username} mrn ${mrn}`, "ok", username);
      Auth.queueFlash(`Account created! Your Medical Record Number is ${mrn}.`, "success");
      return navigate("/portal");
    }
    state.users.push({ ...baseUser, role: null, status: "pending", requested_role: "staff", patient_id: null, reviewed_by: null, reviewed_at: null });
    DB.saveState(state); Auth.logAudit("signup", username, "ok", username);
    Auth.queueFlash(`Account requested for '${username}'. An auditor will assign your staff role, then you can sign in.`, "success");
    navigate("/login");
  };

  const handlePasswordChange = async (form) => {
    const user = Auth.currentUser().user;
    if (!user) return navigate("/login");
    const hasPw = (user.password_set ?? 1) === 1, curPw = form.current_password?.value || "", newPw = form.new_password.value || "", errors = {};
    if (hasPw && !(await DB.verifyPassword(curPw, user.pw_hash))) errors.current_password = "Incorrect current password.";
    if (newPw.length < 10) errors.new_password = "New password must be at least 10 characters long.";
    else if (newPw === curPw) errors.new_password = "New password must differ from current password.";
    else if (newPw !== (form.confirm_password.value || "")) errors.confirm_password = "Passwords do not match.";
    if (Object.keys(errors).length) return setPage(`${hasPw ? "Change" : "Set"} Password - Medi Vault`, Views.renderPasswordChange(errors, user.must_change_password === 1, hasPw), false, user, "/account/password");

    const state = DB.getState(), target = state.users.find((u) => u.id === user.id);
    Object.assign(target, { pw_hash: await DB.hashPassword(newPw), must_change_password: 0, session_version: (target.session_version || 0) + 1, password_set: 1 });
    DB.saveState(state); Auth.startSession(target); Auth.logAudit("password_changed", user.username, "ok", user.username);
    Auth.queueFlash("Password updated successfully.", "success");
    navigate(user.role !== "patient" ? "/" : "/portal");
  };

  const handlePatientNew = (form) => {
    const user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "register")) return navigate("/login");
    const today = DB.todayIso(), name = (form.name.value || "").trim(), mrn = (form.mrn.value || "").trim();
    const dob = (form.dob.value || "").trim(), reg = (form.registered_on.value || "").trim() || today, state = DB.getState(), errors = {};
    if (name.length < 1 || name.length > 100) errors.name = "Full name must be between 1 and 100 characters.";
    if (!/^[A-Za-z0-9-]{3,20}$/.test(mrn)) errors.mrn = "MRN must be 3-20 letters, digits, or hyphens.";
    else if (state.patients.some((p) => p.mrn === mrn)) errors.mrn = "That MRN already exists.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || dob > today) errors.dob = dob > today ? "Date of birth must be today or earlier." : "Invalid date of birth.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reg) || reg < today) errors.registered_on = reg < today ? "Registration date must be today or a future date." : "Invalid registration date.";
    if (Object.keys(errors).length) return setPage("Register Patient - Medi Vault", Views.renderPatientNew({ name, mrn, dob, registered_on: reg }, errors, today), false, user, "/patients/new");

    const pid = DB.nextId(state, "patients");
    state.patients.push({ id: pid, mrn, name, dob, registered_on: reg, created_by: user.username, created_at: DB.now() });
    DB.saveState(state); Auth.logAudit("patient_created", mrn, "ok", user.username);
    Auth.queueFlash("Patient registered successfully", "success");
    navigate(`/patients/${pid}`);
  };

  const handleDocumentUpload = async (form) => {
    const user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "upload")) return navigate("/login");
    const pid = +form.dataset.patientId, state = DB.getState();
    if (!state.patients.some((x) => x.id === pid)) return notFound(user, "/patients");
    const title = (form.title.value || "").trim().slice(0, 100), docType = (form.doc_type.value || "Other").slice(0, 30);
    const file = form.querySelector("input[type='file']")?.files?.[0];
    if (!title) { Auth.logAudit("upload_rejected", `patient ${pid}`, "rejected", user.username); return showToast("Rejected: only real PDF, PNG or JPG files are allowed", "error"); }
    const saved = await validateAndSaveUpload(file, `patient ${pid}`, `/patients/${pid}`, user);
    if (!saved) return;

    const ts = DB.now(), docId = DB.nextId(state, "documents");
    state.documents.push({ id: docId, patient_id: pid, title, doc_type: docType, notes: "", stored_name: saved.stored, original_name: saved.original, size: saved.bytes.length, sha256: saved.sha, version: 1, uploaded_by: user.username, created_at: ts, updated_by: null, updated_at: null });
    state.document_history.push({ id: DB.nextId(state, "document_history"), document_id: docId, version: 1, title, doc_type: docType, notes: "", stored_name: saved.stored, sha256: saved.sha, changed_by: user.username, changed_at: ts, change_type: "created" });
    DB.saveState(state); Auth.logAudit("upload", `patient ${pid} doc ${docId}`, "ok", user.username);
    Auth.queueFlash("Document uploaded successfully", "success");
    navigate(`/patients/${pid}`);
  };

  const handleDocumentEdit = async (form) => {
    const user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "edit_doc")) return navigate("/login");
    const did = +form.dataset.docId, state = DB.getState(), doc = state.documents.find((d) => d.id === did);
    if (!doc) return notFound(user, "/patients");
    const title = (form.title.value || "").trim().slice(0, 100), docType = (form.doc_type.value || doc.doc_type).slice(0, 30), notes = (form.notes.value || "").trim();
    if (!title) return showToast("Title is required", "error");

    const file = form.querySelector("input[type='file']")?.files?.[0], ts = DB.now();
    let changeType = "document_edited";
    if (file?.name) {
      const saved = await validateAndSaveUpload(file, `patient ${doc.patient_id} doc ${did}`, `/documents/${did}/edit`, user);
      if (!saved) return;
      Object.assign(doc, { stored_name: saved.stored, original_name: saved.original, size: saved.bytes.length, sha256: saved.sha, version: (doc.version || 1) + 1 });
      changeType = "new_version";
    }
    Object.assign(doc, { title, doc_type: docType, notes, updated_by: user.username, updated_at: ts });
    state.document_history.push({ id: DB.nextId(state, "document_history"), document_id: did, version: doc.version || 1, title, doc_type: docType, notes, stored_name: doc.stored_name, sha256: doc.sha256, changed_by: user.username, changed_at: ts, change_type: changeType });
    DB.saveState(state);
    Auth.logAudit(changeType === "new_version" ? "document_version_added" : "document_edited", changeType === "new_version" ? `doc ${did} v${doc.version}` : `doc ${did} patient ${doc.patient_id}`, "ok", user.username);
    Auth.queueFlash(changeType === "new_version" ? "New document version uploaded successfully" : "Document metadata updated successfully", "success");
    navigate(`/patients/${doc.patient_id}`);
  };

  const handlePrescriptionNew = (form) => {
    const user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "prescribe")) return navigate("/login");
    const pid = +form.dataset.patientId, state = DB.getState(), patient = state.patients.find((p) => p.id === pid);
    if (!patient) return notFound(user, "/patients");
    const medicine = (form.medicine.value || "").trim().slice(0, 100), dosage = (form.dosage.value || "").trim().slice(0, 50);
    const duration = (form.duration.value || "").trim().slice(0, 50), freqSel = form.frequency_select.value || "Once daily";
    const freqOther = (form.frequency_other?.value || "").trim().slice(0, 50), instructions = (form.instructions.value || "").trim().slice(0, 500);
    const frequency = freqSel === "Other" && freqOther ? freqOther : freqSel, errors = {};
    if (!medicine) errors.medicine = "Medicine name is required (1-100 characters).";
    if (!dosage) errors.dosage = "Dosage is required (1-50 characters).";
    if (!duration) errors.duration = "Duration is required (1-50 characters).";
    if (Object.keys(errors).length) return setPage("New Prescription - Medi Vault", Views.renderPrescriptionNew(patient, { medicine, dosage, duration, frequency_select: freqSel, frequency_other: freqOther, instructions }, errors), false, user, `/patients/${pid}/prescriptions/new`);

    const rxId = DB.nextId(state, "prescriptions");
    state.prescriptions.push({ id: rxId, patient_id: pid, medicine, dosage, frequency, duration, instructions, status: "active", prescribed_by: user.username, prescribed_at: DB.now(), stopped_by: null, stopped_at: null, stop_reason: null });
    DB.saveState(state);
    Auth.logAudit("prescription_added", `rx ${rxId} patient ${patient.mrn}`, "ok", user.username);
    Auth.queueFlash("Prescription added successfully.", "success");
    navigate(`/patients/${pid}`);
  };

  const handleStopPrescription = (rxId, reason) => {
    const user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "prescribe")) return navigate("/login");
    const state = DB.getState(), rx = state.prescriptions.find((r) => r.id === rxId);
    if (!rx) return notFound(user, "/patients");
    if (rx.status !== "active") { Auth.queueFlash("Prescription is already stopped.", "info"); return navigate(`/patients/${rx.patient_id}`); }
    Object.assign(rx, { status: "stopped", stopped_by: user.username, stopped_at: DB.now(), stop_reason: (reason || "").trim().slice(0, 200) });
    DB.saveState(state);
    const pat = state.patients.find((p) => p.id === rx.patient_id);
    Auth.logAudit("prescription_stopped", `rx ${rxId} patient ${pat ? pat.mrn : "unknown"}`, "ok", user.username);
    Auth.queueFlash("Prescription stopped.", "info");
    navigate(`/patients/${rx.patient_id}`);
  };

  const handlePortalProfile = (form) => {
    const user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "portal")) return navigate("/patient-login");
    const state = DB.getState(), pat = state.patients.find((p) => p.id === user.patient_id);
    if (!pat) return notFound(user, "/portal");
    if (pat.dob) { Auth.queueFlash("Your date of birth is already on file. Ask hospital staff to correct it.", "info"); return navigate("/portal"); }
    const dob = (form.dob.value || "").trim(), today = DB.todayIso(), err = validateDob(dob, today);
    if (err) return setPage("My Profile - Medi Vault", Views.renderPortalProfile(pat, user, { dob: err }, today), false, user, "/portal/profile");
    pat.dob = dob; DB.saveState(state); Auth.logAudit("patient_profile_updated", pat.mrn, "ok", user.username);
    Auth.queueFlash("Profile updated.", "success");
    navigate("/portal");
  };

  const handleUserNew = async (form) => {
    const user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "manage_users")) return navigate("/login");
    const username = (form.username.value || "").trim(), role = (form.role.value || "").trim();
    const password = (form.password.value || "").trim(), mrn = (form.mrn?.value || "").trim();
    const state = DB.getState(), errors = {};
    if (!/^[a-z0-9_]{3,30}$/.test(username)) errors.username = "Username must be 3-30 lowercase letters, numbers, or underscores.";
    else if (state.users.some((u) => u.username === username)) errors.username = "Username already exists (including reserved/deleted accounts).";
    if (!Auth.PERMS[role]) errors.role = "Invalid role selected.";
    if (password.length < 10) errors.password = "Password must be at least 10 characters long.";

    let patient_id = null;
    if (role === "patient") {
      const pat = mrn && state.patients.find((p) => p.mrn === mrn);
      if (!mrn) errors.mrn = "Must select a patient MRN to link.";
      else if (!pat) errors.mrn = "Selected MRN was not found.";
      else if (state.users.some((u) => u.patient_id === pat.id)) errors.mrn = "That patient record is already linked to another account.";
      else patient_id = pat.id;
    } else if (mrn) errors.mrn = "Cannot link patient record to non-patient role.";

    if (Object.keys(errors).length) return setPage("Create User - Medi Vault", Views.renderUserNew(getAvailablePatients(), { username, role, password, mrn }, errors), false, user, "/users/new");
    const ts = DB.now();
    state.users.push({ id: DB.nextId(state, "users"), username, email: null, full_name: null, pw_hash: await DB.hashPassword(password), role, status: "approved", requested_role: null, claimed_mrn: null, patient_id, must_change_password: 1, session_version: 0, password_set: 1, created_at: ts, reviewed_by: user.username, reviewed_at: ts });
    DB.saveState(state); Auth.logAudit("user_created", `${username} (${role})${mrn ? ` mrn ${mrn}` : ""}`, "ok", user.username);
    setPage("User Account Created - Medi Vault", Views.renderUserCreatedResult("User Account Created", `Account '${username}' (${role}) provisioned successfully with temporary credentials.`, username, password), false, user, "/users");
  };

  const handleUserAction = async (action, uid, tab, extra = {}) => {
    const user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "manage_users")) return navigate("/login");
    const state = DB.getState(), target = state.users.find((u) => u.id === uid);
    if (!target) return notFound(user, "/users", "The requested user account was not found.");
    const back = (msg, cat = "error") => { Auth.queueFlash(msg, cat); navigate(`/users?tab=${tab}`); };
    if (target.username === user.username) return back("You cannot perform administrative actions on your own account.");
    const lastAuditor = () => target.role === "auditor" && target.status === "approved" && state.users.filter((u) => u.role === "auditor" && u.status === "approved").length <= 1;
    const needStatus = (allowed, verb) => allowed.includes(target.status) ? true : (back(`Cannot ${verb} '${target.username}' while the account is ${target.status}.`), false);
    const commit = (auditAct, detail, msg, cat = "info") => { target.session_version = (target.session_version || 0) + 1; DB.saveState(state); Auth.logAudit(auditAct, detail, "ok", user.username); back(msg, cat); };

    if (action === "approve") {
      if (!needStatus(["pending", "declined"], "approve")) return;
      const role = extra.role || "";
      if (!Auth.PERMS[role]) return back("Invalid role selected.");
      let patient_id = null, mrnDetail = "";
      if (role === "patient") {
        const mrn = extra.mrn || "", pat = mrn && state.patients.find((p) => p.mrn === mrn);
        if (!mrn) return back(`Must choose a patient MRN to approve user '${target.username}' as patient.`);
        if (!pat) return back(`Specified MRN '${mrn}' does not exist.`);
        if (state.users.some((u) => u.patient_id === pat.id && u.id !== uid)) return back(`That patient record '${mrn}' is already linked to another account.`);
        patient_id = pat.id; mrnDetail = ` mrn ${mrn}`;
      }
      Object.assign(target, { status: "approved", role, patient_id, reviewed_by: user.username, reviewed_at: DB.now() });
      return commit("user_approved", `${target.username} (${role})${mrnDetail}`, `User '${target.username}' approved as ${role}.`, "success");
    }
    if (action === "decline") {
      if (!needStatus(["pending"], "decline")) return;
      Object.assign(target, { status: "declined", reviewed_by: user.username, reviewed_at: DB.now() });
      return commit("user_declined", target.username, `User request for '${target.username}' declined.`);
    }
    if (action === "change_role") {
      if (!needStatus(["approved"], "change the role of")) return;
      const newRole = extra.role || "";
      if (!Auth.PERMS[newRole]) return back("Invalid role selected.");
      if (newRole === "patient" && !target.patient_id) return back("A patient account must be linked to a patient record. Create a new patient user (with an MRN) instead.");
      if (newRole !== "auditor" && lastAuditor()) return back("Action blocked: cannot demote the last active auditor.");
      const oldRole = target.role;
      Object.assign(target, { role: newRole, patient_id: newRole === "patient" ? target.patient_id : null });
      return commit("user_role_changed", `${target.username}: ${oldRole} -> ${newRole}`, `Role for '${target.username}' updated to ${newRole}.`, "success");
    }
    if (action === "force_logout") return needStatus(["approved"], "log out") && commit("user_force_logout", target.username, `User '${target.username}' has been logged out immediately.`);
    if (action === "reset_password") {
      if (!needStatus(["approved"], "reset the password of")) return;
      const tempPw = DB.generateTempPassword();
      Object.assign(target, { pw_hash: await DB.hashPassword(tempPw), must_change_password: 1, session_version: (target.session_version || 0) + 1 });
      DB.saveState(state); Auth.logAudit("user_password_reset", target.username, "ok", user.username);
      showToast(`Password reset for user '${target.username}'. Temporary password generated.`, "success");
      return setPage("Password Reset - Medi Vault", Views.renderUserCreatedResult("Password Reset", `A new temporary password was generated for '${target.username}'. Active sessions have been invalidated.`, target.username, tempPw), false, user, "/users");
    }
    if (action === "disable") {
      if (lastAuditor()) return back("Action blocked: cannot disable or delete the last active auditor.");
      if (!needStatus(["approved"], "disable")) return;
      target.status = "disabled";
      return commit("user_disabled", target.username, `User '${target.username}' disabled.`);
    }
    if (action === "enable") {
      if (!needStatus(["disabled"], "enable")) return;
      target.status = "approved";
      return commit("user_enabled", target.username, `User '${target.username}' enabled.`, "success");
    }
    if (action === "delete") {
      if (lastAuditor()) return back("Action blocked: cannot disable or delete the last active auditor.");
      if (!needStatus(["pending", "approved", "declined", "disabled"], "delete")) return;
      target.status = "deleted";
      return commit("user_deleted", target.username, `User '${target.username}' deleted.`);
    }
  };

  /* ---------- Document Preview & Confirm Modal ---------- */
  const openFilePreview = async (storedName, title, downloadName) => {
    const rec = await DB.getFile(storedName);
    if (!rec) return showToast("File data is missing in local browser storage.", "error");
    if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
    activeBlobUrl = URL.createObjectURL(new Blob([rec.bytes], { type: rec.mimeType || "application/octet-stream" }));
    byId("file-viewer-title").textContent = title || downloadName || "Document Preview";
    const dl = byId("file-viewer-download");
    dl.href = activeBlobUrl; dl.download = downloadName || storedName;
    byId("file-viewer-body").innerHTML = (rec.mimeType || "").startsWith("image/")
      ? `<div class="p-4 text-center"><img src="${activeBlobUrl}" alt="${Views.esc(title)}" class="img-fluid rounded-3 shadow-sm" style="max-height: 72vh;"></div>`
      : `<iframe src="${activeBlobUrl}" title="${Views.esc(title)}" style="width: 100%; height: 72vh; border: 0;"></iframe>`;
    bootstrap.Modal.getOrCreateInstance(byId("file-viewer-modal")).show();
  };

  const openStaffDocument = async (id, isHistory) => {
    const user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "view")) { Auth.logAudit("denied", `open document ${id}`, "denied", user?.username || "anonymous"); return showToast("Access denied.", "error"); }
    const state = DB.getState();
    if (isHistory) {
      const h = state.document_history.find((x) => x.id === id);
      if (!h) return showToast("Document snapshot not found.", "error");
      Auth.logAudit("view_document", `doc ${h.document_id} v${h.version} history ${id}`, "ok", user.username);
      return openFilePreview(h.stored_name, `${h.title} (v${h.version})`, h.stored_name.endsWith(".pdf") ? `v${h.version}_${h.title}.pdf` : h.stored_name);
    }
    const d = state.documents.find((x) => x.id === id);
    if (!d) return showToast("Document not found.", "error");
    Auth.logAudit("view_document", `doc ${id} patient ${d.patient_id}`, "ok", user.username);
    openFilePreview(d.stored_name, d.title, d.original_name);
  };

  const openPortalDocument = async (did) => {
    const user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "portal") || !user.patient_id) return showToast("Access denied.", "error");
    const doc = DB.getState().documents.find((d) => d.id === did);
    if (!doc || doc.patient_id !== user.patient_id) return notFound(user, "/portal");
    Auth.logAudit("portal_document_view", `doc ${did}`, "ok", user.username);
    openFilePreview(doc.stored_name, doc.title, doc.original_name);
  };

  const initConfirmModal = () => {
    const modalEl = byId("confirm-modal");
    if (!modalEl) return;
    const wrap = byId("modal-reason-container"), input = byId("modal-reason-input"), btn = modalEl.querySelector(".modal-confirm-btn");
    modalEl.addEventListener("shown.bs.modal", () => (wrap.classList.contains("d-none") ? btn : input).focus());
    modalEl.addEventListener("hidden.bs.modal", () => { confirmCallback = null; });
    btn.addEventListener("click", () => {
      const cb = confirmCallback, reason = wrap.classList.contains("d-none") ? "" : input.value.trim();
      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      if (cb) cb(reason);
    });
  };

  const openConfirmModal = (title, message, hasReason, onConfirm) => {
    const modalEl = byId("confirm-modal");
    modalEl.querySelector(".modal-title").textContent = title || "Confirm Action";
    modalEl.querySelector(".modal-body-text").textContent = message || "Are you sure?";
    byId("modal-reason-container").classList.toggle("d-none", !hasReason);
    byId("modal-reason-input").value = "";
    confirmCallback = onConfirm;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  };

  /* ---------- Per-render UI widgets ---------- */
  const initDynamicBehaviors = () => {
    initPasswordToggles(); initPasswordStrength(); initDropzones(); initClientFilter(); initAuditFilter();
    initPasswordGenerator(); initRoleToggle(); initSignupTypeToggle(); initFrequencyToggle(); initCopyButtons(); initCounters();
  };

  const initPasswordToggles = () => document.querySelectorAll(".password-toggle-btn").forEach((btn) => btn.addEventListener("click", () => {
    const input = byId(btn.dataset.target);
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    btn.innerHTML = `<i class="bi bi-eye${show ? "-slash" : ""}" aria-hidden="true"></i>`;
  }));

  const initPasswordStrength = () => {
    const input = byId("password") || byId("new_password"), bar = byId("password-strength-bar"), text = byId("password-strength-text");
    const confirm = byId("confirm_password"), matchText = byId("password-match-text");
    if (!input || !bar || !text) return;
    const levels = [["10%", "var(--mv-danger)", "Too short - use at least 10 characters."], ["25%", "var(--mv-danger)", "Weak - add more variety."], ["50%", "var(--mv-warning)", "Fair - add numbers or symbols."], ["70%", "var(--mv-teal)", "Good password."], ["85%", "var(--mv-teal)", "Strong password."], ["100%", "var(--mv-emerald)", "Excellent password!"]];
    const score = (pw) => { const s = (pw.length >= 10) + (pw.length >= 14) + (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) + /\d/.test(pw) + /[^A-Za-z0-9]/.test(pw); return pw.length < 10 ? Math.min(s, 1) : s; };
    const checkMatch = () => {
      if (!confirm || !matchText) return;
      if (!confirm.value) { matchText.textContent = ""; matchText.className = "form-text"; return; }
      const ok = confirm.value === input.value;
      matchText.textContent = ok ? "Passwords match." : "Passwords do not match yet.";
      matchText.className = `form-text ${ok ? "text-success" : "text-danger"}`;
    };
    input.addEventListener("input", () => {
      const pw = input.value;
      if (!pw) { bar.style.width = "0"; text.textContent = "At least 10 characters."; }
      else { const [w, c, t] = levels[pw.length < 10 ? 0 : Math.max(1, score(pw))]; bar.style.width = w; bar.style.backgroundColor = c; text.textContent = t; }
      checkMatch();
    });
    confirm?.addEventListener("input", checkMatch);
  };

  const initDropzones = () => document.querySelectorAll(".dropzone").forEach((dz) => {
    const input = dz.querySelector("input[type='file']"), preview = dz.querySelector(".dropzone-preview");
    if (!input || !preview) return;
    const maxBytes = +(dz.dataset.maxBytes || 5242880);
    const render = (file) => {
      if (!file) { preview.classList.remove("is-visible"); preview.innerHTML = ""; return; }
      const size = file.size > 1048576 ? `${(file.size / 1048576).toFixed(2)} MB` : `${(file.size / 1024).toFixed(1)} KB`;
      const okType = ["pdf", "png", "jpg", "jpeg"].includes((file.name.split(".").pop() || "").toLowerCase()), okSize = file.size <= maxBytes;
      const msg = !okType ? "Only PDF, PNG or JPG files are allowed." : !okSize ? "File is larger than 5 MB." : "Ready to upload.";
      preview.innerHTML = `<div class="alert ${okType && okSize ? "alert-success" : "alert-danger"} py-2 px-3 mb-0 rounded-3 small d-inline-flex gap-2 align-items-center"><i class="bi ${okType && okSize ? "bi-file-earmark-check" : "bi-exclamation-triangle"}" aria-hidden="true"></i><span><strong></strong> (${size}) - ${msg}</span></div>`;
      preview.querySelector("strong").textContent = file.name;
      preview.classList.add("is-visible");
    };
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("is-dragover"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("is-dragover"); }));
    dz.addEventListener("drop", (e) => { if (e.dataTransfer?.files.length) { input.files = e.dataTransfer.files; render(input.files[0]); } });
    input.addEventListener("change", () => render(input.files[0]));
  });

  const initClientFilter = () => {
    const input = byId("client-patient-filter"), table = byId("patients-table"), empty = byId("patient-filter-empty");
    if (!input || !table) return;
    input.addEventListener("input", () => {
      const val = input.value.toLowerCase().trim();
      let visible = 0;
      table.querySelectorAll("tbody tr").forEach((r) => { const m = r.textContent.toLowerCase().includes(val); r.style.display = m ? "" : "none"; if (m) visible++; });
      if (empty) empty.style.display = visible ? "none" : "block";
    });
  };

  const initAuditFilter = () => {
    const table = byId("audit-table");
    if (!table) return;
    const uIn = byId("audit-filter-user"), aIn = byId("audit-filter-action"), chips = document.querySelectorAll("#audit-outcome-chips .filter-chip"), empty = byId("audit-filter-empty");
    let outcome = "";
    const apply = () => {
      const u = uIn?.value.toLowerCase().trim() || "", a = aIn?.value.toLowerCase().trim() || "";
      let shown = 0;
      table.querySelectorAll("tbody tr").forEach((r) => {
        const ok = (!u || (r.dataset.user || "").toLowerCase().includes(u)) && (!a || (r.dataset.action || "").toLowerCase().includes(a)) && (!outcome || r.dataset.outcome === outcome);
        r.style.display = ok ? "" : "none";
        if (ok) shown++;
      });
      if (empty) empty.style.display = shown ? "none" : "block";
    };
    chips.forEach((chip) => chip.addEventListener("click", () => {
      outcome = chip.dataset.outcome || "";
      chips.forEach((c) => { const on = c === chip; c.classList.toggle("active", on); c.setAttribute("aria-pressed", String(on)); });
      apply();
    }));
    uIn?.addEventListener("input", apply);
    aIn?.addEventListener("input", apply);
  };

  const initPasswordGenerator = () => document.querySelectorAll(".generate-password-btn").forEach((btn) => btn.addEventListener("click", () => {
    const input = byId(btn.dataset.target || "password");
    if (!input) return;
    const pw = DB.generateTempPassword();
    [input, byId("confirm_password")].filter(Boolean).forEach((el) => { el.value = pw; el.type = "text"; el.dispatchEvent(new Event("input")); });
    showToast("Strong password generated.", "success");
  }));

  const initRoleToggle = () => document.querySelectorAll(".role-select-toggle").forEach((sel) => {
    const box = byId(sel.dataset.patientField || "patient-mrn-group");
    if (!box) return;
    const sync = () => { const isP = sel.value === "patient"; box.style.display = isP ? "" : "none"; const f = box.querySelector("input, select"); if (f) f.required = isP; };
    sel.addEventListener("change", sync);
    sync();
  });

  const initSignupTypeToggle = () => {
    const pat = byId("signup-type-patient"), staff = byId("signup-type-staff"), dobGroup = byId("patient-dob-group"), label = byId("signup-submit-label");
    if (!pat || !staff || !dobGroup) return;
    const sync = () => {
      const isP = pat.checked;
      dobGroup.style.display = isP ? "" : "none";
      const dob = byId("dob"); if (dob) dob.required = isP;
      if (label) label.textContent = isP ? "Create my account" : "Request staff account";
    };
    pat.addEventListener("change", sync); staff.addEventListener("change", sync); sync();
  };

  const initFrequencyToggle = () => {
    const sel = byId("frequency_select"), grp = byId("frequency-other-group");
    if (sel && grp) sel.addEventListener("change", () => { grp.hidden = sel.value !== "Other"; if (!grp.hidden) byId("frequency_other").focus(); });
  };

  const initCopyButtons = () => document.querySelectorAll(".copy-btn").forEach((btn) => btn.addEventListener("click", async () => {
    const text = btn.dataset.copy;
    if (!text || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      const span = btn.querySelector("span");
      if (span) { const old = span.textContent; span.textContent = "Copied!"; setTimeout(() => { span.textContent = old; }, 2000); }
      showToast("Copied to clipboard.", "success");
    } catch { showToast("Could not copy to clipboard.", "error"); }
  }));

  const initCounters = () => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll("[data-count]").forEach((el) => {
      const target = +el.dataset.count || 0;
      if (!target) return;
      let start = null;
      const step = (ts) => {
        if (!start) start = ts;
        const p = Math.min((ts - start) / 650, 1);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      el.textContent = "0";
      requestAnimationFrame(step);
    });
  };
})(window);
