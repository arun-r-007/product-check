const axios = require('axios');
const logger = require('../utils/logger');

async function sendTelegramNotification(productName) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const config = require('../utils/helpers').getConfig();
  const chatId = config.telegram.chatId;

  if (!token || !chatId) {
    logger.warn('Telegram Bot Token or Chat ID is missing. Skipping Telegram notification.');
    return;
  }

  const message = `🎉 <b>FLIPKART PRODUCT IN STOCK!</b>\n\n<b>Product:</b> ${productName}\n\nOrder immediately before it goes out of stock!`;

  try {
    logger.info('Sending Telegram notification...');
    const response = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    });

    if (response.data && response.data.ok) {
      logger.success('Telegram notification sent successfully.');
    } else {
      logger.error(`Telegram Bot response error: ${JSON.stringify(response.data)}`);
    }
  } catch (err) {
    logger.error('Telegram notification failed', err);
  }
}

module.exports = sendTelegramNotification;
