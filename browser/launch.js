const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const logger = require('../utils/logger');

/**
 * Finds an available Playwright Chromium executable in local Windows %LOCALAPPDATA%\ms-playwright
 * or Linux /ms-playwright if the exact version's binary isn't at the default path.
 */
function findFallbackChromiumExecutable() {
  const searchRoots = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    searchRoots.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  }
  if (process.env.LOCALAPPDATA) {
    searchRoots.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright'));
  }
  searchRoots.push('/ms-playwright');

  for (const pwDir of searchRoots) {
    if (!fs.existsSync(pwDir)) continue;
    try {
      const dirs = fs
        .readdirSync(pwDir)
        .filter((d) => d.startsWith('chromium-') || d.startsWith('chromium_headless_shell-'))
        .sort()
        .reverse();

      for (const dir of dirs) {
        const candidates = [
          path.join(pwDir, dir, 'chrome-linux', 'chrome'),
          path.join(pwDir, dir, 'chrome-linux', 'headless_shell'),
          path.join(pwDir, dir, 'chrome-win64', 'chrome.exe'),
          path.join(pwDir, dir, 'chrome-win', 'chrome.exe')
        ];
        for (const exe of candidates) {
          if (fs.existsSync(exe)) {
            return exe;
          }
        }
      }
    } catch (e) {}
  }
  return null;
}

async function launchBrowser(config) {
  // On Linux cloud servers (Render, Railway, Docker) without an X11 DISPLAY, always force headless mode
  // even if HEADLESS=false was accidentally copied into environment variables.
  const isLinuxWithoutDisplay = process.platform === 'linux' && !process.env.DISPLAY;

  const isHeadless = isLinuxWithoutDisplay
    ? true
    : process.env.HEADLESS !== undefined
      ? process.env.HEADLESS === 'true'
      : (config?.monitoring?.headless ?? false);

  logger.info(`Launching Chromium browser in ${isHeadless ? 'HEADLESS' : 'HEADED'} mode...`);

  const launchArgs = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--mute-audio',
    '--no-first-run',
    '--disk-cache-size=1',
    '--media-cache-size=1',
    '--js-flags=--max-old-space-size=256'
  ];

  if (!isHeadless) {
    launchArgs.push('--start-maximized');
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: isHeadless,
      args: launchArgs
    });
  } catch (err) {
    const fallbackExe = findFallbackChromiumExecutable();
    if (fallbackExe) {
      logger.info(`Using installed Playwright Chromium binary: ${fallbackExe}`);
      browser = await chromium.launch({
        headless: isHeadless,
        executablePath: fallbackExe,
        args: launchArgs
      });
    } else {
      throw err;
    }
  }

  const contextOptions = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata'
  };

  if (!isHeadless) {
    contextOptions.viewport = null;
  } else {
    contextOptions.viewport = { width: 1366, height: 768 };
  }

  const context = await browser.newContext(contextOptions);

  // In headless mode (e.g., Render 512MB container), block heavy images, fonts, and media
  // to keep RAM usage low across thousands of 5-second page reloads.
  if (isHeadless) {
    await context.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'media' || type === 'font') {
        return route.abort();
      }
      return route.continue();
    });
  }

  // Bypass simple automated testing checks
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });
  });

  logger.success('Browser launched and window initialized.');
  return { browser, context, page };
}

module.exports = launchBrowser;
