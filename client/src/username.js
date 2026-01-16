const adjectives = [
    'Swift', 'Clever', 'Bright', 'Quick', 'Bold',
    'Calm', 'Eager', 'Fierce', 'Gentle', 'Happy',
    'Jolly', 'Kind', 'Lively', 'Merry', 'Noble',
    'Proud', 'Quiet', 'Rapid', 'Smart', 'Wise',
    'Brave', 'Cool', 'Daring', 'Epic', 'Fresh'
];
const animals = [
    'Falcon', 'Tiger', 'Eagle', 'Wolf', 'Bear',
    'Hawk', 'Lion', 'Shark', 'Panther', 'Fox',
    'Raven', 'Cobra', 'Jaguar', 'Viper', 'Orca',
    'Lynx', 'Puma', 'Owl', 'Dolphin', 'Phoenix',
    'Dragon', 'Griffin', 'Hydra', 'Kraken', 'Sphinx'
];
const STORAGE_KEY = 'collabjs_username';
const CLIENT_ID_KEY = 'collabjs_client_id';
export function generateRandomUsername() {
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const animal = animals[Math.floor(Math.random() * animals.length)];
    const number = Math.floor(Math.random() * 100);
    return `${adjective}${animal}${number}`;
}
export function getStoredUsername() {
    return localStorage.getItem(STORAGE_KEY);
}
export function saveUsername(username) {
    localStorage.setItem(STORAGE_KEY, username);
}
export function getClientId() {
    let clientId = localStorage.getItem(CLIENT_ID_KEY);
    if (!clientId) {
        clientId = crypto.randomUUID();
        localStorage.setItem(CLIENT_ID_KEY, clientId);
    }
    return clientId;
}
export function getOrCreateUsername() {
    let username = getStoredUsername();
    if (!username) {
        username = generateRandomUsername();
        saveUsername(username);
    }
    return username;
}
// Generate a consistent color from username
export function getUserColor(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 50%)`;
}
// Determine if text should be dark on a given background color
// Returns true if background is light (needs dark text)
export function shouldUseDarkText(color) {
    // Parse HSL color
    const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!match)
        return false;
    const h = parseInt(match[1], 10);
    const s = parseInt(match[2], 10) / 100;
    const l = parseInt(match[3], 10) / 100;
    // Convert HSL to RGB to calculate relative luminance
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) {
        r = c;
        g = x;
        b = 0;
    }
    else if (h < 120) {
        r = x;
        g = c;
        b = 0;
    }
    else if (h < 180) {
        r = 0;
        g = c;
        b = x;
    }
    else if (h < 240) {
        r = 0;
        g = x;
        b = c;
    }
    else if (h < 300) {
        r = x;
        g = 0;
        b = c;
    }
    else {
        r = c;
        g = 0;
        b = x;
    }
    r = r + m;
    g = g + m;
    b = b + m;
    // Calculate relative luminance
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    // Use dark text if luminance is high (light background)
    return luminance > 0.5;
}
