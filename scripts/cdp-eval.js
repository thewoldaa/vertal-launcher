'use strict';
/**
 * Evaluate a JS expression inside the running Vertal Launcher renderer
 * (remote debugging port 9333) and print the JSON result.
 * Usage: node scripts/cdp-eval.js '<expression>'
 */
const http = require('http');

const expr = process.argv[2];
const port = process.argv[3] || '9333';
if (!expr) { console.error('usage: node scripts/cdp-eval.js <expression> [port]'); process.exit(1); }

http.get(`http://127.0.0.1:${port}/json`, (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => {
    const target = JSON.parse(d).find((t) => t.type === 'page');
    if (!target) { console.error('no page target'); process.exit(1); }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.onopen = () => ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true },
    }));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id === 1) {
        if (msg.result && msg.result.exceptionDetails) {
          console.error('EXCEPTION:', JSON.stringify(msg.result.exceptionDetails.exception?.description || msg.result.exceptionDetails.text));
          process.exit(1);
        }
        console.log(JSON.stringify(msg.result?.result?.value ?? msg.result, null, 1));
        ws.close();
        process.exit(0);
      }
    };
    ws.onerror = (e) => { console.error('ws error', e.message); process.exit(1); };
  });
}).on('error', (e) => { console.error('http error:', e.message); process.exit(1); });