/* Medi Vault - theme controller.
   Loaded synchronously in <head> so the saved theme is applied before first paint (no flash). */
(function () {
  var STORAGE_KEY = "medivault-theme";
  var THEME_COLORS = { light: "#17324D", dark: "#152536" };
  var root = document.documentElement;

  function readStored() {
    try {
      var value = localStorage.getItem(STORAGE_KEY);
      return value === "dark" || value === "light" ? value : null;
    } catch (e) {
      return null;
    }
  }

  function syncControls(theme) {
    var next = theme === "dark" ? "light" : "dark";
    var label = "Switch to " + next + " theme";
    var buttons = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-label", label);
      buttons[i].setAttribute("title", label);
    }
  }

  function apply(theme) {
    root.setAttribute("data-bs-theme", theme);
    root.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
    syncControls(theme);
  }

  function current() {
    return root.getAttribute("data-bs-theme") === "dark" ? "dark" : "light";
  }

  function set(theme, animate) {
    if (theme !== "dark" && theme !== "light") return;
    if (animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.classList.add("theme-transition");
      window.setTimeout(function () { root.classList.remove("theme-transition"); }, 320);
    }
    apply(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* storage unavailable */ }
  }

  apply(readStored() || "light");

  document.addEventListener("click", function (event) {
    var target = event.target;
    var button = target && target.closest ? target.closest("[data-theme-toggle]") : null;
    if (!button) return;
    event.preventDefault();
    set(current() === "dark" ? "light" : "dark", true);
  });

  document.addEventListener("DOMContentLoaded", function () { syncControls(current()); });

  window.addEventListener("storage", function (event) {
    if (event.key === STORAGE_KEY && (event.newValue === "dark" || event.newValue === "light")) {
      apply(event.newValue);
    }
  });

  window.addEventListener("pageshow", function () { apply(readStored() || current()); });

  window.MediVaultTheme = {
    get: current,
    set: function (theme) { set(theme, true); },
    toggle: function () { set(current() === "dark" ? "light" : "dark", true); }
  };
})();
