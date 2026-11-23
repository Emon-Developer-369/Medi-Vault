/* Medi Vault - client-side interactivity (vanilla JS + Bootstrap 5) */
document.addEventListener("DOMContentLoaded", function () {
  initToasts();
  initPasswordToggles();
  initPasswordStrength();
  initDropzones();
  initClientFilter();
  initAuditFilter();
  initConfirmModal();
  initButtonLoading();
  initPasswordGenerator();
  initRoleToggle();
  initSignupTypeToggle();
  initFrequencyToggle();
  initCopyButtons();

  initGoogleButtons();
  initMisc();
});

/* 1. Light / dark theme lives in static/js/theme.js (loaded in <head> to avoid a flash). */

/* 2. Flash messages as Bootstrap toasts */
function initToasts() {
  document.querySelectorAll(".toast").forEach(function (el) {
    bootstrap.Toast.getOrCreateInstance(el).show();
  });
}

function showToast(message, type) {
  var container = document.getElementById("toast-container");
  if (!container) return;
  var icons = { success: "bi-check-circle-fill", error: "bi-exclamation-octagon-fill", info: "bi-info-circle-fill" };
  var el = document.createElement("div");
  el.className = "toast mv-toast toast-" + (type || "info");
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML =
    '<div class="toast-body"><i class="bi ' + (icons[type] || icons.info) + ' fs-5" aria-hidden="true"></i>' +
    '<span class="flex-grow-1"></span>' +
    '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close notification"></button></div>';
  el.querySelector("span").textContent = message;
  container.appendChild(el);
  var t = bootstrap.Toast.getOrCreateInstance(el, { delay: 4500 });
  el.addEventListener("hidden.bs.toast", function () { el.remove(); });
  t.show();
}

/* 3. Show / hide password */
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

/* 4. Password strength meter + match check */
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
      bar.style.width = lvl.w; bar.style.backgroundColor = lvl.c; text.textContent = lvl.t;
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

/* 5. Drag & drop upload with client-side type/size hints (server re-validates everything) */
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
      preview.innerHTML = '<div class="alert ' + cls + ' py-2 px-3 mb-0 rounded-3 small d-inline-flex gap-2 align-items-center">' +
        '<i class="bi ' + (okType && okSize ? "bi-file-earmark-check" : "bi-exclamation-triangle") + '" aria-hidden="true"></i>' +
        '<span><strong></strong> (' + size + ') - ' + msg + "</span></div>";
      preview.querySelector("strong").textContent = file.name;
      preview.classList.add("is-visible");
    }
  });
}

/* 6. Live patient filter */
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

/* 7. Audit log filters: user, action text, and outcome chips */
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

/* 8. Accessible confirmation modal for destructive actions */
function initConfirmModal() {
  var modalEl = document.getElementById("confirm-modal");
  if (!modalEl) return;
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  var reasonWrap = document.getElementById("modal-reason-container");
  var reasonInput = document.getElementById("modal-reason-input");
  var confirmBtn = modalEl.querySelector(".modal-confirm-btn");
  var activeForm = null;

  document.querySelectorAll("[data-confirm]").forEach(function (trigger) {
    trigger.addEventListener("click", function (e) {
      e.preventDefault();
      activeForm = trigger.closest("form");
      modalEl.querySelector(".modal-title").textContent = trigger.getAttribute("data-confirm-title") || "Confirm Action";
      modalEl.querySelector(".modal-body-text").textContent = trigger.getAttribute("data-confirm") || "Are you sure?";
      var hasReason = trigger.getAttribute("data-has-reason") === "true";
      reasonWrap.classList.toggle("d-none", !hasReason);
      reasonInput.value = "";
      modal.show();
    });
  });
  modalEl.addEventListener("shown.bs.modal", function () {
    (reasonWrap.classList.contains("d-none") ? confirmBtn : reasonInput).focus();
  });
  modalEl.addEventListener("hidden.bs.modal", function () { activeForm = null; });
  confirmBtn.addEventListener("click", function () {
    if (!activeForm) return;
    if (!reasonWrap.classList.contains("d-none") && reasonInput.value.trim()) {
      var hidden = activeForm.querySelector("input[name='stop_reason']");
      if (!hidden) {
        hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = "stop_reason";
        activeForm.appendChild(hidden);
      }
      hidden.value = reasonInput.value.trim();
    }
    var form = activeForm;
    confirmBtn.classList.add("is-loading");
    HTMLFormElement.prototype.submit.call(form);
  });
}

/* 9. Loading spinner + prevent double submit */
function initButtonLoading() {
  document.querySelectorAll("form").forEach(function (f) {
    f.addEventListener("submit", function (e) {
      if (f.dataset.submitting === "1") { e.preventDefault(); return; }
      var btn = f.querySelector("button[type='submit']");
      if (btn && !btn.classList.contains("no-loading")) {
        f.dataset.submitting = "1";
        btn.classList.add("is-loading");
      }
    });
  });
  window.addEventListener("pageshow", function () {
    document.querySelectorAll("form[data-submitting]").forEach(function (f) { delete f.dataset.submitting; });
    document.querySelectorAll(".is-loading").forEach(function (b) { b.classList.remove("is-loading"); });
  });
}

/* 10. Strong password generator */
function initPasswordGenerator() {
  document.querySelectorAll(".generate-password-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var input = document.getElementById(btn.getAttribute("data-target") || "password");
      if (!input) return;
      var chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*";
      var arr = new Uint32Array(16);
      window.crypto.getRandomValues(arr);
      var pw = "";
      for (var i = 0; i < arr.length; i++) pw += chars[arr[i] % chars.length];
      input.value = pw;
      input.type = "text";
      input.dispatchEvent(new Event("input"));
      var confirm = document.getElementById("confirm_password");
      if (confirm) { confirm.value = pw; confirm.type = "text"; confirm.dispatchEvent(new Event("input")); }
      showToast("Strong password generated.", "success");
    });
  });
}

/* 11. Show MRN field when role is patient */
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

/* 12. Signup: patient vs staff */
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

/* 13. Prescription "Other" frequency */
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

/* 14. Copy to clipboard */
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

/* 15. Animated stat counters */
function initCounters() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelectorAll("[data-count]").forEach(function (el) {
    var target = parseInt(el.getAttribute("data-count"), 10) || 0;
    if (target === 0) return;
    var start = null;
    var duration = 900;
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

/* 16. Google's sign-in page cannot render inside an iframe, so open it in a new tab when embedded. */
function initGoogleButtons() {
  if (window.self === window.top) return;
  document.querySelectorAll(".js-google-btn").forEach(function (a) {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener");
  });
}

function initMisc() {
  document.querySelectorAll(".js-back").forEach(function (b) {
    b.addEventListener("click", function () { history.length > 1 ? history.back() : (location.href = "/"); });
  });
  var printBtn = document.getElementById("print-btn");
  if (printBtn) printBtn.addEventListener("click", function () { window.print(); });
}
