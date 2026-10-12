const axios = require('axios');
const logger = require('../utils/logger');

async function triggerPhoneCall(productName) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || require('../utils/helpers').getConfig().twilio.accountSid;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const config = require('../utils/helpers').getConfig();
  const { toNumber, fromNumber } = config.twilio;

  if (!accountSid || !authToken || !toNumber || !fromNumber) {
    logger.warn('Twilio SID, Token, To, or From number is missing. Skipping phone call alert.');
    return;
  }

  // TwiML text-to-speech voice message
  const twiml = `<Response><Say voice="alice">Hello. Your tracked Flipkart product ${productName} is now in stock. Please open Flipkart and place your order immediately.</Say></Response>`;
  
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
    params.append('Twiml', twiml);

    try {
      logger.info(`Triggering Twilio Voice Call to ${num}...`);
      const response = await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
        params,
        {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      if (response.status === 201 || response.status === 200) {
        logger.success(`Twilio Voice Call initiated successfully to ${num}. Call SID: ${response.data.sid}`);
      } else {
        logger.error(`Twilio Voice Call to ${num} returned status ${response.status}: ${JSON.stringify(response.data)}`);
      }
    } catch (err) {
      const errorMsg = err.response ? JSON.stringify(err.response.data) : err.message;
      logger.error(`Twilio Voice Call to ${num} failed: ${errorMsg}`);
    }
  });

  await Promise.all(promises);
}

module.exports = triggerPhoneCall;
