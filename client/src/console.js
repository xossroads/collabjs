import * as acorn from 'acorn';
import { Sandbox } from './sandbox';
export class SharedConsole {
    ydoc;
    yarray;
    container;
    getUsername;
    sandbox;
    constructor(ydoc, container, getUsername) {
        this.ydoc = ydoc;
        this.container = container;
        this.getUsername = getUsername;
        // Get or create the shared array for console logs
        this.yarray = ydoc.getArray('console-logs');
        this.sandbox = new Sandbox((msg) => this.handleSandboxMessage(msg), () => { });
        // Render existing logs
        this.render();
        // Listen for changes from other users
        this.yarray.observe(() => {
            this.render();
        });
    }
    handleSandboxMessage(msg) {
        const username = this.getUsername();
        const content = msg.kind === 'result' ? `← ${msg.content}` : msg.content;
        this.addLog({
            type: msg.kind,
            content,
            username,
            timestamp: Date.now(),
        });
    }
    validateSyntax(code) {
        try {
            acorn.parse(code, {
                ecmaVersion: 'latest',
                sourceType: 'script',
            });
            return null;
        }
        catch (e) {
            const err = e;
            if (err.loc) {
                return {
                    line: err.loc.line,
                    column: err.loc.column,
                    message: (err.message || 'Syntax error').replace(/\s*\(\d+:\d+\)$/, ''),
                };
            }
            else if (e instanceof Error) {
                return {
                    line: 1,
                    column: 0,
                    message: e.message,
                };
            }
            return null;
        }
    }
    execute(code) {
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
    addLog(entry) {
        this.yarray.push([entry]);
    }
    render() {
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
    clear() {
        // Clear the shared array (all users will see this)
        this.ydoc.transact(() => {
            this.yarray.delete(0, this.yarray.length);
        });
    }
    destroy() {
        this.sandbox.destroy();
    }
}
