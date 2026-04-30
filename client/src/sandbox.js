// Cross-origin-style isolation via a sandboxed iframe with opaque origin.
//
// `sandbox="allow-scripts"` without `allow-same-origin` makes the iframe a
// distinct opaque origin per the HTML spec — even though it's hosted on the
// same domain. That blocks user code from reading the parent's cookies,
// localStorage, sessionStorage, DOM, or making credentialed requests to our
// own APIs as the logged-in user. Top navigation, popups, and form submission
// are also blocked because we don't grant those tokens.
//
// We load the runner via `iframe.src` (not `srcdoc`) so the parent's CSP
// doesn't apply to it. The runner needs `new Function` to execute user code
// (which CSP would block under `unsafe-eval`), and keeping that scoped to the
// iframe means the parent can run a strict CSP without `unsafe-eval`.
//
// IMPORTANT: never add `allow-same-origin` to this sandbox. Doing so removes
// the opaque-origin protection and re-exposes everything above.
const RUNNER_URL = '/sandbox/runner.html';
export class Sandbox {
    iframe = null;
    messageHandler = null;
    pendingCode = null;
    onLog;
    onDone;
    constructor(onLog, onDone) {
        this.onLog = onLog;
        this.onDone = onDone;
    }
    execute(code) {
        this.destroy();
        const iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-scripts');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.display = 'none';
        iframe.src = RUNNER_URL;
        this.pendingCode = code;
        this.iframe = iframe;
        const handleMessage = (e) => {
            if (!this.iframe || e.source !== this.iframe.contentWindow)
                return;
            const data = e.data;
            if (!data || typeof data !== 'object')
                return;
            switch (data.kind) {
                case 'ready':
                    if (this.pendingCode !== null && this.iframe.contentWindow) {
                        this.iframe.contentWindow.postMessage({ kind: 'execute', code: this.pendingCode }, '*');
                        this.pendingCode = null;
                    }
                    break;
                case 'log':
                case 'error':
                case 'warn':
                case 'info':
                case 'result':
                    this.onLog({ kind: data.kind, content: String(data.content ?? '') });
                    break;
                case 'done':
                    this.onDone();
                    break;
            }
        };
        this.messageHandler = handleMessage;
        window.addEventListener('message', handleMessage);
        document.body.appendChild(iframe);
    }
    destroy() {
        if (this.messageHandler) {
            window.removeEventListener('message', this.messageHandler);
            this.messageHandler = null;
        }
        if (this.iframe) {
            this.iframe.remove();
            this.iframe = null;
        }
        this.pendingCode = null;
    }
}
