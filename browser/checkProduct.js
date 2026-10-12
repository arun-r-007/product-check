const logger = require('../utils/logger');
const { highlightElement } = require('../utils/visual');

/**
 * Extracts Flipkart product availability details directly from the DOM:
 * 1. Product Title & Price
 * 2. Selected Color name & Color Swatch stock state (checks for "Out of stock" badge inside color div)
 * 3. All Size Swatch divs (`a[href*="swatchAttr=size"]`) and their exact styling/classes:
 *    - Out of stock size: dashed border (`_1o6mltlk6`), gray overlay (`_7dzyg24z` / `rgba(0, 0, 0, 0.06)`),
 *      strikethrough line (`_7dzyg21s` / `rgb(214, 214, 214)`), muted text (`v1zwn21o` / `rgb(112, 112, 112)`)
 *    - In stock size: solid border (`_1o6mltlk4`), transparent overlay (`_7dzyg24y` / `rgba(0, 0, 0, 0)`),
 *      no strikethrough line, dark text (`v1zwn21n` / `rgb(51, 51, 51)`)
 * 4. Page CTA buttons ("Notify Me" vs "Add to cart" / "Buy Now" / "Buy at")
 */
async function extractProductStatusFromPage(page, targetSize = '7', targetPid = '') {
  return await page.evaluate(
    ({ targetSizeStr, targetPidStr }) => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

      // 1. Product Title
      const titleEl =
        document.querySelector('h1') ||
        document.querySelector('[class*="v1zwn213"]') ||
        document.querySelector('title');
      const productTitle = clean(titleEl ? titleEl.innerText || titleEl.textContent : document.title);

      // 2. Price
      let priceText = '';
      const bodyText = document.body ? document.body.innerText : '';
      const priceMatch = bodyText.match(/₹\s?[\d,]+/);
      if (priceMatch) {
        priceText = priceMatch[0].trim();
      }

      // 3. Selected Color Text (e.g., "Selected Color: DNAVY 4")
      let selectedColor = '';
      const colorLabelMatch = bodyText.match(/Selected Color\s*:\s*([^\n\r]+)/i);
      if (colorLabelMatch) {
        selectedColor = clean(colorLabelMatch[1]);
      }

      // 4. Inspect Color Swatch Divs (anchors inside the color picker with .OfydJ4 / 78px width / _1o6mltln)
      const allPidAnchors = Array.from(document.querySelectorAll('a[href*="pid="]'));
      const colorAnchors = allPidAnchors.filter((a) => {
        const href = a.getAttribute('href') || '';
        const style = a.getAttribute('style') || '';
        if (href.includes('swatchAttr=size')) return false;
        return (
          !!a.querySelector('.OfydJ4') ||
          style.includes('78px') ||
          a.classList.contains('_1o6mltln') ||
          /out of stock/i.test(a.innerText || '')
        );
      });

      let targetColorSwatch = null;
      colorAnchors.forEach((a) => {
        const href = a.getAttribute('href') || '';
        const style = a.getAttribute('style') || '';
        const isSelectedBorder =
          style.includes('rgb(31, 31, 31)') ||
          a.classList.contains('_1o6mltln') ||
          (targetPidStr && href.includes(`pid=${targetPidStr}`));
        const rawText = clean(a.innerText || a.textContent);
        const hasOutOfStockBadge =
          /out of stock/i.test(rawText) ||
          !!a.querySelector('.v1zwn221, ._7dzyg22, ._7dzyg2r');

        const swatchInfo = {
          href,
          isSelected: isSelectedBorder,
          hasOutOfStockBadge,
          badgeText: rawText
        };

        if (
          (isSelectedBorder && hasOutOfStockBadge) ||
          (isSelectedBorder && !targetColorSwatch) ||
          (!targetColorSwatch && targetPidStr && href.includes(targetPidStr))
        ) {
          targetColorSwatch = swatchInfo;
        }
      });

      // 5. Inspect Size Swatch Divs (`a[href*="swatchAttr=size"]`)
      const sizeAnchors = Array.from(document.querySelectorAll('a[href*="swatchAttr=size"]'));
      const sizes = sizeAnchors.map((a) => {
        const href = a.getAttribute('href') || '';
        const pidMatch = href.match(/[?&]pid=([^&]+)/);
        const pid = pidMatch ? pidMatch[1] : '';

        // The first text child inside the size box holds the size number (e.g., "5", "6", "7", "8")
        const sizeTextEl = a.querySelector('[font="default-fk-font-l"], .v1zwn26') || a;
        const sizeValue = clean(sizeTextEl.innerText || a.innerText);

        // Outer box inside <a>
        const boxEl = a.firstElementChild;
        const boxClass = boxEl ? boxEl.className || '' : '';
        const boxStyle = boxEl ? boxEl.getAttribute('style') || '' : '';
        const textStyle = sizeTextEl ? sizeTextEl.getAttribute('style') || '' : '';
        const textClass = sizeTextEl ? sizeTextEl.className || '' : '';

        // Check out-of-stock indicators from user's Flipkart HTML structure:
        // - Dashed border class `_1o6mltlk6` (vs solid `_1o6mltlk4`)
        // - Gray overlay `_7dzyg24z` or `rgba(0, 0, 0, 0.06)` (vs transparent `_7dzyg24y` / `rgba(0, 0, 0, 0)`)
        // - Strikethrough line `_7dzyg21s` or `height: 1px` with `rgb(214, 214, 214)`
        // - Muted text `v1zwn21o` / `rgb(112, 112, 112)` (vs dark `v1zwn21n` / `rgb(51, 51, 51)`)
        const hasDashedBorder =
          boxClass.includes('_1o6mltlk6') ||
          /border-style\s*:\s*dashed/i.test(boxStyle);

        const hasStrikethrough =
          !!a.querySelector('._7dzyg21s') ||
          Array.from(a.querySelectorAll('div')).some((d) => {
            const st = d.getAttribute('style') || '';
            return st.includes('height: 1px') && st.includes('rgb(214, 214, 214)');
          });

        const hasGrayOverlay =
          !!a.querySelector('._7dzyg24z') ||
          Array.from(a.querySelectorAll('div')).some((d) => {
            const st = d.getAttribute('style') || '';
            return st.includes('rgba(0, 0, 0, 0.06)');
          });

        const hasGrayText =
          textClass.includes('v1zwn21o') ||
          textStyle.includes('rgb(112, 112, 112)');

        const isOutOfStock = hasDashedBorder || hasStrikethrough || hasGrayOverlay;

        return {
          size: sizeValue,
          pid,
          href,
          inStock: !isOutOfStock,
          hasDashedBorder,
          hasStrikethrough,
          hasGrayOverlay,
          hasGrayText
        };
      });

      // 6. Inspect Page CTA Buttons ("Notify Me" vs "Add to cart" / "Buy Now")
      const buttonsAndLinks = Array.from(
        document.querySelectorAll('button, a, div[role="button"]')
      ).map((el) => clean(el.innerText));

      const hasNotifyMe =
        buttonsAndLinks.some((t) => /^notify me$/i.test(t)) ||
        /\bNotify Me\b/i.test(bodyText);

      const hasBuyOrCartButton = buttonsAndLinks.some(
        (t) =>
          /^add to cart$/i.test(t) ||
          /^go to cart$/i.test(t) ||
          /^buy now$/i.test(t) ||
          /^buy at\s+₹/i.test(t)
      );

      const hasSoldOutText =
        /\bCurrently Unavailable\b/i.test(bodyText) ||
        /\bSold Out\b/i.test(bodyText);

      const targetSizeObj =
        sizes.find((s) => String(s.size).toLowerCase() === String(targetSizeStr).toLowerCase()) ||
        null;

      return {
        productTitle,
        priceText,
        selectedColor,
        targetColorSwatch,
        sizes,
        targetSizeObj,
        hasNotifyMe,
        hasBuyOrCartButton,
        hasSoldOutText
      };
    },
    { targetSizeStr: String(targetSize), targetPidStr: String(targetPid || '') }
  );
}

/**
 * Checks whether the configured Flipkart product (in the target size and color) is in stock.
 */
async function checkProductAvailability(page, config) {
  const targetSize = String(
    process.env.PRODUCT_SIZE ||
      config.product?.size ||
      '7'
  ).trim();

  const targetColor = String(
    process.env.PRODUCT_COLOR ||
      config.product?.color ||
      'DNAVY 4'
  ).trim();

  const productUrl = config.product?.url || config.booking?.url || page.url();
  const pidMatch = productUrl.match(/[?&]pid=([^&]+)/);
  const targetPid = pidMatch ? pidMatch[1] : '';

  try {
    let status = await extractProductStatusFromPage(page, targetSize, targetPid);

    // If the target size pill exists and has a different PID than current page URL,
    // and the target size pill appears IN STOCK on the swatch bar, navigate to its href to verify!
    if (status.targetSizeObj && status.targetSizeObj.inStock && status.targetSizeObj.href) {
      const currentUrl = page.url();
      if (status.targetSizeObj.pid && !currentUrl.includes(status.targetSizeObj.pid)) {
        const sizeUrl = new URL(status.targetSizeObj.href, currentUrl).toString();
        logger.action(`Size ${targetSize} pill looks available! Navigating to Size ${targetSize} URL to verify: ${sizeUrl}`);
        await page.goto(sizeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);
        status = await extractProductStatusFromPage(page, targetSize, status.targetSizeObj.pid);
      }
    }

    // Format size summary for logging
    const sizeSummary =
      status.sizes.length > 0
        ? status.sizes.map((s) => `${s.size}: ${s.inStock ? '✅ IN STOCK' : '❌ Out of Stock'}`).join(' | ')
        : 'No size pills detected';

    const colorStatusStr = status.targetColorSwatch
      ? status.targetColorSwatch.hasOutOfStockBadge
        ? '❌ Out of stock badge on color swatch'
        : '✅ Color swatch active'
      : 'Color swatch not detected';

    logger.info(`Product: ${status.productTitle || config.product?.name || 'Flipkart Product'} ${status.priceText ? `(${status.priceText})` : ''}`);
    logger.info(`Color: ${status.selectedColor || targetColor} (${colorStatusStr})`);
    logger.info(`Sizes on page: ${sizeSummary}`);

    // Highlight the target size element on the page for visual feedback
    try {
      const sizeLocator = page
        .locator(`a[href*="swatchAttr=size"]`)
        .filter({ hasText: new RegExp(`^\\s*${targetSize}\\s*$`) })
        .first();
      if ((await sizeLocator.count()) > 0) {
        await sizeLocator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await highlightElement(sizeLocator);
      }
    } catch (e) {}

    // Determine if Target Size is Available:
    // Case A: Size swatches are rendered on the page
    if (status.targetSizeObj) {
      const sizeInStock = status.targetSizeObj.inStock;
      const colorOut = status.targetColorSwatch?.hasOutOfStockBadge === true;

      // If we are viewing the target size's page, check that the size pill is in stock
      // AND the color swatch does not say "Out of stock" AND "Notify Me" is not blocking it.
      const isAvailable = sizeInStock && !colorOut && !status.hasNotifyMe && !status.hasSoldOutText;

      if (isAvailable) {
        return {
          found: true,
          productTitle: status.productTitle || config.product?.name,
          priceText: status.priceText,
          selectedColor: status.selectedColor || targetColor,
          targetSize,
          sizes: status.sizes,
          reason: `Size ${targetSize} (${status.selectedColor || targetColor}) is IN STOCK! ${status.priceText}`
        };
      }

      // Build detailed reason why it's out of stock
      const reasons = [];
      if (!sizeInStock) {
        reasons.push(`Size ${targetSize} pill is Out of Stock (dashed border / strikethrough)`);
      }
      if (colorOut) {
        reasons.push(`Selected color (${status.selectedColor || targetColor}) shows "Out of stock"`);
      }
      if (status.hasNotifyMe) {
        reasons.push(`Page button shows "Notify Me"`);
      }
      if (status.hasSoldOutText) {
        reasons.push(`Page shows "Sold Out / Currently Unavailable"`);
      }

      const availableSizes = status.sizes.filter((s) => s.inStock).map((s) => s.size);
      const otherSizesNote =
        availableSizes.length > 0
          ? ` (Other sizes in stock: ${availableSizes.join(', ')})`
          : ' (All sizes out of stock)';

      return {
        found: false,
        productTitle: status.productTitle || config.product?.name,
        priceText: status.priceText,
        selectedColor: status.selectedColor || targetColor,
        targetSize,
        sizes: status.sizes,
        reason: `${reasons.join(' & ')}${otherSizesNote}`
      };
    }

    // Case B: Fallback if size pills didn't render but CTA buttons or color swatch did
    const colorOut = status.targetColorSwatch?.hasOutOfStockBadge === true;
    if (status.hasBuyOrCartButton && !colorOut && !status.hasNotifyMe && !status.hasSoldOutText) {
      return {
        found: true,
        productTitle: status.productTitle || config.product?.name,
        priceText: status.priceText,
        selectedColor: status.selectedColor || targetColor,
        targetSize,
        sizes: status.sizes,
        reason: `Product (${status.selectedColor || targetColor}, Size ${targetSize}) is IN STOCK! Buy/Cart button active.`
      };
    }

    return {
      found: false,
      productTitle: status.productTitle || config.product?.name,
      priceText: status.priceText,
      selectedColor: status.selectedColor || targetColor,
      targetSize,
      sizes: status.sizes,
      reason: `Size ${targetSize} (${status.selectedColor || targetColor}) is Out of Stock (${status.hasNotifyMe ? '"Notify Me" active' : 'not available yet'}).`
    };
  } catch (err) {
    logger.error('Error checking Flipkart product availability', err);
    return {
      found: false,
      productTitle: config.product?.name || 'WOODLAND Casuals',
      priceText: '',
      selectedColor: targetColor,
      targetSize,
      sizes: [],
      reason: `Error during product scan: ${err.message}`
    };
  }
}

module.exports = {
  checkProductAvailability,
  extractProductStatusFromPage
};
