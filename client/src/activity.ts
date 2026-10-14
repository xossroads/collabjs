export class ActivityTracker {
  private keystrokeCount = 0;
  private roomId: string;
  private username: string;
  private clientId: string;
  private flushInterval: number | null = null;

  constructor(roomId: string, username: string, clientId: string) {
    this.roomId = roomId;
    this.username = username;
    this.clientId = clientId;
    this.startAutoFlush();
    this.setupVisibilityHandler();
  }

  setUsername(username: string): void {
    this.username = username;
  }

  recordKeystroke(): void {
    this.keystrokeCount++;
  }

  private startAutoFlush(): void {
    // Flush every 30 seconds
    this.flushInterval = window.setInterval(() => {
      if (this.keystrokeCount > 0) {
        this.flush();
      }
    }, 30000);
  }

  private setupVisibilityHandler(): void {
    // Flush when user leaves the page
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.keystrokeCount > 0) {
        this.flush();
      }
    });

    // Flush on page unload
    window.addEventListener('beforeunload', () => {
      if (this.keystrokeCount > 0) {
        this.flush();
      }
    });
  }

  private async flush(): Promise<void> {
    if (this.keystrokeCount === 0) return;

    const data = {
      roomId: this.roomId,
      username: this.username,
      keystrokeCount: this.keystrokeCount,
      inEditor: true,
      clientId: this.clientId,
    };

    this.keystrokeCount = 0;

    // keepalive lets the request outlive the page, so the visibilitychange /
    // beforeunload flushes actually arrive. (sendBeacon can't do this: a
    // string body goes out as text/plain, which express.json() won't parse.)
    try {
      await fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        keepalive: true,
      });
    } catch (error) {
      console.error('Failed to log activity:', error);
    }
  }

  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();
  }
}
