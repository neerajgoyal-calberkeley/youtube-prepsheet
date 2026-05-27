'use strict';
// Runs in the page's MAIN world at document_start, before any YouTube scripts.
// Wraps fetch and XHR to capture timedtext responses when the YouTube player
// fetches captions for display — those requests have the right browser context
// to succeed where our out-of-band fetches get blocked by bot detection.
(function () {
  if (window._ytCSInterceptor) return;
  window._ytCSInterceptor = true;
  window._ytCSCaptionData = {};

  // ── fetch wrapper ─────────────────────────────────────────────────────────
  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await _origFetch.apply(this, args);
    try {
      const url = args[0] instanceof Request ? args[0].url : String(args[0] || '');
      if (url.includes('timedtext')) {
        response.clone().text().then((text) => {
          if (text.length > 0) window._ytCSCaptionData[url] = text;
        }).catch(() => {});
      }
    } catch (_) {}
    return response;
  };

  // ── XHR wrapper ──────────────────────────────────────────────────────────
  const _origOpen = XMLHttpRequest.prototype.open;
  const _origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._ytCSUrl = String(url || '');
    return _origOpen.apply(this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this._ytCSUrl?.includes('timedtext')) {
      this.addEventListener('load', function () {
        if (this.responseText?.length > 0)
          window._ytCSCaptionData[this._ytCSUrl] = this.responseText;
      });
    }
    return _origSend.apply(this, args);
  };
})();
