// Site-wide light/dark mode. The initial mode is applied before first paint by
// /mode.js (public/), which reads the same storage key; this module handles
// the footer toggle and remembers the choice.

export type UiMode = 'light' | 'dark';

const STORAGE_KEY = 'collabjs-ui-mode';

export function getMode(): UiMode {
  return document.documentElement.dataset.mode === 'light' ? 'light' : 'dark';
}

function setMode(mode: UiMode): void {
  document.documentElement.dataset.mode = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // storage blocked: the mode still applies for this page view
  }
}

// Wire a button to flip the mode. Its label names the mode it switches to.
// onChange runs after the switch (the editor uses it to follow along).
export function setupModeToggle(
  button: HTMLButtonElement,
  onChange?: (mode: UiMode) => void
): void {
  const render = () => {
    const next = getMode() === 'dark' ? 'light' : 'dark';
    button.textContent = next === 'light' ? '☀ Light mode' : '☾ Dark mode';
    button.title = `Switch to ${next} mode`;
  };
  render();
  button.addEventListener('click', () => {
    const next: UiMode = getMode() === 'dark' ? 'light' : 'dark';
    setMode(next);
    render();
    onChange?.(next);
  });
}
