// Cross-origin-style isolation via a sandboxed iframe with opaque origin.
//
// `sandbox="allow-scripts"` without `allow-same-origin` makes the iframe a
// distinct opaque origin per the HTML spec — even though it's hosted on the
// same domain. That blocks user code from reading the parent's cookies,
// localStorage, sessionStorage, DOM, or making credentialed requests to our
// own APIs as the logged-in user. Top navigation, popups, and form submission
// are also blocked because we don't grant those tokens.
//
// IMPORTANT: never add `allow-same-origin` to this sandbox. Doing so removes
// the opaque-origin protection and re-exposes everything above.
const RUNNER_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script>
(function () {
  'use strict';

  function stringify(value) {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'function') return value.toString();
    if (typeof value === 'object') {
      try { return JSON.stringify(value, null, 2); }
      catch (_) { return String(value); }
    }
    return String(value);
  }

  function send(msg) {
    parent.postMessage(msg, '*');
  }

  var sandboxConsole = {
    log:   function () { send({ kind: 'log',   content: Array.prototype.map.call(arguments, stringify).join(' ') }); },
    error: function () { send({ kind: 'error', content: Array.prototype.map.call(arguments, stringify).join(' ') }); },
    warn:  function () { send({ kind: 'warn',  content: Array.prototype.map.call(arguments, stringify).join(' ') }); },
    info:  function () { send({ kind: 'info',  content: Array.prototype.map.call(arguments, stringify).join(' ') }); }
  };

  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || data.kind !== 'execute') return;
    var code = String(data.code || '');

    try {
      var fn = new Function('console', code);
      var result = fn(sandboxConsole);
      if (result !== undefined) {
        send({ kind: 'result', content: stringify(result) });
      }
      send({ kind: 'done' });
    } catch (err) {
      var msg;
      if (err instanceof Error) {
        msg = err.name + ': ' + err.message;
        var lineMatch = err.stack && err.stack.match(/<anonymous>:(\\d+):/);
        if (lineMatch) {
          var offset = err instanceof SyntaxError ? 1 : 2;
          var line = parseInt(lineMatch[1], 10) - offset;
          if (line > 0) msg += ' (line ' + line + ')';
        }
      } else {
        msg = String(err);
      }
      send({ kind: 'error', content: msg });
      send({ kind: 'done' });
    }
  });

  window.addEventListener('error', function (e) {
    send({ kind: 'error', content: 'UncaughtError: ' + e.message });
  });

  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason;
    var content = (reason && reason.message) ? reason.message : String(reason);
    send({ kind: 'error', content: 'UnhandledRejection: ' + content });
  });

  send({ kind: 'ready' });
})();
</script>
</body>
</html>`;
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
        iframe.srcdoc = RUNNER_HTML;
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
