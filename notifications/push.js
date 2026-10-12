const axios = require('axios');
const logger = require('../utils/logger');

async function sendPushNotification(productName, customMessage = null, clickUrl = null, options = {}) {
  const config = require('../utils/helpers').getConfig();
  const topic = (process.env.NTFY_TOPIC || config.ntfy?.topic || 'flipkart-woodland-size7-alerts').trim();

  if (!topic) {
    logger.warn('ntfy topic is not configured. Skipping push notification.');
    return;
  }

  const isAlert = options.isAlert !== false;

  try {
    logger.info(`Sending ntfy push notification to topic: ${topic}...`);
    const headers = {
      'Title': options.title || (isAlert ? 'Flipkart Product In Stock Alert!' : 'Flipkart Stock Monitor Update'),
      'Priority': options.priority || (isAlert ? 'urgent' : 'default'),
      'Tags': options.tags || (isAlert ? 'tada,shopping_cart,athletic_shoe' : 'hourglass,mag')
    };

    if (isAlert) {
      headers['Actions'] = `view, 🛒 Buy Now on Flipkart, ${clickUrl || 'https://www.flipkart.com'}; http, 🛑 Stop Alerts, https://ntfy.sh/${topic}, method=POST, body=stop`;
    } else if (clickUrl) {
      headers['Actions'] = `view, 👟 View Product on Flipkart, ${clickUrl}`;
    }

    if (clickUrl) {
      headers['Click'] = clickUrl;
    }

    const bodyText =
      customMessage ||
      `🎉 IN STOCK! ${productName} is now available on Flipkart! Open the link to buy immediately.`;

    await axios.post(`https://ntfy.sh/${topic}`, bodyText, { headers });
    logger.success('✓ Push notification sent successfully via ntfy.sh.');
  } catch (err) {
    if (err.response && err.response.status === 429) {
      logger.warn('Push notification rate-limited by ntfy.sh (HTTP 429). Will retry on next alert cycle.');
    } else {
      logger.error('Failed to send push notification via ntfy.sh', err.message || err);
    }
  }
}

module.exports = sendPushNotification;
