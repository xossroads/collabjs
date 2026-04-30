import { shouldUseDarkText } from './username';
export class MouseCursors {
    awareness;
    container;
    cursors = new Map();
    throttleTimer = null;
    constructor(awareness, container) {
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
    handleMouseMove = (e) => {
        // Throttle updates to ~30fps
        if (this.throttleTimer)
            return;
        this.throttleTimer = window.setTimeout(() => {
            this.throttleTimer = null;
        }, 33);
        const rect = this.container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        // Update local awareness with mouse position
        const currentState = this.awareness.getLocalState();
        if (currentState) {
            this.awareness.setLocalStateField('mouse', { x, y });
        }
    };
    handleMouseLeave = () => {
        // Clear mouse position when leaving the container
        this.awareness.setLocalStateField('mouse', null);
    };
    handleAwarenessChange = () => {
        this.renderCursors();
    };
    renderCursors() {
        const states = this.awareness.getStates();
        const localClientId = this.awareness.clientID;
        const activeClientIds = new Set();
        states.forEach((state, clientId) => {
            if (clientId === localClientId)
                return;
            if (!state.user || !state.mouse)
                return;
            activeClientIds.add(clientId);
            const user = state.user;
            const mouse = state.mouse;
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
            const label = cursor.querySelector('.cursor-label');
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
    createCursorElement(user) {
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
        path.setAttribute('d', 'M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.48 0 .72-.58.38-.92L6.35 2.85a.5.5 0 0 0-.85.36Z');
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
