import { createEditor, CollabEditor } from './editor';
import { ActivityTracker } from './activity';
import { SharedConsole } from './console';
import { MouseCursors } from './mouse-cursors';
import {
  getOrCreateUsername,
  saveUsername,
  generateRandomUsername,
  getClientId
} from './username';
import {
  setupAwarenessListener,
} from './awareness';
import {
  THEMES,
  getThemeById,
  getDefaultTheme,
  saveTheme,
} from './themes';
import {
  fetchHostStatus,
  claimHost,
  loginHost,
  getStoredHostToken,
  storeHostToken,
  clearHostToken,
} from './host';

// Get room ID from URL or generate one. The full UUID gives ~122 bits of
// entropy — enough that a public deployment can't be enumerated by scanning.
// The pre-existing 8-char slice was ~32 bits and easily brute-forceable.
function getRoomId(): string {
  const path = window.location.pathname;
  const match = path.match(/^\/room\/([a-zA-Z0-9-]+)$/);

  if (match) {
    return match[1];
  }

  const newRoomId = crypto.randomUUID();
  window.history.replaceState(null, '', `/room/${newRoomId}`);
  return newRoomId;
}

// Initialize app
async function init() {
  const roomId = getRoomId();
  let username = getOrCreateUsername();
  const clientId = getClientId();

  // Get DOM elements
  const editorContainer = document.getElementById('editor-container')!;
  const usernameDisplay = document.getElementById('username-display')!;
  const roomIdDisplay = document.getElementById('room-id')!;
  const connectedUsersContainer = document.getElementById('connected-users')!;
  const changeUsernameBtn = document.getElementById('change-username')!;
  const usernameModal = document.getElementById('username-modal')!;
  const usernameInput = document.getElementById('username-input') as HTMLInputElement;
  const randomNameBtn = document.getElementById('random-name-btn')!;
  const saveNameBtn = document.getElementById('save-name-btn')!;
  const runBtn = document.getElementById('run-btn')!;
  const outputContent = document.getElementById('output-content')!;
  const clearOutputBtn = document.getElementById('clear-output')!;
  const resizeHandle = document.getElementById('resize-handle')!;
  const outputPanel = document.getElementById('output-panel')!;
  const aboutBtn = document.getElementById('about-btn')!;
  const aboutModal = document.getElementById('about-modal')!;
  const closeAboutBtn = document.getElementById('close-about-btn')!;
  const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;

  // Display initial values
  usernameDisplay.textContent = username;
  roomIdDisplay.textContent = roomId;

  // Populate theme selector
  const darkThemes = THEMES.filter(t => t.isDark);
  const lightThemes = THEMES.filter(t => !t.isDark);

  const darkGroup = document.createElement('optgroup');
  darkGroup.label = 'Dark Themes';
  darkThemes.forEach(theme => {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = theme.name;
    darkGroup.appendChild(option);
  });

  const lightGroup = document.createElement('optgroup');
  lightGroup.label = 'Light Themes';
  lightThemes.forEach(theme => {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = theme.name;
    lightGroup.appendChild(option);
  });

  themeSelect.appendChild(darkGroup);
  themeSelect.appendChild(lightGroup);

  // Set initial theme from localStorage
  const initialTheme = getDefaultTheme();
  themeSelect.value = initialTheme.id;

  // Activity tracker (editor only)
  const activityTracker = new ActivityTracker(roomId, username);

  // Determine WebSocket URL
  // In development (Vite on 5173), connect directly to Hocuspocus on port 3000
  // In production, use /ws path (nginx proxies to Hocuspocus)
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const isDev = window.location.port === '5173';
  const wsUrl = isDev
    ? `${wsProtocol}//${window.location.hostname}:3000`
    : `${wsProtocol}//${window.location.host}/ws`;

  // Create collaborative editor
  let editor: CollabEditor = createEditor({
    container: editorContainer,
    roomId,
    username,
    wsUrl,
    initialTheme: initialTheme.extension,
    onFocus: () => {},
    onBlur: () => {},
    onKeystroke: () => activityTracker.recordKeystroke(),
  });

  // Theme change handler
  themeSelect.addEventListener('change', () => {
    const theme = getThemeById(themeSelect.value);
    if (theme) {
      editor.setTheme(theme.extension);
      saveTheme(theme.id);
    }
  });

  // Create shared console (synced via Y.js)
  const sharedConsole = new SharedConsole(editor.ydoc, outputContent, () => username);

  // Initialize mouse cursor tracking
  const mouseCursors = new MouseCursors(editor.awareness, editorContainer);

  // Setup awareness listener for connected users display
  const cleanupAwareness = setupAwarenessListener(
    editor.awareness,
    connectedUsersContainer,
    () => username
  );

  // Run button - execute code
  runBtn.addEventListener('click', () => {
    const code = editor.view.state.doc.toString();
    sharedConsole.execute(code);
  });

  // Keyboard shortcut: Ctrl/Cmd + Enter to run
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const code = editor.view.state.doc.toString();
      sharedConsole.execute(code);
    }
  });

  // Clear output
  clearOutputBtn.addEventListener('click', () => {
    sharedConsole.clear();
  });

  // Resizable panel
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = outputPanel.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const diff = startX - e.clientX;
    const newWidth = Math.max(200, Math.min(800, startWidth + diff));
    outputPanel.style.width = `${newWidth}px`;
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });

  // About modal
  aboutBtn.addEventListener('click', () => {
    aboutModal.classList.remove('hidden');
  });

  closeAboutBtn.addEventListener('click', () => {
    aboutModal.classList.add('hidden');
  });

  aboutModal.addEventListener('click', (e) => {
    if (e.target === aboutModal) {
      aboutModal.classList.add('hidden');
    }
  });

  // Username modal functions
  function showUsernameModal() {
    usernameInput.value = username;
    usernameModal.classList.remove('hidden');
    usernameInput.focus();
    usernameInput.select();
  }

  function hideUsernameModal() {
    usernameModal.classList.add('hidden');
  }

  function applyUsername(newUsername: string) {
    if (newUsername && newUsername.trim()) {
      username = newUsername.trim();
      saveUsername(username);
      usernameDisplay.textContent = username;
      editor.updateUsername(username);
      activityTracker.setUsername(username);

      // Register with server
      fetch('/api/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, clientId }),
      }).catch(console.error);
    }
    hideUsernameModal();
  }

  // Username modal event handlers
  changeUsernameBtn.addEventListener('click', showUsernameModal);

  randomNameBtn.addEventListener('click', () => {
    usernameInput.value = generateRandomUsername();
  });

  saveNameBtn.addEventListener('click', () => {
    applyUsername(usernameInput.value);
  });

  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      applyUsername(usernameInput.value);
    } else if (e.key === 'Escape') {
      hideUsernameModal();
    }
  });

  // Close modal on backdrop click
  usernameModal.addEventListener('click', (e) => {
    if (e.target === usernameModal) {
      hideUsernameModal();
    }
  });

  // Register user with server
  fetch('/api/user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, clientId }),
  }).catch(console.error);

  // --- Host claim/login flow -----------------------------------------
  // After main UI is up, decide whether to:
  // - silently treat user as host (token already stored)
  // - prompt to claim (no host set yet)
  // - show the host login button (host set, not currently authed)
  setupHostFlow(roomId);

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    mouseCursors.destroy();
    cleanupAwareness();
    activityTracker.destroy();
    sharedConsole.destroy();
    editor.destroy();
  });
}

// Drive the host claim and login modals. Kept separate from init() so the
// existing layout reads cleanly. The modals live in index.html; this just
// wires their event handlers and decides which (if any) to show on load.
async function setupHostFlow(roomId: string): Promise<void> {
  const hostBtn = document.getElementById('host-btn') as HTMLButtonElement;
  const claimModal = document.getElementById('host-claim-modal')!;
  const claimPwd = document.getElementById('host-claim-password') as HTMLInputElement;
  const claimConfirm = document.getElementById('host-claim-confirm') as HTMLInputElement;
  const claimError = document.getElementById('host-claim-error')!;
  const claimSubmit = document.getElementById('host-claim-submit')!;
  const claimSkip = document.getElementById('host-claim-skip')!;
  const loginModal = document.getElementById('host-login-modal')!;
  const loginPwd = document.getElementById('host-login-password') as HTMLInputElement;
  const loginError = document.getElementById('host-login-error')!;
  const loginMessage = document.getElementById('host-login-message')!;
  const loginSubmit = document.getElementById('host-login-submit')!;
  const loginCancel = document.getElementById('host-login-cancel')!;

  const showError = (el: HTMLElement, msg: string) => {
    el.textContent = msg;
    el.classList.remove('hidden');
  };
  const clearError = (el: HTMLElement) => {
    el.textContent = '';
    el.classList.add('hidden');
  };

  const openClaimModal = () => {
    claimPwd.value = '';
    claimConfirm.value = '';
    clearError(claimError);
    claimModal.classList.remove('hidden');
    claimPwd.focus();
  };
  const closeClaimModal = () => claimModal.classList.add('hidden');

  const openLoginModal = (message?: string) => {
    loginPwd.value = '';
    clearError(loginError);
    loginMessage.textContent =
      message ?? 'Enter the host password for this room.';
    loginModal.classList.remove('hidden');
    loginPwd.focus();
  };
  const closeLoginModal = () => loginModal.classList.add('hidden');

  // Two button states:
  //   "🔒 Host"  (default class)  → click to open login modal
  //   "👑 Host"  (.is-host)       → click to log out (clear stored token)
  // hidden class wins over both: we hide entirely when the room has no
  // host yet (the claim modal is the affordance there).
  const setButtonState = (state: 'hidden' | 'login' | 'authed') => {
    hostBtn.classList.remove('hidden', 'is-host');
    if (state === 'hidden') {
      hostBtn.classList.add('hidden');
      return;
    }
    if (state === 'authed') {
      hostBtn.classList.add('is-host');
      hostBtn.textContent = '👑 Host';
      hostBtn.title = 'You are this room\'s host. Click to log out.';
    } else {
      hostBtn.textContent = '🔒 Host';
      hostBtn.title = 'Host login';
    }
  };

  const onHostAuthenticated = (token: string) => {
    storeHostToken(roomId, token);
    setButtonState('authed');
  };

  const handleHostButtonClick = () => {
    if (getStoredHostToken(roomId)) {
      // Authed state: clicking logs out. Remove the token; the button drops
      // back to "🔒 Host" so they can re-authenticate later if they want.
      clearHostToken(roomId);
      setButtonState('login');
      return;
    }
    openLoginModal();
  };

  // Submit the claim. On 409 race, swap to login mode.
  const handleClaim = async () => {
    clearError(claimError);
    const pwd = claimPwd.value;
    const confirm = claimConfirm.value;
    if (pwd.length < 8) {
      showError(claimError, 'Password must be at least 8 characters.');
      return;
    }
    if (pwd !== confirm) {
      showError(claimError, 'Passwords do not match.');
      return;
    }

    const result = await claimHost(roomId, pwd);
    if (result.ok) {
      onHostAuthenticated(result.token);
      closeClaimModal();
      return;
    }
    if (result.reason === 'conflict') {
      closeClaimModal();
      setButtonState('login');
      openLoginModal(
        'Someone else just claimed this room. You can log in if you know the password.'
      );
      return;
    }
    if (result.reason === 'invalid') {
      showError(claimError, 'Password rejected by server (8–72 characters).');
      return;
    }
    if (result.reason === 'unavailable') {
      showError(claimError, 'Host feature is currently unavailable.');
      return;
    }
    showError(claimError, 'Could not reach the server. Try again.');
  };

  const handleLogin = async () => {
    clearError(loginError);
    const pwd = loginPwd.value;
    if (pwd.length === 0) {
      showError(loginError, 'Enter your password.');
      return;
    }

    const result = await loginHost(roomId, pwd);
    if (result.ok) {
      onHostAuthenticated(result.token);
      closeLoginModal();
      return;
    }
    if (result.reason === 'unauthorized') {
      showError(loginError, 'Invalid password.');
      return;
    }
    if (result.reason === 'unavailable') {
      showError(loginError, 'Host feature is currently unavailable.');
      return;
    }
    showError(loginError, 'Could not reach the server. Try again.');
  };

  // Wire events
  claimSubmit.addEventListener('click', handleClaim);
  claimSkip.addEventListener('click', closeClaimModal);
  claimConfirm.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleClaim();
    else if (e.key === 'Escape') closeClaimModal();
  });
  claimPwd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') claimConfirm.focus();
    else if (e.key === 'Escape') closeClaimModal();
  });
  claimModal.addEventListener('click', (e) => {
    if (e.target === claimModal) closeClaimModal();
  });

  loginSubmit.addEventListener('click', handleLogin);
  loginCancel.addEventListener('click', closeLoginModal);
  loginPwd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
    else if (e.key === 'Escape') closeLoginModal();
  });
  loginModal.addEventListener('click', (e) => {
    if (e.target === loginModal) closeLoginModal();
  });

  hostBtn.addEventListener('click', handleHostButtonClick);

  // Decide initial state. The button is shown whenever the room has a host
  // (in either authed or login state); hidden when no host is set yet (the
  // claim modal is the affordance there) or when the DB is down.
  const status = await fetchHostStatus(roomId);
  if (!status.available) {
    setButtonState('hidden');
    return;
  }
  if (!status.claimed) {
    setButtonState('hidden');
    openClaimModal();
    return;
  }
  setButtonState(getStoredHostToken(roomId) ? 'authed' : 'login');
}

// Start the app
init().catch(console.error);
