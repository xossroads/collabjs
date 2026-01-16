export class ActivityTracker {
  private keystrokeCount = 0;
  private roomId: string;
  private username: string;
  private flushInterval: number | null = null;

  constructor(roomId: string, username: string) {
    this.roomId = roomId;
    this.username = username;
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
        this.flushSync();
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
    };

    this.keystrokeCount = 0;

    try {
      await fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } catch (error) {
      console.error('Failed to log activity:', error);
    }
  }

  private flushSync(): void {
    if (this.keystrokeCount === 0) return;

    const data = {
      roomId: this.roomId,
      username: this.username,
      keystrokeCount: this.keystrokeCount,
      inEditor: true,
    };

    // Use sendBeacon for reliable delivery on page unload
    navigator.sendBeacon(
      '/api/activity',
      JSON.stringify(data)
    );
  }

  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();
  }
}
