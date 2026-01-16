export class CodeExecutor {
    outputContainer;
    logs = [];
    constructor(outputContainer) {
        this.outputContainer = outputContainer;
    }
    execute(code) {
        // Create a sandboxed console that captures output
        const capturedLogs = [];
        const sandboxConsole = {
            log: (...args) => {
                capturedLogs.push({
                    type: 'log',
                    content: args.map(this.stringify).join(' '),
                    timestamp: new Date(),
                });
            },
            error: (...args) => {
                capturedLogs.push({
                    type: 'error',
                    content: args.map(this.stringify).join(' '),
                    timestamp: new Date(),
                });
            },
            warn: (...args) => {
                capturedLogs.push({
                    type: 'warn',
                    content: args.map(this.stringify).join(' '),
                    timestamp: new Date(),
                });
            },
            info: (...args) => {
                capturedLogs.push({
                    type: 'info',
                    content: args.map(this.stringify).join(' '),
                    timestamp: new Date(),
                });
            },
        };
        try {
            // Create function with sandboxed console
            const fn = new Function('console', code);
            const result = fn(sandboxConsole);
            // Add captured logs
            capturedLogs.forEach((log) => this.addLog(log));
            // Show return value if not undefined
            if (result !== undefined) {
                this.addLog({
                    type: 'result',
                    content: `← ${this.stringify(result)}`,
                    timestamp: new Date(),
                });
            }
        }
        catch (error) {
            // Add any logs that happened before the error
            capturedLogs.forEach((log) => this.addLog(log));
            // Add the error
            this.addLog({
                type: 'error',
                content: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
                timestamp: new Date(),
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
        this.logs.push(entry);
        this.renderLog(entry);
    }
    renderLog(entry) {
        const line = document.createElement('div');
        line.className = `output-line ${entry.type}`;
        line.textContent = entry.content;
        this.outputContainer.appendChild(line);
        this.outputContainer.scrollTop = this.outputContainer.scrollHeight;
    }
    clear() {
        this.logs = [];
        this.outputContainer.innerHTML = '';
    }
    getLogs() {
        return [...this.logs];
    }
}
