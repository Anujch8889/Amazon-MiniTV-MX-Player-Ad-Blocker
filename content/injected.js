/**
 * Injected Page-Level Script
 * This runs in the PAGE context (not extension context)
 * It intercepts and neutralizes ad-related JavaScript functions
 */

(function () {
  'use strict';

  console.log('[AdBlocker] Page-level ad interceptor active');

  // ========== INTERCEPT GOOGLE IMA SDK ==========
  // The IMA SDK (Interactive Media Ads) is the most common video ad framework

  // Block google IMA SDK initialization
  Object.defineProperty(window, 'google', {
    get: function () {
      return this._google;
    },
    set: function (val) {
      this._google = val;
      // Neutralize IMA if present
      if (val && val.ima) {
        neutralizeIMA(val.ima);
      }
    },
    configurable: true
  });

  function neutralizeIMA(ima) {
    try {
      // Override AdsManager to prevent ad playback
      if (ima.AdsManager) {
        const origAdsManager = ima.AdsManager;
        ima.AdsManager = function () {
          const instance = new origAdsManager(...arguments);
          // Override methods that trigger ad playback
          instance.start = function () {
            console.log('[AdBlocker] Blocked IMA ad start');
            // Dispatch ad complete event
            try {
              if (instance.dispatchEvent) {
                instance.dispatchEvent({ type: 'allAdsCompleted' });
              }
            } catch (e) { }
          };
          instance.init = function () { };
          return instance;
        };
      }

      // Override AdsRequest
      if (ima.AdsRequest) {
        ima.AdsRequest = function () {
          this.adTagUrl = '';
          this.linearAdSlotWidth = 0;
          this.linearAdSlotHeight = 0;
        };
      }

      // Override AdsLoader
      if (ima.AdsLoader) {
        const origLoader = ima.AdsLoader;
        ima.AdsLoader = function () {
          const loader = new origLoader(...arguments);
          const origRequestAds = loader.requestAds;
          loader.requestAds = function () {
            console.log('[AdBlocker] Blocked IMA ad request');
            // Don't actually request ads
          };
          return loader;
        };
      }
    } catch (e) {
      // IMA structure might differ
    }
  }

  // ========== INTERCEPT VAST/VPAID ==========

  // Block VAST XML parsing
  const origXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    const urlStr = (url || '').toString().toLowerCase();
    const adPatterns = [
      'vast', 'vpaid', 'doubleclick', 'googlesyndication',
      'googleads', 'amazon-adsystem', 'adservice', 'adserver',
      'ad_request', 'ad_tag', 'prebid', 'imasdk',
      'moat.com', 'scorecardresearch', 'serving-sys',
      'adcolony', 'inmobi', 'pubmatic', 'criteo',
      'taboola', 'outbrain', 'ads.mxplayer',
      'ssai', 'companion%20ad', 'companionad'
    ];

    for (const pattern of adPatterns) {
      if (urlStr.includes(pattern)) {
        console.log('[AdBlocker] Blocked XHR ad request:', urlStr.substring(0, 80));
        // Replace with dummy URL that will fail silently
        return origXHROpen.call(this, method, 'data:text/plain,blocked');
      }
    }
    return origXHROpen.apply(this, arguments);
  };

  // Block fetch requests to ad servers
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = (typeof input === 'string' ? input : (input && input.url) || '').toLowerCase();
    const adPatterns = [
      'vast', 'vpaid', 'doubleclick', 'googlesyndication',
      'googleads', 'amazon-adsystem', 'adservice', 'adserver',
      'ad_request', 'ad_tag', 'prebid', 'imasdk',
      'moat.com', 'scorecardresearch', 'serving-sys',
      'adcolony', 'inmobi', 'pubmatic', 'criteo',
      'taboola', 'outbrain', 'ads.mxplayer',
      'ssai', 'companion'
    ];

    for (const pattern of adPatterns) {
      if (url.includes(pattern)) {
        console.log('[AdBlocker] Blocked fetch ad request:', url.substring(0, 80));
        return Promise.resolve(new Response('', { status: 200 }));
      }
    }
    return origFetch.apply(this, arguments);
  };

  // ========== BLOCK AD-RELATED SCRIPT INJECTIONS ==========

  const origCreateElement = document.createElement.bind(document);
  document.createElement = function (tagName) {
    const el = origCreateElement(tagName);

    if (tagName.toLowerCase() === 'script') {
      const origSetSrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
      if (origSetSrc && origSetSrc.set) {
        Object.defineProperty(el, 'src', {
          set: function (val) {
            const urlStr = (val || '').toLowerCase();
            const adScriptPatterns = [
              'imasdk.googleapis.com',
              'doubleclick.net',
              'googlesyndication.com',
              'amazon-adsystem.com',
              'googleadservices.com',
              'moat.com',
              'scorecardresearch',
              'serving-sys.com',
              'adcolony.com',
              'inmobi.com',
              'pubmatic.com',
              'criteo.com',
              'taboola.com',
              'outbrain.com',
              'prebid'
            ];

            for (const pattern of adScriptPatterns) {
              if (urlStr.includes(pattern)) {
                console.log('[AdBlocker] Blocked ad script load:', urlStr.substring(0, 80));
                return; // Don't set the src
              }
            }
            origSetSrc.set.call(this, val);
          },
          get: function () {
            return origSetSrc.get ? origSetSrc.get.call(this) : '';
          },
          configurable: true
        });
      }
    }

    return el;
  };

  // ========== INTERCEPT AD EVENT LISTENERS ==========

  // Override setTimeout/setInterval to block ad-related timers
  const origSetTimeout = window.setTimeout;
  window.setTimeout = function (fn, delay) {
    const fnStr = (typeof fn === 'function' ? fn.toString() : fn || '').toLowerCase();
    const adTimerPatterns = ['adbreak', 'showad', 'displayad', 'loadad', 'preroll', 'midroll'];

    for (const pattern of adTimerPatterns) {
      if (fnStr.includes(pattern)) {
        console.log('[AdBlocker] Blocked ad timer');
        return origSetTimeout(() => { }, delay);
      }
    }
    return origSetTimeout.apply(this, arguments);
  };

  // ========== PREVENT AD BLOCKER DETECTION ==========

  // Some sites check for hidden ad elements to detect blockers
  // We counter this by faking that ads are "visible"
  const origGetComputedStyle = window.getComputedStyle;
  window.getComputedStyle = function (el) {
    const result = origGetComputedStyle.apply(this, arguments);

    if (el && el.hasAttribute && el.hasAttribute('data-ad-blocked')) {
      // Return fake styles to bypass ad blocker detection
      return new Proxy(result, {
        get: function (target, prop) {
          if (prop === 'display') return 'block';
          if (prop === 'visibility') return 'visible';
          if (prop === 'height') return '250px';
          if (prop === 'width') return '300px';
          if (prop === 'opacity') return '1';
          return typeof target[prop] === 'function'
            ? target[prop].bind(target)
            : target[prop];
        }
      });
    }
    return result;
  };

  console.log('[AdBlocker] All ad interceptors installed successfully');
})();
