const axios = require('axios');
const logger = require('../utils/logger');

async function sendSMSNotification(productName) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || require('../utils/helpers').getConfig().twilio.accountSid;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const config = require('../utils/helpers').getConfig();
  const { toNumber, fromNumber } = config.twilio;

  if (!accountSid || !authToken || !toNumber || !fromNumber) {
    logger.warn('Twilio SID, Token, To, or From number is missing. Skipping SMS alert.');
    return;
  }

  const messageText = `Flipkart Alert: ${productName} is now IN STOCK! Open Flipkart immediately to order.`;
  
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
    const params = new URLSearchParams();
    params.append('To', num);
    params.append('From', fromNumber);
    params.append('Body', messageText);

    try {
      logger.info(`Sending SMS alert to ${num}...`);
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
        logger.success(`Twilio SMS sent successfully to ${num}. SID: ${response.data.sid}`);
      } else {
        logger.error(`Twilio SMS to ${num} returned status ${response.status}: ${JSON.stringify(response.data)}`);
      }
    } catch (err) {
      const responseData = err.response ? err.response.data : null;
      if (responseData && responseData.code === 20003) {
        logger.error(`Twilio Account Error: Your Twilio account (${accountSid}) is inactive or suspended (Status 4). Check your Twilio Console or disable twilioSMS in config/config.json.`);
        return;
      }
      const errorMsg = responseData ? JSON.stringify(responseData) : err.message;
      logger.error(`Twilio SMS to ${num} failed: ${errorMsg}`);
    }
  });

  await Promise.all(promises);
}

module.exports = sendSMSNotification;
