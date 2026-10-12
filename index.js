const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const logger = require('./utils/logger');
const { getConfig, sleep } = require('./utils/helpers');
const launchBrowser = require('./browser/launch');
const openProductPage = require('./browser/openProductPage');
const { checkProductAvailability } = require('./browser/checkProduct');
const { dispatchAllNotifications } = require('./notifications/manager');
const { dismissDesktopNotifications } = require('./notifications/desktop');
const { startNtfyListener, stopNtfyListener } = require('./notifications/ntfyListener');
const { startMockServer, stopMockServer } = require('./utils/mockServer');
const { resetScreenshotCounter, captureMilestone } = require('./utils/visual');

let browserInstance = null;
let alreadyNotified = false;
let inContinuousAlertLoop = false;
global.stopRequested = false;

/**
 * Returns the current date (YYYY-MM-DD), hour (0-23), and minute (0-59) in Indian Standard Time (Asia/Kolkata).
 */
function getIstTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = {};
  for (const p of formatter.formatToParts(date)) {
    parts[p.type] = p.value;
  }
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = parseInt(parts.hour, 10) % 24;
  const minute = parseInt(parts.minute, 10);
  return { dateStr, hour, minute };
}

/**
 * Parses DAILY_STATUS_TIME (e.g. "10:30") into targetHour and targetMinute in IST.
 */
function parseDailyTargetTime(rawTime = '10:30') {
  const match = String(rawTime || '10:30')
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  const targetHour = match ? Math.min(23, Math.max(0, parseInt(match[1], 10))) : 10;
  const targetMinute = match ? Math.min(59, Math.max(0, parseInt(match[2], 10))) : 30;
  const ampm = targetHour >= 12 ? 'PM' : 'AM';
  const displayHour = targetHour % 12 === 0 ? 12 : targetHour % 12;
  const displayMin = String(targetMinute).padStart(2, '0');
  return {
    targetHour,
    targetMinute,
    label: `${displayHour}:${displayMin} ${ampm} IST`
  };
}

/**
 * Checks both local state file and remote ntfy.sh 24h message cache to see if an
 * Out-of-Stock notification was already sent today (in IST). Prevents duplicate notifications
 * across container restarts on Render/Railway.
 */
async function resolveLastDailySentDate(stateFilePath, topic) {
  let lastSentDate = null;

  // 1. Check local state file
  try {
    if (fs.existsSync(stateFilePath)) {
      const parsed = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
      if (parsed && parsed.lastSentDate) {
        lastSentDate = parsed.lastSentDate;
      }
    }
  } catch (e) {}

  // 2. Check remote ntfy topic cache (last 24h) in case container filesystem was reset on cloud restart
  if (topic) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`https://ntfy.sh/${topic}/json?poll=1&since=24h`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const text = await res.text();
        const lines = text.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (
              data.event === 'message' &&
              data.time &&
              data.message &&
              /out of stock/i.test(data.message)
            ) {
              const msgIst = getIstTimeParts(new Date(data.time * 1000));
              if (!lastSentDate || msgIst.dateStr > lastSentDate) {
                lastSentDate = msgIst.dateStr;
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  return lastSentDate;
}

function saveLastDailySentDate(stateFilePath, dateStr) {
  try {
    const dir = path.dirname(stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      stateFilePath,
      JSON.stringify({ lastSentDate: dateStr, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch (e) {}
}

function isStopCommand(raw) {
  if (!raw) return false;
  const str = String(raw).trim().toLowerCase();
  return (
    str === 'stop' ||
    str === 's' ||
    str === 'q' ||
    str === 'quit' ||
    str === 'exit' ||
    str === '12345' ||
    str.includes('stop')
  );
}

let cleanupFn = null;

function requestStop(source = 'user command') {
  if (global.stopRequested) return;
  global.stopRequested = true;
  dismissDesktopNotifications();
  logger.success(`🛑 Stop requested (${source})! Halting alerts and exiting immediately...`);
  if (typeof cleanupFn === 'function') {
    cleanupFn(0);
  } else {
    process.exit(0);
  }
}
global.requestStop = requestStop;

// Command line argument parser
const isDryRunArg = process.argv.includes('--dry-run');

async function main() {
  let config;
  try {
    config = getConfig();
  } catch (err) {
    logger.error('Failed to load configuration files', err);
    process.exit(1);
  }

  // Initialize product config with .env overrides
  config.product = config.product || {};
  if (process.env.PRODUCT_NAME) {
    config.product.name = process.env.PRODUCT_NAME.trim();
  }
  if (process.env.PRODUCT_COLOR) {
    config.product.color = process.env.PRODUCT_COLOR.trim();
  }
  if (process.env.PRODUCT_SIZE) {
    config.product.size = String(process.env.PRODUCT_SIZE).trim();
  }
  if (process.env.PRODUCT_URL) {
    config.product.url = process.env.PRODUCT_URL.trim();
  }

  config.product.name = config.product.name || 'WOODLAND Slip On Casuals For Men';
  config.product.color = config.product.color || 'DNAVY 4';
  config.product.size = String(config.product.size || '7');

  config.ntfy = config.ntfy || {};
  if (process.env.NTFY_TOPIC) {
    config.ntfy.topic = process.env.NTFY_TOPIC.trim();
  }
  config.ntfy.topic = config.ntfy.topic || 'flipkart-woodland-size7-alerts';

  const activePort = process.env.PORT || 3001;

  // Override dryRun with command line arg if present
  if (isDryRunArg) {
    config.monitoring.dryRun = true;
  }

  logger.info('Starting Flipkart Product Availability Monitor...');
  logger.info(`Mode: ${config.monitoring.dryRun ? 'DRY-RUN (Mock Flipkart Simulation)' : 'PRODUCTION (Flipkart Live Site)'}`);
  logger.info(`ntfy Topic: ${config.ntfy.topic} (Separate from BookMyShow ticket monitor)`);

  // Start the local server on port 3001 for Dashboard, /stop endpoint, and WhatsApp webhook
  try {
    const isDryRun = config.monitoring.dryRun;
    const serverUrl = await startMockServer(isDryRun);
    if (isDryRun) {
      config.product.url = `${serverUrl}/woodland-slip-lightweight-comfortable-easy-wear-casuals-men/p/itm28c3d46f85a6c?pid=SHOFXHQCVGM4NRCE&marketplace=FLIPKART`;
      logger.info(`Dry-run target URL: ${config.product.url}`);
    } else {
      logger.info(`[Dashboard] Live dashboard active at: http://localhost:${activePort}/dashboard`);
      logger.info(`[Stop Control] Quick stop URL: http://localhost:${activePort}/stop`);
    }
  } catch (err) {
    logger.warn(`Local web server on port ${activePort} could not start (${err.message}). Continuing product monitor...`);
  }

  // Start background ntfy topic listener to allow typing "stop" inside the mobile app
  if (config.notifications.ntfy && config.ntfy && config.ntfy.topic) {
    startNtfyListener(config.ntfy.topic, (receivedCmd) => {
      requestStop(`ntfy app command: "${receivedCmd}"`);
    });
  }

  // Validate product URL
  if (!config.product.url || config.product.url.trim() === '') {
    logger.error('No product URL configured. Set PRODUCT_URL in .env or config.json and restart.');
    stopMockServer();
    process.exit(1);
  }

  logger.info(`Target Product: ${config.product.name}`);
  logger.info(`Target Color:   ${config.product.color}`);
  logger.info(`Target Size:    ${config.product.size}`);
  logger.info(`Target URL:     ${config.product.url}`);

  // Immediate cleanup & exit handler
  let isCleaningUp = false;
  const cleanup = async () => {
    if (isCleaningUp) return;
    isCleaningUp = true;
    dismissDesktopNotifications();

    logger.info('Cleaning up resources and shutting down immediately...');
    stopMockServer();
    stopNtfyListener();
    if (browserInstance) {
      try {
        await browserInstance.close();
        logger.success('✓ Browser closed.');
      } catch (err) {}
    }
    logger.success('✓ Cleanup complete. Monitor stopped.');
    process.exit(0);
  };
  cleanupFn = cleanup;

  process.on('SIGINT', () => {
    requestStop('Ctrl+C shortcut');
  });
  process.on('SIGTERM', () => cleanup());

  const monitorIntervalMs = config.simulation.monitorInterval || config.monitoring.intervalSeconds * 1000;

  // Daily Out-of-Stock notification configuration (once every 24 hours, sent after 10:30 AM IST)
  const heartbeatMinutes =
    process.env.HEARTBEAT_INTERVAL_MINUTES !== undefined
      ? parseFloat(process.env.HEARTBEAT_INTERVAL_MINUTES)
      : 1440;
  const dailySchedule = parseDailyTargetTime(process.env.DAILY_STATUS_TIME || '10:30');
  const dailyStateFile = path.join(__dirname, 'logs', 'daily_status_state.json');

  let lastDailySentDate = await resolveLastDailySentDate(dailyStateFile, config.ntfy.topic);
  const startupIst = getIstTimeParts();

  if (heartbeatMinutes > 0) {
    logger.info(
      `[Daily Schedule] Out-of-Stock notification set to ONCE per day (every 24h) after ${dailySchedule.label}.`
    );
    if (lastDailySentDate === startupIst.dateStr) {
      logger.info(
        `[Daily Schedule] Today's Out-of-Stock update (${startupIst.dateStr}) was already sent. Next update scheduled for tomorrow after ${dailySchedule.label}.`
      );
      saveLastDailySentDate(dailyStateFile, lastDailySentDate);
    } else {
      logger.info(
        `[Daily Schedule] Next Out-of-Stock update will be sent once today (${startupIst.dateStr}) at/after ${dailySchedule.label}.`
      );
    }
  }

  while (true) {
    let browser = null;
    let page = null;

    try {
      resetScreenshotCounter();

      // --- STATE: Launching Browser ---
      logger.info('[Step 1/3] Launching Chromium...');
      const launchResult = await launchBrowser(config);
      browser = launchResult.browser;
      browserInstance = browser;
      page = launchResult.page;

      logger.success('✓ Browser started.');
      await captureMilestone(page, 'browser_started');

      // --- STATE: Direct navigation to the configured Flipkart product URL ---
      logger.info('[Step 2/3] Opening Flipkart product page...');
      await openProductPage(page, config);

      // --- STATE: Monitoring Loop ---
      logger.info(`[Step 3/3] Monitoring Size ${config.product.size} (${config.product.color}) availability...`);
      let checksInCurrentSession = 0;

      while (true) {
        if (page.isClosed()) {
          throw new Error('Browser page was closed unexpectedly.');
        }

        checksInCurrentSession++;
        logger.action(`Checking Flipkart stock for "${config.product.name}" (Color: ${config.product.color}, Size: ${config.product.size})...`);
        const productResult = await checkProductAvailability(page, config);

        if (productResult.found) {
          logger.success(`🎉 PRODUCT IN STOCK! ${productResult.reason}`);
          await captureMilestone(page, 'product_in_stock');

          const pricePart = productResult.priceText ? ` at ${productResult.priceText}` : '';
          const alertLabel = `${config.product.name} - Size ${config.product.size} (${productResult.selectedColor})${pricePart}`;
          const customAlertMsg = `🎉 *FLIPKART IN STOCK ALERT!* *${config.product.name}* (Color: *${productResult.selectedColor}*, Size: *${config.product.size}*)${pricePart} is now AVAILABLE! Buy now: ${page.url()}`;

          if (!alreadyNotified) {
            alreadyNotified = true;

            // Trigger initial notifications
            logger.info('Triggering initial alerts across all configured channels...');
            await dispatchAllNotifications(alertLabel, config, customAlertMsg, page.url(), { isContinuous: false });

            // Continuous rapid alert loop across all active notification channels
            inContinuousAlertLoop = true;
            global.stopRequested = false;

            logger.action('\n================================================================================');
            logger.action(`🚨🚨🚨 SIZE ${config.product.size} (${productResult.selectedColor}) IS IN STOCK! CONTINUOUS ALERTS ACTIVE 🚨🚨🚨`);
            logger.action('👉 TO STOP ALERTS (ANY OF THESE):');
            logger.action('   1. Type "stop" (or "STOP", "s", "q") + [ENTER] in this console');
            logger.action(`   2. OR inside the mobile ntfy app (${config.ntfy.topic}): type "stop" + Send, or tap [🛑 Stop Alerts]`);
            logger.action('   3. OR press [Ctrl+C] in this console');
            logger.action(`   4. OR open http://localhost:${activePort}/stop in your browser`);
            logger.action('================================================================================\n');

            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
              terminal: false
            });

            const onConsoleInput = (input) => {
              if (isStopCommand(input)) {
                requestStop(`console input: "${String(input).trim()}"`);
              }
            };

            rl.on('line', onConsoleInput);
            process.stdin.resume();
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', onConsoleInput);

            let alertCount = 0;
            const alertIntervalSeconds = process.env.ALERT_INTERVAL_SECONDS
              ? parseFloat(process.env.ALERT_INTERVAL_SECONDS)
              : 2;
            const alertIntervalMs = Math.max(100, Math.round(alertIntervalSeconds * 1000));

            logger.info(`Repeated alert pace: Sending every ${alertIntervalSeconds} second(s) (customizable via ALERT_INTERVAL_SECONDS in .env)`);

            while (!global.stopRequested) {
              alertCount++;
              logger.info(`[Continuous Alert #${alertCount}] Broadcasting stock alerts (every ${alertIntervalSeconds}s)...`);
              await dispatchAllNotifications(alertLabel, config, customAlertMsg, page.url(), { isContinuous: true });

              if (global.stopRequested) break;

              for (let elapsed = 0; elapsed < alertIntervalMs && !global.stopRequested; elapsed += 50) {
                await sleep(Math.min(50, alertIntervalMs - elapsed));
              }

              if (alertCount % 5 === 0) {
                logger.action(`🔔 Sent ${alertCount} alerts (every ${alertIntervalSeconds}s). Type "stop" + [ENTER] or visit http://localhost:${activePort}/stop to silence.`);
              }
            }

            try {
              rl.close();
              process.stdin.removeListener('data', onConsoleInput);
            } catch (e) {}

            inContinuousAlertLoop = false;
            logger.success('✅ Continuous alert loop stopped. Exiting immediately...');
          } else {
            logger.info('Product availability already reported. Duplicate alerts suppressed.');
          }

          await cleanup();
          return;
        } else {
          logger.warn(`Status: ${productResult.reason}`);

          // Daily Out-of-Stock notification: Send ONLY once per day (every 24 hours) after 10:30 AM IST
          if (heartbeatMinutes > 0) {
            const nowIst = getIstTimeParts();
            const isAfterTargetTime =
              nowIst.hour > dailySchedule.targetHour ||
              (nowIst.hour === dailySchedule.targetHour && nowIst.minute >= dailySchedule.targetMinute);

            if (isAfterTargetTime && lastDailySentDate !== nowIst.dateStr) {
              lastDailySentDate = nowIst.dateStr;
              saveLastDailySentDate(dailyStateFile, lastDailySentDate);

              const dailyMsg = `📅 Daily Stock Update (${dailySchedule.label}): "${config.product.name}" (Color: ${productResult.selectedColor}, Size: ${config.product.size}) is currently Out of Stock (${nowIst.dateStr}). Next Out-of-Stock update in 24 hours.`;

              logger.info(`[Daily Schedule] Sending daily Out-of-Stock update for ${nowIst.dateStr} (after ${dailySchedule.label})...`);
              if (config.notifications.twilioWhatsApp) {
                const sendWhatsAppNotification = require('./notifications/whatsapp');
                sendWhatsAppNotification(config.product.name, dailyMsg).catch((err) => {
                  logger.error('Failed to send daily WhatsApp status:', err.message);
                });
              }
              if (config.notifications.ntfy) {
                const sendPushNotification = require('./notifications/push');
                await sendPushNotification(config.product.name, dailyMsg, page.url(), { isAlert: false });
              }
            }
          }

          logger.info(`Retrying Flipkart stock check in ${monitorIntervalMs / 1000} seconds...`);
        }

        // Wait for interval
        await sleep(monitorIntervalMs);

        // Recycle Chromium every 50 checks (~4 mins) to keep memory footprint flat on 512MB cloud servers
        if (checksInCurrentSession >= 50) {
          logger.info('Recycling browser session to keep memory usage clean...');
          break;
        }

        // Reload Flipkart product page to catch stock updates immediately
        logger.action('Reloading Flipkart product page...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(config.simulation.pageLoadDelay || 2000);
        await openProductPage.waitForProductPage(page);
      }

      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {}
        browserInstance = null;
      }
    } catch (err) {
      logger.error('Error encountered in monitoring loop. Attempting recovery and browser restart in 10 seconds...', err);

      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {}
        browserInstance = null;
      }

      await sleep(10000);
    }
  }
}

main();
