// intercept.js - Native Browser MITM for IRCTC Config
// This script runs in the MAIN world to monkey-patch fetch and XHR.
(function() {
  console.log("[Tatkal Agent] Native Request Interceptor Injected.");

  // Intercept Fetch API
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = args[0] instanceof Request ? args[0].url : args[0];
    if (typeof url === 'string' && (url.includes('/api/hidden_config_v2') || url.includes('version.json'))) {
      try {
        const response = await originalFetch.apply(this, args);
        const cloned = response.clone();
        let text = await cloned.text();

        // Read keys dynamically injected by content.js
        const keysNode = document.querySelector('#tatkal-bypass-keys');
        const bypassKey = keysNode ? keysNode.dataset.bypassKey : "PRO_MAX_CTF_2026";

        // Emulate MrRobot_ProMaX regex replacement
        text = text.replace(/"API_KEY"\s*:\s*"[^"]*"/g, `"API_KEY":"${bypassKey}"`);
        text = text.replace(/"CNN_API_KEY"\s*:\s*"[^"]*"/g, `"CNN_API_KEY":"${bypassKey}"`);
        text = text.replace(/"USER_ID"\s*:\s*"[^"]*"/g, `"USER_ID":"${bypassKey}"`);

        console.log(`[Tatkal Agent] Intercepted fetch for ${url}. Replaced API Keys.`);
        return new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      } catch (e) {
        console.error("[Tatkal Agent] Fetch Interceptor error", e);
      }
    }
    return originalFetch.apply(this, args);
  };

  // Intercept XHR
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._url = url;
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  const originalXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args) {
    if (typeof this._url === 'string' && (this._url.includes('/api/hidden_config_v2') || this._url.includes('version.json'))) {
      this.addEventListener('readystatechange', function() {
        if (this.readyState === 4 && this.responseText) {
          try {
            const keysNode = document.querySelector('#tatkal-bypass-keys');
            const bypassKey = keysNode ? keysNode.dataset.bypassKey : "PRO_MAX_CTF_2026";

            let text = this.responseText;
            text = text.replace(/"API_KEY"\s*:\s*"[^"]*"/g, `"API_KEY":"${bypassKey}"`);
            text = text.replace(/"CNN_API_KEY"\s*:\s*"[^"]*"/g, `"CNN_API_KEY":"${bypassKey}"`);
            text = text.replace(/"USER_ID"\s*:\s*"[^"]*"/g, `"USER_ID":"${bypassKey}"`);

            Object.defineProperty(this, 'responseText', { value: text });
            if (this.responseType === '' || this.responseType === 'text') {
              Object.defineProperty(this, 'response', { value: text });
            }
            console.log(`[Tatkal Agent] Intercepted XHR for ${this._url}. Replaced API Keys.`);
          } catch(e) {}
        }
      });
    }
    return originalXhrSend.apply(this, args);
  };
})();
