'use strict';
/** Capture a PNG of the running Vertal Launcher renderer (port 9333).
 *  Usage: node scripts/cdp-screenshot.js <outfile.png> */
const http = require('http');
const fs = require('fs');

const out = process.argv[2] || 'smoke-shot.png';
http.get('http://127.0.0.1:9333/json', (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => {
    const target = JSON.parse(d).find((t) => t.type === 'page');
    if (!target) { console.error('no page target'); process.exit(1); }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => { console.error('timeout waiting for screenshot'); process.exit(1); }, 15000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id === 1) {
        clearTimeout(timer);
        if (!msg.result || !msg.result.data) { console.error('no screenshot in reply'); process.exit(1); }
        fs.writeFileSync(out, Buffer.from(msg.result.data, 'base64'));
        console.log('saved ' + out + ' (' + fs.statSync(out).size + ' bytes)');
        ws.close();
        process.exit(0);
      }
    };
    ws.onerror = (e) => { clearTimeout(timer); console.error('ws error', e.message); process.exit(1); };
  });
}).on('error', (e) => { console.error('http error:', e.message); process.exit(1); });