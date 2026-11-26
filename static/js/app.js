/* Medi Vault - client-side router, form handlers, and interactive UI (100% HTML/CSS/JS) */
(function (global) {
  "use strict";

  var DB = global.MediVaultDB;
  var Auth = global.MediVaultAuth;
  var Views = global.MediVaultViews;

  var activeBlobUrl = null;
  var confirmCallback = null;

  document.addEventListener("DOMContentLoaded", async function () {
    await DB.init();
    initConfirmModal();
    initGlobalClickDelegation();
    window.addEventListener("popstate", function () {
      renderCurrentRoute();
    });
    renderCurrentRoute();
  });

  /* ---------- Toast helpers ---------- */
  function showToast(message, type) {
    var container = document.getElementById("toast-container");
    if (!container) return;
    var icons = {
      success: "bi-check-circle-fill",
      error: "bi-exclamation-octagon-fill",
      info: "bi-info-circle-fill"
    };
    var cat = type === "success" || type === "error" || type === "info" ? type : "info";
    var el = document.createElement("div");
    el.className = "toast mv-toast toast-" + cat;
    el.setAttribute("role", cat === "error" ? "alert" : "status");
    el.innerHTML =
      '<div class="toast-body"><i class="bi ' + icons[cat] + ' fs-5" aria-hidden="true"></i>' +
      '<span class="flex-grow-1"></span>' +
      '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close notification"></button></div>';
    el.querySelector("span").textContent = message;
    container.appendChild(el);
    var t = bootstrap.Toast.getOrCreateInstance(el, { delay: 4500 });
    el.addEventListener("hidden.bs.toast", function () { el.remove(); });
    t.show();
  }

  function flushFlashes() {
    var items = Auth.popFlashes();
    items.forEach(function (f) {
      showToast(f.message, f.category);
    });
  }

  /* ---------- Navigation & rendering ---------- */
  function navigate(pathWithQueryAndHash, replace) {
    var url = new URL(pathWithQueryAndHash, window.location.origin);
    var target = url.pathname + url.search + url.hash;
    if (replace) {
      history.replaceState({}, "", target);
    } else {
      history.pushState({}, "", target);
    }
    renderCurrentRoute();
  }

  function setPage(title, html, isLanding, user, currentPath) {
    document.title = title;
    var main = document.getElementById("main");
    main.className = isLanding ? "landing" : "container py-4 py-lg-5";
    main.innerHTML = html;

    var state = DB.getState();
    var pendingCount = state.users.filter(function (u) { return u.status === "pending"; }).length;
    var navRoot = document.getElementById("nav-root");
    navRoot.innerHTML = Views.renderNav(user, currentPath, pendingCount);

    // Sync theme toggle aria-label after nav re-render
    if (global.MediVaultTheme) {
      var curTheme = global.MediVaultTheme.get();
      var nextTheme = curTheme === "dark" ? "light" : "dark";
      var btn = document.getElementById("theme-toggle");
      if (btn) {
        btn.setAttribute("aria-label", "Switch to " + nextTheme + " theme");
        btn.setAttribute("title", "Switch to " + nextTheme + " theme");
      }
    }

    initDynamicBehaviors();
    flushFlashes();

    if (window.location.hash) {
      var targetEl = document.getElementById(window.location.hash.slice(1));
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth" });
      }
    } else {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }

  function renderErrorPage(code, title, message, user, path) {
    setPage(code + " " + title + " - Medi Vault", Views.renderError(code, title, message), false, user, path);
  }

  function renderCurrentRoute() {
    var url = new URL(window.location.href);
    var path = url.pathname.replace(/\/+$/, "") || "/";
    var params = url.searchParams;

    var authCheck = Auth.currentUser();
    var user = authCheck.user;
    if (authCheck.reason === "inactive") {
      Auth.queueFlash("Your account is no longer active or your session has expired.", "error");
    } else if (authCheck.reason === "version_mismatch") {
      Auth.queueFlash("Your session has ended because you were logged out or credentials changed.", "info");
    } else if (authCheck.reason === "expired") {
      Auth.queueFlash("Your session has expired after inactivity. Please sign in again.", "info");
    }

    // Forced password change check
    if (user && user.must_change_password === 1 && path !== "/account/password") {
      Auth.queueFlash("You must set a new password before continuing.", "info");
      navigate("/account/password", true);
      return;
    }

    // Route matching
    if (path === "/") {
      if (user) {
        navigate(Auth.landingFor(user.role), true);
        return;
      }
      var s = DB.getState();
      setPage(
        "Medi Vault | Secure healthcare platform",
        Views.renderHome({ patients: s.patients.length, documents: s.documents.length, audit: s.audit.length }),
        true,
        null,
        "/"
      );
      return;
    }

    if (path === "/login") {
      if (user) { navigate("/", true); return; }
      setPage("Staff Login - Medi Vault", Views.renderLogin({}), false, null, "/login");
      return;
    }

    if (path === "/patient-login") {
      if (user) { navigate("/", true); return; }
      setPage("Patient Login - Medi Vault", Views.renderPatientLogin({}), false, null, "/patient-login");
      return;
    }

    if (path === "/signup") {
      if (user) { navigate("/", true); return; }
      var signupType = params.get("type") === "staff" ? "staff" : "patient";
      setPage("Sign Up - Medi Vault", Views.renderSignup({ signup_type: signupType }, {}, DB.todayIso()), false, null, "/signup");
      return;
    }

    if (path === "/account/password") {
      if (!user) { navigate("/login", true); return; }
      var hasPw = (user.password_set !== undefined && user.password_set !== null ? user.password_set : 1) === 1;
      setPage(
        (hasPw ? "Change" : "Set") + " Password - Medi Vault",
        Views.renderPasswordChange({}, user.must_change_password === 1, hasPw),
        false,
        user,
        "/account/password"
      );
      return;
    }

    // Helper for protected routes
    function needPerm(perm) {
      if (!user) {
        navigate("/login", true);
        return false;
      }
      if (!Auth.hasPerm(user, perm)) {
        Auth.logAudit("denied", "GET " + path + " needs '" + perm + "'", "denied", user.username);
        renderErrorPage(403, "Access Denied", "Your current role does not have permission for this action. This attempt has been logged.", user, path);
        return false;
      }
      return true;
    }

    if (path === "/patients") {
      if (!needPerm("view")) return;
      var q = (params.get("q") || "").trim().slice(0, 50);
      var qLower = q.toLowerCase();
      var state = DB.getState();
      var rows = state.patients
        .filter(function (p) {
          if (!qLower) return true;
          return (p.name || "").toLowerCase().indexOf(qLower) !== -1 || (p.mrn || "").toLowerCase().indexOf(qLower) !== -1;
        })
        .slice()
        .sort(function (a, b) { return b.id - a.id; })
        .slice(0, 100)
        .map(function (p) {
          var docCount = state.documents.filter(function (d) { return d.patient_id === p.id; }).length;
          return Object.assign({}, p, { doc_count: docCount });
        });
      if (q) {
        Auth.logAudit("search", q, "ok", user.username);
        state = DB.getState();
      }
      var today = DB.todayIso();
      var stats = {
        patients: state.patients.length,
        documents: state.documents.length,
        active_rx: state.prescriptions.filter(function (r) { return r.status === "active"; }).length,
        today: state.patients.filter(function (p) { return (p.created_at || "").slice(0, 10) === today; }).length
      };
      setPage("Patients - Medi Vault", Views.renderPatients(q, rows, stats, user, Auth.permsFor(user.role)), false, user, "/patients");
      return;
    }

    if (path === "/patients/new") {
      if (!needPerm("register")) return;
      var todayDate = DB.todayIso();
      setPage("Register Patient - Medi Vault", Views.renderPatientNew({ registered_on: todayDate }, {}, todayDate), false, user, "/patients/new");
      return;
    }

    var matchPatientDetail = path.match(/^\/patients\/(\d+)$/);
    if (matchPatientDetail) {
      if (!needPerm("view")) return;
      var pid = parseInt(matchPatientDetail[1], 10);
      var st = DB.getState();
      var patient = st.patients.find(function (p) { return p.id === pid; });
      if (!patient) {
        renderErrorPage(404, "Not Found", "The requested patient record or document was not found.", user, path);
        return;
      }
      var docs = st.documents.filter(function (d) { return d.patient_id === pid; }).sort(function (a, b) { return b.id - a.id; });
      var rxs = st.prescriptions.filter(function (r) { return r.patient_id === pid; }).sort(function (a, b) { return b.id - a.id; });
      Auth.logAudit("view_patient", patient.mrn, "ok", user.username);
      setPage(patient.name + " - Medi Vault", Views.renderPatientDetail(patient, docs, rxs, Auth.permsFor(user.role)), false, user, path);
      return;
    }

    var matchDocEdit = path.match(/^\/documents\/(\d+)\/edit$/);
    if (matchDocEdit) {
      if (!needPerm("edit_doc")) return;
      var did = parseInt(matchDocEdit[1], 10);
      var stDoc = DB.getState();
      var doc = stDoc.documents.find(function (d) { return d.id === did; });
      var patDoc = doc ? stDoc.patients.find(function (p) { return p.id === doc.patient_id; }) : null;
      if (!doc || !patDoc) {
        renderErrorPage(404, "Not Found", "The requested patient record or document was not found.", user, path);
        return;
      }
      var hist = stDoc.document_history
        .filter(function (h) { return h.document_id === did; })
        .sort(function (a, b) { return (b.version - a.version) || (b.id - a.id); });
      setPage("Edit Document - Medi Vault", Views.renderDocumentEdit(doc, patDoc, hist), false, user, path);
      return;
    }

    var matchRxNew = path.match(/^\/patients\/(\d+)\/prescriptions\/new$/);
    if (matchRxNew) {
      if (!needPerm("prescribe")) return;
      var rxPid = parseInt(matchRxNew[1], 10);
      var stRx = DB.getState();
      var rxPat = stRx.patients.find(function (p) { return p.id === rxPid; });
      if (!rxPat) {
        renderErrorPage(404, "Not Found", "The requested patient record or document was not found.", user, path);
        return;
      }
      setPage("New Prescription - Medi Vault", Views.renderPrescriptionNew(rxPat, { frequency_select: "Once daily" }, {}), false, user, path);
      return;
    }

    var matchRxPrint = path.match(/^\/prescriptions\/(\d+)\/print$/);
    if (matchRxPrint) {
      if (!user) { navigate("/login", true); return; }
      var rxId = parseInt(matchRxPrint[1], 10);
      var stPrint = DB.getState();
      var rx = stPrint.prescriptions.find(function (r) { return r.id === rxId; });
      var patPrint = rx ? stPrint.patients.find(function (p) { return p.id === rx.patient_id; }) : null;
      if (!rx || !patPrint) {
        renderErrorPage(404, "Not Found", "The requested patient record or document was not found.", user, path);
        return;
      }
      if (user.role === "doctor" || (user.role === "patient" && user.patient_id === rx.patient_id)) {
        setPage("Print Prescription - Medi Vault", Views.renderPrescriptionPrint(rx, patPrint, user.role), false, user, path);
      } else {
        Auth.logAudit("denied", "GET " + path, "denied", user.username);
        renderErrorPage(403, "Access Denied", "Your current role does not have permission for this action. This attempt has been logged.", user, path);
      }
      return;
    }

    if (path === "/portal") {
      if (!needPerm("portal")) return;
      var stPortal = DB.getState();
      var pPat = user.patient_id ? stPortal.patients.find(function (p) { return p.id === user.patient_id; }) : null;
      if (!pPat) {
        renderErrorPage(404, "Not Found", "The requested patient record or document was not found.", user, path);
        return;
      }
      var activeRx = stPortal.prescriptions.filter(function (r) { return r.patient_id === pPat.id && r.status === "active"; }).sort(function (a, b) { return b.id - a.id; });
      var pastRx = stPortal.prescriptions.filter(function (r) { return r.patient_id === pPat.id && r.status === "stopped"; }).sort(function (a, b) { return b.id - a.id; });
      // Strictly omit internal doctor notes, version history, or uploader usernames
      var pDocs = stPortal.documents
        .filter(function (d) { return d.patient_id === pPat.id; })
        .sort(function (a, b) { return b.id - a.id; })
        .map(function (d) {
          return { id: d.id, patient_id: d.patient_id, title: d.title, doc_type: d.doc_type, original_name: d.original_name, created_at: d.created_at };
        });

      var updates = pDocs.map(function (d) {
        return { date: d.created_at, label: "Document added: " + d.title, docId: d.id, url: "#" };
      }).concat(activeRx.concat(pastRx).map(function (r) {
        return { date: r.prescribed_at, label: "Prescription added: " + r.medicine, url: "/portal?view=prescriptions" };
      })).sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });

      Auth.logAudit("portal_view", pPat.mrn, "ok", user.username);
      setPage(
        "My patient portal | Medi Vault",
        Views.renderPortal(params.get("view") || "dashboard", pPat, activeRx, pastRx, pDocs, updates),
        false,
        user,
        "/portal"
      );
      return;
    }

    if (path === "/portal/profile") {
      if (!needPerm("portal")) return;
      var stProf = DB.getState();
      var profPat = user.patient_id ? stProf.patients.find(function (p) { return p.id === user.patient_id; }) : null;
      if (!profPat) {
        renderErrorPage(404, "Not Found", "The requested patient record or document was not found.", user, path);
        return;
      }
      setPage("My Profile - Medi Vault", Views.renderPortalProfile(profPat, user, {}, DB.todayIso()), false, user, "/portal/profile");
      return;
    }

    if (path === "/audit") {
      if (!needPerm("audit")) return;
      var stAudit = DB.getState();
      var auditRows = stAudit.audit.slice().sort(function (a, b) { return b.id - a.id; }).slice(0, 200);
      var outcomeCounts = { ok: 0, failed: 0, denied: 0, rejected: 0, blocked: 0 };
      auditRows.forEach(function (r) {
        if (Object.prototype.hasOwnProperty.call(outcomeCounts, r.outcome)) {
          outcomeCounts[r.outcome]++;
        }
      });
      setPage("Audit Log - Medi Vault", Views.renderAudit(auditRows, outcomeCounts), false, user, "/audit");
      return;
    }

    if (path === "/users") {
      if (!needPerm("manage_users")) return;
      var tab = (params.get("tab") || "pending").toLowerCase();
      var validTabs = ["pending", "active", "declined", "disabled", "deleted"];
      if (validTabs.indexOf(tab) === -1) tab = "pending";
      var stUsers = DB.getState();
      var counts = {
        pending: stUsers.users.filter(function (u) { return u.status === "pending"; }).length,
        active: stUsers.users.filter(function (u) { return u.status === "approved"; }).length,
        declined: stUsers.users.filter(function (u) { return u.status === "declined"; }).length,
        disabled: stUsers.users.filter(function (u) { return u.status === "disabled"; }).length,
        deleted: stUsers.users.filter(function (u) { return u.status === "deleted"; }).length
      };
      var statusFilter = tab === "active" ? "approved" : tab;
      var users = stUsers.users
        .filter(function (u) { return u.status === statusFilter; })
        .sort(function (a, b) { return b.id - a.id; })
        .map(function (u) {
          var pat = u.patient_id ? stUsers.patients.find(function (p) { return p.id === u.patient_id; }) : null;
          return Object.assign({}, u, { patient_mrn: pat ? pat.mrn : null });
        });
      setPage("Manage Users - Medi Vault", Views.renderUsers(users, tab, counts, user.username), false, user, "/users");
      return;
    }

    if (path === "/users/new") {
      if (!needPerm("manage_users")) return;
      var avail = getAvailablePatients();
      setPage("Create User - Medi Vault", Views.renderUserNew(avail, {}, {}), false, user, "/users/new");
      return;
    }

    renderErrorPage(404, "Not Found", "The requested patient record or document was not found.", user, path);
  }

  function getAvailablePatients() {
    var st = DB.getState();
    var linkedIds = {};
    st.users.forEach(function (u) { if (u.patient_id) linkedIds[u.patient_id] = true; });
    return st.patients
      .filter(function (p) { return !linkedIds[p.id]; })
      .sort(function (a, b) { return a.mrn.localeCompare(b.mrn); });
  }

  /* ---------- Event Delegation & Form Handlers ---------- */
  function initGlobalClickDelegation() {
    document.addEventListener("click", function (e) {
      // Google Sign-In button info
      var gBtn = e.target.closest(".js-google-btn");
      if (gBtn) {
        e.preventDefault();
        showToast("Google sign-in requires a server OAuth client. Use password sign-in or demo accounts.", "info");
        return;
      }

      // Logout button
      if (e.target.closest("#logout-btn")) {
        e.preventDefault();
        var cur = Auth.currentUser().user;
        var wasPatient = cur && cur.role === "patient";
        if (cur) Auth.logAudit("logout", "", "ok", cur.username);
        Auth.clearSession();
        Auth.queueFlash("You have been signed out.", "info");
        navigate(wasPatient ? "/patient-login" : "/login");
        return;
      }

      // Reset demo data button
      if (e.target.closest("#reset-demo-btn")) {
        e.preventDefault();
        openConfirmModal(
          "Reset Demo Data",
          "Restore the original synthetic demo accounts, sample patients, lab report, and clear local changes?",
          false,
          async function () {
            await DB.reset();
            Auth.clearSession();
            Auth.queueFlash("Demo data restored.", "success");
            navigate("/");
          }
        );
        return;
      }

      // Back button
      if (e.target.closest(".js-back")) {
        e.preventDefault();
        if (history.length > 1) history.back(); else navigate("/");
        return;
      }

      // Print prescription button
      if (e.target.closest("#print-btn")) {
        e.preventDefault();
        window.print();
        return;
      }

      // Open document (staff)
      var openDocBtn = e.target.closest("[data-open-doc]");
      if (openDocBtn) {
        e.preventDefault();
        openStaffDocument(parseInt(openDocBtn.getAttribute("data-open-doc"), 10), false);
        return;
      }

      // Open document snapshot (staff)
      var openHistBtn = e.target.closest("[data-open-history]");
      if (openHistBtn) {
        e.preventDefault();
        openStaffDocument(parseInt(openHistBtn.getAttribute("data-open-history"), 10), true);
        return;
      }

      // Open document (patient portal)
      var openPortalBtn = e.target.closest("[data-open-portal-doc]");
      if (openPortalBtn) {
        e.preventDefault();
        openPortalDocument(parseInt(openPortalBtn.getAttribute("data-open-portal-doc"), 10));
        return;
      }

      // Stop prescription button
      var stopRxBtn = e.target.closest("[data-stop-rx]");
      if (stopRxBtn) {
        e.preventDefault();
        var rxId = parseInt(stopRxBtn.getAttribute("data-stop-rx"), 10);
        openConfirmModal(
          stopRxBtn.getAttribute("data-confirm-title") || "Stop Prescription",
          stopRxBtn.getAttribute("data-confirm") || "Stop this prescription?",
          true,
          function (reason) {
            handleStopPrescription(rxId, reason);
          }
        );
        return;
      }

      // User management confirmed actions (decline, force_logout, reset_password, disable, delete)
      var userActBtn = e.target.closest("[data-user-action]");
      if (userActBtn) {
        e.preventDefault();
        var act = userActBtn.getAttribute("data-user-action");
        var uid = parseInt(userActBtn.getAttribute("data-uid"), 10);
        var tab = userActBtn.getAttribute("data-tab") || "active";
        openConfirmModal(
          userActBtn.getAttribute("data-confirm-title") || "Confirm Action",
          userActBtn.getAttribute("data-confirm") || "Are you sure?",
          false,
          function () {
            handleUserAction(act, uid, tab);
          }
        );
        return;
      }

      // Direct enable button
      var enableBtn = e.target.closest("[data-user-action-direct]");
      if (enableBtn) {
        e.preventDefault();
        handleUserAction(
          enableBtn.getAttribute("data-user-action-direct"),
          parseInt(enableBtn.getAttribute("data-uid"), 10),
          enableBtn.getAttribute("data-tab") || "disabled"
        );
        return;
      }

      // Intercept internal <a href="..."> navigation
      var anchor = e.target.closest("a[href]");
      if (anchor) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (anchor.hasAttribute("download") || anchor.getAttribute("target") === "_blank") return;
        var href = anchor.getAttribute("href");
        if (!href || href.indexOf("http") === 0 || href.indexOf("mailto:") === 0 || href.indexOf("blob:") === 0) return;
        if (href.charAt(0) === "#") return;
        e.preventDefault();
        var targetUrl = new URL(href, window.location.origin);
        if (targetUrl.pathname === window.location.pathname && targetUrl.search === window.location.search && targetUrl.hash) {
          history.pushState({}, "", targetUrl.pathname + targetUrl.search + targetUrl.hash);
          var el = document.getElementById(targetUrl.hash.slice(1));
          if (el) el.scrollIntoView({ behavior: "smooth" });
        } else {
          navigate(href);
        }
      }
    });

    document.addEventListener("submit", function (e) {
      var form = e.target;
      if (!form || !form.tagName || form.tagName !== "FORM") return;
      e.preventDefault();

      if (form.id === "staff-login-form") handlePasswordLogin(form, function (r) { return r !== "patient"; }, "login");
      else if (form.id === "patient-login-form") handlePasswordLogin(form, function (r) { return r === "patient"; }, "patient_login");
      else if (form.id === "signup-form") handleSignup(form);
      else if (form.id === "password-change-form") handlePasswordChange(form);
      else if (form.id === "patient-search-form") {
        var q = (form.querySelector("[name='q']").value || "").trim().slice(0, 50);
        navigate(q ? "/patients?q=" + encodeURIComponent(q) : "/patients");
      }
      else if (form.id === "patient-new-form") handlePatientNew(form);
      else if (form.id === "upload-doc-form") handleDocumentUpload(form);
      else if (form.id === "doc-edit-form") handleDocumentEdit(form);
      else if (form.id === "rx-new-form") handlePrescriptionNew(form);
      else if (form.id === "portal-profile-form") handlePortalProfile(form);
      else if (form.id === "user-new-form") handleUserNew(form);
      else if (form.classList.contains("user-role-form")) {
        handleUserAction("change_role", parseInt(form.dataset.uid, 10), form.dataset.tab, {
          role: form.querySelector("[name='role']").value
        });
      }
      else if (form.classList.contains("user-approve-form")) {
        handleUserAction("approve", parseInt(form.dataset.uid, 10), form.dataset.tab, {
          role: form.querySelector("[name='role']").value,
          mrn: (form.querySelector("[name='mrn']") ? form.querySelector("[name='mrn']").value : "").trim()
        });
      }
    });
  }

  /* ---------- Handlers ---------- */
  async function handlePasswordLogin(form, allowedFn, mode) {
    var identifier = (form.username.value || "").trim();
    var password = form.password.value || "";

    if (Auth.checkLockout(identifier)) {
      Auth.logAudit("login_locked", identifier.slice(0, 30), "blocked");
      showToast("Too many attempts. Try again later.", "error");
      return;
    }

    var u = Auth.findLoginUser(identifier);
    var pwOk = u ? await DB.verifyPassword(password, u.pw_hash) : false;
    if (!u || !pwOk || !allowedFn(u.role)) {
      Auth.recordFailedAttempt(identifier);
      if (Auth.checkLockout(identifier)) {
        Auth.logAudit("login_locked", identifier.slice(0, 30), "blocked");
      }
      Auth.logAudit("login_failed", identifier.slice(0, 30), "failed");
      showToast("Wrong username or password", "error");
      return;
    }

    if (u.status !== "approved") {
      Auth.logAudit("login_blocked", u.username.slice(0, 30), "blocked");
      if (u.status === "pending") showToast("Your account is pending approval by an auditor.", "info");
      else if (u.status === "declined") showToast("Your account request has been declined.", "error");
      else if (u.status === "disabled") showToast("Your account has been disabled.", "error");
      else showToast("Wrong username or password", "error");
      return;
    }

    Auth.startSession(u);
    Auth.logAudit("login", "", "ok", u.username);

    if (u.must_change_password === 1) {
      Auth.queueFlash("Please set a new password before continuing.", "info");
      navigate("/account/password");
      return;
    }

    if (u.role === "patient") {
      Auth.queueFlash("Welcome to your health portal, " + (u.full_name || u.username) + "!", "success");
    } else {
      Auth.queueFlash("Welcome back, " + u.username + "!", "success");
    }
    navigate(Auth.landingFor(u.role));
  }

  async function handleSignup(form) {
    var signupType = form.querySelector("#signup-type-staff").checked ? "staff" : "patient";
    var fullName = (form.full_name.value || "").trim();
    var email = (form.email.value || "").trim().toLowerCase();
    var username = (form.username.value || "").trim();
    var password = form.password.value || "";
    var confirm = form.confirm_password.value || "";
    var dobRaw = form.dob ? (form.dob.value || "").trim() : "";
    var values = { signup_type: signupType, full_name: fullName, email: email, username: username, dob: dobRaw };
    var errors = {};
    var state = DB.getState();
    var today = DB.todayIso();

    if (fullName.length < 2 || fullName.length > 100) {
      errors.full_name = "Please enter your full name (2-100 characters).";
    }
    if (email.length > 254 || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
      errors.email = "Please enter a valid email address.";
    } else if (state.users.some(function (u) { return u.email && u.email.toLowerCase() === email; })) {
      errors.email = "An account with this email already exists. Try signing in instead.";
    }

    if (username) {
      if (!/^[a-z0-9_]{3,30}$/.test(username)) {
        errors.username = "Username must be 3-30 lowercase letters, digits, or underscores.";
      } else if (state.users.some(function (u) { return u.username === username; })) {
        errors.username = "This username is already taken.";
      }
    }

    if (password.length < 10) {
      errors.password = "Password must be at least 10 characters long.";
    } else if (password !== confirm) {
      errors.confirm_password = "Passwords do not match.";
    }

    if (signupType === "patient") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dobRaw)) {
        errors.dob = "Please enter your date of birth.";
      } else if (dobRaw > today) {
        errors.dob = "Date of birth must be today or earlier.";
      } else if (parseInt(dobRaw.slice(0, 4), 10) < 1900) {
        errors.dob = "Please enter a realistic date of birth.";
      }
    }

    if (Object.keys(errors).length > 0) {
      setPage("Sign Up - Medi Vault", Views.renderSignup(values, errors, today), false, null, "/signup");
      return;
    }

    if (!username) username = Auth.uniqueUsernameFromEmail(email);
    var pwHash = await DB.hashPassword(password);
    var ts = DB.now();

    if (signupType === "patient") {
      var mrn = Auth.nextFreeMrn();
      var patId = DB.nextId(state, "patients");
      state.patients.push({
        id: patId, mrn: mrn, name: fullName, dob: dobRaw,
        registered_on: today, created_by: "self-signup", created_at: ts
      });
      var newUser = {
        id: DB.nextId(state, "users"), username: username, email: email, full_name: fullName,
        pw_hash: pwHash, role: "patient", status: "approved", requested_role: "patient",
        claimed_mrn: null, patient_id: patId, must_change_password: 0, session_version: 0,
        password_set: 1, created_at: ts, reviewed_by: "self-signup", reviewed_at: ts
      };
      state.users.push(newUser);
      DB.saveState(state);
      Auth.startSession(newUser);
      Auth.logAudit("patient_self_signup", username + " mrn " + mrn, "ok", username);
      Auth.queueFlash("Account created! Your Medical Record Number is " + mrn + ".", "success");
      navigate("/portal");
      return;
    }

    state.users.push({
      id: DB.nextId(state, "users"), username: username, email: email, full_name: fullName,
      pw_hash: pwHash, role: null, status: "pending", requested_role: "staff",
      claimed_mrn: null, patient_id: null, must_change_password: 0, session_version: 0,
      password_set: 1, created_at: ts, reviewed_by: null, reviewed_at: null
    });
    DB.saveState(state);
    Auth.logAudit("signup", username, "ok", username);
    Auth.queueFlash("Account requested for '" + username + "'. An auditor will assign your staff role, then you can sign in.", "success");
    navigate("/login");
  }

  async function handlePasswordChange(form) {
    var user = Auth.currentUser().user;
    if (!user) { navigate("/login"); return; }
    var hasPw = (user.password_set !== undefined && user.password_set !== null ? user.password_set : 1) === 1;
    var currentPw = form.current_password ? form.current_password.value : "";
    var newPw = form.new_password.value || "";
    var confirmPw = form.confirm_password.value || "";
    var errors = {};

    if (hasPw && !(await DB.verifyPassword(currentPw, user.pw_hash))) {
      errors.current_password = "Incorrect current password.";
    }
    if (newPw.length < 10) {
      errors.new_password = "New password must be at least 10 characters long.";
    } else if (newPw === currentPw) {
      errors.new_password = "New password must differ from current password.";
    } else if (newPw !== confirmPw) {
      errors.confirm_password = "Passwords do not match.";
    }

    if (Object.keys(errors).length > 0) {
      setPage(
        (hasPw ? "Change" : "Set") + " Password - Medi Vault",
        Views.renderPasswordChange(errors, user.must_change_password === 1, hasPw),
        false,
        user,
        "/account/password"
      );
      return;
    }

    var state = DB.getState();
    var target = state.users.find(function (u) { return u.id === user.id; });
    target.pw_hash = await DB.hashPassword(newPw);
    target.must_change_password = 0;
    target.session_version = (target.session_version || 0) + 1;
    target.password_set = 1;
    DB.saveState(state);

    Auth.startSession(target);
    Auth.logAudit("password_changed", user.username, "ok", user.username);
    Auth.queueFlash("Password updated successfully.", "success");
    navigate(user.role !== "patient" ? "/" : "/portal");
  }

  function handlePatientNew(form) {
    var user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "register")) { navigate("/login"); return; }
    var today = DB.todayIso();
    var name = (form.name.value || "").trim();
    var mrn = (form.mrn.value || "").trim();
    var dobRaw = (form.dob.value || "").trim();
    var regRaw = (form.registered_on.value || "").trim() || today;
    var errors = {};
    var state = DB.getState();

    if (name.length < 1 || name.length > 100) {
      errors.name = "Full name must be between 1 and 100 characters.";
    }
    if (!/^[A-Za-z0-9-]{3,20}$/.test(mrn)) {
      errors.mrn = "MRN must be 3-20 letters, digits, or hyphens.";
    } else if (state.patients.some(function (p) { return p.mrn === mrn; })) {
      errors.mrn = "That MRN already exists.";
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dobRaw)) {
      errors.dob = "Invalid date of birth.";
    } else if (dobRaw > today) {
      errors.dob = "Date of birth must be today or earlier.";
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(regRaw)) {
      errors.registered_on = "Invalid registration date.";
    } else if (regRaw < today) {
      errors.registered_on = "Registration date must be today or a future date.";
    }

    if (Object.keys(errors).length > 0) {
      setPage(
        "Register Patient - Medi Vault",
        Views.renderPatientNew({ name: name, mrn: mrn, dob: dobRaw, registered_on: regRaw }, errors, today),
        false,
        user,
        "/patients/new"
      );
      return;
    }

    var pid = DB.nextId(state, "patients");
    state.patients.push({
      id: pid, mrn: mrn, name: name, dob: dobRaw, registered_on: regRaw,
      created_by: user.username, created_at: DB.now()
    });
    DB.saveState(state);
    Auth.logAudit("patient_created", mrn, "ok", user.username);
    Auth.queueFlash("Patient registered successfully", "success");
    navigate("/patients/" + pid);
  }

  async function handleDocumentUpload(form) {
    var user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "upload")) { navigate("/login"); return; }
    var pid = parseInt(form.dataset.patientId, 10);
    var state = DB.getState();
    var p = state.patients.find(function (x) { return x.id === pid; });
    if (!p) { renderErrorPage(404, "Not Found", "The requested patient record or document was not found.", user, "/patients"); return; }

    var title = (form.title.value || "").trim().slice(0, 100);
    var docType = (form.doc_type.value || "Other").slice(0, 30);
    var fileInput = form.querySelector("input[type='file']");
    var file = fileInput && fileInput.files ? fileInput.files[0] : null;

    if (file && file.size > 5 * 1024 * 1024) {
      renderErrorPage(413, "File Too Large", "The uploaded file exceeds the 5 MB size limit.", user, "/patients/" + pid);
      return;
    }

    var ext = file && file.name.indexOf(".") !== -1 ? file.name.split(".").pop().toLowerCase() : "";
    var bytes = file ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(0);

    if (!title || !file || !DB.hasMagicSignature(bytes, ext)) {
      Auth.logAudit("upload_rejected", "patient " + pid, "rejected", user.username);
      showToast("Rejected: only real PDF, PNG or JPG files are allowed", "error");
      return;
    }

    var stored = DB.randomHex(16) + "." + ext;
    await DB.saveFile(stored, bytes, DB.mimeForExt(ext));
    var sha = await DB.sha256Hex(bytes);
    var ts = DB.now();

    var docId = DB.nextId(state, "documents");
    state.documents.push({
      id: docId, patient_id: pid, title: title, doc_type: docType, notes: "",
      stored_name: stored, original_name: DB.sanitizeFilename(file.name), size: bytes.length,
      sha256: sha, version: 1, uploaded_by: user.username, created_at: ts, updated_by: null, updated_at: null
    });
    state.document_history.push({
      id: DB.nextId(state, "document_history"), document_id: docId, version: 1,
      title: title, doc_type: docType, notes: "", stored_name: stored, sha256: sha,
      changed_by: user.username, changed_at: ts, change_type: "created"
    });
    DB.saveState(state);
    Auth.logAudit("upload", "patient " + pid + " doc " + docId, "ok", user.username);
    Auth.queueFlash("Document uploaded successfully", "success");
    navigate("/patients/" + pid);
  }

  async function handleDocumentEdit(form) {
    var user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "edit_doc")) { navigate("/login"); return; }
    var did = parseInt(form.dataset.docId, 10);
    var state = DB.getState();
    var doc = state.documents.find(function (d) { return d.id === did; });
    if (!doc) { renderErrorPage(404, "Not Found", "The requested patient record or document was not found.", user, "/patients"); return; }

    var title = (form.title.value || "").trim().slice(0, 100);
    var docType = (form.doc_type.value || doc.doc_type).slice(0, 30);
    var notes = (form.notes.value || "").trim();
    if (!title) {
      showToast("Title is required", "error");
      return;
    }

    var fileInput = form.querySelector("input[type='file']");
    var file = fileInput && fileInput.files ? fileInput.files[0] : null;
    var ts = DB.now();

    if (file && file.name) {
      if (file.size > 5 * 1024 * 1024) {
        renderErrorPage(413, "File Too Large", "The uploaded file exceeds the 5 MB size limit.", user, "/documents/" + did + "/edit");
        return;
      }
      var ext = file.name.indexOf(".") !== -1 ? file.name.split(".").pop().toLowerCase() : "";
      var bytes = new Uint8Array(await file.arrayBuffer());
      if (!DB.hasMagicSignature(bytes, ext)) {
        Auth.logAudit("upload_rejected", "patient " + doc.patient_id + " doc " + did, "rejected", user.username);
        showToast("Rejected: only real PDF, PNG or JPG files are allowed", "error");
        return;
      }
      var stored = DB.randomHex(16) + "." + ext;
      await DB.saveFile(stored, bytes, DB.mimeForExt(ext));
      var newSha = await DB.sha256Hex(bytes);
      var newVersion = (doc.version || 1) + 1;

      doc.title = title;
      doc.doc_type = docType;
      doc.notes = notes;
      doc.stored_name = stored;
      doc.original_name = DB.sanitizeFilename(file.name);
      doc.size = bytes.length;
      doc.sha256 = newSha;
      doc.version = newVersion;
      doc.updated_by = user.username;
      doc.updated_at = ts;

      state.document_history.push({
        id: DB.nextId(state, "document_history"), document_id: did, version: newVersion,
        title: title, doc_type: docType, notes: notes, stored_name: stored, sha256: newSha,
        changed_by: user.username, changed_at: ts, change_type: "new_version"
      });
      DB.saveState(state);
      Auth.logAudit("document_version_added", "doc " + did + " v" + newVersion, "ok", user.username);
      Auth.queueFlash("New document version uploaded successfully", "success");
      navigate("/patients/" + doc.patient_id);
      return;
    }

    var curVersion = doc.version || 1;
    doc.title = title;
    doc.doc_type = docType;
    doc.notes = notes;
    doc.updated_by = user.username;
    doc.updated_at = ts;

    state.document_history.push({
      id: DB.nextId(state, "document_history"), document_id: did, version: curVersion,
      title: title, doc_type: docType, notes: notes, stored_name: doc.stored_name, sha256: doc.sha256,
      changed_by: user.username, changed_at: ts, change_type: "document_edited"
    });
    DB.saveState(state);
    Auth.logAudit("document_edited", "doc " + did + " patient " + doc.patient_id, "ok", user.username);
    Auth.queueFlash("Document metadata updated successfully", "success");
    navigate("/patients/" + doc.patient_id);
  }

  function handlePrescriptionNew(form) {
    var user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "prescribe")) { navigate("/login"); return; }
    var pid = parseInt(form.dataset.patientId, 10);
    var state = DB.getState();
    var patient = state.patients.find(function (p) { return p.id === pid; });
    if (!patient) { renderErrorPage(404, "Not Found", "The requested patient record or document was not found.", user, "/patients"); return; }

    var medicine = (form.medicine.value || "").trim().slice(0, 100);
    var dosage = (form.dosage.value || "").trim().slice(0, 50);
    var duration = (form.duration.value || "").trim().slice(0, 50);
    var freqSel = form.frequency_select.value || "Once daily";
    var freqOther = form.frequency_other ? (form.frequency_other.value || "").trim().slice(0, 50) : "";
    var instructions = (form.instructions.value || "").trim().slice(0, 500);
    var frequency = freqSel === "Other" && freqOther ? freqOther : freqSel;

    var errors = {};
    if (!medicine) errors.medicine = "Medicine name is required (1-100 characters).";
    if (!dosage) errors.dosage = "Dosage is required (1-50 characters).";
    if (!duration) errors.duration = "Duration is required (1-50 characters).";

    if (Object.keys(errors).length > 0) {
      setPage(
        "New Prescription - Medi Vault",
        Views.renderPrescriptionNew(patient, {
          medicine: medicine, dosage: dosage, duration: duration,
          frequency_select: freqSel, frequency_other: freqOther, instructions: instructions
        }, errors),
        false,
        user,
        "/patients/" + pid + "/prescriptions/new"
      );
      return;
    }

    var rxId = DB.nextId(state, "prescriptions");
    state.prescriptions.push({
      id: rxId, patient_id: pid, medicine: medicine, dosage: dosage, frequency: frequency,
      duration: duration, instructions: instructions, status: "active",
      prescribed_by: user.username, prescribed_at: DB.now(),
      stopped_by: null, stopped_at: null, stop_reason: null
    });
    DB.saveState(state);
    // Audit: rx_id and patient MRN only (NO medicine names)
    Auth.logAudit("prescription_added", "rx " + rxId + " patient " + patient.mrn, "ok", user.username);
    Auth.queueFlash("Prescription added successfully.", "success");
    navigate("/patients/" + pid);
  }

  function handleStopPrescription(rxId, reason) {
    var user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "prescribe")) { navigate("/login"); return; }
    var state = DB.getState();
    var rx = state.prescriptions.find(function (r) { return r.id === rxId; });
    if (!rx) { renderErrorPage(404, "Not Found", "The requested patient record or document was not found.", user, "/patients"); return; }
    if (rx.status !== "active") {
      Auth.queueFlash("Prescription is already stopped.", "info");
      navigate("/patients/" + rx.patient_id);
      return;
    }

    rx.status = "stopped";
    rx.stopped_by = user.username;
    rx.stopped_at = DB.now();
    rx.stop_reason = (reason || "").trim().slice(0, 200);
    DB.saveState(state);

    var patient = state.patients.find(function (p) { return p.id === rx.patient_id; });
    Auth.logAudit("prescription_stopped", "rx " + rxId + " patient " + (patient ? patient.mrn : "unknown"), "ok", user.username);
    Auth.queueFlash("Prescription stopped.", "info");
    navigate("/patients/" + rx.patient_id);
  }

  function handlePortalProfile(form) {
    var user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "portal")) { navigate("/patient-login"); return; }
    var state = DB.getState();
    var patient = state.patients.find(function (p) { return p.id === user.patient_id; });
    if (!patient) { renderErrorPage(404, "Not Found", "The requested patient record or document was not found.", user, "/portal"); return; }

    if (patient.dob) {
      Auth.queueFlash("Your date of birth is already on file. Ask hospital staff to correct it.", "info");
      navigate("/portal");
      return;
    }

    var dobRaw = (form.dob.value || "").trim();
    var today = DB.todayIso();
    var errors = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dobRaw)) {
      errors.dob = "Please enter a valid date of birth.";
    } else if (dobRaw > today) {
      errors.dob = "Date of birth must be today or earlier.";
    } else if (parseInt(dobRaw.slice(0, 4), 10) < 1900) {
      errors.dob = "Please enter a realistic date of birth.";
    }

    if (Object.keys(errors).length > 0) {
      setPage("My Profile - Medi Vault", Views.renderPortalProfile(patient, user, errors, today), false, user, "/portal/profile");
      return;
    }

    patient.dob = dobRaw;
    DB.saveState(state);
    Auth.logAudit("patient_profile_updated", patient.mrn, "ok", user.username);
    Auth.queueFlash("Profile updated.", "success");
    navigate("/portal");
  }

  async function handleUserNew(form) {
    var user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "manage_users")) { navigate("/login"); return; }
    var username = (form.username.value || "").trim();
    var role = (form.role.value || "").trim();
    var password = (form.password.value || "").trim();
    var mrn = form.mrn ? (form.mrn.value || "").trim() : "";
    var errors = {};
    var state = DB.getState();

    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
      errors.username = "Username must be 3-30 lowercase letters, numbers, or underscores.";
    } else if (state.users.some(function (u) { return u.username === username; })) {
      errors.username = "Username already exists (including reserved/deleted accounts).";
    }
    if (!Auth.PERMS[role]) {
      errors.role = "Invalid role selected.";
    }
    if (password.length < 10) {
      errors.password = "Password must be at least 10 characters long.";
    }

    var patientId = null;
    if (role === "patient") {
      if (!mrn) {
        errors.mrn = "Must select a patient MRN to link.";
      } else {
        var pat = state.patients.find(function (p) { return p.mrn === mrn; });
        if (!pat) {
          errors.mrn = "Selected MRN was not found.";
        } else if (state.users.some(function (u) { return u.patient_id === pat.id; })) {
          errors.mrn = "That patient record is already linked to another account.";
        } else {
          patientId = pat.id;
        }
      }
    } else if (mrn) {
      errors.mrn = "Cannot link patient record to non-patient role.";
    }

    if (Object.keys(errors).length > 0) {
      setPage(
        "Create User - Medi Vault",
        Views.renderUserNew(getAvailablePatients(), { username: username, role: role, password: password, mrn: mrn }, errors),
        false,
        user,
        "/users/new"
      );
      return;
    }

    var pwHash = await DB.hashPassword(password);
    var ts = DB.now();
    state.users.push({
      id: DB.nextId(state, "users"), username: username, email: null, full_name: null,
      pw_hash: pwHash, role: role, status: "approved", requested_role: null,
      claimed_mrn: null, patient_id: patientId, must_change_password: 1, session_version: 0,
      password_set: 1, created_at: ts, reviewed_by: user.username, reviewed_at: ts
    });
    DB.saveState(state);
    Auth.logAudit("user_created", username + " (" + role + ")" + (mrn ? " mrn " + mrn : ""), "ok", user.username);

    setPage(
      "User Account Created - Medi Vault",
      Views.renderUserCreatedResult(
        "User Account Created",
        "Account '" + username + "' (" + role + ") provisioned successfully with temporary credentials.",
        username,
        password
      ),
      false,
      user,
      "/users"
    );
  }

  async function handleUserAction(action, uid, tab, extra) {
    var user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "manage_users")) { navigate("/login"); return; }
    var state = DB.getState();
    var target = state.users.find(function (u) { return u.id === uid; });
    if (!target) {
      renderErrorPage(404, "Not Found", "The requested user account was not found.", user, "/users");
      return;
    }
    if (target.username === user.username) {
      Auth.queueFlash("You cannot perform administrative actions on your own account.", "error");
      navigate("/users?tab=" + tab);
      return;
    }

    function activeAuditorCount() {
      return state.users.filter(function (u) { return u.role === "auditor" && u.status === "approved"; }).length;
    }

    if (action === "approve") {
      if (target.status !== "pending" && target.status !== "declined") {
        Auth.queueFlash("Cannot approve '" + target.username + "' while the account is " + target.status + ".", "error");
        navigate("/users?tab=" + tab);
        return;
      }
      var role = extra && extra.role ? extra.role : "";
      if (!Auth.PERMS[role]) {
        Auth.queueFlash("Invalid role selected.", "error");
        navigate("/users?tab=" + tab);
        return;
      }
      var patId = null;
      var mrnDetail = "";
      if (role === "patient") {
        var mrn = extra && extra.mrn ? extra.mrn : "";
        if (!mrn) {
          Auth.queueFlash("Must choose a patient MRN to approve user '" + target.username + "' as patient.", "error");
          navigate("/users?tab=" + tab);
          return;
        }
        var pat = state.patients.find(function (p) { return p.mrn === mrn; });
        if (!pat) {
          Auth.queueFlash("Specified MRN '" + mrn + "' does not exist.", "error");
          navigate("/users?tab=" + tab);
          return;
        }
        if (state.users.some(function (u) { return u.patient_id === pat.id && u.id !== uid; })) {
          Auth.queueFlash("That patient record '" + mrn + "' is already linked to another account.", "error");
          navigate("/users?tab=" + tab);
          return;
        }
        patId = pat.id;
        mrnDetail = " mrn " + mrn;
      }
      target.status = "approved";
      target.role = role;
      target.patient_id = patId;
      target.reviewed_by = user.username;
      target.reviewed_at = DB.now();
      target.session_version = (target.session_version || 0) + 1;
      DB.saveState(state);
      Auth.logAudit("user_approved", target.username + " (" + role + ")" + mrnDetail, "ok", user.username);
      Auth.queueFlash("User '" + target.username + "' approved as " + role + ".", "success");
      navigate("/users?tab=" + tab);
      return;
    }

    if (action === "decline") {
      if (target.status !== "pending") {
        Auth.queueFlash("Cannot decline '" + target.username + "' while the account is " + target.status + ".", "error");
        navigate("/users?tab=" + tab);
        return;
      }
      target.status = "declined";
      target.reviewed_by = user.username;
      target.reviewed_at = DB.now();
      target.session_version = (target.session_version || 0) + 1;
      DB.saveState(state);
      Auth.logAudit("user_declined", target.username, "ok", user.username);
      Auth.queueFlash("User request for '" + target.username + "' declined.", "info");
      navigate("/users?tab=" + tab);
      return;
    }

    if (action === "change_role") {
      if (target.status !== "approved") {
        Auth.queueFlash("Cannot change the role of '" + target.username + "' while the account is " + target.status + ".", "error");
        navigate("/users?tab=" + tab);
        return;
      }
      var newRole = extra && extra.role ? extra.role : "";
      if (!Auth.PERMS[newRole]) {
        Auth.queueFlash("Invalid role selected.", "error");
        navigate("/users?tab=" + tab);
        return;
      }
      if (newRole === "patient" && !target.patient_id) {
        Auth.queueFlash("A patient account must be linked to a patient record. Create a new patient user (with an MRN) instead.", "error");
        navigate("/users?tab=" + tab);
        return;
      }
      if (target.role === "auditor" && newRole !== "auditor" && activeAuditorCount() <= 1) {
        Auth.queueFlash("Action blocked: cannot demote the last active auditor.", "error");
        navigate("/users?tab=" + tab);
        return;
      }
      var oldRole = target.role;
      target.role = newRole;
      target.patient_id = newRole === "patient" ? target.patient_id : null;
      target.session_version = (target.session_version || 0) + 1;
      DB.saveState(state);
      Auth.logAudit("user_role_changed", target.username + ": " + oldRole + " -> " + newRole, "ok", user.username);
      Auth.queueFlash("Role for '" + target.username + "' updated to " + newRole + ".", "success");
      navigate("/users?tab=" + tab);
      return;
    }

    if (action === "force_logout") {
      if (target.status !== "approved") {
        Auth.queueFlash("Cannot log out '" + target.username + "' while the account is " + target.status + ".", "error");
        navigate("/users?tab=" + tab);
        return;
      }
      target.session_version = (target.session_version || 0) + 1;
      DB.saveState(state);
      Auth.logAudit("user_force_logout", target.username, "ok", user.username);
      Auth.queueFlash("User '" + target.username + "' has been logged out immediately.", "info");
      navigate("/users?tab=" + tab);
      return;
    }

    if (action === "reset_password") {
      if (target.status !== "approved") {
        Auth.queueFlash("Cannot reset the password of '" + target.username + "' while the account is " + target.status + ".", "error");
        navigate("/users?tab=" + tab);
        return;
      }
      var tempPw = DB.generateTempPassword();
      target.pw_hash = await DB.hashPassword(tempPw);
      target.must_change_password = 1;
      target.session_version = (target.session_version || 0) + 1;
      DB.saveState(state);
      Auth.logAudit("user_password_reset", target.username, "ok", user.username);
      showToast("Password reset for user '" + target.username + "'. Temporary password generated.", "success");
      setPage(
        "Password Reset - Medi Vault",
        Views.renderUserCreatedResult(
          "Password Reset",
          "A new temporary password was generated for '" + target.username + "'. Active sessions have been invalidated.",
          target.username,
          tempPw
        ),
        false,
        user,
        "/users"
      );
      return;
    }

    if (action === "disable") {
      if (target.role === "auditor" && target.status === "approved" && activeAuditorCount() <= 1) {
        Auth.queueFlash("Action blocked: cannot disable or delete the last active auditor.", "error");
        navigate("/users?tab=" + tab);
        return;
      }
      if (target.status !== "approved") {
        Auth.queueFlash("Cannot disable '" + target.username + "' while the account is " + target.status + ".", "error");
        navigate("/users?tab=" + tab);
        return;
      }
      target.status = "disabled";
      target.session_version = (target.session_version || 0) + 1;
      DB.saveState(state);
      Auth.logAudit("user_disabled", target.username, "ok", user.username);
      Auth.queueFlash("User '" + target.username + "' disabled.", "info");
      navigate("/users?tab=" + tab);
      return;
    }

    if (action === "enable") {
      if (target.status !== "disabled") {
        Auth.queueFlash("Cannot enable '" + target.username + "' while the account is " + target.status + ".", "error");
        navigate("/users?tab=" + tab);
        return;
      }
      target.status = "approved";
      target.session_version = (target.session_version || 0) + 1;
      DB.saveState(state);
      Auth.logAudit("user_enabled", target.username, "ok", user.username);
      Auth.queueFlash("User '" + target.username + "' enabled.", "success");
      navigate("/users?tab=" + tab);
      return;
    }

    if (action === "delete") {
      if (target.role === "auditor" && target.status === "approved" && activeAuditorCount() <= 1) {
        Auth.queueFlash("Action blocked: cannot disable or delete the last active auditor.", "error");
        navigate("/users?tab=" + tab);
        return;
      }
      if (["pending", "approved", "declined", "disabled"].indexOf(target.status) === -1) {
        Auth.queueFlash("Cannot delete '" + target.username + "' while the account is " + target.status + ".", "error");
        navigate("/users?tab=" + tab);
        return;
      }
      target.status = "deleted";
      target.session_version = (target.session_version || 0) + 1;
      DB.saveState(state);
      Auth.logAudit("user_deleted", target.username, "ok", user.username);
      Auth.queueFlash("User '" + target.username + "' deleted.", "info");
      navigate("/users?tab=" + tab);
    }
  }

  /* ---------- Document Preview ---------- */
  async function openFilePreview(storedName, title, downloadName) {
    var rec = await DB.getFile(storedName);
    if (!rec) {
      showToast("File data is missing in local browser storage.", "error");
      return;
    }
    if (activeBlobUrl) {
      URL.revokeObjectURL(activeBlobUrl);
      activeBlobUrl = null;
    }
    var blob = new Blob([rec.bytes], { type: rec.mimeType || "application/octet-stream" });
    activeBlobUrl = URL.createObjectURL(blob);

    var modalEl = document.getElementById("file-viewer-modal");
    document.getElementById("file-viewer-title").textContent = title || downloadName || "Document Preview";
    var dl = document.getElementById("file-viewer-download");
    dl.href = activeBlobUrl;
    dl.download = downloadName || storedName;

    var body = document.getElementById("file-viewer-body");
    if ((rec.mimeType || "").indexOf("image/") === 0) {
      body.innerHTML = '<div class="p-4 text-center"><img src="' + activeBlobUrl + '" alt="' + Views.esc(title) + '" class="img-fluid rounded-3 shadow-sm" style="max-height: 72vh;"></div>';
    } else {
      body.innerHTML = '<iframe src="' + activeBlobUrl + '" title="' + Views.esc(title) + '" style="width: 100%; height: 72vh; border: 0;"></iframe>';
    }
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  async function openStaffDocument(id, isHistory) {
    var user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "view")) {
      Auth.logAudit("denied", "open document " + id, "denied", user ? user.username : "anonymous");
      showToast("Access denied.", "error");
      return;
    }
    var state = DB.getState();
    if (isHistory) {
      var h = state.document_history.find(function (x) { return x.id === id; });
      if (!h) { showToast("Document snapshot not found.", "error"); return; }
      Auth.logAudit("view_document", "doc " + h.document_id + " v" + h.version + " history " + id, "ok", user.username);
      var dlName = h.stored_name.endsWith(".pdf") ? "v" + h.version + "_" + h.title + ".pdf" : h.stored_name;
      await openFilePreview(h.stored_name, h.title + " (v" + h.version + ")", dlName);
    } else {
      var d = state.documents.find(function (x) { return x.id === id; });
      if (!d) { showToast("Document not found.", "error"); return; }
      Auth.logAudit("view_document", "doc " + id + " patient " + d.patient_id, "ok", user.username);
      await openFilePreview(d.stored_name, d.title, d.original_name);
    }
  }

  async function openPortalDocument(did) {
    var user = Auth.currentUser().user;
    if (!user || !Auth.hasPerm(user, "portal") || !user.patient_id) {
      showToast("Access denied.", "error");
      return;
    }
    var state = DB.getState();
    var doc = state.documents.find(function (d) { return d.id === did; });
    if (!doc || doc.patient_id !== user.patient_id) {
      renderErrorPage(404, "Not Found", "The requested patient record or document was not found.", user, "/portal");
      return;
    }
    Auth.logAudit("portal_document_view", "doc " + did, "ok", user.username);
    await openFilePreview(doc.stored_name, doc.title, doc.original_name);
  }

  /* ---------- Confirm modal ---------- */
  function initConfirmModal() {
    var modalEl = document.getElementById("confirm-modal");
    if (!modalEl) return;
    var reasonWrap = document.getElementById("modal-reason-container");
    var reasonInput = document.getElementById("modal-reason-input");
    var confirmBtn = modalEl.querySelector(".modal-confirm-btn");

    modalEl.addEventListener("shown.bs.modal", function () {
      (reasonWrap.classList.contains("d-none") ? confirmBtn : reasonInput).focus();
    });
    modalEl.addEventListener("hidden.bs.modal", function () {
      confirmCallback = null;
    });
    confirmBtn.addEventListener("click", function () {
      var cb = confirmCallback;
      var reason = reasonWrap.classList.contains("d-none") ? "" : reasonInput.value.trim();
      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      if (cb) cb(reason);
    });
  }

  function openConfirmModal(title, message, hasReason, onConfirm) {
    var modalEl = document.getElementById("confirm-modal");
    modalEl.querySelector(".modal-title").textContent = title || "Confirm Action";
    modalEl.querySelector(".modal-body-text").textContent = message || "Are you sure?";
    var reasonWrap = document.getElementById("modal-reason-container");
    var reasonInput = document.getElementById("modal-reason-input");
    reasonWrap.classList.toggle("d-none", !hasReason);
    reasonInput.value = "";
    confirmCallback = onConfirm;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  /* ---------- Per-render UI widgets ---------- */
  function initDynamicBehaviors() {
    initPasswordToggles();
    initPasswordStrength();
    initDropzones();
    initClientFilter();
    initAuditFilter();
    initPasswordGenerator();
    initRoleToggle();
    initSignupTypeToggle();
    initFrequencyToggle();
    initCopyButtons();
    initCounters();
  }

  function initPasswordToggles() {
    document.querySelectorAll(".password-toggle-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var input = document.getElementById(btn.getAttribute("data-target"));
        if (!input) return;
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
        btn.innerHTML = show ? '<i class="bi bi-eye-slash" aria-hidden="true"></i>' : '<i class="bi bi-eye" aria-hidden="true"></i>';
      });
    });
  }

  function scorePassword(pw) {
    var score = 0;
    if (pw.length >= 10) score++;
    if (pw.length >= 14) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return pw.length < 10 ? Math.min(score, 1) : score;
  }

  function initPasswordStrength() {
    var input = document.getElementById("password") || document.getElementById("new_password");
    var bar = document.getElementById("password-strength-bar");
    var text = document.getElementById("password-strength-text");
    var confirm = document.getElementById("confirm_password");
    var matchText = document.getElementById("password-match-text");
    if (!input || !bar || !text) return;

    var levels = [
      { w: "10%", c: "var(--mv-danger)", t: "Too short - use at least 10 characters." },
      { w: "25%", c: "var(--mv-danger)", t: "Weak - add more variety." },
      { w: "50%", c: "var(--mv-warning)", t: "Fair - add numbers or symbols." },
      { w: "70%", c: "var(--mv-teal)", t: "Good password." },
      { w: "85%", c: "var(--mv-teal)", t: "Strong password." },
      { w: "100%", c: "var(--mv-emerald)", t: "Excellent password!" }
    ];

    function update() {
      var pw = input.value;
      if (!pw) { bar.style.width = "0"; text.textContent = "At least 10 characters."; }
      else {
        var lvl = levels[pw.length < 10 ? 0 : Math.max(1, scorePassword(pw))];
        bar.style.width = lvl.w;
        bar.style.backgroundColor = lvl.c;
        text.textContent = lvl.t;
      }
      checkMatch();
    }
    function checkMatch() {
      if (!confirm || !matchText) return;
      if (!confirm.value) { matchText.textContent = ""; matchText.className = "form-text"; return; }
      var ok = confirm.value === input.value;
      matchText.textContent = ok ? "Passwords match." : "Passwords do not match yet.";
      matchText.className = "form-text " + (ok ? "text-success" : "text-danger");
    }
    input.addEventListener("input", update);
    if (confirm) confirm.addEventListener("input", checkMatch);
  }

  function initDropzones() {
    document.querySelectorAll(".dropzone").forEach(function (dz) {
      var input = dz.querySelector("input[type='file']");
      var preview = dz.querySelector(".dropzone-preview");
      if (!input || !preview) return;
      var maxBytes = parseInt(dz.getAttribute("data-max-bytes") || "5242880", 10);

      ["dragenter", "dragover"].forEach(function (ev) {
        dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("is-dragover"); });
      });
      ["dragleave", "drop"].forEach(function (ev) {
        dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("is-dragover"); });
      });
      dz.addEventListener("drop", function (e) {
        if (e.dataTransfer && e.dataTransfer.files.length) {
          input.files = e.dataTransfer.files;
          render(input.files[0]);
        }
      });
      input.addEventListener("change", function () { render(input.files[0]); });

      function render(file) {
        if (!file) { preview.classList.remove("is-visible"); preview.innerHTML = ""; return; }
        var size = file.size > 1048576 ? (file.size / 1048576).toFixed(2) + " MB" : (file.size / 1024).toFixed(1) + " KB";
        var ext = (file.name.split(".").pop() || "").toLowerCase();
        var okType = ["pdf", "png", "jpg", "jpeg"].indexOf(ext) !== -1;
        var okSize = file.size <= maxBytes;
        var cls = okType && okSize ? "alert-success" : "alert-danger";
        var msg = !okType ? "Only PDF, PNG or JPG files are allowed." : (!okSize ? "File is larger than 5 MB." : "Ready to upload.");
        preview.innerHTML =
          '<div class="alert ' + cls + ' py-2 px-3 mb-0 rounded-3 small d-inline-flex gap-2 align-items-center">' +
            '<i class="bi ' + (okType && okSize ? "bi-file-earmark-check" : "bi-exclamation-triangle") + '" aria-hidden="true"></i>' +
            '<span><strong></strong> (' + size + ') - ' + msg + '</span></div>';
        preview.querySelector("strong").textContent = file.name;
        preview.classList.add("is-visible");
      }
    });
  }

  function initClientFilter() {
    var input = document.getElementById("client-patient-filter");
    var table = document.getElementById("patients-table");
    if (!input || !table) return;
    var rows = table.querySelectorAll("tbody tr");
    var empty = document.getElementById("patient-filter-empty");
    input.addEventListener("input", function () {
      var val = input.value.toLowerCase().trim();
      var visible = 0;
      rows.forEach(function (row) {
        var match = row.textContent.toLowerCase().indexOf(val) !== -1;
        row.style.display = match ? "" : "none";
        if (match) visible++;
      });
      if (empty) empty.style.display = visible === 0 ? "block" : "none";
    });
  }

  function initAuditFilter() {
    var table = document.getElementById("audit-table");
    if (!table) return;
    var userInput = document.getElementById("audit-filter-user");
    var actionInput = document.getElementById("audit-filter-action");
    var chips = document.querySelectorAll("#audit-outcome-chips .filter-chip");
    var empty = document.getElementById("audit-filter-empty");
    var outcome = "";

    function apply() {
      var u = userInput ? userInput.value.toLowerCase().trim() : "";
      var a = actionInput ? actionInput.value.toLowerCase().trim() : "";
      var shown = 0;
      table.querySelectorAll("tbody tr").forEach(function (r) {
        var ok = (!u || (r.dataset.user || "").toLowerCase().indexOf(u) !== -1) &&
                 (!a || (r.dataset.action || "").toLowerCase().indexOf(a) !== -1) &&
                 (!outcome || (r.dataset.outcome || "") === outcome);
        r.style.display = ok ? "" : "none";
        if (ok) shown++;
      });
      if (empty) empty.style.display = shown === 0 ? "block" : "none";
    }
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        outcome = chip.getAttribute("data-outcome") || "";
        chips.forEach(function (c) {
          var on = c === chip;
          c.classList.toggle("active", on);
          c.setAttribute("aria-pressed", on ? "true" : "false");
        });
        apply();
      });
    });
    if (userInput) userInput.addEventListener("input", apply);
    if (actionInput) actionInput.addEventListener("input", apply);
  }

  function initPasswordGenerator() {
    document.querySelectorAll(".generate-password-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var input = document.getElementById(btn.getAttribute("data-target") || "password");
        if (!input) return;
        var pw = DB.generateTempPassword();
        input.value = pw;
        input.type = "text";
        input.dispatchEvent(new Event("input"));
        var confirm = document.getElementById("confirm_password");
        if (confirm) { confirm.value = pw; confirm.type = "text"; confirm.dispatchEvent(new Event("input")); }
        showToast("Strong password generated.", "success");
      });
    });
  }

  function initRoleToggle() {
    document.querySelectorAll(".role-select-toggle").forEach(function (select) {
      var box = document.getElementById(select.getAttribute("data-patient-field") || "patient-mrn-group");
      if (!box) return;
      function sync() {
        var isPatient = select.value === "patient";
        box.style.display = isPatient ? "" : "none";
        var field = box.querySelector("input, select");
        if (field) field.required = isPatient;
      }
      select.addEventListener("change", sync);
      sync();
    });
  }

  function initSignupTypeToggle() {
    var patient = document.getElementById("signup-type-patient");
    var staff = document.getElementById("signup-type-staff");
    var dobGroup = document.getElementById("patient-dob-group");
    var label = document.getElementById("signup-submit-label");
    if (!patient || !staff || !dobGroup) return;
    function sync() {
      var isPatient = patient.checked;
      dobGroup.style.display = isPatient ? "" : "none";
      var dob = document.getElementById("dob");
      if (dob) dob.required = isPatient;
      if (label) label.textContent = isPatient ? "Create my account" : "Request staff account";
    }
    patient.addEventListener("change", sync);
    staff.addEventListener("change", sync);
    sync();
  }

  function initFrequencyToggle() {
    var sel = document.getElementById("frequency_select");
    var group = document.getElementById("frequency-other-group");
    if (!sel || !group) return;
    function sync() {
      group.hidden = sel.value !== "Other";
      if (!group.hidden) document.getElementById("frequency_other").focus();
    }
    sel.addEventListener("change", sync);
  }

  function initCopyButtons() {
    document.querySelectorAll(".copy-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var text = btn.getAttribute("data-copy");
        if (!text) return;
        var done = function () {
          var span = btn.querySelector("span");
          if (span) { var old = span.textContent; span.textContent = "Copied!"; setTimeout(function () { span.textContent = old; }, 2000); }
          showToast("Copied to clipboard.", "success");
        };
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
        } else { fallbackCopy(text); done(); }
      });
    });
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ }
    ta.remove();
  }

  function initCounters() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll("[data-count]").forEach(function (el) {
      var target = parseInt(el.getAttribute("data-count"), 10) || 0;
      if (target === 0) return;
      var start = null;
      var duration = 650;
      function step(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / duration, 1);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      }
      el.textContent = "0";
      requestAnimationFrame(step);
    });
  }
})(window);
