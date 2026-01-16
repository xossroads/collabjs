import { shouldUseDarkText } from './username';
export function getConnectedUsers(awareness) {
    const users = new Map();
    awareness.getStates().forEach((state, clientId) => {
        if (state.user && clientId !== awareness.clientID) {
            users.set(clientId, state.user);
        }
    });
    return users;
}
export function renderConnectedUsers(awareness, container) {
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
export function setupAwarenessListener(awareness, container, getCurrentUsername) {
    if (!awareness) {
        return () => { };
    }
    const update = () => {
        renderConnectedUsers(awareness, container);
    };
    awareness.on('change', update);
    update();
    return () => awareness.off('change', update);
}
