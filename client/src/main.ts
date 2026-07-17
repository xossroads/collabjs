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
  getConnectedUsers,
  type UserState,
} from './awareness';
import type { Awareness } from 'y-protocols/awareness';
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
  nukeRoom,
  logoutAllHostSessions,
  parseHostStatelessMessage,
  getStoredHostToken,
  storeHostToken,
  clearHostToken,
  fetchRoomStats,
  kickUser,
  type RoomUserStats,
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

// Inject the AdSense loader only when a publisher id is configured
// (VITE_ADSENSE_CLIENT in client/.env, gitignored — baked in at build time).
// Keeps the id out of the repo and means forks/dev machines without the var
// simply serve no ads. The CSP in index.html already allowlists the ad hosts.
function loadAdsense(): void {
  const client = import.meta.env.VITE_ADSENSE_CLIENT;
  if (!client || !/^ca-pub-\d+$/.test(client)) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
  script.crossOrigin = 'anonymous';
  document.head.appendChild(script);
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
  const activityTracker = new ActivityTracker(roomId, username, clientId);

  // Determine WebSocket URL
  // In development (Vite on 5173), connect directly to Hocuspocus on port 3000
  // In production, use /ws path (nginx proxies to Hocuspocus)
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const isDev = window.location.port === '5173';
  // clientId rides along as a query param so the server can tag this
  // connection (Connection.context) — that's what the host kick targets.
  const wsUrl = isDev
    ? `${wsProtocol}//${window.location.hostname}:3000?clientId=${clientId}`
    : `${wsProtocol}//${window.location.host}/ws?clientId=${clientId}`;

  // Create collaborative editor
  // Deferred ref for the host-state-changed handler. setupHostFlow assigns
  // it once it has built its modal/button state machine. Any messages that
  // arrive before then (vanishingly unlikely — page just loaded) are ignored.
  const onHostStateChangedRef: { current: (() => void) | null } = { current: null };

  let editor: CollabEditor = createEditor({
    container: editorContainer,
    roomId,
    username,
    clientId,
    wsUrl,
    initialTheme: initialTheme.extension,
    onFocus: () => {},
    onBlur: () => {},
    onKeystroke: () => activityTracker.recordKeystroke(),
    onStateless: (payload) => {
      const msg = parseHostStatelessMessage(payload);
      if (!msg) return;
      if (msg.type === 'room-nuked') {
        // Server tells us this room is being deleted and where to go next.
        // Navigating (rather than reloading) drops our local Y.Doc and lands
        // every connected tab in the same fresh room, so the group stays
        // together. Reloading would have left CRDT auto-sync to push our
        // pre-nuke content back into the empty server doc.
        clearHostToken(roomId);
        window.location.replace(`/room/${msg.nextRoomId}`);
      } else if (msg.type === 'kicked') {
        // The host removed us. Tear down before the server closes the
        // socket so the provider doesn't auto-reconnect into the ban, then
        // show the (non-dismissable) overlay.
        activityTracker.destroy();
        editor.destroy();
        document.getElementById('kicked-overlay')!.classList.remove('hidden');
      } else if (msg.type === 'host-state-changed') {
        // Claim/login/logout-all happened somewhere. Re-fetch and reconcile
        // UI live so other tabs don't keep showing stale state until reload.
        onHostStateChangedRef.current?.();
      }
    },
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

  // Kicked overlay: the only way out is a fresh room.
  document.getElementById('kicked-new-room')!.addEventListener('click', () => {
    window.location.replace(`/room/${crypto.randomUUID()}`);
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
  setupHostFlow(roomId, onHostStateChangedRef, editor.awareness);

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
async function setupHostFlow(
  roomId: string,
  onHostStateChangedRef: { current: (() => void) | null },
  awareness: Awareness
): Promise<void> {
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
  const menuModal = document.getElementById('host-menu-modal')!;
  const menuLogout = document.getElementById('host-menu-logout')!;
  const menuLogoutAll = document.getElementById('host-menu-logout-all')!;
  const menuNuke = document.getElementById('host-menu-nuke')!;
  const menuClose = document.getElementById('host-menu-close')!;
  const nukeModal = document.getElementById('host-nuke-modal')!;
  const nukeError = document.getElementById('host-nuke-error')!;
  const nukeCancel = document.getElementById('host-nuke-cancel')!;
  const nukeConfirm = document.getElementById('host-nuke-confirm') as HTMLButtonElement;
  const logoutAllModal = document.getElementById('host-logout-all-modal')!;
  const logoutAllError = document.getElementById('host-logout-all-error')!;
  const logoutAllCancel = document.getElementById('host-logout-all-cancel')!;
  const logoutAllConfirm = document.getElementById('host-logout-all-confirm') as HTMLButtonElement;
  const dashboardUsers = document.getElementById('host-dashboard-users')!;
  const dashboardDetail = document.getElementById('host-dashboard-detail')!;

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
  //   "🔒 Host"  (default class)  → click opens login modal
  //   "🎛️ Host"  (.is-host)       → click opens host menu (log out, nuke, …)
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
      hostBtn.textContent = '🎛️ Host';
      hostBtn.title = 'Open host menu';
    } else {
      hostBtn.textContent = '🔒 Host';
      hostBtn.title = 'Host login';
    }
  };

  const onHostAuthenticated = (token: string) => {
    storeHostToken(roomId, token);
    setButtonState('authed');
  };

  // Dashboard state. selectedClientId is the awareness clientID of the user
  // whose details are showing in the right pane. Cleared when the user
  // disconnects, when the modal closes, or when the host loses auth.
  let selectedClientId: number | null = null;
  let dashboardUnsubscribe: (() => void) | null = null;

  // Activity stats for the detail pane, keyed by username. null while a
  // fetch is in flight (renders as "Loading…"); statsError set means the
  // last fetch failed. statsRequestSeq guards against a stale response
  // overwriting a newer one (open → click can have two fetches racing).
  let roomStats: Map<string, RoomUserStats> | null = null;
  let roomStatsTotal = 0;
  let statsError: string | null = null;
  let statsRequestSeq = 0;

  const loadDashboardStats = async () => {
    const token = getStoredHostToken(roomId);
    if (!token) return;
    const seq = ++statsRequestSeq;
    const result = await fetchRoomStats(roomId, token);
    if (seq !== statsRequestSeq) return;

    if (result.ok) {
      // Keyed by clientId; legacy rows (null clientId) key by username.
      roomStats = new Map(result.stats.map((s) => [s.clientId ?? s.username, s]));
      roomStatsTotal = result.stats.reduce((sum, s) => sum + s.keystrokes, 0);
      statsError = null;
      renderDashboardDetail();
      return;
    }
    if (result.reason === 'unauthorized' || result.reason === 'forbidden') {
      // Same treatment as the other host actions: token is dead, drop it
      // and fall back to the login button. Closing the menu tears down the
      // dashboard, so no need to render an error into it.
      clearHostToken(roomId);
      setButtonState('login');
      closeMenuModal();
      return;
    }
    statsError =
      result.reason === 'unavailable'
        ? 'Host feature is currently unavailable.'
        : 'Could not load activity stats.';
    renderDashboardDetail();
  };

  // A stat row is a label/value pair; textContent keeps usernames and
  // anything else inert.
  const appendStatRow = (dl: HTMLDListElement, label: string, value: string) => {
    const row = document.createElement('div');
    row.className = 'stat-row';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    row.appendChild(dt);
    row.appendChild(dd);
    dl.appendChild(row);
  };

  const renderDetailStats = (user: UserState) => {
    if (statsError) {
      const err = document.createElement('p');
      err.className = 'dashboard-detail-error';
      err.textContent = statsError;
      dashboardDetail.appendChild(err);
      return;
    }
    if (roomStats === null) {
      const loading = document.createElement('p');
      loading.className = 'dashboard-detail-empty';
      loading.textContent = 'Loading activity…';
      dashboardDetail.appendChild(loading);
      return;
    }

    // Exact match by the clientId the user broadcasts via awareness; falls
    // back to name matching for peers on old clients / legacy rows.
    const stats = roomStats.get(user.clientId ?? user.name);
    if (!stats || stats.keystrokes === 0) {
      const none = document.createElement('p');
      none.className = 'dashboard-detail-empty';
      none.textContent = 'No recorded activity yet.';
      dashboardDetail.appendChild(none);
      return;
    }

    const dl = document.createElement('dl');
    dl.className = 'dashboard-stats';
    appendStatRow(dl, 'Keystrokes', stats.keystrokes.toLocaleString());
    const share =
      roomStatsTotal > 0
        ? Math.round((stats.keystrokes / roomStatsTotal) * 100)
        : 0;
    appendStatRow(dl, 'Share of room activity', `${share}%`);
    appendStatRow(dl, 'First active', new Date(stats.firstActive).toLocaleString());
    appendStatRow(dl, 'Last active', new Date(stats.lastActive).toLocaleString());
    dashboardDetail.appendChild(dl);

    const bar = document.createElement('div');
    bar.className = 'stat-share-bar';
    const fill = document.createElement('div');
    fill.className = 'stat-share-fill';
    fill.style.width = `${share}%`;
    bar.appendChild(fill);
    dashboardDetail.appendChild(bar);

    // Share is computed against every user with activity in the room's
    // logs — including people who have since left — so it reflects the
    // room's whole history, not just who's connected right now.
    const note = document.createElement('p');
    note.className = 'dashboard-detail-note';
    note.textContent = 'Share is measured against all activity ever recorded in this room.';
    dashboardDetail.appendChild(note);
  };

  // Kick lives at the bottom of the detail pane. Only targetable users get
  // it — a peer without a broadcast clientId (old client) can't be matched
  // to a connection server-side. Two-click confirm instead of a third modal.
  const appendKickButton = (user: UserState) => {
    const targetId = user.clientId;
    if (!targetId) return;
    const btn = document.createElement('button');
    btn.className = 'danger dashboard-kick';
    btn.textContent = 'Kick from room…';
    let armed = false;
    let disarmTimer = 0;
    btn.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        btn.textContent = 'Confirm kick';
        disarmTimer = window.setTimeout(() => {
          armed = false;
          btn.textContent = 'Kick from room…';
        }, 3000);
        return;
      }
      window.clearTimeout(disarmTimer);
      btn.disabled = true;
      btn.textContent = 'Kicking…';
      const token = getStoredHostToken(roomId);
      if (!token) {
        setButtonState('login');
        closeMenuModal();
        return;
      }
      const result = await kickUser(roomId, token, targetId);
      if (result.ok) {
        // Their disconnect fires the awareness listener, which re-renders
        // the sidebar and clears the selection — nothing to do here.
        return;
      }
      if (result.reason === 'unauthorized' || result.reason === 'forbidden') {
        clearHostToken(roomId);
        setButtonState('login');
        closeMenuModal();
        return;
      }
      btn.disabled = false;
      armed = false;
      btn.textContent = 'Kick failed — try again';
    });
    dashboardDetail.appendChild(btn);
  };

  const renderDashboardDetail = () => {
    dashboardDetail.innerHTML = '';
    if (selectedClientId === null) {
      const empty = document.createElement('p');
      empty.className = 'dashboard-detail-empty';
      empty.textContent = 'Select a user to see details.';
      dashboardDetail.appendChild(empty);
      return;
    }
    const user = getConnectedUsers(awareness).get(selectedClientId);
    if (!user) {
      // Selected user disconnected; fall back to empty state.
      selectedClientId = null;
      renderDashboardDetail();
      return;
    }
    const heading = document.createElement('h3');
    const dot = document.createElement('span');
    dot.className = 'user-dot';
    dot.style.backgroundColor = user.color;
    const name = document.createElement('span');
    name.textContent = user.name;
    heading.appendChild(dot);
    heading.appendChild(name);
    dashboardDetail.appendChild(heading);

    renderDetailStats(user);
    appendKickButton(user);
  };

  const renderDashboardUsers = () => {
    const users = getConnectedUsers(awareness);
    dashboardUsers.innerHTML = '';

    // If the selected user dropped, clear before rendering so the detail
    // pane and selected-row state stay consistent.
    if (selectedClientId !== null && !users.has(selectedClientId)) {
      selectedClientId = null;
    }

    if (users.size === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty-state';
      empty.textContent = 'No other users connected.';
      dashboardUsers.appendChild(empty);
      renderDashboardDetail();
      return;
    }

    users.forEach((user, clientId) => {
      const li = document.createElement('li');
      if (clientId === selectedClientId) li.classList.add('selected');

      const dot = document.createElement('span');
      dot.className = 'user-dot';
      dot.style.backgroundColor = user.color;

      const nameEl = document.createElement('span');
      nameEl.className = 'user-name';
      nameEl.textContent = user.name;

      li.appendChild(dot);
      li.appendChild(nameEl);
      li.addEventListener('click', () => {
        selectedClientId = clientId;
        renderDashboardUsers();
        renderDashboardDetail();
        // Render cached numbers immediately, then refresh in the background
        // — activity flushes every 30s, so stats can grow while the modal
        // is open. The seq guard in loadDashboardStats handles races.
        void loadDashboardStats();
      });
      dashboardUsers.appendChild(li);
    });

    renderDashboardDetail();
  };

  const openMenuModal = () => {
    selectedClientId = null;
    // Reset to the loading state so a reopened modal doesn't flash stats
    // from the previous visit, then fetch fresh numbers.
    roomStats = null;
    statsError = null;
    void loadDashboardStats();
    renderDashboardUsers();
    if (!dashboardUnsubscribe) {
      // Only re-render the list while the modal is open. Listener is torn
      // down on close to avoid touching detached DOM nodes.
      const update = () => renderDashboardUsers();
      awareness.on('change', update);
      dashboardUnsubscribe = () => awareness.off('change', update);
    }
    menuModal.classList.remove('hidden');
  };
  const closeMenuModal = () => {
    menuModal.classList.add('hidden');
    if (dashboardUnsubscribe) {
      dashboardUnsubscribe();
      dashboardUnsubscribe = null;
    }
  };
  const openNukeModal = () => {
    clearError(nukeError);
    nukeConfirm.disabled = false;
    nukeConfirm.textContent = 'Destroy it!';
    nukeModal.classList.remove('hidden');
  };
  const closeNukeModal = () => nukeModal.classList.add('hidden');

  const openLogoutAllModal = () => {
    clearError(logoutAllError);
    logoutAllConfirm.disabled = false;
    logoutAllConfirm.textContent = 'Yes, log everyone out';
    logoutAllModal.classList.remove('hidden');
  };
  const closeLogoutAllModal = () => logoutAllModal.classList.add('hidden');

  const handleHostButtonClick = () => {
    if (getStoredHostToken(roomId)) {
      openMenuModal();
    } else {
      openLoginModal();
    }
  };

  const handleLogoutFromMenu = () => {
    clearHostToken(roomId);
    setButtonState('login');
    closeMenuModal();
  };

  const handleLogoutAllConfirm = async () => {
    const token = getStoredHostToken(roomId);
    if (!token) {
      showError(logoutAllError, 'You are no longer logged in. Reload and try again.');
      return;
    }
    clearError(logoutAllError);
    logoutAllConfirm.disabled = true;
    logoutAllConfirm.textContent = 'Logging out…';

    const result = await logoutAllHostSessions(roomId, token);
    if (result.ok) {
      // Our own session was wiped along with the others. Drop the local
      // token and put the button back to login state without reloading —
      // user gets immediate feedback that they're logged out.
      clearHostToken(roomId);
      setButtonState('login');
      closeLogoutAllModal();
      return;
    }
    logoutAllConfirm.disabled = false;
    logoutAllConfirm.textContent = 'Yes, log everyone out';
    if (result.reason === 'unauthorized' || result.reason === 'forbidden') {
      showError(logoutAllError, 'Your host session is no longer valid. Log in again.');
      clearHostToken(roomId);
      setButtonState('login');
      return;
    }
    if (result.reason === 'unavailable') {
      showError(logoutAllError, 'Host feature is currently unavailable.');
      return;
    }
    showError(logoutAllError, 'Could not revoke sessions. Try again.');
  };

  const handleNukeConfirm = async () => {
    const token = getStoredHostToken(roomId);
    if (!token) {
      showError(nukeError, 'You are no longer logged in. Reload and try again.');
      return;
    }
    clearError(nukeError);
    nukeConfirm.disabled = true;
    nukeConfirm.textContent = 'Destroying…';

    const result = await nukeRoom(roomId, token);
    if (result.ok) {
      // Room is gone; our token is dead with it. Navigate to the new room
      // the server picked — every other tab gets the same destination via
      // the room-nuked broadcast, so the group lands together.
      clearHostToken(roomId);
      window.location.replace(`/room/${result.nextRoomId}`);
      return;
    }
    nukeConfirm.disabled = false;
    nukeConfirm.textContent = 'Destroy it!';
    if (result.reason === 'unauthorized' || result.reason === 'forbidden') {
      showError(nukeError, 'Your host session is no longer valid. Log in again.');
      clearHostToken(roomId);
      setButtonState('login');
      return;
    }
    if (result.reason === 'unavailable') {
      showError(nukeError, 'Host feature is currently unavailable.');
      return;
    }
    showError(nukeError, 'Could not delete the room. Try again.');
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

  menuLogout.addEventListener('click', handleLogoutFromMenu);
  menuLogoutAll.addEventListener('click', () => {
    closeMenuModal();
    openLogoutAllModal();
  });
  menuNuke.addEventListener('click', () => {
    closeMenuModal();
    openNukeModal();
  });
  menuClose.addEventListener('click', closeMenuModal);
  menuModal.addEventListener('click', (e) => {
    if (e.target === menuModal) closeMenuModal();
  });

  logoutAllCancel.addEventListener('click', closeLogoutAllModal);
  logoutAllConfirm.addEventListener('click', handleLogoutAllConfirm);
  logoutAllModal.addEventListener('click', (e) => {
    if (e.target === logoutAllModal && !logoutAllConfirm.disabled) closeLogoutAllModal();
  });

  nukeCancel.addEventListener('click', closeNukeModal);
  nukeConfirm.addEventListener('click', handleNukeConfirm);
  nukeModal.addEventListener('click', (e) => {
    if (e.target === nukeModal && !nukeConfirm.disabled) closeNukeModal();
  });

  hostBtn.addEventListener('click', handleHostButtonClick);

  const isOpen = (modal: HTMLElement) => !modal.classList.contains('hidden');

  // Reconcile our local state with the server's view of the world. Called
  // on page load and whenever the server pushes a host-state-changed
  // stateless message (claim/login/logout-all elsewhere).
  //
  // - Drops localStorage tokens the server says are no longer valid.
  // - Updates the host button state to match.
  // - Closes any open host-only modals (menu/nuke/logout-all) when we lose
  //   auth, since they'd reference dead actions.
  // - Closes the claim modal when the room gets claimed by someone else,
  //   and swaps it for the login modal so the user can still authenticate
  //   if they know the new password.
  // - Closes the login modal if the room becomes unclaimed mid-flight.
  const refreshHostState = async (isInitialLoad = false): Promise<void> => {
    const storedToken = getStoredHostToken(roomId);
    const status = await fetchHostStatus(roomId, storedToken);

    // If the stored token changed while the fetch was in flight, our result
    // is stale — bail. The race that motivates this: on the tab that just
    // claimed/logged in, the server's host-state-changed broadcast can
    // arrive before the claim/login HTTP response. We start a refresh with
    // a null token, then the response stores the real token and sets
    // 'authed'; without this guard, the late-arriving authed:false result
    // would overwrite the correct state and leave the button stuck at 🔒.
    if (getStoredHostToken(roomId) !== storedToken) return;

    if (!status.available) {
      setButtonState('hidden');
      return;
    }

    if (!status.claimed) {
      setButtonState('hidden');
      // Auto-open the claim modal only on the very first load — we don't
      // want to silently spring it on someone if the room just got nuked
      // out from under them by another tab.
      if (isInitialLoad) {
        openClaimModal();
      }
      if (isOpen(loginModal)) closeLoginModal();
      if (isOpen(menuModal)) closeMenuModal();
      if (isOpen(nukeModal) && !nukeConfirm.disabled) closeNukeModal();
      if (isOpen(logoutAllModal) && !logoutAllConfirm.disabled) closeLogoutAllModal();
      return;
    }

    // Room is claimed.
    if (storedToken && !status.authed) {
      clearHostToken(roomId);
    }
    setButtonState(status.authed ? 'authed' : 'login');

    // If the claim modal was open and someone else just claimed, close it
    // and switch to login so they can authenticate if they know the password.
    if (isOpen(claimModal)) {
      closeClaimModal();
      if (!isInitialLoad) {
        openLoginModal(
          'Someone else just claimed this room. You can log in if you know the password.'
        );
      }
    }

    if (!status.authed) {
      // Lost auth — close menus/confirms that depend on it. Don't close
      // mid-network-call dialogs; let them surface the 401 themselves.
      if (isOpen(menuModal)) closeMenuModal();
      if (isOpen(nukeModal) && !nukeConfirm.disabled) closeNukeModal();
      if (isOpen(logoutAllModal) && !logoutAllConfirm.disabled) closeLogoutAllModal();
    }
  };

  // Wire the deferred ref so the editor's onStateless can drive us.
  onHostStateChangedRef.current = () => {
    refreshHostState().catch(console.error);
  };

  await refreshHostState(true);
}

// Start the app
loadAdsense();
init().catch(console.error);
