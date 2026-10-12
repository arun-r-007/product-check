const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const axios = require('axios');
const logger = require('../utils/logger');

async function sendWhatsAppNotification(productName, customMessage = null) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || require('../utils/helpers').getConfig().twilio.accountSid;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const config = require('../utils/helpers').getConfig();
  const { toNumber, fromNumber, whatsappFromNumber } = config.twilio;

  if (!accountSid || !authToken || !toNumber || (!fromNumber && !whatsappFromNumber)) {
    logger.warn('Twilio SID, Token, To, or From number is missing. Skipping WhatsApp alert.');
    return;
  }

  const rawFrom = whatsappFromNumber || fromNumber;
  const fromWhatsapp = rawFrom.startsWith('whatsapp:') ? rawFrom : `whatsapp:${rawFrom}`;
  const messageText = customMessage || `🎉 Flipkart Alert: *${productName}* is now IN STOCK! Open Flipkart immediately to buy.`;

  // Basic Auth header
  const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  // Convert to array if it is a single string or comma-separated string
  let targetNumbers = [];
  if (Array.isArray(toNumber)) {
    targetNumbers = toNumber;
  } else if (typeof toNumber === 'string') {
    targetNumbers = toNumber.split(',').map(num => num.trim());
  }

  const promises = targetNumbers.map(async (num) => {
    const toWhatsapp = num.startsWith('whatsapp:') ? num : `whatsapp:${num}`;
    const params = new URLSearchParams();
    params.append('To', toWhatsapp);
    params.append('From', fromWhatsapp);
    params.append('Body', messageText);

    try {
      logger.info(`Sending WhatsApp alert to ${toWhatsapp}...`);
      const response = await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        params,
        {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      if (response.status === 201 || response.status === 200) {
        logger.success(`Twilio WhatsApp sent successfully to ${toWhatsapp}. SID: ${response.data.sid}`);
      } else {
        logger.error(`Twilio WhatsApp to ${toWhatsapp} returned status ${response.status}: ${JSON.stringify(response.data)}`);
      }
    } catch (err) {
      const responseData = err.response ? err.response.data : null;
      if (responseData) {
        if (responseData.code === 21654) {
          logger.error(`[Twilio 21654] ${toWhatsapp}: WhatsApp Sandbox session is not active. Send "join <sandbox-code>" from your phone to +1 415 523 8886 in WhatsApp to enable 24-hr freeform messages.`);
          return;
        }
        if (responseData.code === 572002) {
          logger.warn(`[Twilio 572002] ${toWhatsapp}: Number has not joined the Twilio WhatsApp Sandbox yet. Send "join <sandbox-code>" to +1 415 523 8886 from this phone.`);
          return;
        }
        if (responseData.code === 20003) {
          logger.error(`[Twilio 20003] Account (${accountSid}) is inactive or suspended.`);
          return;
        }
      }
      const errorMsg = responseData ? JSON.stringify(responseData) : err.message;
      logger.error(`Twilio WhatsApp to ${toWhatsapp} failed: ${errorMsg}`);
    }
  });

  await Promise.all(promises);
}

module.exports = sendWhatsAppNotification;
