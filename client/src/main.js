import { createEditor } from './editor';
import { ActivityTracker } from './activity';
import { SharedConsole } from './console';
import { MouseCursors } from './mouse-cursors';
import { getOrCreateUsername, saveUsername, generateRandomUsername, getClientId } from './username';
import { setupAwarenessListener, } from './awareness';
import { THEMES, getThemeById, getDefaultTheme, saveTheme, } from './themes';
// Get room ID from URL or generate one
function getRoomId() {
    const path = window.location.pathname;
    const match = path.match(/^\/room\/([a-zA-Z0-9-]+)$/);
    if (match) {
        return match[1];
    }
    // Generate a new room ID and redirect
    const newRoomId = crypto.randomUUID().slice(0, 8);
    window.history.replaceState(null, '', `/room/${newRoomId}`);
    return newRoomId;
}
// Initialize app
async function init() {
    const roomId = getRoomId();
    let username = getOrCreateUsername();
    const clientId = getClientId();
    // Get DOM elements
    const editorContainer = document.getElementById('editor-container');
    const usernameDisplay = document.getElementById('username-display');
    const roomIdDisplay = document.getElementById('room-id');
    const connectedUsersContainer = document.getElementById('connected-users');
    const changeUsernameBtn = document.getElementById('change-username');
    const usernameModal = document.getElementById('username-modal');
    const usernameInput = document.getElementById('username-input');
    const randomNameBtn = document.getElementById('random-name-btn');
    const saveNameBtn = document.getElementById('save-name-btn');
    const runBtn = document.getElementById('run-btn');
    const outputContent = document.getElementById('output-content');
    const clearOutputBtn = document.getElementById('clear-output');
    const resizeHandle = document.getElementById('resize-handle');
    const outputPanel = document.getElementById('output-panel');
    const aboutBtn = document.getElementById('about-btn');
    const aboutModal = document.getElementById('about-modal');
    const closeAboutBtn = document.getElementById('close-about-btn');
    const themeSelect = document.getElementById('theme-select');
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
    let editor = createEditor({
        container: editorContainer,
        roomId,
        username,
        wsUrl,
        initialTheme: initialTheme.extension,
        onFocus: () => { },
        onBlur: () => { },
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
    const cleanupAwareness = setupAwarenessListener(editor.awareness, connectedUsersContainer, () => username);
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
        if (!isResizing)
            return;
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
    function applyUsername(newUsername) {
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
        }
        else if (e.key === 'Escape') {
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
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        mouseCursors.destroy();
        cleanupAwareness();
        activityTracker.destroy();
        editor.destroy();
    });
}
// Start the app
init().catch(console.error);
