import * as Y from 'yjs';
import * as acorn from 'acorn';
import { Sandbox, SandboxMessage } from './sandbox';

export type LogType = 'log' | 'error' | 'warn' | 'info' | 'result' | 'system';

interface SyntaxErrorInfo {
  line: number;
  column: number;
  message: string;
}

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

    // Listen for changes from other users
    this.yarray.observe(() => {
      this.render();
    });
  }

  private handleSandboxMessage(msg: SandboxMessage): void {
    const username = this.getUsername();
    const content = msg.kind === 'result' ? `← ${msg.content}` : msg.content;
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
    // postMessage and are appended to the Y.js array as they arrive.
    this.sandbox.execute(code);
  }

  private addLog(entry: LogEntry): void {
    this.yarray.push([entry]);
  }

  private render(): void {
    this.container.innerHTML = '';

    const logs = this.yarray.toArray();
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
    // Clear the shared array (all users will see this)
    this.ydoc.transact(() => {
      this.yarray.delete(0, this.yarray.length);
    });
  }

  destroy(): void {
    this.sandbox.destroy();
  }
}
