/**
 * Injected Page-Level Script
 * This runs in the PAGE context (not extension context)
 * It intercepts and neutralizes ad-related JavaScript functions
 */

(function () {
  'use strict';

  console.log('[AdBlocker] Page-level ad interceptor active');

  // ========== MX PLAYER AD BLOCKER DETECTION BYPASS ==========
  const isMXPlayerPage = window.location.hostname.includes('mxplayer.in') || 
                         window.location.hostname.includes('amazonmxplayer');

  if (isMXPlayerPage) {
    // MX Player sets this flag when it detects ad blocking.
    // Override it so it always returns false.
    Object.defineProperty(window, 'mxAdBlockerEventTriggered', {
      get: function () { return false; },
      set: function () { /* silently ignore */ },
      configurable: false
    });
    console.log('[AdBlocker] MX Player adblocker detection bypass installed');
  }

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
      // Override AdsManager to skip ad playback but fire completion events
      // so the video player transitions to content properly
      if (ima.AdsManager) {
        const origAdsManager = ima.AdsManager;
        ima.AdsManager = function () {
          const instance = new origAdsManager(...arguments);
          // Override methods that trigger ad playback
          instance.start = function () {
            console.log('[AdBlocker] Blocked IMA ad start');
            // Fire all necessary completion events so the player starts content
            try {
              if (instance.dispatchEvent) {
                instance.dispatchEvent({ type: 'allAdsCompleted' });
              }
              // Also fire contentResumeRequested for players that listen to it
              if (instance.dispatchEvent) {
                instance.dispatchEvent({ type: 'contentResumeRequested' });
              }
            } catch (e) { }
            
            // Try to find and play the content video directly
            setTimeout(() => {
              try {
                const videos = document.querySelectorAll('video');
                videos.forEach(v => {
                  if (v.paused && v.readyState >= 2) {
                    v.play().catch(() => {});
                  }
                });
              } catch (e) {}
            }, 500);
          };
          instance.init = function () {
            console.log('[AdBlocker] Skipped IMA ad init');
          };
          // Allow destroy to work normally
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
            // Fire error event so the player falls through to content
            try {
              if (loader.dispatchEvent) {
                loader.dispatchEvent({ type: 'adError', error: { getMessage: () => 'Ad blocked' } });
              }
            } catch (e) {}
          };
          return loader;
        };
      }
    } catch (e) {
      // IMA structure might differ
    }
  }

  // ========== INTERCEPT VAST/VPAID ==========

  // Empty VMAP XML that satisfies the player's ad check without showing any ads
  const EMPTY_VMAP_XML = '<?xml version="1.0" encoding="UTF-8"?><vmap:VMAP xmlns:vmap="http://www.iab.net/videosuite/vmap" version="1.0"></vmap:VMAP>';
  const EMPTY_VAST_XML = '<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"></VAST>';

  // Block VAST XML parsing
  const origXHROpen = XMLHttpRequest.prototype.open;
  const origXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    const urlStr = (url || '').toString().toLowerCase();
    this._adBlockerUrl = urlStr;
    this._adBlockerOrigUrl = url;

    const adPatterns = [
      'doubleclick', 'googlesyndication',
      'googleads', 'amazon-adsystem', 'adservice', 'adserver',
      'ad_request', 'ad_tag', 'prebid', 'imasdk',
      'moat.com', 'scorecardresearch', 'serving-sys',
      'adcolony', 'inmobi', 'pubmatic', 'criteo',
      'taboola', 'outbrain', 'ads.mxplayer',
      'companionad'
    ];

    // For VMAP/VAST requests on MX Player, let them through but we'll intercept the response
    const isVmapVast = urlStr.includes('vmap') || urlStr.includes('vast') || urlStr.includes('vpaid') || urlStr.includes('videoads');
    if (isMXPlayerPage && isVmapVast) {
      this._adBlockerFakeVmap = true;
      console.log('[AdBlocker] Will fake VMAP/VAST response for:', urlStr.substring(0, 80));
      return origXHROpen.call(this, method, 'data:text/xml,' + encodeURIComponent(isVmapVast && urlStr.includes('vmap') ? EMPTY_VMAP_XML : EMPTY_VAST_XML));
    }

    // On MX Player, allow critical player infrastructure XHR requests through
    const mxAllowedXHR = ['doubleclick', 'googlesyndication', 'googleads', 
      'amazon-adsystem', 'adservice', 'imasdk', 'prebid'];

    for (const pattern of adPatterns) {
      if (urlStr.includes(pattern)) {
        if (isMXPlayerPage && mxAllowedXHR.includes(pattern)) {
          continue;
        }
        console.log('[AdBlocker] Blocked XHR ad request:', urlStr.substring(0, 80));
        return origXHROpen.call(this, method, 'data:text/plain,blocked');
      }
    }
    return origXHROpen.apply(this, arguments);
  };

  // Block fetch requests to ad servers
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    let url = '';
    if (typeof input === 'string') {
      url = input;
    } else if (input) {
      if (input instanceof URL) {
        url = input.toString();
      } else if (typeof Request !== 'undefined' && input instanceof Request) {
        url = input.url;
      } else if (typeof input.url === 'string') {
        url = input.url;
      } else {
        url = input.toString();
      }
    }
    const urlStr = url.toLowerCase();

    // For VMAP/VAST/videoads requests on MX Player, return a valid empty VMAP/VAST XML
    // so the player thinks ads loaded successfully but there are no ads to play
    if (isMXPlayerPage) {
      if (urlStr.includes('videoads') || urlStr.includes('ads-vmap') || urlStr.includes('vmap')) {
        console.log('[AdBlocker] Faking VMAP response for fetch:', urlStr.substring(0, 80));
        return Promise.resolve(new Response(EMPTY_VMAP_XML, {
          status: 200,
          headers: { 'Content-Type': 'application/xml' }
        }));
      }
      if (urlStr.includes('vast') || urlStr.includes('vpaid')) {
        console.log('[AdBlocker] Faking VAST response for fetch:', urlStr.substring(0, 80));
        return Promise.resolve(new Response(EMPTY_VAST_XML, {
          status: 200,
          headers: { 'Content-Type': 'application/xml' }
        }));
      }
    }

    const adPatterns = [
      'doubleclick', 'googlesyndication',
      'googleads', 'amazon-adsystem', 'adservice', 'adserver',
      'ad_request', 'ad_tag', 'prebid', 'imasdk',
      'moat.com', 'scorecardresearch', 'serving-sys',
      'adcolony', 'inmobi', 'pubmatic', 'criteo',
      'taboola', 'outbrain', 'ads.mxplayer',
      'companion_ad', 'companionad'
    ];

    // On MX Player, allow critical player infrastructure through fetch too
    const mxAllowedPatterns = ['doubleclick', 'googlesyndication', 'googleads', 
      'amazon-adsystem', 'adservice', 'imasdk', 'prebid', 'googleadservices'];

    for (const pattern of adPatterns) {
      if (urlStr.includes(pattern)) {
        // On MX Player, let critical player scripts through
        if (isMXPlayerPage && mxAllowedPatterns.includes(pattern)) {
          continue;
        }
        console.log('[AdBlocker] Blocked fetch ad request:', urlStr.substring(0, 80));
        return Promise.resolve(new Response('', { status: 200 }));
      }
    }
    return origFetch.apply(this, arguments);
  };

  // ========== BLOCK AD-RELATED SCRIPT INJECTIONS ==========

  const origCreateElement = document.createElement.bind(document);
  document.createElement = function (tagName) {
    const el = origCreateElement.apply(this, arguments);

    if (tagName && typeof tagName === 'string' && tagName.toLowerCase() === 'script') {
      const origSetSrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
      if (origSetSrc && origSetSrc.set) {
        Object.defineProperty(el, 'src', {
          set: function (val) {
            const urlStr = (val || '').toString().toLowerCase();
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
                // On MX Player, allow critical player infrastructure scripts to load
                // Our neutralizeIMA will intercept them at the JS level instead
                if (isMXPlayerPage && (
                  pattern === 'imasdk.googleapis.com' ||
                  pattern === 'doubleclick.net' ||
                  pattern === 'googlesyndication.com' ||
                  pattern === 'amazon-adsystem.com' ||
                  pattern === 'googleadservices.com' ||
                  pattern === 'prebid'
                )) {
                  // Let it load - neutralizeIMA handles ad skipping
                  break;
                }
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

  // Intercept setAttribute for scripts
  const origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (name && typeof name === 'string' && name.toLowerCase() === 'src' && 
        this.tagName && typeof this.tagName === 'string' && this.tagName.toLowerCase() === 'script') {
      const urlStr = (value || '').toString().toLowerCase();
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
          // On MX Player, allow critical player infrastructure scripts to load
          if (isMXPlayerPage && (
            pattern === 'imasdk.googleapis.com' ||
            pattern === 'doubleclick.net' ||
            pattern === 'googlesyndication.com' ||
            pattern === 'amazon-adsystem.com' ||
            pattern === 'googleadservices.com' ||
            pattern === 'prebid'
          )) {
            break;
          }
          console.log('[AdBlocker] Blocked ad script setAttribute src:', urlStr.substring(0, 80));
          return;
        }
      }
    }
    return origSetAttribute.apply(this, arguments);
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
