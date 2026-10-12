const http = require('http');
const logger = require('./logger');
const { dismissDesktopNotifications } = require('../notifications/desktop');

let server = null;
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

function startMockServer(isDryRun = true) {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    if (server) {
      return resolve(`http://localhost:${PORT}`);
    }

    server = http.createServer((req, res) => {
      // 1. Twilio Incoming WhatsApp Webhook Endpoint
      if (req.url === '/api/whatsapp/webhook' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });

        req.on('end', () => {
          const params = new URLSearchParams(body);
          const messageText = params.get('Body') ? params.get('Body').trim() : '';
          const fromNumber = params.get('From') || '';

          logger.info(`[Webhook] Incoming message received: "${messageText}" from ${fromNumber}`);

          const lowerText = messageText.toLowerCase();
          if (messageText === '12345' || lowerText.includes('stop')) {
            logger.success(`🔑 Stop command ("${messageText}") received via webhook! Terminating alert loop...`);
            global.stopRequested = true;
            dismissDesktopNotifications();
          }

          res.writeHead(200, { 'Content-Type': 'text/xml' });
          res.end('<Response></Response>');
        });
        return;
      }

      // 2. Quick Browser Stop Endpoint: http://localhost:3000/stop
      if (req.url === '/stop' || req.url === '/api/stop') {
        logger.success('🛑 Stop command received via web browser (http://localhost:3000/stop)! Halting alerts immediately...');
        global.stopRequested = true;
        dismissDesktopNotifications();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><meta charset="utf-8"><title>Alerts Silenced</title></head>
            <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;padding:50px;background:#0f172a;color:#f8fafc;">
              <h1 style="color:#22c55e;font-size:32px;">✅ ALERTS SILENCED!</h1>
              <p style="font-size:18px;color:#94a3b8;">Continuous notifications have been stopped.</p>
              <p style="font-size:16px;color:#cbd5e1;">Your Flipkart product page window remains open so you can place your order.</p>
            </body>
          </html>
        `);
        return;
      }

      // 3. Dry-Run Mock Flipkart Product Page (simulates Out-of-Stock -> In-Stock after 5s using exact Flipkart DOM)
      if (isDryRun) {
        const elapsed = Date.now() - startTime;
        const isSize7InStock = elapsed >= 5000;

        const colorOutOfStockOverlay = isSize7InStock
          ? ''
          : `<div class="_1psv1zeb9 _1psv1ze0 _7dzyg2r" style="display: flex; flex: 1 1 0%; flex-direction: column; align-items: center; min-height: 0px; min-width: 0px; position: absolute; z-index: 0; box-sizing: border-box; border-width: 0px; inset: 0px; justify-content: center; background-color: rgba(0, 0, 0, 0.56);"><div class="v1zwn21n v1zwn26 _1psv1zeb9 _1psv1ze0" font="default-fk-font-l"> </div></div><div class="_1psv1zeb9 _1psv1ze0 _1psv1ze2i _1psv1ze4r _7dzyg22" style="display: flex; flex: 1 1 0%; flex-direction: column; align-items: center; min-height: 0px; min-width: 0px; position: absolute; z-index: 0; box-sizing: border-box; border-width: 0px; left: 0px; right: 0px; opacity: 0.8; background-color: rgb(245, 245, 245);"><div class="v1zwn221 v1zwn2d _1psv1zeb9 _1psv1ze0" font="default-fk-font-l" style="color: rgb(229, 72, 5); text-align: center;">Out of stock</div></div>`;

        const size7BoxHtml = isSize7InStock
          ? `<div class="_1psv1zeb9 _1psv1ze0 _7dzyg20 _1o6mltlgv _1o6mltlbu _1o6mltl1s _1o6mltl6t _1psv1ze30 _1psv1ze59 _1o6mltlk4 _1psv1ze90 _1psv1ze6r" style="display: flex; flex-direction: column; align-items: center; min-width: 52px; position: relative; border-width: 1.6px; border-style: solid; background-color: rgb(255, 255, 255); border-radius: 12px; border-color: rgb(31, 31, 31); justify-content: center; height: 46px;"><div class="v1zwn21n v1zwn26 _1psv1zeb9 _1psv1ze0" font="default-fk-font-l" style="color: rgb(51, 51, 51); font-weight: bold;">7</div><div class="_1psv1zeb9 _1psv1ze0 _1o6mltlk1 _1o6mltlf0 _1o6mltl4y _1o6mltl9z _7dzyg24y" style="position: absolute; inset: 0px; background-color: rgba(0, 0, 0, 0);"></div></div>`
          : `<div class="_1psv1zeb9 _1psv1ze0 _7dzyg20 _1o6mltlgv _1o6mltlbu _1o6mltl1s _1o6mltl6t _1psv1ze30 _1psv1ze59 _1o6mltlk6 _1psv1ze90 _1psv1ze6r" style="display: flex; flex-direction: column; align-items: center; min-width: 52px; position: relative; border-width: 1.2px; border-style: dashed; background-color: rgb(255, 255, 255); border-radius: 12px; border-color: rgb(214, 214, 214); justify-content: center; height: 46px;"><div class="v1zwn21o v1zwn26 _1psv1zeb9 _1psv1ze0" font="default-fk-font-l" style="color: rgb(112, 112, 112);">7</div><div class="_1psv1zeb9 _1psv1ze0 _1o6mltlk1 _1o6mltlf0 _1o6mltl4y _1o6mltl9z _7dzyg24z" style="display: flex; position: absolute; inset: 0px; justify-content: center; background-color: rgba(0, 0, 0, 0.06);"><div class="_1psv1zeb9 _1psv1ze0 _7dzyg21s" style="height: 1px; background-color: rgb(214, 214, 214); width: 100%; align-self: center;"></div></div></div>`;

        const ctaButtonHtml = isSize7InStock
          ? `<button style="background:#ff9f00;color:#fff;border:none;border-radius:8px;padding:14px 28px;font-size:16px;font-weight:bold;cursor:pointer;margin-right:12px;">Add to cart</button><button style="background:#fb641b;color:#fff;border:none;border-radius:8px;padding:14px 28px;font-size:16px;font-weight:bold;cursor:pointer;">Buy at ₹1,852</button>`
          : `<button style="background:#1162f2;color:#fff;border:none;border-radius:8px;padding:14px 36px;font-size:16px;font-weight:bold;cursor:pointer;width:100%;">Notify Me</button>`;

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en-IN">
          <head>
            <meta charset="UTF-8">
            <title>WOODLAND Slip On Lightweight Comfortable Easy Wear Casuals For Men - Flipkart.com</title>
            <style>
              body { font-family: Roboto, Arial, sans-serif; background: #f1f3f6; margin: 0; padding: 30px; }
              .container { max-width: 720px; margin: 0 auto; background: #fff; padding: 28px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
              .size-row { display: flex; gap: 10px; margin: 16px 0 24px 0; }
              a { text-decoration: none; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1 style="font-size:20px;color:#212121;margin-bottom:8px;">WOODLAND Slip On Lightweight Comfortable Easy Wear Casuals For Men</h1>
              <div style="font-size:24px;font-weight:bold;color:#212121;margin-bottom:16px;">₹1,852 <span style="font-size:16px;color:#878787;text-decoration:line-through;">₹4,495</span> <span style="color:#388e3c;font-size:16px;">59% off</span></div>
              
              <div style="margin-bottom:10px;font-weight:600;color:#212121;">Selected Color: DNAVY 4</div>
              <div class="css-g5y9jx" style="display:flex;gap:12px;margin-bottom:20px;">
                <a class="_1psv1zeb9 _1o6mltlk4 _1o6mltln" href="/woodland-slip-lightweight-comfortable-easy-wear-casuals-men/p/itm28c3d46f85a6c?pid=SHOFXHQCVGM4NRCE&marketplace=FLIPKART" style="display: flex; flex-direction: column; min-width: 78px; position: relative; border-width: 1.6px; border-style: solid; border-radius: 14px; overflow: hidden; border-color: rgb(31, 31, 31); max-width: 78px; min-height: 95px; justify-content: center; align-items: center;">
                  <picture><img alt="DNAVY 4" src="https://rukminim2.flixcart.com/image/80/110/xif0q/shoe/v/x/8/-watermarked-original-imahn9g5afgr7thh.jpeg?q=90" style="width:70px;height:85px;object-fit:contain;"></picture>
                  ${colorOutOfStockOverlay}
                </a>
              </div>

              <div style="font-weight:600;color:#212121;">Select Size</div>
              <div class="size-row">
                <a href="/woodland-slip-lightweight-comfortable-easy-wear-casuals-men/p/itm28c3d46f85a6c?pid=SHOFXHQCPZACJF8E&swatchAttr=size">
                  <div class="_1o6mltlk6" style="display:flex;min-width:52px;height:46px;border:1.2px dashed rgb(214,214,214);border-radius:12px;align-items:center;justify-content:center;position:relative;">
                    <div class="v1zwn21o v1zwn26" font="default-fk-font-l" style="color:rgb(112,112,112);">5</div>
                    <div class="_7dzyg24z" style="position:absolute;inset:0;background:rgba(0,0,0,0.06);"></div>
                  </div>
                </a>
                <a href="/woodland-slip-lightweight-comfortable-easy-wear-casuals-men/p/itm28c3d46f85a6c?pid=SHOFXHQCXYVFJZTW&swatchAttr=size">
                  <div class="_1o6mltlk6" style="display:flex;min-width:52px;height:46px;border:1.2px dashed rgb(214,214,214);border-radius:12px;align-items:center;justify-content:center;position:relative;">
                    <div class="v1zwn21o v1zwn26" font="default-fk-font-l" style="color:rgb(112,112,112);">6</div>
                    <div class="_7dzyg24z" style="position:absolute;inset:0;background:rgba(0,0,0,0.06);"></div>
                  </div>
                </a>
                <a href="/woodland-slip-lightweight-comfortable-easy-wear-casuals-men/p/itm28c3d46f85a6c?pid=SHOFXHQCVGM4NRCE&swatchAttr=size">
                  ${size7BoxHtml}
                </a>
                <a href="/woodland-slip-lightweight-comfortable-easy-wear-casuals-men/p/itm28c3d46f85a6c?pid=SHOFXHQCFM5YYBAG&swatchAttr=size">
                  <div class="_1o6mltlk4" style="display:flex;min-width:52px;height:46px;border:1.2px solid rgb(214,214,214);border-radius:12px;align-items:center;justify-content:center;position:relative;">
                    <div class="v1zwn21n v1zwn26" font="default-fk-font-l" style="color:rgb(51,51,51);">8</div>
                  </div>
                </a>
              </div>

              <div style="margin-top:20px;">
                ${ctaButtonHtml}
              </div>
            </div>
          </body>
          </html>
        `);
        return;
      }

      // 4. Live Production Status Dashboard (when accessed in browser on Render / cloud or localhost:3000)
      if ((req.url === '/' || req.url === '/dashboard') && !isDryRun) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderProductionDashboard());
        return;
      }

      // Default fallback
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    server.listen(PORT, () => {
      logger.success(`Local Web Server started on http://localhost:${PORT}`);
      resolve(`http://localhost:${PORT}`);
    });

    server.on('error', (err) => {
      logger.error('Failed to start Server', err);
      reject(err);
    });
  });
}

function stopMockServer() {
  if (server) {
    server.close();
    server = null;
    logger.info('Local Web Server stopped.');
  }
}

function renderProductionDashboard() {
  const productName = process.env.PRODUCT_NAME || 'WOODLAND Slip On Casuals For Men';
  const productColor = process.env.PRODUCT_COLOR || 'DNAVY 4';
  const productSize = process.env.PRODUCT_SIZE || '7';
  const productUrl =
    process.env.PRODUCT_URL ||
    'https://www.flipkart.com/woodland-slip-lightweight-comfortable-easy-wear-casuals-men/p/itm28c3d46f85a6c?pid=SHOFXHQCVGM4NRCE&marketplace=FLIPKART';
  const alertInterval = process.env.ALERT_INTERVAL_SECONDS || '2';
  const heartbeatMinutes = process.env.HEARTBEAT_INTERVAL_MINUTES || '1440';
  const heartbeatLabel = String(heartbeatMinutes) === '1440' ? '1/day' : `${heartbeatMinutes}m`;
  const stopStatus = global.stopRequested ? '🔴 Alerts Silenced' : '🟢 Active & Monitoring';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flipkart Stock Monitor | Live Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: rgba(23, 32, 54, 0.7);
      --border: rgba(255, 255, 255, 0.08);
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #2874f0;
      --green: #10b981;
      --red: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: radial-gradient(circle at top, #1e293b 0%, #0b0f19 50%, #05070e 100%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px;
    }
    .container { width: 100%; max-width: 860px; }
    .header { text-align: center; margin-bottom: 30px; }
    .badge-live {
      display: inline-flex; align-items: center; gap: 8px;
      background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--green); padding: 6px 14px; border-radius: 9999px;
      font-size: 13px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 14px;
    }
    .pulse-dot {
      width: 8px; height: 8px; background: var(--green); border-radius: 50%;
      box-shadow: 0 0 10px var(--green); animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { transform: scale(1.1); box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }
    h1 {
      font-size: 32px; font-weight: 800;
      background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px;
    }
    p.subtitle { color: var(--text-muted); font-size: 15px; }
    .grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px; margin-bottom: 24px;
    }
    .card {
      background: var(--card-bg); backdrop-filter: blur(12px);
      border: 1px solid var(--border); border-radius: 16px; padding: 20px;
    }
    .card-title {
      font-size: 12px; text-transform: uppercase; letter-spacing: 0.6px;
      color: var(--text-muted); margin-bottom: 8px; font-weight: 600;
    }
    .card-value { font-size: 18px; font-weight: 700; color: #fff; }
    .card-value small { font-size: 13px; font-weight: 500; color: var(--text-muted); }
    .highlight-green { color: #34d399; }
    .highlight-blue { color: #60a5fa; }
    .actions-card {
      background: var(--card-bg); backdrop-filter: blur(12px);
      border: 1px solid var(--border); border-radius: 16px; padding: 24px;
      margin-bottom: 24px; text-align: center;
    }
    .actions-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; }
    .btn-group { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
    .btn {
      display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px;
      border-radius: 10px; font-size: 14px; font-weight: 600; text-decoration: none;
      cursor: pointer; border: none; transition: all 0.2s;
    }
    .btn-danger {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white;
    }
    .btn-primary {
      background: linear-gradient(135deg, #2874f0 0%, #1d4ed8 100%); color: white;
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08); color: var(--text); border: 1px solid var(--border);
    }
    .info-footer { font-size: 13px; color: var(--text-muted); text-align: center; line-height: 1.6; }
    code { background: rgba(255, 255, 255, 0.1); padding: 2px 6px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="badge-live">
        <span class="pulse-dot"></span>
        Flipkart Stock Monitoring Active
      </div>
      <h1>Flipkart Product Availability Monitor</h1>
      <p class="subtitle">Automated 24/7 stock watcher for Size &amp; Color variants</p>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-title">👟 Target Product</div>
        <div class="card-value">${productName}</div>
      </div>
      <div class="card">
        <div class="card-title">🎨 Target Color</div>
        <div class="card-value highlight-blue">${productColor}</div>
      </div>
      <div class="card">
        <div class="card-title">📏 Target Size</div>
        <div class="card-value highlight-green">Size ${productSize} (UK/India)</div>
      </div>
      <div class="card">
        <div class="card-title">🔔 Alert Interval</div>
        <div class="card-value">Every ${alertInterval}s <small>(heartbeat: ${heartbeatLabel})</small></div>
      </div>
      <div class="card">
        <div class="card-title">📲 Push Notifications</div>
        <div class="card-value highlight-green">ntfy.sh enabled</div>
      </div>
      <div class="card">
        <div class="card-title">🛑 Alert State</div>
        <div class="card-value">${stopStatus}</div>
      </div>
    </div>

    <div class="actions-card">
      <div class="actions-title">Interactive Controls</div>
      <div class="btn-group">
        <a href="/stop" class="btn btn-danger">🛑 Silence Continuous Alerts</a>
        <a href="${productUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">🛒 Open Flipkart Product Page</a>
        <a href="https://ntfy.sh/${process.env.NTFY_TOPIC || 'flipkart-woodland-size7-alerts'}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">📲 Open ntfy Mobile Alerts</a>
      </div>
    </div>

    <div class="info-footer">
      <p>Watching Flipkart product variant <code>pid=SHOFXHQCVGM4NRCE</code> (Color: ${productColor}, Size: ${productSize}).</p>
      <p>Webhook endpoint active at <code>/api/whatsapp/webhook</code> | Control endpoint at <code>/stop</code></p>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { startMockServer, stopMockServer, renderProductionDashboard };
