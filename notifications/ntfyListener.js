const logger = require('../utils/logger');

let abortController = null;
let isListening = false;

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
    str.startsWith('stop') ||
    str === '/stop'
  );
}

function startNtfyListener(topic, onStopCallback) {
  if (!topic || isListening) return;
  isListening = true;
  abortController = new AbortController();
  const listenerStartUnix = Math.floor(Date.now() / 1000);

  logger.info(`[ntfy] Listening for remote stop commands on topic: "${topic}"...`);

  (async () => {
    while (isListening) {
      try {
        const response = await fetch(`https://ntfy.sh/${topic}/json`, {
          signal: abortController.signal
        });

        if (!response.ok) {
          throw new Error(`ntfy stream returned HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (isListening) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep remainder

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              // Listen for newly published messages only
              if (
                data.event === 'message' &&
                data.message &&
                (!data.time || data.time >= listenerStartUnix)
              ) {
                const text = String(data.message).trim();
                // If the message is a stop command
                if (isStopCommand(text)) {
                  logger.success(`\n🛑 [ntfy App] Remote stop command ("${text}") received! Halting alerts immediately...`);
                  if (typeof onStopCallback === 'function') {
                    onStopCallback(text);
                  }
                }
              }
            } catch (err) {}
          }
        }
      } catch (err) {
        if (!isListening || err.name === 'AbortError') {
          break;
        }
        // On network drop, retry after 3 seconds
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  })();
}

function stopNtfyListener() {
  isListening = false;
  if (abortController) {
    try {
      abortController.abort();
    } catch (e) {}
    abortController = null;
  }
}

module.exports = { startNtfyListener, stopNtfyListener, isStopCommand };
