/* Medi Vault - HTML view renderers (client-side replacements for Jinja templates). */
(function (global) {
  "use strict";

  function esc(val) {
    if (val === null || val === undefined) return "";
    return String(val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function capitalize(s) {
    if (!s) return "";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function googleButtonHtml(source, label) {
    return (
      '<a href="/auth/google?from=' + esc(source) + '" class="btn btn-google w-100 rounded-pill py-2 d-flex align-items-center justify-content-center gap-2 js-google-btn" id="google-btn-' + esc(source) + '">' +
        '<svg class="google-g" viewBox="0 0 48 48" aria-hidden="true">' +
          '<path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>' +
          '<path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>' +
          '<path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>' +
          '<path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>' +
        '</svg>' +
        '<span>' + esc(label) + '</span>' +
      '</a>' +
      '<p class="form-text text-center mt-1 mb-0"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>Google sign-in requires a server OAuth client. Use password sign-in or demo accounts below.</p>'
    );
  }

  function renderNav(user, currentPath, pendingCount) {
    var navLinks = "";
    var navActions = "";

    if (!user) {
      var homeCls = currentPath === "/" ? "current" : "";
      navLinks =
        '<div class="nav-links">' +
          '<a class="' + homeCls + '" href="/#overview">Overview</a>' +
          '<a href="/#platform">Platform features</a>' +
          '<a href="/#security">Security</a>' +
        '</div>';
      navActions =
        '<div class="nav-actions">' +
          '<a class="staff-link" href="/login"><i class="bi bi-hospital"></i> Staff login</a>' +
          '<a class="btn btn-gradient" href="/patient-login">Patient portal <i class="bi bi-arrow-right"></i></a>' +
        '</div>';
    } else {
      if (user.role === "patient") {
        navLinks =
          '<div class="nav-links">' +
            '<a class="' + (currentPath === "/portal" ? "current" : "") + '" href="/portal">My dashboard</a>' +
            '<a class="' + (currentPath === "/portal/profile" ? "current" : "") + '" href="/portal/profile">My profile</a>' +
          '</div>';
      } else {
        var perms = global.MediVaultAuth.permsFor(user.role);
        var items = [
          ["view", "/patients", "Patient directory"],
          ["register", "/patients/new", "Register patient"],
          ["audit", "/audit", "Audit log"],
          ["manage_users", "/users", "User management"]
        ];
        var linksHtml = items.map(function (item) {
          if (perms.indexOf(item[0]) === -1) return "";
          var suffix = item[0] === "manage_users" && pendingCount ? " (" + pendingCount + ")" : "";
          var cls = currentPath === item[1] ? "current" : "";
          return '<a class="' + cls + '" href="' + item[1] + '">' + esc(item[2]) + suffix + '</a>';
        }).join("");
        navLinks = '<div class="nav-links">' + linksHtml + '</div>';
      }
      navActions =
        '<div class="nav-actions">' +
          '<span class="role-badge">' + esc(capitalize(user.role)) + '</span>' +
          '<a href="/account/password" class="staff-link">Account settings</a>' +
          '<button type="button" id="logout-btn" class="btn btn-surface btn-sm">Logout</button>' +
        '</div>';
    }

    return (
      '<div class="utility no-print"><div class="wrap"><span><i class="bi bi-shield-check"></i> Secure healthcare platform</span><span class="utility-end"><i class="bi bi-lock"></i> Privacy-first access</span></div></div>' +
      '<nav class="navbar navbar-expand-lg mv-navbar" aria-label="Main navigation">' +
        '<div class="wrap">' +
          '<a class="brand navbar-brand" href="/"><i class="bi bi-shield-plus" aria-hidden="true"></i>Medi<span>Vault</span></a>' +
          '<button type="button" class="theme-toggle" id="theme-toggle" data-theme-toggle aria-label="Switch theme" title="Switch theme"><i class="bi bi-sun-fill icon-sun" aria-hidden="true"></i><i class="bi bi-moon-stars-fill icon-moon" aria-hidden="true"></i></button>' +
          '<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#mainNav" aria-controls="mainNav" aria-expanded="false" aria-label="Toggle navigation"><i class="bi bi-list"></i></button>' +
          '<div class="collapse navbar-collapse" id="mainNav">' + navLinks + navActions + '</div>' +
        '</div>' +
      '</nav>'
    );
  }

  function renderHome(stats) {
    var trustItems = [
      ["shield-lock", "Role-based access", "The right access for every role"],
      ["folder2-open", "Private record storage", "Medical files kept off public paths"],
      ["journal-check", "Auditable activity", "Accountability at every step"]
    ];
    var features = [
      ["01", "folder2-open", "Medical records", "Keep reports and medical documents organized in one private record.", "/patient-login"],
      ["02", "capsule", "Prescriptions", "Review current medicines, dosage instructions, and prescription history.", "/patient-login"],
      ["03", "people", "Patient management", "Register patients and locate the right record by name or medical record number.", "/login"],
      ["04", "shield-check", "Access & oversight", "Review account permissions and monitor activity through a dedicated audit log.", "/login"]
    ];
    var snapshot = [
      ["Registered patients", stats.patients],
      ["Private documents", stats.documents],
      ["Audited actions", stats.audit]
    ];

    return (
      '<section class="intro" id="overview"><div class="wrap intro-grid">' +
        '<div class="intro-copy">' +
          '<span class="eyebrow"><i class="bi bi-plus-lg"></i> CONNECTED HEALTHCARE</span>' +
          '<h1>Your health records,<br><em>in one secure place.</em></h1>' +
          '<p>A private healthcare workspace for patients and care teams. Access medical records, manage prescriptions, and stay connected to your care.</p>' +
          '<div class="actions">' +
            '<a class="btn btn-gradient" href="/patient-login"><i class="bi bi-person"></i> Patient portal <i class="bi bi-arrow-right"></i></a>' +
            '<a class="btn btn-surface" href="/login"><i class="bi bi-hospital"></i> Staff login</a>' +
          '</div>' +
          '<div class="signup-line">New to Medi Vault? <a href="/signup">Create free account <i class="bi bi-arrow-up-right"></i></a></div>' +
        '</div>' +
        '<figure class="consult">' +
          '<img src="/static/img/consultation.png" alt="A physician discussing care with a patient during a consultation" width="1024" height="768">' +
          '<figcaption><span class="tile"><i class="bi bi-shield-check"></i></span><span><b>Private by design</b><small>Access tailored to your role</small></span></figcaption>' +
        '</figure>' +
      '</div></section>' +
      '<section class="trust" aria-label="Platform safeguards"><div class="wrap trust-grid">' +
        trustItems.map(function (t) {
          return '<div><i class="bi bi-' + t[0] + '"></i><span><b>' + esc(t[1]) + '</b><small>' + esc(t[2]) + '</small></span></div>';
        }).join("") +
      '</div></section>' +
      '<section id="platform" class="features wrap">' +
        '<div class="section-heading"><div><span class="eyebrow">PLATFORM OVERVIEW</span><h2>One platform, connected care.</h2></div><p>Purpose-built tools for every part<br class="d-none d-md-inline"> of the care journey.</p></div>' +
        '<div class="feature-grid">' +
          features.map(function (f) {
            return '<a href="' + f[4] + '" class="feature"><div class="feature-top"><i class="bi bi-' + f[1] + ' tile"></i><span>' + f[0] + '</span></div><h3>' + esc(f[2]) + '</h3><p>' + esc(f[3]) + '</p><i class="bi bi-arrow-up-right feature-arrow"></i></a>';
          }).join("") +
        '</div>' +
      '</section>' +
      '<section id="security" class="security wrap">' +
        '<div><span class="eyebrow">SECURITY &amp; PRIVACY</span><h2>Protected at every step.</h2><p>Patients see their own records. Clinical staff, records clerks and auditors work within permissions specific to their role.</p><a href="/signup">Create a patient account <i class="bi bi-arrow-right"></i></a></div>' +
        '<div class="overview-panel"><div class="panel-head"><b><i class="bi bi-grid-1x2"></i> Platform snapshot</b><small>Aggregate totals</small></div>' +
          snapshot.map(function (s) {
            return '<div class="panel-row"><span>' + esc(s[0]) + '</span><strong>' + esc(s[1]) + '</strong></div>';
          }).join("") +
        '</div>' +
      '</section>'
    );
  }

  function renderLogin(form) {
    form = form || {};
    return (
      '<div class="auth-wrap">' +
        '<div class="row g-0 w-100 mv-card overflow-hidden fade-up">' +
          '<div class="col-lg-5 auth-side p-4 p-md-5 d-flex flex-column justify-content-between">' +
            '<div>' +
              '<span class="badge rounded-pill text-bg-light text-primary mb-3 px-3 py-2"><i class="bi bi-hospital me-1" aria-hidden="true"></i>Hospital staff</span>' +
              '<h1 class="h2 fw-bold">Welcome back to Medi Vault</h1>' +
              '<p class="opacity-90">Clerks, doctors and auditors sign in here. Your role decides what you can see.</p>' +
            '</div>' +
            '<ul class="list-unstyled d-grid gap-3 my-4">' +
              '<li class="d-flex gap-3 align-items-center"><span class="feature-dot"><i class="bi bi-person-vcard" aria-hidden="true"></i></span>Clerks register patients and upload reports</li>' +
              '<li class="d-flex gap-3 align-items-center"><span class="feature-dot"><i class="bi bi-clipboard2-pulse" aria-hidden="true"></i></span>Doctors edit notes and prescribe</li>' +
              '<li class="d-flex gap-3 align-items-center"><span class="feature-dot"><i class="bi bi-shield-check" aria-hidden="true"></i></span>Auditors review logs and manage users</li>' +
            '</ul>' +
            '<p class="small opacity-75 mb-0">Demo logins: <span class="mono">clerk</span>, <span class="mono">doctor</span>, <span class="mono">auditor</span> &bull; password <span class="mono">Demo@1234</span></p>' +
          '</div>' +
          '<div class="col-lg-7 p-4 p-md-5">' +
            '<h2 class="h3 fw-bold mb-1">Staff sign in</h2>' +
            '<p class="text-body-secondary mb-4">Use your username or email. Are you a patient? <a href="/patient-login">Patient login</a></p>' +
            googleButtonHtml("staff", "Sign in with Google") +
            '<div class="divider-text my-4">or with password</div>' +
            '<form id="staff-login-form" novalidate>' +
              '<div class="mb-3">' +
                '<label for="username" class="form-label">Username or email</label>' +
                '<div class="input-group">' +
                  '<span class="input-group-text"><i class="bi bi-person" aria-hidden="true"></i></span>' +
                  '<input id="username" name="username" class="form-control" value="' + esc(form.username || "") + '" autocomplete="username" required autofocus>' +
                '</div>' +
              '</div>' +
              '<div class="mb-4">' +
                '<label for="password" class="form-label">Password</label>' +
                '<div class="input-group">' +
                  '<input id="password" name="password" type="password" class="form-control" autocomplete="current-password" required>' +
                  '<button type="button" class="btn btn-outline-secondary password-toggle-btn" data-target="password" aria-label="Show password"><i class="bi bi-eye" aria-hidden="true"></i></button>' +
                '</div>' +
              '</div>' +
              '<button type="submit" class="btn btn-gradient w-100 rounded-pill py-2 fw-semibold">Sign in <i class="bi bi-arrow-right ms-1" aria-hidden="true"></i></button>' +
            '</form>' +
            '<p class="text-center text-body-secondary mt-4 mb-0">New hospital staff? <a href="/signup?type=staff">Request a staff account</a></p>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderPatientLogin(form) {
    form = form || {};
    return (
      '<div class="auth-wrap">' +
        '<div class="row g-0 w-100 mv-card overflow-hidden fade-up">' +
          '<div class="col-lg-5 auth-side p-4 p-md-5 d-flex flex-column justify-content-between">' +
            '<div>' +
              '<span class="badge rounded-pill text-bg-light text-primary mb-3 px-3 py-2"><i class="bi bi-heart-pulse me-1" aria-hidden="true"></i>Patient portal</span>' +
              '<h1 class="h2 fw-bold">Your health, in your hands</h1>' +
              '<p class="opacity-90">See your current and past medicines, open your reports and print prescriptions anytime.</p>' +
            '</div>' +
            '<ul class="list-unstyled d-grid gap-3 my-4">' +
              '<li class="d-flex gap-3 align-items-center"><span class="feature-dot"><i class="bi bi-capsule" aria-hidden="true"></i></span>Active and past prescriptions</li>' +
              '<li class="d-flex gap-3 align-items-center"><span class="feature-dot"><i class="bi bi-file-earmark-medical" aria-hidden="true"></i></span>Your lab reports and summaries</li>' +
              '<li class="d-flex gap-3 align-items-center"><span class="feature-dot"><i class="bi bi-lock" aria-hidden="true"></i></span>Only you can see your records</li>' +
            '</ul>' +
            '<p class="small opacity-75 mb-0">Demo patient: <span class="mono">asha</span> &bull; password <span class="mono">Demo@1234</span></p>' +
          '</div>' +
          '<div class="col-lg-7 p-4 p-md-5">' +
            '<h2 class="h3 fw-bold mb-1">Patient sign in</h2>' +
            '<p class="text-body-secondary mb-4">No account yet? <a href="/signup">Sign up free in seconds</a> &bull; Staff? <a href="/login">Staff login</a></p>' +
            googleButtonHtml("patient", "Continue with Google") +
            '<div class="divider-text my-4">or with email</div>' +
            '<form id="patient-login-form" novalidate>' +
              '<div class="mb-3">' +
                '<label for="username" class="form-label">Email or username</label>' +
                '<div class="input-group">' +
                  '<span class="input-group-text"><i class="bi bi-envelope" aria-hidden="true"></i></span>' +
                  '<input id="username" name="username" class="form-control" value="' + esc(form.username || "") + '" autocomplete="username" required autofocus>' +
                '</div>' +
              '</div>' +
              '<div class="mb-4">' +
                '<label for="password" class="form-label">Password</label>' +
                '<div class="input-group">' +
                  '<input id="password" name="password" type="password" class="form-control" autocomplete="current-password" required>' +
                  '<button type="button" class="btn btn-outline-secondary password-toggle-btn" data-target="password" aria-label="Show password"><i class="bi bi-eye" aria-hidden="true"></i></button>' +
                '</div>' +
              '</div>' +
              '<button type="submit" class="btn btn-gradient w-100 rounded-pill py-2 fw-semibold">Open my portal <i class="bi bi-arrow-right ms-1" aria-hidden="true"></i></button>' +
            '</form>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function fieldError(errors, name) {
    return errors && errors[name]
      ? '<div class="invalid-feedback d-block" id="' + esc(name) + '-error">' + esc(errors[name]) + '</div>'
      : "";
  }

  function renderSignup(form, errors, today) {
    form = form || {};
    errors = errors || {};
    var isStaff = form.signup_type === "staff";
    return (
      '<div class="row justify-content-center"><div class="col-lg-9 col-xl-8">' +
        '<div class="text-center mb-4 fade-up">' +
          '<h1 class="page-title display-6">Create your <span class="text-gradient">Medi Vault</span> account</h1>' +
          '<p class="text-body-secondary mb-0">Patients get instant access &mdash; no waiting for approval.</p>' +
        '</div>' +
        '<div class="mv-card p-4 p-md-5 fade-up">' +
          googleButtonHtml("signup", "Sign up with Google") +
          '<div class="divider-text my-4">or sign up with email</div>' +
          '<form id="signup-form" novalidate>' +
            '<fieldset class="mb-4">' +
              '<legend class="form-label">I am a...</legend>' +
              '<div class="row g-3">' +
                '<div class="col-md-6"><label class="type-option d-block">' +
                  '<input class="visually-hidden" type="radio" name="signup_type" id="signup-type-patient" value="patient" ' + (!isStaff ? "checked" : "") + '>' +
                  '<span class="type-card d-block"><span class="d-flex align-items-center gap-2 mb-1">' +
                    '<i class="bi bi-heart-pulse-fill type-icon text-danger" aria-hidden="true"></i><strong>Patient</strong><span class="chip chip-ok ms-auto">Instant</span>' +
                  '</span><small class="text-body-secondary">Account is active immediately with your own health record.</small></span>' +
                '</label></div>' +
                '<div class="col-md-6"><label class="type-option d-block">' +
                  '<input class="visually-hidden" type="radio" name="signup_type" id="signup-type-staff" value="staff" ' + (isStaff ? "checked" : "") + '>' +
                  '<span class="type-card d-block"><span class="d-flex align-items-center gap-2 mb-1">' +
                    '<i class="bi bi-hospital-fill type-icon text-primary" aria-hidden="true"></i><strong>Hospital staff</strong><span class="chip chip-pending ms-auto">Role review</span>' +
                  '</span><small class="text-body-secondary">Clinical access to patient data needs an auditor to assign your role.</small></span>' +
                '</label></div>' +
              '</div>' +
            '</fieldset>' +
            '<div class="row g-3">' +
              '<div class="col-md-6">' +
                '<label for="full_name" class="form-label">Full name</label>' +
                '<input id="full_name" name="full_name" class="form-control ' + (errors.full_name ? "is-invalid" : "") + '" value="' + esc(form.full_name || "") + '" autocomplete="name" maxlength="100" required>' +
                fieldError(errors, "full_name") +
              '</div>' +
              '<div class="col-md-6">' +
                '<label for="email" class="form-label">Email</label>' +
                '<input id="email" name="email" type="email" class="form-control ' + (errors.email ? "is-invalid" : "") + '" value="' + esc(form.email || "") + '" autocomplete="email" maxlength="254" required>' +
                fieldError(errors, "email") +
              '</div>' +
              '<div class="col-md-6" id="patient-dob-group">' +
                '<label for="dob" class="form-label">Date of birth</label>' +
                '<input id="dob" name="dob" type="date" class="form-control ' + (errors.dob ? "is-invalid" : "") + '" value="' + esc(form.dob || "") + '" max="' + esc(today) + '">' +
                fieldError(errors, "dob") +
              '</div>' +
              '<div class="col-md-6">' +
                '<label for="username" class="form-label">Username <span class="text-body-secondary fw-normal">(optional)</span></label>' +
                '<input id="username" name="username" class="form-control ' + (errors.username ? "is-invalid" : "") + '" value="' + esc(form.username || "") + '" autocomplete="username" maxlength="30" placeholder="auto from email" aria-describedby="username-hint">' +
                '<div class="form-text" id="username-hint">3-30 lowercase letters, digits or underscores.</div>' +
                fieldError(errors, "username") +
              '</div>' +
              '<div class="col-md-6">' +
                '<label for="password" class="form-label">Password</label>' +
                '<div class="input-group">' +
                  '<input id="password" name="password" type="password" class="form-control ' + (errors.password ? "is-invalid" : "") + '" autocomplete="new-password" minlength="10" required aria-describedby="password-strength-text">' +
                  '<button type="button" class="btn btn-outline-secondary password-toggle-btn" data-target="password" aria-label="Show password"><i class="bi bi-eye" aria-hidden="true"></i></button>' +
                '</div>' +
                '<div class="strength-bar mt-2" aria-hidden="true"><span id="password-strength-bar"></span></div>' +
                '<div class="form-text" id="password-strength-text" aria-live="polite">At least 10 characters.</div>' +
                fieldError(errors, "password") +
              '</div>' +
              '<div class="col-md-6">' +
                '<label for="confirm_password" class="form-label">Confirm password</label>' +
                '<input id="confirm_password" name="confirm_password" type="password" class="form-control ' + (errors.confirm_password ? "is-invalid" : "") + '" autocomplete="new-password" required>' +
                '<div class="form-text" id="password-match-text" aria-live="polite"></div>' +
                fieldError(errors, "confirm_password") +
              '</div>' +
            '</div>' +
            '<button type="submit" class="btn btn-gradient w-100 rounded-pill py-2 fw-semibold mt-4" id="signup-submit">' +
              '<i class="bi bi-person-check me-1" aria-hidden="true"></i><span id="signup-submit-label">' + (isStaff ? "Request staff account" : "Create my account") + '</span>' +
            '</button>' +
          '</form>' +
          '<p class="text-center text-body-secondary mt-4 mb-0">Already have an account? <a href="/patient-login">Patient login</a> &bull; <a href="/login">Staff login</a></p>' +
        '</div>' +
      '</div></div>'
    );
  }

  function renderPasswordChange(errors, mustChange, hasPassword) {
    errors = errors || {};
    return (
      '<div class="row justify-content-center"><div class="col-md-8 col-lg-6"><div class="mv-card fade-up">' +
        '<div class="mv-card-header"><div>' +
          '<h1 class="h4 fw-bold mb-1"><i class="bi bi-shield-lock-fill text-primary me-2" aria-hidden="true"></i>' + (hasPassword ? "Change password" : "Set a password") + '</h1>' +
          '<p class="small text-body-secondary mb-0">Minimum 10 characters, different from your current password.</p>' +
        '</div></div>' +
        '<div class="mv-card-body">' +
          (mustChange ? '<div class="alert alert-warning rounded-4 border-0 d-flex gap-2" role="alert"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i><div>You are using a temporary password. Set a new one before continuing.</div></div>' : "") +
          '<form id="password-change-form" novalidate>' +
            (hasPassword ? (
              '<div class="mb-3">' +
                '<label for="current_password" class="form-label">Current password</label>' +
                '<div class="input-group">' +
                  '<input id="current_password" name="current_password" type="password" class="form-control ' + (errors.current_password ? "is-invalid" : "") + '" autocomplete="current-password" required>' +
                  '<button type="button" class="btn btn-outline-secondary password-toggle-btn" data-target="current_password" aria-label="Show password"><i class="bi bi-eye" aria-hidden="true"></i></button>' +
                '</div>' +
                fieldError(errors, "current_password") +
              '</div>'
            ) : "") +
            '<div class="mb-3">' +
              '<label for="new_password" class="form-label">New password</label>' +
              '<div class="input-group">' +
                '<input id="new_password" name="new_password" type="password" class="form-control ' + (errors.new_password ? "is-invalid" : "") + '" autocomplete="new-password" minlength="10" required aria-describedby="password-strength-text">' +
                '<button type="button" class="btn btn-outline-secondary password-toggle-btn" data-target="new_password" aria-label="Show password"><i class="bi bi-eye" aria-hidden="true"></i></button>' +
                '<button type="button" class="btn btn-outline-primary generate-password-btn" data-target="new_password" title="Generate a strong password"><i class="bi bi-magic" aria-hidden="true"></i><span class="visually-hidden">Generate a strong password</span></button>' +
              '</div>' +
              '<div class="strength-bar mt-2" aria-hidden="true"><span id="password-strength-bar"></span></div>' +
              '<div class="form-text" id="password-strength-text" aria-live="polite">At least 10 characters.</div>' +
              fieldError(errors, "new_password") +
            '</div>' +
            '<div class="mb-4">' +
              '<label for="confirm_password" class="form-label">Confirm new password</label>' +
              '<input id="confirm_password" name="confirm_password" type="password" class="form-control ' + (errors.confirm_password ? "is-invalid" : "") + '" autocomplete="new-password" required>' +
              '<div class="form-text" id="password-match-text" aria-live="polite"></div>' +
              fieldError(errors, "confirm_password") +
            '</div>' +
            '<button type="submit" class="btn btn-gradient w-100 rounded-pill py-2 fw-semibold"><i class="bi bi-check2-circle me-1" aria-hidden="true"></i>Update password</button>' +
          '</form>' +
        '</div>' +
      '</div></div></div>'
    );
  }

  function renderPatients(q, rows, stats, user, perms) {
    var isDoctor = user.role === "doctor";
    var canRegister = perms.indexOf("register") !== -1;
    var rowsHtml = rows.map(function (r) {
      var initial = (r.name || "?").charAt(0).toUpperCase();
      var reg = r.registered_on || (r.created_at ? r.created_at.slice(0, 10) : "-");
      return (
        '<tr>' +
          '<td><span class="mrn">' + esc(r.mrn) + '</span></td>' +
          '<td><div class="d-flex align-items-center gap-2"><span class="avatar" style="background: var(--mv-gradient-soft);" aria-hidden="true">' + esc(initial) + '</span><strong>' + esc(r.name) + '</strong></div></td>' +
          '<td>' + esc(r.dob || "-") + '</td>' +
          '<td>' + esc(reg) + '</td>' +
          '<td><span class="chip chip-version"><i class="bi bi-files" aria-hidden="true"></i>' + esc(r.doc_count) + '</span></td>' +
          '<td class="text-end"><a href="/patients/' + r.id + '" class="btn btn-sm btn-gradient rounded-pill px-3">Open <i class="bi bi-chevron-right" aria-hidden="true"></i></a></td>' +
        '</tr>'
      );
    }).join("");

    return (
      '<div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4 fade-up">' +
        '<div>' +
          '<span class="eyebrow">' + (isDoctor ? "CLINICAL WORKSPACE" : "REGISTRATION DESK") + '</span>' +
          '<h1 class="page-title h2 mb-1">Welcome, <span class="text-gradient">' + esc(user.username) + '</span></h1>' +
          '<p class="text-body-secondary mb-0">' + (isDoctor ? "Review patient records, medical documents and prescriptions." : "Register patients, organize documents and look up medical records.") + '</p>' +
        '</div>' +
        (canRegister ? '<a href="/patients/new" class="btn btn-gradient rounded-pill px-4" id="btn-register-patient"><i class="bi bi-person-plus me-1" aria-hidden="true"></i>Register patient</a>' : "") +
      '</div>' +
      '<section class="row g-3 mb-4" aria-label="Summary">' +
        '<div class="col-6 col-lg-3"><div class="stat-card stat-cyan"><div class="d-flex justify-content-between"><div><div class="stat-value" data-count="' + stats.patients + '">' + stats.patients + '</div><div class="stat-label">Patients</div></div><i class="bi bi-people-fill stat-icon" aria-hidden="true"></i></div></div></div>' +
        '<div class="col-6 col-lg-3"><div class="stat-card stat-indigo"><div class="d-flex justify-content-between"><div><div class="stat-value" data-count="' + stats.documents + '">' + stats.documents + '</div><div class="stat-label">Documents</div></div><i class="bi bi-file-earmark-medical-fill stat-icon" aria-hidden="true"></i></div></div></div>' +
        '<div class="col-6 col-lg-3"><div class="stat-card stat-pink"><div class="d-flex justify-content-between"><div><div class="stat-value" data-count="' + stats.active_rx + '">' + stats.active_rx + '</div><div class="stat-label">Active prescriptions</div></div><i class="bi bi-capsule-pill stat-icon" aria-hidden="true"></i></div></div></div>' +
        '<div class="col-6 col-lg-3"><div class="stat-card stat-amber"><div class="d-flex justify-content-between"><div><div class="stat-value" data-count="' + stats.today + '">' + stats.today + '</div><div class="stat-label">New today</div></div><i class="bi bi-calendar-heart-fill stat-icon" aria-hidden="true"></i></div></div></div>' +
      '</section>' +
      '<div class="mv-card fade-up">' +
        '<div class="mv-card-header">' +
          '<h2 class="h5 fw-bold mb-0"><i class="bi bi-search-heart me-2 text-primary" aria-hidden="true"></i>Patient directory</h2>' +
          '<form id="patient-search-form" class="d-flex gap-2 flex-grow-1 justify-content-end" role="search" style="max-width: 520px;">' +
            '<label for="client-patient-filter" class="visually-hidden">Search patients by name or MRN</label>' +
            '<div class="input-group"><span class="input-group-text"><i class="bi bi-search" aria-hidden="true"></i></span><input id="client-patient-filter" name="q" value="' + esc(q || "") + '" class="form-control" placeholder="Type a name or MRN to filter live..." autocomplete="off"></div>' +
            '<button type="submit" class="btn btn-outline-primary rounded-pill px-3 no-loading">Search</button>' +
          '</form>' +
        '</div>' +
        '<div class="table-responsive"><table class="table mv-table" id="patients-table"><thead><tr><th scope="col">MRN</th><th scope="col">Name</th><th scope="col">Date of birth</th><th scope="col">Registered</th><th scope="col">Documents</th><th scope="col" class="text-end">Action</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
        '<div id="patient-filter-empty" class="empty-state" style="display: ' + (rows.length === 0 ? "block" : "none") + ';"><i class="bi bi-person-x" aria-hidden="true"></i><p class="mb-0">No patients match your search.</p></div>' +
      '</div>'
    );
  }

  function renderPatientNew(form, errors, today) {
    form = form || {};
    errors = errors || {};
    return (
      '<a href="/patients" class="btn btn-outline-secondary btn-sm rounded-pill mb-3"><i class="bi bi-arrow-left me-1" aria-hidden="true"></i>Back to patients</a>' +
      '<div class="row justify-content-center"><div class="col-lg-8 col-xl-7"><div class="mv-card fade-up">' +
        '<div class="mv-card-header"><div class="d-flex align-items-center gap-3">' +
          '<span class="header-icon" aria-hidden="true"><i class="bi bi-person-plus-fill"></i></span>' +
          '<div><h1 class="h4 fw-bold mb-1">Register new patient</h1><p class="text-body-secondary mb-0 small">Create a record in the patient directory. MRN must be unique.</p></div>' +
        '</div></div>' +
        '<form id="patient-new-form" class="mv-card-body" novalidate>' +
          '<div class="form-note mb-4" role="note"><i class="bi bi-info-circle-fill" aria-hidden="true"></i><span>Use synthetic (fake) data only. Never enter real patient information.</span></div>' +
          '<fieldset class="form-section"><legend class="form-section-title"><i class="bi bi-person-vcard" aria-hidden="true"></i>Patient identity</legend><div class="row g-3">' +
            '<div class="col-12"><label for="name" class="form-label">Full name</label>' +
              '<div class="input-group has-validation"><span class="input-group-text"><i class="bi bi-person" aria-hidden="true"></i></span><input id="name" name="name" class="form-control ' + (errors.name ? "is-invalid" : "") + '" value="' + esc(form.name || "") + '" maxlength="100" required placeholder="e.g. Priya Sharma (fake)" autocomplete="off"></div>' +
              fieldError(errors, "name") +
            '</div>' +
            '<div class="col-12"><label for="mrn" class="form-label">Medical Record Number (MRN)</label>' +
              '<div class="input-group has-validation"><span class="input-group-text"><i class="bi bi-upc-scan" aria-hidden="true"></i></span><input id="mrn" name="mrn" class="form-control mono ' + (errors.mrn ? "is-invalid" : "") + '" value="' + esc(form.mrn || "") + '" maxlength="20" required placeholder="MRN-2001" autocomplete="off"></div>' +
              '<div class="form-text" id="mrn-hint">3-20 letters, digits or hyphens.</div>' +
              fieldError(errors, "mrn") +
            '</div>' +
          '</div></fieldset>' +
          '<fieldset class="form-section"><legend class="form-section-title is-blue"><i class="bi bi-calendar3" aria-hidden="true"></i>Key dates</legend><div class="row g-3">' +
            '<div class="col-md-6"><label for="dob" class="form-label">Date of birth</label>' +
              '<input id="dob" name="dob" type="date" class="form-control ' + (errors.dob ? "is-invalid" : "") + '" value="' + esc(form.dob || "") + '" max="' + esc(today) + '" required>' +
              '<div class="form-text" id="dob-hint">Must be today or earlier.</div>' +
              fieldError(errors, "dob") +
            '</div>' +
            '<div class="col-md-6"><label for="registered_on" class="form-label">Registration date</label>' +
              '<input id="registered_on" name="registered_on" type="date" class="form-control ' + (errors.registered_on ? "is-invalid" : "") + '" value="' + esc(form.registered_on || today) + '" min="' + esc(today) + '" required>' +
              '<div class="form-text" id="reg-hint">Defaults to today. Past dates are rejected.</div>' +
              fieldError(errors, "registered_on") +
            '</div>' +
          '</div></fieldset>' +
          '<div class="form-actions"><a href="/patients" class="btn btn-outline-secondary rounded-pill px-4">Cancel</a><button type="submit" class="btn btn-gradient rounded-pill px-4"><i class="bi bi-check2-circle me-1" aria-hidden="true"></i>Register patient</button></div>' +
        '</form>' +
      '</div></div></div>'
    );
  }

  function renderPatientDetail(p, docs, prescriptions, perms) {
    var canPrescribe = perms.indexOf("prescribe") !== -1;
    var canEditDoc = perms.indexOf("edit_doc") !== -1;
    var canUpload = perms.indexOf("upload") !== -1;
    var activeRxCount = prescriptions.filter(function (rx) { return rx.status === "active"; }).length;
    var initial = (p.name || "?").charAt(0).toUpperCase();

    var docsBody = docs.length ? docs.map(function (d) {
      var isPdf = (d.stored_name || "").toLowerCase().endsWith(".pdf");
      return (
        '<tr>' +
          '<td><i class="bi ' + (isPdf ? "bi-file-earmark-pdf-fill text-danger" : "bi-file-earmark-image-fill text-info") + ' me-1" aria-hidden="true"></i><strong>' + esc(d.title) + '</strong></td>' +
          '<td><span class="chip chip-type">' + esc(d.doc_type) + '</span></td>' +
          '<td><span class="chip chip-version">v' + esc(d.version || 1) + '</span></td>' +
          '<td>' + esc(d.uploaded_by) + '</td>' +
          '<td class="small text-nowrap">' + esc(d.created_at) + '</td>' +
          '<td class="small text-body-secondary text-truncate" style="max-width: 200px;" title="' + esc(d.notes || "") + '">' + esc(d.notes || "-") + '</td>' +
          '<td class="text-end text-nowrap">' +
            '<button type="button" class="btn btn-sm btn-outline-primary rounded-pill me-1" data-open-doc="' + d.id + '"><i class="bi bi-box-arrow-up-right me-1" aria-hidden="true"></i>Open</button>' +
            (canEditDoc ? '<a href="/documents/' + d.id + '/edit" class="btn btn-sm btn-gradient rounded-pill"><i class="bi bi-pencil me-1" aria-hidden="true"></i>Edit</a>' : "") +
          '</td>' +
        '</tr>'
      );
    }).join("") : '<tr><td colspan="7"><div class="empty-state"><i class="bi bi-folder-x" aria-hidden="true"></i>No documents uploaded yet for this patient.</div></td></tr>';

    var rxBody = prescriptions.length ? prescriptions.map(function (rx) {
      return (
        '<tr>' +
          '<td><i class="bi bi-capsule-pill text-danger me-1" aria-hidden="true"></i><strong>' + esc(rx.medicine) + '</strong></td>' +
          '<td>' + esc(rx.dosage) + '</td>' +
          '<td>' + esc(rx.frequency) + '</td>' +
          '<td>' + esc(rx.duration) + '</td>' +
          '<td><span class="chip chip-' + esc(rx.status) + '">' + esc(rx.status) + '</span></td>' +
          '<td class="small">Dr. ' + esc(rx.prescribed_by) + '<br><span class="text-body-secondary">' + esc((rx.prescribed_at || "").slice(0, 10)) + '</span></td>' +
          '<td class="small text-body-secondary" style="max-width: 220px;">' +
            (rx.instructions ? '<div>' + esc(rx.instructions) + '</div>' : "") +
            (rx.status === "stopped" ? '<div class="text-danger">Stopped (' + esc((rx.stopped_at || "").slice(0, 10)) + ')' + (rx.stop_reason ? ': ' + esc(rx.stop_reason) : "") + '</div>' : "") +
          '</td>' +
          '<td class="text-end text-nowrap">' +
            '<a href="/prescriptions/' + rx.id + '/print" class="btn btn-sm btn-outline-primary rounded-pill me-1"><i class="bi bi-printer me-1" aria-hidden="true"></i>Print</a>' +
            (rx.status === "active" ? (
              '<button type="button" class="btn btn-sm btn-outline-danger rounded-pill" data-stop-rx="' + rx.id + '" data-confirm="Stop prescription for \'' + esc(rx.medicine) + '\'?" data-confirm-title="Stop Prescription" data-has-reason="true"><i class="bi bi-stop-circle me-1" aria-hidden="true"></i>Stop</button>'
            ) : "") +
          '</td>' +
        '</tr>'
      );
    }).join("") : '<tr><td colspan="8"><div class="empty-state"><i class="bi bi-capsule" aria-hidden="true"></i>No prescriptions recorded for this patient.</div></td></tr>';

    return (
      '<a href="/patients" class="btn btn-outline-secondary btn-sm rounded-pill mb-3"><i class="bi bi-arrow-left me-1" aria-hidden="true"></i>Back to patients</a>' +
      '<section class="hero p-4 p-md-4 mb-4 fade-up"><div class="d-flex flex-wrap align-items-center gap-3">' +
        '<span class="avatar" style="width: 3.5rem; height: 3.5rem; font-size: 1.3rem;" aria-hidden="true">' + esc(initial) + '</span>' +
        '<div class="flex-grow-1"><h1 class="h3 fw-bold mb-1">' + esc(p.name) + '</h1><div class="d-flex flex-wrap gap-3 small opacity-90">' +
          '<span><i class="bi bi-upc-scan me-1" aria-hidden="true"></i>MRN: <strong class="mono">' + esc(p.mrn) + '</strong></span>' +
          '<span><i class="bi bi-cake2 me-1" aria-hidden="true"></i>Date of Birth: <strong>' + esc(p.dob || "Not provided") + '</strong></span>' +
          '<span><i class="bi bi-calendar-check me-1" aria-hidden="true"></i>Registered On: <strong>' + esc(p.registered_on || (p.created_at || "").slice(0, 10)) + '</strong></span>' +
        '</div></div>' +
        '<div class="d-flex gap-2">' +
          '<span class="badge rounded-pill text-bg-light px-3 py-2"><i class="bi bi-files me-1" aria-hidden="true"></i>' + docs.length + ' documents</span>' +
          (canPrescribe ? '<span class="badge rounded-pill text-bg-light px-3 py-2"><i class="bi bi-capsule me-1" aria-hidden="true"></i>' + activeRxCount + ' active Rx</span>' : "") +
        '</div>' +
      '</div></section>' +
      '<ul class="nav mv-tabs mb-3" id="patientTabs" role="tablist">' +
        '<li class="nav-item" role="presentation"><button class="nav-link active" id="docs-tab" data-bs-toggle="tab" data-bs-target="#docs-pane" type="button" role="tab" aria-controls="docs-pane" aria-selected="true"><i class="bi bi-folder2-open me-1" aria-hidden="true"></i>Documents <span class="badge rounded-pill ms-1">' + docs.length + '</span></button></li>' +
        (canPrescribe ? '<li class="nav-item" role="presentation"><button class="nav-link" id="rx-tab" data-bs-toggle="tab" data-bs-target="#rx-pane" type="button" role="tab" aria-controls="rx-pane" aria-selected="false"><i class="bi bi-capsule me-1" aria-hidden="true"></i>Prescriptions <span class="badge rounded-pill ms-1">' + prescriptions.length + '</span></button></li>' : "") +
        (canUpload ? '<li class="nav-item" role="presentation"><button class="nav-link" id="upload-tab" data-bs-toggle="tab" data-bs-target="#upload-pane" type="button" role="tab" aria-controls="upload-pane" aria-selected="false"><i class="bi bi-cloud-arrow-up me-1" aria-hidden="true"></i>Upload</button></li>' : "") +
      '</ul>' +
      '<div class="tab-content">' +
        '<div class="tab-pane fade show active" id="docs-pane" role="tabpanel" aria-labelledby="docs-tab" tabindex="0"><div class="mv-card">' +
          '<div class="mv-card-header"><h2 class="h5 fw-bold mb-0">Documents &amp; Reports</h2></div>' +
          '<div class="table-responsive"><table class="table mv-table"><thead><tr><th scope="col">Title</th><th scope="col">Type</th><th scope="col">Version</th><th scope="col">Uploaded by</th><th scope="col">Uploaded at</th><th scope="col">Notes</th><th scope="col" class="text-end">Actions</th></tr></thead><tbody>' + docsBody + '</tbody></table></div>' +
        '</div></div>' +
        (canPrescribe ? (
          '<div class="tab-pane fade" id="rx-pane" role="tabpanel" aria-labelledby="rx-tab" tabindex="0"><div class="mv-card">' +
            '<div class="mv-card-header"><div><h2 class="h5 fw-bold mb-0">Prescriptions</h2><p class="small text-body-secondary mb-0">Active medications and medication history</p></div>' +
            '<a href="/patients/' + p.id + '/prescriptions/new" class="btn btn-gradient btn-sm rounded-pill px-3"><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>+ Add prescription</a></div>' +
            '<div class="table-responsive"><table class="table mv-table"><thead><tr><th scope="col">Medicine</th><th scope="col">Dosage</th><th scope="col">Frequency</th><th scope="col">Duration</th><th scope="col">Status</th><th scope="col">Prescribed</th><th scope="col">Instructions / stop reason</th><th scope="col" class="text-end">Actions</th></tr></thead><tbody>' + rxBody + '</tbody></table></div>' +
          '</div></div>'
        ) : "") +
        (canUpload ? (
          '<div class="tab-pane fade" id="upload-pane" role="tabpanel" aria-labelledby="upload-tab" tabindex="0"><div class="mv-card">' +
            '<div class="mv-card-header"><div><h2 class="h5 fw-bold mb-0">Upload document</h2><p class="small text-body-secondary mb-0">PDF, PNG or JPG only &bull; max 5 MB &bull; real file signature verified</p></div></div>' +
            '<form id="upload-doc-form" data-patient-id="' + p.id + '" class="mv-card-body">' +
              '<div class="row g-3">' +
                '<div class="col-md-8"><label for="title" class="form-label">Document title</label><input id="title" name="title" class="form-control" placeholder="e.g. Complete Blood Count Report" maxlength="100" required></div>' +
                '<div class="col-md-4"><label for="doc_type" class="form-label">Document type</label><select id="doc_type" name="doc_type" class="form-select">' +
                  '<option value="Lab report">Lab report</option><option value="Prescription">Prescription</option><option value="Discharge summary">Discharge summary</option><option value="Scan">Scan</option><option value="Other">Other</option>' +
                '</select></div>' +
                '<div class="col-12"><span class="form-label d-block" id="upload-file-label">File</span>' +
                  '<div class="dropzone" id="upload-dropzone" data-max-bytes="5242880">' +
                    '<input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg" required aria-labelledby="upload-file-label">' +
                    '<i class="bi bi-cloud-arrow-up-fill dz-icon" aria-hidden="true"></i>' +
                    '<p class="fw-semibold mb-1">Drag and drop a file here, or click to browse</p>' +
                    '<small class="text-body-secondary">Supports PDF, PNG, JPG (maximum 5 MB)</small>' +
                    '<div class="dropzone-preview" aria-live="polite"></div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<button type="submit" class="btn btn-gradient rounded-pill px-4 mt-4"><i class="bi bi-upload me-1" aria-hidden="true"></i>Upload document</button>' +
            '</form>' +
          '</div></div>'
        ) : "") +
      '</div>'
    );
  }

  function renderDocumentEdit(d, patient, history) {
    var types = ["Lab report", "Prescription", "Discharge summary", "Scan", "Other"];
    var options = types.map(function (t) {
      return '<option value="' + esc(t) + '" ' + (d.doc_type === t ? "selected" : "") + '>' + esc(t) + '</option>';
    }).join("");
    if (types.indexOf(d.doc_type) === -1) {
      options += '<option value="' + esc(d.doc_type) + '" selected>' + esc(d.doc_type) + '</option>';
    }

    var historyHtml = history.length ? history.map(function (h) {
      var chipCls = h.change_type === "new_version" ? "chip-ok" : (h.change_type === "created" ? "chip-type" : "chip-pending");
      return (
        '<li class="d-flex gap-3"><span class="timeline-dot mt-2 flex-shrink-0" aria-hidden="true"></span><div class="flex-grow-1 border-bottom pb-3">' +
          '<div class="d-flex flex-wrap align-items-center gap-2 mb-1">' +
            '<span class="chip chip-version">v' + esc(h.version) + '</span>' +
            '<span class="chip ' + chipCls + '">' + esc((h.change_type || "").replace(/_/g, " ")) + '</span>' +
            (h.stored_name ? '<button type="button" class="btn btn-sm btn-link ms-auto p-0" data-open-history="' + h.id + '">Open snapshot</button>' : "") +
          '</div>' +
          '<div class="fw-semibold">' + esc(h.title) + ' <span class="text-body-secondary fw-normal small">&bull; ' + esc(h.doc_type) + '</span></div>' +
          (h.notes ? '<div class="small text-body-secondary">' + esc(h.notes) + '</div>' : "") +
          '<div class="small text-body-secondary"><i class="bi bi-person me-1" aria-hidden="true"></i>' + esc(h.changed_by) + ' &bull; ' + esc(h.changed_at) + '</div>' +
        '</div></li>'
      );
    }).join("") : '<li class="empty-state"><i class="bi bi-clock" aria-hidden="true"></i>No prior version history recorded.</li>';

    return (
      '<a href="/patients/' + d.patient_id + '" class="btn btn-outline-secondary btn-sm rounded-pill mb-3"><i class="bi bi-arrow-left me-1" aria-hidden="true"></i>Back to patient record</a>' +
      '<div class="row g-4">' +
        '<div class="col-lg-7"><div class="mv-card fade-up">' +
          '<div class="mv-card-header">' +
            '<div><h1 class="h4 fw-bold mb-1"><i class="bi bi-pencil-square text-primary me-2" aria-hidden="true"></i>Edit document</h1>' +
            '<p class="text-body-secondary small mb-0">Patient MRN: <span class="mrn">' + esc(patient.mrn) + '</span> &bull; Current version: <span class="chip chip-version">v' + esc(d.version || 1) + '</span></p></div>' +
            '<button type="button" class="btn btn-sm btn-outline-primary rounded-pill" data-open-doc="' + d.id + '"><i class="bi bi-eye me-1" aria-hidden="true"></i>View current file</button>' +
          '</div>' +
          '<form id="doc-edit-form" data-doc-id="' + d.id + '" class="mv-card-body">' +
            '<div class="row g-3">' +
              '<div class="col-md-8"><label for="title" class="form-label">Document title</label><input id="title" name="title" class="form-control" value="' + esc(d.title) + '" maxlength="100" required></div>' +
              '<div class="col-md-4"><label for="doc_type" class="form-label">Document type</label><select id="doc_type" name="doc_type" class="form-select">' + options + '</select></div>' +
              '<div class="col-12"><label for="notes" class="form-label">Clinical notes</label><textarea id="notes" name="notes" rows="4" class="form-control" placeholder="Add doctor or clinical notes here..." aria-describedby="notes-hint">' + esc(d.notes || "") + '</textarea><div class="form-text" id="notes-hint">Notes are saved in the version history and hidden from the patient portal.</div></div>' +
              '<div class="col-12"><span class="form-label d-block" id="edit-file-label">Replace file with a new version (optional)</span>' +
                '<div class="dropzone" id="edit-dropzone" data-max-bytes="5242880"><input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg" aria-labelledby="edit-file-label"><i class="bi bi-arrow-repeat dz-icon" aria-hidden="true"></i><p class="fw-semibold mb-1">Drop a new file to create version v' + ((d.version || 1) + 1) + '</p><small class="text-body-secondary">Leave empty to update details only. PDF, PNG, JPG (max 5 MB)</small><div class="dropzone-preview" aria-live="polite"></div></div>' +
              '</div>' +
            '</div>' +
            '<div class="d-flex gap-2 mt-4"><button type="submit" class="btn btn-gradient rounded-pill px-4"><i class="bi bi-save me-1" aria-hidden="true"></i>Save changes</button><a href="/patients/' + d.patient_id + '" class="btn btn-outline-secondary rounded-pill px-4">Cancel</a></div>' +
          '</form>' +
        '</div></div>' +
        '<div class="col-lg-5"><div class="mv-card fade-up h-100">' +
          '<div class="mv-card-header"><div><h2 class="h5 fw-bold mb-0"><i class="bi bi-clock-history text-primary me-2" aria-hidden="true"></i>Version history</h2><p class="small text-body-secondary mb-0">Preserved snapshots of every change</p></div></div>' +
          '<div class="mv-card-body"><ol class="list-unstyled d-grid gap-3 mb-0">' + historyHtml + '</ol></div>' +
        '</div></div>' +
      '</div>'
    );
  }

  function renderPrescriptionNew(patient, form, errors) {
    form = form || {};
    errors = errors || {};
    var freqs = ["Once daily", "Twice daily", "Three times daily", "Four times daily", "Every 8 hours", "At bedtime", "As needed", "Other"];
    var freqOptions = freqs.map(function (f) {
      return '<option value="' + esc(f) + '" ' + ((form.frequency_select || "Once daily") === f ? "selected" : "") + '>' + esc(f) + '</option>';
    }).join("");

    return (
      '<a href="/patients/' + patient.id + '" class="btn btn-outline-secondary btn-sm rounded-pill mb-3"><i class="bi bi-arrow-left me-1" aria-hidden="true"></i>Back to patient</a>' +
      '<div class="row justify-content-center"><div class="col-lg-8"><div class="mv-card fade-up">' +
        '<div class="mv-card-header"><div><h1 class="h4 fw-bold mb-1"><i class="bi bi-capsule-pill text-danger me-2" aria-hidden="true"></i>New prescription</h1><p class="text-body-secondary small mb-0">For ' + esc(patient.name) + ' &bull; <span class="mrn">' + esc(patient.mrn) + '</span></p></div></div>' +
        '<form id="rx-new-form" data-patient-id="' + patient.id + '" class="mv-card-body" novalidate>' +
          '<div class="row g-3">' +
            '<div class="col-md-6"><label for="medicine" class="form-label">Medicine</label><input id="medicine" name="medicine" class="form-control ' + (errors.medicine ? "is-invalid" : "") + '" value="' + esc(form.medicine || "") + '" maxlength="100" required placeholder="e.g. Amoxicillin">' + fieldError(errors, "medicine") + '</div>' +
            '<div class="col-md-6"><label for="dosage" class="form-label">Dosage</label><input id="dosage" name="dosage" class="form-control ' + (errors.dosage ? "is-invalid" : "") + '" value="' + esc(form.dosage || "") + '" maxlength="50" required placeholder="e.g. 500 mg">' + fieldError(errors, "dosage") + '</div>' +
            '<div class="col-md-6"><label for="frequency_select" class="form-label">Frequency</label><select id="frequency_select" name="frequency_select" class="form-select">' + freqOptions + '</select></div>' +
            '<div class="col-md-6" id="frequency-other-group" ' + (form.frequency_select !== "Other" ? "hidden" : "") + '><label for="frequency_other" class="form-label">Custom frequency</label><input id="frequency_other" name="frequency_other" class="form-control" value="' + esc(form.frequency_other || "") + '" maxlength="50" placeholder="e.g. Every 6 hours"></div>' +
            '<div class="col-md-6"><label for="duration" class="form-label">Duration</label><input id="duration" name="duration" class="form-control ' + (errors.duration ? "is-invalid" : "") + '" value="' + esc(form.duration || "") + '" maxlength="50" required placeholder="e.g. 7 days">' + fieldError(errors, "duration") + '</div>' +
            '<div class="col-12"><label for="instructions" class="form-label">Instructions <span class="text-body-secondary fw-normal">(optional)</span></label><textarea id="instructions" name="instructions" rows="3" class="form-control" maxlength="500" placeholder="e.g. Take after meals">' + esc(form.instructions || "") + '</textarea></div>' +
          '</div>' +
          '<div class="d-flex gap-2 mt-4"><button type="submit" class="btn btn-gradient rounded-pill px-4"><i class="bi bi-check2-circle me-1" aria-hidden="true"></i>Save prescription</button><a href="/patients/' + patient.id + '" class="btn btn-outline-secondary rounded-pill px-4">Cancel</a></div>' +
        '</form>' +
      '</div></div></div>'
    );
  }

  function renderPrescriptionPrint(rx, patient, role) {
    var backHref = role === "patient" ? "/portal" : "/patients/" + patient.id;
    var backLabel = role === "patient" ? "Back to portal" : "Back to patient";
    return (
      '<div class="no-print d-flex justify-content-between align-items-center mb-3">' +
        '<a href="' + backHref + '" class="btn btn-outline-secondary btn-sm rounded-pill"><i class="bi bi-arrow-left me-1" aria-hidden="true"></i>' + backLabel + '</a>' +
        '<button type="button" class="btn btn-gradient rounded-pill px-4" id="print-btn"><i class="bi bi-printer me-1" aria-hidden="true"></i>Print prescription</button>' +
      '</div>' +
      '<article class="mv-card rx-print mx-auto p-4 p-md-5" style="max-width: 720px;">' +
        '<header class="d-flex justify-content-between align-items-start border-bottom border-2 pb-3 mb-4">' +
          '<div><h1 class="h3 fw-bold mb-0 text-gradient">Medi Vault Clinic</h1><p class="text-body-secondary small mb-0">Medical Health &amp; Records System</p></div>' +
          '<div class="text-end"><span class="chip chip-' + esc(rx.status) + '">' + esc((rx.status || "").toUpperCase()) + '</span><div class="small text-body-secondary mt-1">Rx #' + esc(rx.id) + '</div></div>' +
        '</header>' +
        '<dl class="row small mb-4 p-3 rounded-3" style="background: var(--mv-gradient-soft);">' +
          '<dt class="col-sm-4 text-body-secondary fw-normal">Patient name</dt><dd class="col-sm-8 fw-bold">' + esc(patient.name) + '</dd>' +
          '<dt class="col-sm-4 text-body-secondary fw-normal">MRN</dt><dd class="col-sm-8 mrn">' + esc(patient.mrn) + '</dd>' +
          '<dt class="col-sm-4 text-body-secondary fw-normal">Date of birth</dt><dd class="col-sm-8">' + esc(patient.dob || "-") + '</dd>' +
          '<dt class="col-sm-4 text-body-secondary fw-normal mb-0">Prescription date</dt><dd class="col-sm-8 mb-0">' + esc((rx.prescribed_at || "").slice(0, 10)) + '</dd>' +
        '</dl>' +
        '<h2 class="h4 fw-bold d-flex align-items-baseline gap-2"><span class="fst-italic" style="font-family: serif; color: var(--mv-indigo);">Rx</span>' + esc(rx.medicine) + '</h2>' +
        '<table class="table table-sm mt-2"><tbody>' +
          '<tr><th scope="row" class="text-body-secondary fw-normal" style="width: 160px;">Dosage</th><td class="fw-semibold">' + esc(rx.dosage) + '</td></tr>' +
          '<tr><th scope="row" class="text-body-secondary fw-normal">Frequency</th><td>' + esc(rx.frequency) + '</td></tr>' +
          '<tr><th scope="row" class="text-body-secondary fw-normal">Duration</th><td>' + esc(rx.duration) + '</td></tr>' +
          (rx.instructions ? '<tr><th scope="row" class="text-body-secondary fw-normal">Instructions</th><td><em>' + esc(rx.instructions) + '</em></td></tr>' : "") +
          (rx.status === "stopped" ? '<tr><th scope="row" class="text-danger fw-normal">Discontinued</th><td class="text-body-secondary">Stopped on ' + esc((rx.stopped_at || "").slice(0, 10) || "-") + ' by ' + esc(rx.stopped_by) + (rx.stop_reason ? ': ' + esc(rx.stop_reason) : "") + '</td></tr>' : "") +
        '</tbody></table>' +
        '<footer class="d-flex justify-content-between align-items-end border-top pt-3 mt-5 small text-body-secondary" style="border-top-style: dashed !important;">' +
          '<div>Prescribed by: <strong>Dr. ' + esc(rx.prescribed_by) + '</strong><br>Date: ' + esc(rx.prescribed_at) + '</div>' +
          '<div class="text-end"><div class="border-bottom border-secondary mb-1" style="width: 150px;"></div>Doctor signature</div>' +
        '</footer>' +
      '</article>'
    );
  }

  function renderPortal(view, patient, activeRx, pastRx, docs, updates) {
    var pages = { dashboard: "Dashboard", records: "My medical records", prescriptions: "Prescriptions", notifications: "Notifications" };
    if (!pages[view]) view = "dashboard";

    var tabsHtml = Object.keys(pages).map(function (k) {
      return '<a href="/portal?view=' + k + '" class="' + (view === k ? "selected" : "") + '">' + esc(pages[k]) + '</a>';
    }).join("") + '<a href="/portal/profile">My profile</a>';

    var html =
      '<span class="eyebrow">PATIENT PORTAL</span>' +
      '<h1 class="page-title mt-2">' + (view === "dashboard" ? "Welcome, " + esc(patient.name) : esc(pages[view])) + '</h1>' +
      '<p class="text-body-secondary">Your personal health record and updates from your care team.</p>' +
      '<nav class="portal-tabs" aria-label="Patient workspace">' + tabsHtml + '</nav>';

    if (view === "dashboard") {
      html +=
        '<section class="profile-strip"><div><span class="eyebrow">PATIENT SUMMARY</span><h2>' + esc(patient.name) + '</h2><span>MRN: <b>' + esc(patient.mrn) + '</b> &nbsp; · &nbsp; Date of birth: ' + esc(patient.dob || "Not provided") + '</span></div><a href="/portal/profile" class="btn btn-surface">View profile</a></section>' +
        '<div class="row g-3 mb-4 portal-stats">' +
          '<div class="col-sm-4"><a class="stat-card d-block text-decoration-none" href="/portal?view=records"><i class="bi bi-folder2-open float-end stat-icon"></i><div class="stat-value">' + docs.length + '</div><div class="stat-label">Medical records</div></a></div>' +
          '<div class="col-sm-4"><a class="stat-card d-block text-decoration-none" href="/portal?view=prescriptions"><i class="bi bi-capsule float-end stat-icon"></i><div class="stat-value">' + activeRx.length + '</div><div class="stat-label">Active prescriptions</div></a></div>' +
          '<div class="col-sm-4"><a class="stat-card d-block text-decoration-none" href="/portal?view=prescriptions"><i class="bi bi-clock-history float-end stat-icon"></i><div class="stat-value">' + pastRx.length + '</div><div class="stat-label">Previous prescriptions</div></a></div>' +
        '</div>';
    }

    if (view === "dashboard" || view === "records") {
      var list = view === "dashboard" ? docs.slice(0, 3) : docs;
      var docsRows = list.length ? list.map(function (d) {
        return '<tr><td>' + esc(d.title) + '</td><td>' + esc(d.doc_type) + '</td><td>' + esc((d.created_at || "").slice(0, 10)) + '</td><td><button type="button" class="btn btn-sm btn-link p-0" data-open-portal-doc="' + d.id + '">View document</button></td></tr>';
      }).join("") : '<tr><td colspan="4" class="empty-state">No medical documents have been added yet.</td></tr>';

      html +=
        '<section class="mv-card mb-4">' +
          '<div class="mv-card-header"><h2>' + (view === "dashboard" ? "Recent medical documents" : "Medical documents & reports") + '</h2>' + (view === "dashboard" ? '<a href="/portal?view=records">View all</a>' : "") + '</div>' +
          '<div class="table-responsive"><table class="table mv-table"><thead><tr><th>Document</th><th>Type</th><th>Uploaded</th><th>Action</th></tr></thead><tbody>' + docsRows + '</tbody></table></div>' +
        '</section>';
    }

    if (view === "dashboard" || view === "prescriptions") {
      var groups = [["Active prescriptions", activeRx]];
      if (view === "prescriptions") groups.push(["Previous prescriptions", pastRx]);
      groups.forEach(function (grp) {
        var title = grp[0];
        var items = grp[1];
        var inner = items.length ? items.map(function (r) {
          return (
            '<article class="rx-row">' +
              '<div><b>' + esc(r.medicine) + '</b> <span class="chip chip-' + esc(r.status) + '">' + esc(r.status) + '</span>' +
              '<div>' + esc(r.dosage) + ' · ' + esc(r.frequency) + ' · ' + esc(r.duration) + '</div>' +
              (r.instructions ? '<p class="mb-1">' + esc(r.instructions) + '</p>' : "") +
              '<small>Prescribed by ' + esc(r.prescribed_by) + ' · ' + esc((r.prescribed_at || "").slice(0, 10)) + '</small></div>' +
              '<a href="/prescriptions/' + r.id + '/print">Print prescription</a>' +
            '</article>'
          );
        }).join("") : '<div class="empty-state">No ' + esc(title.toLowerCase()) + ' on file.</div>';
        html += '<section class="mv-card mb-4"><div class="mv-card-header"><h2>' + esc(title) + '</h2></div>' + inner + '</section>';
      });
    }

    if (view === "dashboard" || view === "notifications") {
      var slice = view === "dashboard" ? updates.slice(0, 4) : updates;
      var itemsHtml = "";
      if (!patient.dob) {
        itemsHtml += '<div class="rx-row">Your profile is missing a date of birth. <a href="/portal/profile">Complete profile</a></div>';
      }
      itemsHtml += slice.map(function (e) {
        if (e.docId) {
          return '<div class="rx-row"><button type="button" class="btn btn-link p-0 text-start" data-open-portal-doc="' + e.docId + '">' + esc(e.label) + '</button><small>' + esc(e.date) + '</small></div>';
        }
        return '<div class="rx-row"><a href="' + esc(e.url) + '">' + esc(e.label) + '</a><small>' + esc(e.date) + '</small></div>';
      }).join("");
      if (!updates.length && patient.dob) {
        itemsHtml += '<div class="empty-state">No record updates yet.</div>';
      }
      html += '<section class="mv-card"><div class="mv-card-header"><h2>Notifications</h2></div>' + itemsHtml + '</section>';
    }

    return html;
  }

  function renderPortalProfile(patient, user, errors, today) {
    errors = errors || {};
    return (
      '<a href="/portal" class="btn btn-outline-secondary btn-sm rounded-pill mb-3"><i class="bi bi-arrow-left me-1" aria-hidden="true"></i>Back to portal</a>' +
      '<div class="row justify-content-center"><div class="col-lg-6"><div class="mv-card fade-up">' +
        '<div class="mv-card-header"><div><h1 class="h4 fw-bold mb-1"><i class="bi bi-person-badge text-primary me-2" aria-hidden="true"></i>My profile</h1><p class="small text-body-secondary mb-0">MRN <span class="mrn">' + esc(patient.mrn) + '</span></p></div></div>' +
        '<div class="mv-card-body">' +
          '<dl class="row mb-4">' +
            '<dt class="col-sm-4 text-body-secondary fw-normal">Name</dt><dd class="col-sm-8 fw-semibold">' + esc(patient.name) + '</dd>' +
            '<dt class="col-sm-4 text-body-secondary fw-normal">Email</dt><dd class="col-sm-8">' + esc(user.email || "-") + '</dd>' +
            '<dt class="col-sm-4 text-body-secondary fw-normal">Username</dt><dd class="col-sm-8 mono">' + esc(user.username) + '</dd>' +
            '<dt class="col-sm-4 text-body-secondary fw-normal mb-0">Date of birth</dt><dd class="col-sm-8 mb-0">' + esc(patient.dob || "Not provided") + '</dd>' +
          '</dl>' +
          (!patient.dob ? (
            '<form id="portal-profile-form" novalidate>' +
              '<label for="dob" class="form-label">Add your date of birth</label>' +
              '<input id="dob" name="dob" type="date" class="form-control ' + (errors.dob ? "is-invalid" : "") + '" max="' + esc(today) + '" required>' +
              fieldError(errors, "dob") +
              '<div class="d-flex gap-2 mt-3"><button type="submit" class="btn btn-gradient rounded-pill px-4">Save</button><a href="/portal" class="btn btn-outline-secondary rounded-pill px-4">Skip for now</a></div>' +
            '</form>'
          ) : (
            '<p class="small text-body-secondary mb-0"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>Need to correct your details? Ask hospital staff to update your record.</p>'
          )) +
        '</div>' +
      '</div></div></div>'
    );
  }

  function renderAudit(rows, outcomeCounts) {
    var chips = [
      ["ok", "OK"], ["failed", "Failed"], ["denied", "Denied"], ["rejected", "Rejected"], ["blocked", "Blocked"]
    ];
    var rowsHtml = rows.map(function (r) {
      return (
        '<tr data-user="' + esc(r.user) + '" data-action="' + esc(r.action) + '" data-outcome="' + esc(r.outcome) + '">' +
          '<td class="mono small text-nowrap">' + esc(r.ts) + '</td>' +
          '<td><strong>' + esc(r.user) + '</strong></td>' +
          '<td><code>' + esc(r.action) + '</code></td>' +
          '<td class="small text-body-secondary text-break" style="max-width: 320px;">' + esc(r.detail) + '</td>' +
          '<td><span class="chip chip-' + esc(r.outcome) + '">' + esc(r.outcome) + '</span></td>' +
        '</tr>'
      );
    }).join("");

    return (
      '<div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4 fade-up">' +
        '<div><span class="eyebrow">GOVERNANCE WORKSPACE</span><h1 class="page-title h2 mb-1"><span class="text-gradient">System audit log</span></h1><p class="text-body-secondary mb-0">Append-only trail of access events, document actions and security checks (latest 200). No patient names or document titles are recorded.</p></div>' +
        '<a href="/users" class="btn btn-gradient rounded-pill px-4"><i class="bi bi-person-gear me-1" aria-hidden="true"></i>Manage users</a>' +
      '</div>' +
      '<section class="row g-3 mb-4" aria-label="Outcome summary">' +
        '<div class="col-6 col-lg"><div class="stat-card stat-green"><div class="stat-value" data-count="' + outcomeCounts.ok + '">' + outcomeCounts.ok + '</div><div class="stat-label">Successful actions</div></div></div>' +
        '<div class="col-6 col-lg"><div class="stat-card stat-pink"><div class="stat-value" data-count="' + outcomeCounts.failed + '">' + outcomeCounts.failed + '</div><div class="stat-label">Failed logins</div></div></div>' +
        '<div class="col-6 col-lg"><div class="stat-card stat-indigo"><div class="stat-value" data-count="' + outcomeCounts.denied + '">' + outcomeCounts.denied + '</div><div class="stat-label">Denied (403)</div></div></div>' +
        '<div class="col-6 col-lg"><div class="stat-card stat-amber"><div class="stat-value" data-count="' + outcomeCounts.rejected + '">' + outcomeCounts.rejected + '</div><div class="stat-label">Rejected uploads</div></div></div>' +
        '<div class="col-12 col-lg"><div class="stat-card stat-cyan"><div class="stat-value" data-count="' + outcomeCounts.blocked + '">' + outcomeCounts.blocked + '</div><div class="stat-label">Blocked</div></div></div>' +
      '</section>' +
      '<div class="mv-card fade-up">' +
        '<div class="mv-card-body border-bottom" style="border-color: var(--mv-border) !important;"><div class="row g-3">' +
          '<div class="col-md-6"><label for="audit-filter-user" class="form-label">Filter by user</label><div class="input-group"><span class="input-group-text"><i class="bi bi-person" aria-hidden="true"></i></span><input id="audit-filter-user" class="form-control" placeholder="Type a username..." autocomplete="off"></div></div>' +
          '<div class="col-md-6"><label for="audit-filter-action" class="form-label">Filter by action</label><div class="input-group"><span class="input-group-text"><i class="bi bi-lightning" aria-hidden="true"></i></span><input id="audit-filter-action" class="form-control" placeholder="e.g. login, search, upload..." autocomplete="off"></div></div>' +
          '<div class="col-12"><span class="form-label d-block" id="outcome-chips-label">Outcome</span><div class="d-flex flex-wrap gap-2" role="group" aria-labelledby="outcome-chips-label" id="audit-outcome-chips">' +
            '<button type="button" class="filter-chip active" data-outcome="" aria-pressed="true">All <span class="count">' + rows.length + '</span></button>' +
            chips.map(function (c) {
              return '<button type="button" class="filter-chip" data-outcome="' + c[0] + '" aria-pressed="false"><span class="chip chip-' + c[0] + ' p-0 px-1" aria-hidden="true">&bull;</span>' + c[1] + ' <span class="count">' + outcomeCounts[c[0]] + '</span></button>';
            }).join("") +
          '</div></div>' +
        '</div></div>' +
        '<div class="table-responsive"><table class="table mv-table" id="audit-table"><thead><tr><th scope="col">Time</th><th scope="col">User</th><th scope="col">Action</th><th scope="col">Detail</th><th scope="col">Outcome</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
        '<div id="audit-filter-empty" class="empty-state" style="display: ' + (rows.length === 0 ? "block" : "none") + ';"><i class="bi bi-funnel" aria-hidden="true"></i><p class="mb-0">No audit entries match the current filter.</p></div>' +
      '</div>'
    );
  }

  function renderUsers(users, activeTab, counts, currentUsername) {
    var tabs = [
      ["pending", "Pending Requests", "bi-hourglass-split"],
      ["active", "Active Users", "bi-person-check"],
      ["declined", "Declined", "bi-x-octagon"],
      ["disabled", "Disabled", "bi-slash-circle"],
      ["deleted", "Deleted", "bi-trash3"]
    ];
    var tabsHtml = tabs.map(function (t) {
      var isActive = activeTab === t[0];
      return (
        '<li class="nav-item"><a href="/users?tab=' + t[0] + '" class="nav-link ' + (isActive ? "active" : "") + '" ' + (isActive ? 'aria-current="page"' : "") + '>' +
          '<i class="bi ' + t[2] + ' me-1" aria-hidden="true"></i>' + t[1] + ' <span class="badge rounded-pill ms-1">' + counts[t[0]] + '</span>' +
        '</a></li>'
      );
    }).join("");

    var bodyHtml = users.length ? users.map(function (u) {
      var isSelf = u.username === currentUsername;
      var initials = (u.username || "??").slice(0, 2).toUpperCase();
      var middleCols = "";
      if (activeTab === "pending") {
        middleCols =
          '<td><span class="role-badge role-' + esc(u.requested_role || "staff") + '">' + esc(capitalize(u.requested_role || "staff")) + '</span>' +
          (u.claimed_mrn ? '<div class="small mt-1">Claimed <span class="mrn">' + esc(u.claimed_mrn) + '</span></div>' : "") + '</td>';
      } else {
        var roleCell = "";
        if (activeTab === "active" && !isSelf) {
          roleCell =
            '<form class="d-flex gap-1 align-items-center m-0 user-role-form" data-uid="' + u.id + '" data-tab="' + activeTab + '">' +
              '<label for="role-' + u.id + '" class="visually-hidden">Role for ' + esc(u.username) + '</label>' +
              '<select id="role-' + u.id + '" name="role" class="form-select form-select-sm" style="width: auto;" required>' +
                '<option value="clerk" ' + (u.role === "clerk" ? "selected" : "") + '>Clerk</option>' +
                '<option value="doctor" ' + (u.role === "doctor" ? "selected" : "") + '>Doctor</option>' +
                '<option value="auditor" ' + (u.role === "auditor" ? "selected" : "") + '>Auditor</option>' +
                (u.role === "patient" ? '<option value="patient" selected>Patient</option>' : "") +
              '</select>' +
              '<button type="submit" class="btn btn-sm btn-outline-primary rounded-pill">Update</button>' +
            '</form>';
        } else if (u.role) {
          roleCell = '<span class="role-badge role-' + esc(u.role) + '">' + esc(u.role) + '</span>';
        } else {
          roleCell = '<span class="text-body-secondary fst-italic small">None</span>';
        }
        middleCols = '<td>' + roleCell + '</td><td>' + (u.patient_mrn ? '<span class="mrn">' + esc(u.patient_mrn) + '</span>' : '<span class="text-body-secondary">-</span>') + '</td>';
      }

      var actionsCell = "";
      if (isSelf) {
        actionsCell = '<small class="text-body-secondary">Current user</small>';
      } else {
        var btns = "";
        if (u.status === "pending") {
          btns +=
            '<form class="d-flex flex-wrap gap-1 align-items-center justify-content-end m-0 user-approve-form" data-uid="' + u.id + '" data-tab="' + activeTab + '">' +
              '<select name="role" class="form-select form-select-sm role-select-toggle" data-patient-field="pending-patient-' + u.id + '" style="width: auto;" required>' +
                '<option value="clerk" ' + (u.requested_role !== "patient" ? "selected" : "") + '>Clerk</option><option value="doctor">Doctor</option><option value="auditor">Auditor</option>' +
                '<option value="patient" ' + (u.requested_role === "patient" ? "selected" : "") + '>Patient</option>' +
              '</select>' +
              '<div id="pending-patient-' + u.id + '" ' + (u.requested_role !== "patient" ? 'style="display: none;"' : "") + '><input type="text" name="mrn" value="' + esc(u.claimed_mrn || "") + '" placeholder="MRN-1001" class="form-control form-control-sm" style="width: 110px;"></div>' +
              '<button type="submit" class="btn btn-sm btn-success rounded-pill"><i class="bi bi-check-lg" aria-hidden="true"></i> Approve</button>' +
            '</form>' +
            '<button type="button" class="btn btn-sm btn-outline-danger rounded-pill" data-user-action="decline" data-uid="' + u.id + '" data-tab="' + activeTab + '" data-confirm="Decline access request for user \'' + esc(u.username) + '\'?" data-confirm-title="Decline User Request"><i class="bi bi-x-lg" aria-hidden="true"></i> Decline</button>';
        } else if (u.status === "approved") {
          btns +=
            '<button type="button" class="btn btn-sm btn-outline-secondary rounded-pill" data-user-action="force_logout" data-uid="' + u.id + '" data-tab="' + activeTab + '" data-confirm="Force immediate logout for \'' + esc(u.username) + '\'? Their session ends on their next request." data-confirm-title="Force Logout User"><i class="bi bi-box-arrow-right" aria-hidden="true"></i> Log out now</button>' +
            '<button type="button" class="btn btn-sm btn-outline-primary rounded-pill" data-user-action="reset_password" data-uid="' + u.id + '" data-tab="' + activeTab + '" data-confirm="Reset password for \'' + esc(u.username) + '\'? A new temporary password will be shown once." data-confirm-title="Reset User Password"><i class="bi bi-key" aria-hidden="true"></i> Reset Password</button>' +
            '<button type="button" class="btn btn-sm btn-outline-warning rounded-pill" data-user-action="disable" data-uid="' + u.id + '" data-tab="' + activeTab + '" data-confirm="Disable account for \'' + esc(u.username) + '\'? They immediately lose access." data-confirm-title="Disable User Account"><i class="bi bi-slash-circle" aria-hidden="true"></i> Disable</button>' +
            '<button type="button" class="btn btn-sm btn-danger rounded-pill" data-user-action="delete" data-uid="' + u.id + '" data-tab="' + activeTab + '" data-confirm="Delete account for \'' + esc(u.username) + '\'? This soft-deletes the user and keeps the username in audit trails." data-confirm-title="Delete User"><i class="bi bi-trash3" aria-hidden="true"></i> Delete</button>';
        } else if (u.status === "disabled") {
          btns +=
            '<button type="button" class="btn btn-sm btn-success rounded-pill" data-user-action-direct="enable" data-uid="' + u.id + '" data-tab="' + activeTab + '"><i class="bi bi-check-circle" aria-hidden="true"></i> Enable</button>' +
            '<button type="button" class="btn btn-sm btn-danger rounded-pill" data-user-action="delete" data-uid="' + u.id + '" data-tab="' + activeTab + '" data-confirm="Delete account for \'' + esc(u.username) + '\'?" data-confirm-title="Delete User"><i class="bi bi-trash3" aria-hidden="true"></i> Delete</button>';
        } else if (u.status === "declined") {
          btns +=
            '<form class="d-flex flex-wrap gap-1 align-items-center justify-content-end m-0 user-approve-form" data-uid="' + u.id + '" data-tab="' + activeTab + '">' +
              '<select name="role" class="form-select form-select-sm role-select-toggle" data-patient-field="declined-patient-' + u.id + '" style="width: auto;" required>' +
                '<option value="clerk">Clerk</option><option value="doctor">Doctor</option><option value="auditor">Auditor</option><option value="patient">Patient</option>' +
              '</select>' +
              '<div id="declined-patient-' + u.id + '" style="display: none;"><input type="text" name="mrn" value="' + esc(u.claimed_mrn || "") + '" placeholder="MRN-1001" class="form-control form-control-sm" style="width: 110px;"></div>' +
              '<button type="submit" class="btn btn-sm btn-success rounded-pill">Re-Approve</button>' +
            '</form>' +
            '<button type="button" class="btn btn-sm btn-danger rounded-pill" data-user-action="delete" data-uid="' + u.id + '" data-tab="' + activeTab + '" data-confirm="Delete account for \'' + esc(u.username) + '\'?" data-confirm-title="Delete User"><i class="bi bi-trash3" aria-hidden="true"></i> Delete</button>';
        } else {
          btns = '<small class="text-body-secondary fst-italic">Soft-deleted</small>';
        }
        actionsCell = '<div class="d-flex flex-wrap gap-1 justify-content-end">' + btns + '</div>';
      }

      return (
        '<tr>' +
          '<td><div class="d-flex align-items-center gap-2"><span class="avatar" style="background: var(--mv-gradient-soft);" aria-hidden="true">' + esc(initials) + '</span><div><strong>' + esc(u.username) + '</strong>' +
          (isSelf ? '<span class="chip chip-you ms-1">You</span>' : "") +
          ((u.full_name || u.email) ? '<div class="small text-body-secondary">' + esc(u.full_name || "") + (u.full_name && u.email ? " &bull; " : "") + esc(u.email || "") + '</div>' : "") +
          '</div></div></td>' +
          '<td><span class="chip chip-' + esc(u.status) + '">' + esc(u.status) + '</span></td>' +
          middleCols +
          '<td class="small text-nowrap">' + esc(u.created_at || "-") + '</td>' +
          '<td class="small">' + (u.reviewed_by ? esc(u.reviewed_by) + '<div class="text-body-secondary">' + esc(u.reviewed_at) + '</div>' : "-") + '</td>' +
          '<td class="text-end">' + actionsCell + '</td>' +
        '</tr>'
      );
    }).join("") : '<tr><td colspan="7"><div class="empty-state"><i class="bi bi-people" aria-hidden="true"></i>No users in ' + esc(activeTab) + ' status.</div></td></tr>';

    return (
      '<div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4 fade-up">' +
        '<div><h1 class="page-title h2 mb-1"><span class="text-gradient">User management</span></h1><p class="text-body-secondary mb-0">Approve staff requests, assign roles, provision accounts and administer credentials.</p></div>' +
        '<a href="/users/new" class="btn btn-gradient rounded-pill px-4" id="btn-create-user"><i class="bi bi-person-plus me-1" aria-hidden="true"></i>+ Create user</a>' +
      '</div>' +
      '<ul class="nav mv-tabs mb-3 flex-wrap" aria-label="User status tabs">' + tabsHtml + '</ul>' +
      '<div class="mv-card fade-up"><div class="table-responsive"><table class="table mv-table"><thead><tr>' +
        '<th scope="col">User</th><th scope="col">Status</th>' +
        (activeTab === "pending" ? '<th scope="col">Requested</th>' : '<th scope="col">Role</th><th scope="col">Linked patient</th>') +
        '<th scope="col">Created</th><th scope="col">Reviewed by</th><th scope="col" class="text-end">Actions</th>' +
      '</tr></thead><tbody>' + bodyHtml + '</tbody></table></div></div>'
    );
  }

  function renderUserNew(patients, form, errors) {
    form = form || {};
    errors = errors || {};
    var roles = ["clerk", "doctor", "auditor", "patient"];
    var roleOpts = roles.map(function (r) {
      return '<option value="' + r + '" ' + (form.role === r ? "selected" : "") + '>' + capitalize(r) + '</option>';
    }).join("");
    var mrnOpts = patients.map(function (p) {
      return '<option value="' + esc(p.mrn) + '" ' + (form.mrn === p.mrn ? "selected" : "") + '>' + esc(p.mrn) + '</option>';
    }).join("");

    return (
      '<a href="/users" class="btn btn-outline-secondary btn-sm rounded-pill mb-3"><i class="bi bi-arrow-left me-1" aria-hidden="true"></i>Back to users</a>' +
      '<div class="row justify-content-center"><div class="col-lg-7"><div class="mv-card fade-up">' +
        '<div class="mv-card-header"><div><h1 class="h4 fw-bold mb-1"><i class="bi bi-person-plus-fill text-primary me-2" aria-hidden="true"></i>Create user account</h1><p class="small text-body-secondary mb-0">The user must change this temporary password at first login.</p></div></div>' +
        '<form id="user-new-form" class="mv-card-body" novalidate>' +
          '<div class="row g-3">' +
            '<div class="col-md-6"><label for="username" class="form-label">Username</label><input id="username" name="username" class="form-control ' + (errors.username ? "is-invalid" : "") + '" value="' + esc(form.username || "") + '" maxlength="30" required aria-describedby="username-hint"><div class="form-text" id="username-hint">3-30 lowercase letters, digits or underscores.</div>' + fieldError(errors, "username") + '</div>' +
            '<div class="col-md-6"><label for="role" class="form-label">Role</label><select id="role" name="role" class="form-select role-select-toggle ' + (errors.role ? "is-invalid" : "") + '" data-patient-field="patient-mrn-group" required>' + roleOpts + '</select>' + fieldError(errors, "role") + '</div>' +
            '<div class="col-12" id="patient-mrn-group" ' + (form.role !== "patient" ? 'style="display: none;"' : "") + '><label for="mrn" class="form-label">Link to patient record (MRN)</label><select id="mrn" name="mrn" class="form-select ' + (errors.mrn ? "is-invalid" : "") + '"><option value="">-- Select an unlinked patient MRN --</option>' + mrnOpts + '</select>' + fieldError(errors, "mrn") + '</div>' +
            '<div class="col-12"><label for="password" class="form-label">Temporary password</label><div class="input-group"><input id="password" name="password" type="text" class="form-control mono ' + (errors.password ? "is-invalid" : "") + '" value="' + esc(form.password || "") + '" minlength="10" required autocomplete="off"><button type="button" class="btn btn-outline-primary generate-password-btn" data-target="password"><i class="bi bi-magic me-1" aria-hidden="true"></i>Generate</button></div>' + fieldError(errors, "password") + '</div>' +
          '</div>' +
          '<div class="d-flex gap-2 mt-4"><button type="submit" class="btn btn-gradient rounded-pill px-4"><i class="bi bi-check2-circle me-1" aria-hidden="true"></i>Create account</button><a href="/users" class="btn btn-outline-secondary rounded-pill px-4">Cancel</a></div>' +
        '</form>' +
      '</div></div></div>'
    );
  }

  function renderUserCreatedResult(title, subtitle, username, tempPassword) {
    return (
      '<div class="row justify-content-center"><div class="col-lg-6"><div class="mv-card p-4 p-md-5 text-center fade-up">' +
        '<span class="feature-icon stat-green mb-3" style="width: 4rem; height: 4rem; font-size: 1.8rem;"><i class="bi bi-check2-all" aria-hidden="true"></i></span>' +
        '<h1 class="h3 fw-bold">' + esc(title) + '</h1>' +
        '<p class="text-body-secondary">' + esc(subtitle) + '</p>' +
        '<div class="text-start mt-4">' +
          '<span class="form-label d-block">Username</span><div class="secret-box mono mb-3">' + esc(username) + '</div>' +
          '<span class="form-label d-block">Temporary password <span class="text-danger small fw-normal">(shown only once)</span></span>' +
          '<div class="d-flex gap-2 align-items-stretch"><div class="secret-box mono flex-grow-1" id="temp-password">' + esc(tempPassword) + '</div><button type="button" class="btn btn-outline-primary rounded-3 copy-btn" data-copy="' + esc(tempPassword) + '"><i class="bi bi-clipboard me-1" aria-hidden="true"></i><span>Copy</span></button></div>' +
        '</div>' +
        '<div class="alert alert-warning rounded-4 border-0 mt-4 text-start small" role="note"><i class="bi bi-exclamation-triangle-fill me-1" aria-hidden="true"></i>Share this password securely. The user must set a new password at first login. It is never stored in plain text or written to the audit log.</div>' +
        '<a href="/users?tab=active" class="btn btn-gradient rounded-pill px-4">Back to user management</a>' +
      '</div></div></div>'
    );
  }

  function renderError(code, title, message) {
    return (
      '<div class="row justify-content-center"><div class="col-md-8 col-lg-6"><div class="mv-card p-5 text-center fade-up">' +
        '<div class="display-1 fw-bold text-gradient mb-2">' + esc(code) + '</div>' +
        '<h1 class="h3 fw-bold">' + esc(title) + '</h1>' +
        '<p class="text-body-secondary mb-4">' + esc(message) + '</p>' +
        '<div class="d-flex justify-content-center gap-2">' +
          '<a href="/" class="btn btn-gradient rounded-pill px-4"><i class="bi bi-house me-1" aria-hidden="true"></i>Go home</a>' +
          '<button type="button" class="btn btn-outline-secondary rounded-pill px-4 js-back"><i class="bi bi-arrow-left me-1" aria-hidden="true"></i>Go back</button>' +
        '</div>' +
      '</div></div></div>'
    );
  }

  global.MediVaultViews = {
    esc: esc,
    renderNav: renderNav,
    renderHome: renderHome,
    renderLogin: renderLogin,
    renderPatientLogin: renderPatientLogin,
    renderSignup: renderSignup,
    renderPasswordChange: renderPasswordChange,
    renderPatients: renderPatients,
    renderPatientNew: renderPatientNew,
    renderPatientDetail: renderPatientDetail,
    renderDocumentEdit: renderDocumentEdit,
    renderPrescriptionNew: renderPrescriptionNew,
    renderPrescriptionPrint: renderPrescriptionPrint,
    renderPortal: renderPortal,
    renderPortalProfile: renderPortalProfile,
    renderAudit: renderAudit,
    renderUsers: renderUsers,
    renderUserNew: renderUserNew,
    renderUserCreatedResult: renderUserCreatedResult,
    renderError: renderError
  };
})(window);
