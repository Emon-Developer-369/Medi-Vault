/* Medi Vault - theme controller (loaded in <head> to prevent first-paint flash). */
(() => {
  const KEY = "medivault-theme";
  const COLORS = { light: "#17324D", dark: "#152536" };
  const root = document.documentElement;
  const read = () => { try { const v = localStorage.getItem(KEY); return v === "dark" || v === "light" ? v : null; } catch { return null; } };
  const current = () => (root.getAttribute("data-bs-theme") === "dark" ? "dark" : "light");

  const syncControls = (theme) => {
    const label = `Switch to ${theme === "dark" ? "light" : "dark"} theme`;
    document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
      b.setAttribute("aria-label", label);
      b.setAttribute("title", label);
    });
  };

  const apply = (theme) => {
    root.setAttribute("data-bs-theme", theme);
    root.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", COLORS[theme]);
    syncControls(theme);
  };

  const set = (theme, animate) => {
    if (theme !== "dark" && theme !== "light") return;
    if (animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.classList.add("theme-transition");
      setTimeout(() => root.classList.remove("theme-transition"), 320);
    }
    apply(theme);
    try { localStorage.setItem(KEY, theme); } catch {}
  };

  apply(read() || "light");
  document.addEventListener("click", (e) => {
    if (!e.target?.closest?.("[data-theme-toggle]")) return;
    e.preventDefault();
    set(current() === "dark" ? "light" : "dark", true);
  });
  document.addEventListener("DOMContentLoaded", () => syncControls(current()));
  addEventListener("storage", (e) => { if (e.key === KEY && (e.newValue === "dark" || e.newValue === "light")) apply(e.newValue); });
  addEventListener("pageshow", () => apply(read() || current()));

  window.MediVaultTheme = { get: current, set: (t) => set(t, true), toggle: () => set(current() === "dark" ? "light" : "dark", true) };
})();
