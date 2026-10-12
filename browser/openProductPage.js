const logger = require('../utils/logger');
const { sleep } = require('../utils/helpers');
const { captureMilestone } = require('../utils/visual');

/**
 * Dismisses Flipkart's login popup modal if it appears over the product page.
 */
async function dismissFlipkartPopup(page) {
  try {
    const closeBtn = page.locator('button:has-text("✕"), [aria-label="Close"], span:has-text("✕")').first();
    if ((await closeBtn.count()) > 0 && (await closeBtn.isVisible())) {
      await closeBtn.click({ timeout: 2000 }).catch(() => {});
      logger.info('Dismissed Flipkart login modal popup.');
    }
  } catch (err) {
    // Ignore if no popup exists
  }
}

/**
 * Waits until Flipkart's product details, color swatches, or size swatches are rendered.
 */
async function waitForProductPage(page) {
  try {
    await page.waitForSelector(
      'a[href*="swatchAttr=size"], a[href*="pid="], button:has-text("Notify Me"), button:has-text("Add to cart"), button:has-text("Buy Now"), div:has-text("Select Size")',
      { timeout: 15000 }
    );
    logger.success('✓ Flipkart product page elements rendered.');
  } catch (err) {
    logger.warn('Product swatches or CTA buttons did not render within 15s. Continuing anyway...');
  }

  await dismissFlipkartPopup(page);
}

/**
 * Opens the target Flipkart product URL directly.
 */
async function openProductPage(page, config, targetUrl = null) {
  const url = targetUrl || config.product?.url || config.booking?.url;
  const simConfig = config.simulation || {};

  if (!url || url.trim() === '') {
    throw new Error('No product URL configured. Set PRODUCT_URL in .env or config.json');
  }

  logger.info(`Opening Flipkart product page: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(simConfig.pageLoadDelay || 2000);

  await waitForProductPage(page);

  await captureMilestone(page, 'product_page_loaded');
  logger.success('✓ Flipkart product page loaded.');
}

module.exports = openProductPage;
module.exports.waitForProductPage = waitForProductPage;
module.exports.dismissFlipkartPopup = dismissFlipkartPopup;
