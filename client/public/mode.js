// Set light/dark mode on <html> before the first paint, so a light-mode
// visitor never sees a flash of the dark page. Loaded as a plain blocking
// script in <head> of every page — it must be external (not inline) because
// the CSP is script-src 'self'. The saved choice wins; with none, a returning
// user's earlier editor theme decides; otherwise follow the OS preference.
// Toggled later by client/src/mode.ts (same storage key).
(function () {
  // Light editor themes (isDark: false in client/src/themes.ts) — keep in sync.
  var LIGHT_THEMES = [
    'github-light', 'tokyo-night-day', 'material-light', 'solarized-light',
    'duotone-light', 'eclipse', 'quietlight', 'noctis-lilac', 'bbedit',
    'white-light', 'xcode-light'
  ];
  var mode = null;
  var legacyTheme = null;
  try {
    mode = localStorage.getItem('collabjs-ui-mode');
    // Theme picked before light mode existed (one key for all themes).
    legacyTheme = localStorage.getItem('collabjs-theme');
  } catch (e) {
    // storage blocked: fall through to the OS preference
  }
  if (mode !== 'light' && mode !== 'dark' && legacyTheme) {
    mode = LIGHT_THEMES.indexOf(legacyTheme) >= 0 ? 'light' : 'dark';
  }
  if (mode !== 'light' && mode !== 'dark') {
    mode = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }
  document.documentElement.dataset.mode = mode;
})();
