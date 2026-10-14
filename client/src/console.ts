import * as Y from 'yjs';
import * as acorn from 'acorn';
import { Sandbox, SandboxMessage } from './sandbox';

export type LogType = 'log' | 'error' | 'warn' | 'info' | 'result' | 'system';

interface SyntaxErrorInfo {
  line: number;
  column: number;
  message: string;
}

// Bounds on the shared log. Every entry lives in the room's Y.Doc, so it is
// synced to every peer and persisted with the document; an unbounded
// `for (…) console.log(i)` would freeze every collaborator's tab and bloat
// the stored room forever.
const MAX_ENTRIES = 1000;          // kept in the shared array (oldest trimmed)
const MAX_LINES_PER_RUN = 1000;    // further output from one run is dropped
const MAX_CONTENT_LENGTH = 10_000; // per entry, in characters
// Sandbox output arrives as one postMessage per line; collect it for this
// long and write it in a single Y.js transaction.
const FLUSH_DELAY_MS = 50;

export interface LogEntry {
  type: LogType;
  content: string;
  username: string;
  timestamp: number;
}

export class SharedConsole {
  private ydoc: Y.Doc;
  private yarray: Y.Array<LogEntry>;
  private container: HTMLElement;
  private getUsername: () => string;
  private sandbox: Sandbox;
  private pending: LogEntry[] = [];
  private flushTimer: number | null = null;
  private renderFrame: number | null = null;
  private linesThisRun = 0;

  constructor(ydoc: Y.Doc, container: HTMLElement, getUsername: () => string) {
    this.ydoc = ydoc;
    this.container = container;
    this.getUsername = getUsername;

    // Get or create the shared array for console logs
    this.yarray = ydoc.getArray<LogEntry>('console-logs');

    this.sandbox = new Sandbox(
      (msg) => this.handleSandboxMessage(msg),
      () => {}
    );

    // Render existing logs
    this.render();

    // Listen for changes from any user (including our own flushes). Renders
    // are coalesced to one per animation frame.
    this.yarray.observe(() => {
      this.scheduleRender();
    });
  }

  private handleSandboxMessage(msg: SandboxMessage): void {
    if (this.linesThisRun > MAX_LINES_PER_RUN) return;
    this.linesThisRun++;

    const username = this.getUsername();
    if (this.linesThisRun > MAX_LINES_PER_RUN) {
      this.addLog({
        type: 'system',
        content: `… output truncated after ${MAX_LINES_PER_RUN} lines`,
        username,
        timestamp: Date.now(),
      });
      return;
    }

    let content = msg.kind === 'result' ? `← ${msg.content}` : msg.content;
    if (content.length > MAX_CONTENT_LENGTH) {
      content = `${content.slice(0, MAX_CONTENT_LENGTH)}… (truncated)`;
    }
    this.addLog({
      type: msg.kind,
      content,
      username,
      timestamp: Date.now(),
    });
  }

  private validateSyntax(code: string): SyntaxErrorInfo | null {
    try {
      // allowReturnOutsideFunction matches `new Function` semantics in the
      // sandbox runner: the user's code runs as a function body, so top-level
      // `return foo` is valid execution-wise. Without this flag Acorn would
      // reject it and the runner never gets a chance.
      acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowReturnOutsideFunction: true,
      });
      return null;
    } catch (e: unknown) {
      const err = e as { loc?: { line: number; column: number }; message?: string };
      if (err.loc) {
        return {
          line: err.loc.line,
          column: err.loc.column,
          message: (err.message || 'Syntax error').replace(/\s*\(\d+:\d+\)$/, ''),
        };
      } else if (e instanceof Error) {
        return {
          line: 1,
          column: 0,
          message: e.message,
        };
      }
      return null;
    }
  }

  execute(code: string): void {
    const username = this.getUsername();

    // Validate syntax first
    const syntaxError = this.validateSyntax(code);

    if (syntaxError) {
      this.addLog({
        type: 'error',
        content: `SyntaxError: ${syntaxError.message} (line ${syntaxError.line})`,
        username,
        timestamp: Date.now(),
      });
      return;
    }

    // Add execution marker
    this.addLog({
      type: 'system',
      content: `▶ Running code...`,
      username,
      timestamp: Date.now(),
    });

    // Hand off to the sandboxed iframe runner. Logs and errors stream back via
    // postMessage and are batched into the Y.js array.
    this.linesThisRun = 0;
    this.sandbox.execute(code);
  }

  private addLog(entry: LogEntry): void {
    this.pending.push(entry);
    if (this.flushTimer === null) {
      this.flushTimer = window.setTimeout(() => this.flush(), FLUSH_DELAY_MS);
    }
  }

  // Write buffered entries in one transaction (one sync message, one observe
  // event) and trim the oldest so the shared log stays bounded.
  private flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pending.length === 0) return;
    const entries = this.pending;
    this.pending = [];
    this.ydoc.transact(() => {
      this.yarray.push(entries);
      const overflow = this.yarray.length - MAX_ENTRIES;
      if (overflow > 0) this.yarray.delete(0, overflow);
    });
  }

  private scheduleRender(): void {
    if (this.renderFrame !== null) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.render();
    });
  }

  private render(): void {
    this.container.innerHTML = '';

    // Peers trim on write, but a misbehaving one might not; never draw more
    // than the cap.
    const logs = this.yarray.toArray().slice(-MAX_ENTRIES);
    logs.forEach((entry) => {
      const line = document.createElement('div');
      line.className = `output-line ${entry.type}`;

      // Add username badge for non-system messages
      if (entry.type !== 'system') {
        const badge = document.createElement('span');
        badge.className = 'output-username';
        badge.textContent = entry.username;
        line.appendChild(badge);
      }

      const content = document.createElement('span');
      content.textContent = entry.content;
      line.appendChild(content);

      this.container.appendChild(line);
    });

    this.container.scrollTop = this.container.scrollHeight;
  }

  clear(): void {
    // Drop anything still buffered too, so it doesn't reappear after the
    // clear.
    this.pending = [];
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Clear the shared array (all users will see this)
    this.ydoc.transact(() => {
      this.yarray.delete(0, this.yarray.length);
    });
  }

  destroy(): void {
    this.flush();
    if (this.renderFrame !== null) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
    this.sandbox.destroy();
  }
}
