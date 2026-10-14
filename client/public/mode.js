// Set light/dark mode on <html> before the first paint, so a light-mode
// visitor never sees a flash of the dark page. Loaded as a plain blocking
// script in <head> of every page — it must be external (not inline) because
// the CSP is script-src 'self'. The saved choice wins; with none, follow the
// OS preference. Toggled later by client/src/mode.ts (same storage key).
(function () {
  var mode = null;
  try {
    mode = localStorage.getItem('collabjs-ui-mode');
  } catch (e) {
    // storage blocked: fall through to the OS preference
  }
  if (mode !== 'light' && mode !== 'dark') {
    mode = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }
  document.documentElement.dataset.mode = mode;
})();
