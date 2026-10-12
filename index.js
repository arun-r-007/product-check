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

function requestStop(source = 'user command') {
  if (global.stopRequested) return;
  global.stopRequested = true;
  dismissDesktopNotifications();
  logger.success(`🛑 Stop requested (${source})! Halting continuous alerts immediately...`);
}

// Command line argument parser
const isDryRunArg = process.argv.includes('--dry-run');

/**
 * Halts execution until the user presses Enter or a timeout is reached
 */
function waitForEnter(timeoutMs) {
  return new Promise((resolve) => {
    const handle = setTimeout(() => {
      logger.info('Timeout reached. Automatically proceeding to shutdown...');
      process.stdin.pause();
      resolve();
    }, timeoutMs);

    logger.action(`\n👉 PRESS [ENTER] IN THIS CONSOLE OR WAIT ${Math.round(timeoutMs / 1000)} SECONDS TO CLOSE THE BROWSER...`);

    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', () => {
      clearTimeout(handle);
      process.stdin.pause();
      resolve();
    });
  });
}

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

  // Graceful cleanup handler
  const cleanup = async (keepBrowserOpenDuration = 0) => {
    dismissDesktopNotifications();
    if (keepBrowserOpenDuration > 0 && browserInstance) {
      logger.info(`Keeping browser open so you can complete your Flipkart purchase...`);
      await waitForEnter(keepBrowserOpenDuration);
    }

    logger.info('Cleaning up resources and shutting down...');
    if (browserInstance) {
      try {
        await browserInstance.close();
        logger.success('✓ Browser closed.');
      } catch (err) {}
    }
    stopMockServer();
    stopNtfyListener();
    logger.success('✓ Cleanup complete. Monitor stopped.');
    process.exit(0);
  };

  process.on('SIGINT', () => {
    if (inContinuousAlertLoop && !global.stopRequested) {
      requestStop('Ctrl+C shortcut');
    } else {
      cleanup(0);
    }
  });
  process.on('SIGTERM', () => cleanup(0));

  const monitorIntervalMs = config.simulation.monitorInterval || config.monitoring.intervalSeconds * 1000;

  // Heartbeat interval when product is Out of Stock (default: 1440 minutes = once per day, configurable via HEARTBEAT_INTERVAL_MINUTES in .env)
  const heartbeatMinutes =
    process.env.HEARTBEAT_INTERVAL_MINUTES !== undefined
      ? parseFloat(process.env.HEARTBEAT_INTERVAL_MINUTES)
      : 1440;
  const heartbeatIntervalMs = heartbeatMinutes > 0 ? heartbeatMinutes * 60 * 1000 : null;
  if (heartbeatIntervalMs) {
    const label = heartbeatMinutes === 1440 ? '24 hours (once per day)' : `${heartbeatMinutes} min(s)`;
    logger.info(`Status heartbeat: Updates sent every ${label} while Size ${config.product.size} is Out of Stock.`);
  }

  let lastHeartbeatTime = Date.now();
  let initialStatusSent = false;

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
      while (true) {
        if (page.isClosed()) {
          throw new Error('Browser page was closed unexpectedly.');
        }

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
            logger.success('✅ Continuous alert loop silenced. Flipkart product page remains open for checkout!');
          } else {
            logger.info('Product availability already reported. Duplicate alerts suppressed.');
          }

          // Keep browser open so user can add to cart / buy now
          await cleanup(config.simulation.keepBrowserOpenAfterSuccess || 1800000);
          return;
        } else {
          logger.warn(`Status: ${productResult.reason}`);

          // Initial status notification on first check
          if (!initialStatusSent) {
            initialStatusSent = true;
            lastHeartbeatTime = Date.now();
            const initialMsg = `🔍 Flipkart Monitor Connected: Watching "${config.product.name}" (Color: ${productResult.selectedColor}, Size: ${config.product.size}). Currently Out of Stock — checking every ${monitorIntervalMs / 1000}s.`;

            if (config.notifications.twilioWhatsApp) {
              logger.info('Sending initial status verification to WhatsApp...');
              const sendWhatsAppNotification = require('./notifications/whatsapp');
              sendWhatsAppNotification(config.product.name, initialMsg).catch((err) => {
                logger.error('Failed to send initial WhatsApp alert:', err.message);
              });
            }
            if (config.notifications.ntfy) {
              logger.info('Sending initial status verification to ntfy...');
              const sendPushNotification = require('./notifications/push');
              sendPushNotification(config.product.name, initialMsg, page.url(), { isAlert: false });
            }
          } else if (heartbeatIntervalMs) {
            // Heartbeat status notification every N minutes
            const now = Date.now();
            if (now - lastHeartbeatTime >= heartbeatIntervalMs) {
              lastHeartbeatTime = now;
              const heartbeatMsg = `🔍 Flipkart Monitor Heartbeat: "${config.product.name}" (Color: ${productResult.selectedColor}, Size: ${config.product.size}) is still Out of Stock. Monitoring active every ${monitorIntervalMs / 1000}s.`;

              logger.info(`[Heartbeat] Sending ${heartbeatMinutes}-min status update to active notification channels...`);
              if (config.notifications.twilioWhatsApp) {
                const sendWhatsAppNotification = require('./notifications/whatsapp');
                sendWhatsAppNotification(config.product.name, heartbeatMsg).catch((err) => {
                  logger.error('Failed to send heartbeat WhatsApp alert:', err.message);
                });
              }
              if (config.notifications.ntfy) {
                const sendPushNotification = require('./notifications/push');
                sendPushNotification(config.product.name, heartbeatMsg, page.url(), { isAlert: false });
              }
            }
          }

          logger.info(`Retrying Flipkart stock check in ${monitorIntervalMs / 1000} seconds...`);
        }

        // Wait for interval
        await sleep(monitorIntervalMs);

        // Reload Flipkart product page to catch stock updates immediately
        logger.action('Reloading Flipkart product page...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(config.simulation.pageLoadDelay || 2000);
        await openProductPage.waitForProductPage(page);
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
