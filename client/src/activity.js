export class ActivityTracker {
    keystrokeCount = 0;
    roomId;
    username;
    flushInterval = null;
    constructor(roomId, username) {
        this.roomId = roomId;
        this.username = username;
        this.startAutoFlush();
        this.setupVisibilityHandler();
    }
    setUsername(username) {
        this.username = username;
    }
    recordKeystroke() {
        this.keystrokeCount++;
    }
    startAutoFlush() {
        // Flush every 30 seconds
        this.flushInterval = window.setInterval(() => {
            if (this.keystrokeCount > 0) {
                this.flush();
            }
        }, 30000);
    }
    setupVisibilityHandler() {
        // Flush when user leaves the page
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && this.keystrokeCount > 0) {
                this.flush();
            }
        });
        // Flush on page unload
        window.addEventListener('beforeunload', () => {
            if (this.keystrokeCount > 0) {
                this.flushSync();
            }
        });
    }
    async flush() {
        if (this.keystrokeCount === 0)
            return;
        const data = {
            roomId: this.roomId,
            username: this.username,
            keystrokeCount: this.keystrokeCount,
            inEditor: true,
        };
        this.keystrokeCount = 0;
        try {
            await fetch('/api/activity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
        }
        catch (error) {
            console.error('Failed to log activity:', error);
        }
    }
    flushSync() {
        if (this.keystrokeCount === 0)
            return;
        const data = {
            roomId: this.roomId,
            username: this.username,
            keystrokeCount: this.keystrokeCount,
            inEditor: true,
        };
        // Use sendBeacon for reliable delivery on page unload
        navigator.sendBeacon('/api/activity', JSON.stringify(data));
    }
    destroy() {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
        }
        this.flush();
    }
}
