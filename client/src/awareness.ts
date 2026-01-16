import type { Awareness } from 'y-protocols/awareness';
import { shouldUseDarkText } from './username';

export interface UserState {
  name: string;
  color: string;
}

export function getConnectedUsers(awareness: Awareness): Map<number, UserState> {
  const users = new Map<number, UserState>();

  awareness.getStates().forEach((state, clientId) => {
    if (state.user && clientId !== awareness.clientID) {
      users.set(clientId, state.user as UserState);
    }
  });

  return users;
}

export function renderConnectedUsers(
  awareness: Awareness,
  container: HTMLElement
): void {
  const users = getConnectedUsers(awareness);

  container.innerHTML = '';

  users.forEach((user) => {
    const badge = document.createElement('span');
    badge.className = 'user-badge';
    badge.style.backgroundColor = user.color;
    badge.style.color = shouldUseDarkText(user.color) ? '#1e1e1e' : '#ffffff';
    badge.textContent = user.name;
    container.appendChild(badge);
  });
}

export function setupAwarenessListener(
  awareness: Awareness | null,
  container: HTMLElement,
  getCurrentUsername: () => string
): () => void {
  if (!awareness) {
    return () => {};
  }

  const update = () => {
    renderConnectedUsers(awareness, container);
  };

  awareness.on('change', update);
  update();

  return () => awareness.off('change', update);
}
