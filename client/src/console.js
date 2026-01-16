import * as acorn from 'acorn';
export class SharedConsole {
    ydoc;
    yarray;
    container;
    getUsername;
    constructor(ydoc, container, getUsername) {
        this.ydoc = ydoc;
        this.container = container;
        this.getUsername = getUsername;
        // Get or create the shared array for console logs
        this.yarray = ydoc.getArray('console-logs');
        // Render existing logs
        this.render();
        // Listen for changes from other users
        this.yarray.observe(() => {
            this.render();
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
        // Create a sandboxed console that captures output
        const capturedLogs = [];
        const sandboxConsole = {
            log: (...args) => {
                capturedLogs.push({
                    type: 'log',
                    content: args.map(this.stringify).join(' '),
                    username,
                    timestamp: Date.now(),
                });
            },
            error: (...args) => {
                capturedLogs.push({
                    type: 'error',
                    content: args.map(this.stringify).join(' '),
                    username,
                    timestamp: Date.now(),
                });
            },
            warn: (...args) => {
                capturedLogs.push({
                    type: 'warn',
                    content: args.map(this.stringify).join(' '),
                    username,
                    timestamp: Date.now(),
                });
            },
            info: (...args) => {
                capturedLogs.push({
                    type: 'info',
                    content: args.map(this.stringify).join(' '),
                    username,
                    timestamp: Date.now(),
                });
            },
        };
        try {
            // Create function with sandboxed console
            const fn = new Function('console', code);
            const result = fn(sandboxConsole);
            // Add captured logs to shared array
            capturedLogs.forEach((log) => this.addLog(log));
            // Show return value if not undefined
            if (result !== undefined) {
                this.addLog({
                    type: 'result',
                    content: `← ${this.stringify(result)}`,
                    username,
                    timestamp: Date.now(),
                });
            }
        }
        catch (error) {
            // Add any logs that happened before the error
            capturedLogs.forEach((log) => this.addLog(log));
            // Safely extract error message
            let errorMessage = '';
            try {
                if (error instanceof Error) {
                    errorMessage = `${error.name}: ${error.message}`;
                    // Try to extract line number from stack trace
                    const lineMatch = error.stack?.match(/<anonymous>:(\d+):/);
                    if (lineMatch) {
                        const offset = error instanceof SyntaxError ? 1 : 2;
                        const line = parseInt(lineMatch[1], 10) - offset;
                        if (line > 0) {
                            errorMessage += ` (line ${line})`;
                        }
                    }
                }
                else {
                    errorMessage = String(error);
                }
            }
            catch {
                // If parsing fails, just show basic error
                errorMessage = String(error);
            }
            // Add the error
            this.addLog({
                type: 'error',
                content: errorMessage,
                username,
                timestamp: Date.now(),
            });
        }
    }
    stringify(value) {
        if (value === undefined)
            return 'undefined';
        if (value === null)
            return 'null';
        if (typeof value === 'function')
            return value.toString();
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value, null, 2);
            }
            catch {
                return String(value);
            }
        }
        return String(value);
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
}
