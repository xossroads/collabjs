import { Awareness } from 'y-protocols/awareness';
import { shouldUseDarkText } from './username';
import { sanitizeRemoteUser } from './sanitize';

interface MousePosition {
  x: number;
  y: number;
}

interface UserState {
  name: string;
  color: string;
  mouse?: MousePosition;
}

function sanitizeMouse(value: unknown): MousePosition | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { x?: unknown; y?: unknown };
  if (typeof raw.x !== 'number' || typeof raw.y !== 'number') return null;
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
  // Clamp to a generous viewport bound so a hostile client can't push the
  // cursor element to absurd coordinates.
  const x = Math.max(-10_000, Math.min(50_000, raw.x));
  const y = Math.max(-10_000, Math.min(50_000, raw.y));
  return { x, y };
}

export class MouseCursors {
  private awareness: Awareness;
  private container: HTMLElement;
  private cursors: Map<number, HTMLElement> = new Map();
  private throttleTimer: number | null = null;

  constructor(awareness: Awareness, container: HTMLElement) {
    this.awareness = awareness;
    this.container = container;

    // Make container position relative for absolute cursor positioning
    container.style.position = 'relative';

    // Track local mouse movement
    container.addEventListener('mousemove', this.handleMouseMove);
    container.addEventListener('mouseleave', this.handleMouseLeave);

    // Listen for remote awareness updates
    awareness.on('change', this.handleAwarenessChange);

    // Initial render
    this.renderCursors();
  }

  private handleMouseMove = (e: MouseEvent) => {
    // Throttle updates to ~30fps
    if (this.throttleTimer) return;

    this.throttleTimer = window.setTimeout(() => {
      this.throttleTimer = null;
    }, 33);

    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Update local awareness with mouse position
    const currentState = this.awareness.getLocalState() as UserState | null;
    if (currentState) {
      this.awareness.setLocalStateField('mouse', { x, y });
    }
  };

  private handleMouseLeave = () => {
    // Clear mouse position when leaving the container
    this.awareness.setLocalStateField('mouse', null);
  };

  private handleAwarenessChange = () => {
    this.renderCursors();
  };

  private renderCursors() {
    const states = this.awareness.getStates();
    const localClientId = this.awareness.clientID;
    const activeClientIds = new Set<number>();

    states.forEach((state, clientId) => {
      if (clientId === localClientId) return;
      if (!state.user || !state.mouse) return;

      const user = sanitizeRemoteUser(state.user);
      const mouse = sanitizeMouse(state.mouse);
      if (!mouse) return;

      activeClientIds.add(clientId);

      let cursor = this.cursors.get(clientId);

      if (!cursor) {
        cursor = this.createCursorElement(user);
        this.cursors.set(clientId, cursor);
        this.container.appendChild(cursor);
      }

      // Update position
      cursor.style.left = `${mouse.x}px`;
      cursor.style.top = `${mouse.y}px`;

      // Update color if changed
      const svg = cursor.querySelector('svg');
      if (svg) {
        svg.style.fill = user.color;
      }

      const label = cursor.querySelector('.cursor-label') as HTMLElement;
      if (label) {
        label.textContent = user.name;
        label.style.backgroundColor = user.color;
      }
    });

    // Remove cursors for disconnected users
    this.cursors.forEach((cursor, clientId) => {
      if (!activeClientIds.has(clientId)) {
        cursor.remove();
        this.cursors.delete(clientId);
      }
    });
  }

  private createCursorElement(user: UserState): HTMLElement {
    // Build with DOM APIs only. `user.name` and `user.color` come from remote
    // awareness state, which any room participant controls — string templating
    // into innerHTML here would be a same-origin XSS sink.
    const textColor = shouldUseDarkText(user.color) ? '#1e1e1e' : '#ffffff';
    const cursor = document.createElement('div');
    cursor.className = 'remote-cursor';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.style.fill = user.color;

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute(
      'd',
      'M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.48 0 .72-.58.38-.92L6.35 2.85a.5.5 0 0 0-.85.36Z'
    );
    svg.appendChild(path);

    const label = document.createElement('span');
    label.className = 'cursor-label';
    label.style.backgroundColor = user.color;
    label.style.color = textColor;
    label.textContent = user.name;

    cursor.appendChild(svg);
    cursor.appendChild(label);
    return cursor;
  }

  destroy() {
    this.container.removeEventListener('mousemove', this.handleMouseMove);
    this.container.removeEventListener('mouseleave', this.handleMouseLeave);
    this.awareness.off('change', this.handleAwarenessChange);

    this.cursors.forEach((cursor) => cursor.remove());
    this.cursors.clear();
  }
}
