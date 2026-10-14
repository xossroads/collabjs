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

export function generateRandomUsername(): string {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  const number = Math.floor(Math.random() * 100);
  return `${adjective}${animal}${number}`;
}

export function getStoredUsername(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function saveUsername(username: string): void {
  localStorage.setItem(STORAGE_KEY, username);
}

export function getClientId(): string {
  let clientId = localStorage.getItem(CLIENT_ID_KEY);
  if (!clientId) {
    clientId = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, clientId);
  }
  return clientId;
}

export function getOrCreateUsername(): string {
  let username = getStoredUsername();
  if (!username) {
    username = generateRandomUsername();
    saveUsername(username);
  }
  return username;
}

// Generate a consistent color from username
export function getUserColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 50%)`;
}

// Translucent variant for remote selection highlights. y-codemirror.next
// defaults to `color + '33'`, which only works for 6-digit hex and yields
// invalid CSS for our hsl() colors — so selections never showed.
export function getUserColorLight(username: string): string {
  return getUserColor(username).replace(/^hsl\((.*)\)$/, 'hsla($1, 0.2)');
}
