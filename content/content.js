/**
 * Content Script - Ad Blocker for Amazon MiniTV & MX Player
 * 
 * Strategy:
 * 1. CSS hides known ad elements (content.css - loaded at document_start)
 * 2. MutationObserver watches for dynamically injected ad elements
 * 3. Video player monitoring to skip/mute ad segments
 * 4. Injected page-level script to intercept ad-related JS functions
 */

(function () {
  'use strict';

  let isEnabled = true;
  let blockedCount = 0;
  const REPORT_INTERVAL = 5000; // Report blocked count every 5 seconds

  // ========== AD ELEMENT SELECTORS ==========
  const AD_SELECTORS = [
    // Amazon MiniTV / Video Player
    '.atvwebplayersdk-ad-overlay',
    '.atvwebplayersdk-adtimeindicator-text',
    '.atvwebplayersdk-ad-timer',
    '[class*="adBreak"]',
    '[class*="ad-overlay"]',
    '[class*="ad-container"]',
    '[class*="ad-banner"]',
    '[class*="adOverlay"]',
    '[class*="adContainer"]',
    '[class*="adBanner"]',
    '[class*="AdSlot"]',
    '[class*="ad-slot"]',
    '[class*="videoAd"]',
    '[class*="video-ad"]',
    '[class*="preroll"]',
    '[class*="midroll"]',
    '[class*="postroll"]',
    '[data-ad-type]',
    '[data-ad-id]',
    '[data-ad-slot]',
    '[data-ad-unit]',
    '#ad-display',
    '#ad-feedback',
    '#ad-container',
    '#videoAdContainer',

    // MX Player specific
    '.mx-ad-container',
    '.mx-ad-overlay',
    '.mx-ad-banner',
    '.mx-player-ad',
    '[class*="mx-ad"]',
    '[class*="mxAd"]',
    '[id*="mx-ad"]',

    // General ad patterns
    '[class*="ad-wrapper"]',
    '[class*="adWrapper"]',
    '[class*="ad_wrapper"]',
    '[id*="ad-container"]',
    '[id*="adContainer"]',
    '[id*="google_ads"]',
    '[id*="ad-overlay"]',

    // Google IMA SDK
    '.ima-ad-container',
    '#ima-ad-container',
    '[class*="ima-"]',
    '.videoAdUi',
    '.videoAdUiBottomBar',
    '.videoAdUiTopBar',

    // VAST/VPAID
    '[class*="vast-"]',
    '[class*="vpaid-"]',
    '[id*="vast"]',
    '[id*="vpaid"]',

    // Popup and overlay ads
    '.overlay-ad',
    '.popup-ad',
    '.interstitial-ad',
    '[class*="interstitial"]',
    '[class*="popupAd"]',
    '[class*="popup-ad"]',
    '[class*="overlay-ad"]',
    '[class*="overlayAd"]',

    // Sponsored content
    '[class*="sponsored"]',
    '[class*="Sponsored"]',
    '.a-ad',
    '.a-ad-feedback',

    // Ad iframes
    'iframe[src*="doubleclick"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="amazon-adsystem"]',
    'iframe[id*="ad"]',
    'iframe[class*="ad-"]',

    // Banner ads
    '[class*="banner-ad"]',
    '[class*="bannerAd"]',
    '[class*="banner_ad"]',
    '[class*="leaderboard-ad"]',
    '[class*="rectangle-ad"]',

    // Google companion
    '#google_companion_ad',
    '.GoogleActiveViewClass'
  ];

  const SKIP_BUTTON_SELECTORS = [
    '[class*="skip-ad"]',
    '[class*="skipAd"]',
    '[class*="skip_ad"]',
    'button[class*="skip"]',
    '.videoAdUiSkipButton',
    '.ytp-ad-skip-button',
    '[class*="ad-skip"]',
    '[data-testid*="skip"]',
    '[aria-label*="Skip"]',
    '[aria-label*="skip"]'
  ];

  // ========== CORE AD REMOVAL ==========

  /**
   * Remove all matching ad elements from the DOM
   */
  function removeAdElements() {
    if (!isEnabled) return;

    let removed = 0;
    const selectorString = AD_SELECTORS.join(', ');

    try {
      const adElements = document.querySelectorAll(selectorString);
      adElements.forEach((el) => {
        // Don't remove the video player itself
        if (el.tagName === 'VIDEO') return;

        // Check if element is visible (not already hidden)
        if (el.offsetParent !== null || el.style.display !== 'none') {
          el.style.display = 'none';
          el.style.visibility = 'hidden';
          el.style.height = '0';
          el.style.width = '0';
          el.style.overflow = 'hidden';
          el.style.position = 'absolute';
          el.style.zIndex = '-9999';
          el.setAttribute('data-ad-blocked', 'true');
          removed++;
        }
      });
    } catch (e) {
      // Selector might be invalid on some pages
    }

    if (removed > 0) {
      blockedCount += removed;
      console.log(`[AdBlocker] Removed ${removed} ad elements`);
    }

    return removed;
  }

  /**
   * Auto-click skip buttons when they appear
   */
  function clickSkipButtons() {
    if (!isEnabled) return;

    const selectorString = SKIP_BUTTON_SELECTORS.join(', ');
    const skipButtons = document.querySelectorAll(selectorString);

    skipButtons.forEach((btn) => {
      if (btn.offsetParent !== null && !btn.hasAttribute('data-skip-clicked')) {
        btn.setAttribute('data-skip-clicked', 'true');
        btn.click();
        console.log('[AdBlocker] Auto-clicked skip button');
        blockedCount++;
      }
    });
  }

  // ========== VIDEO PLAYER MONITORING ==========

  /**
   * Monitor video elements for ad playback and skip/mute them
   */
  function monitorVideoPlayers() {
    if (!isEnabled) return;

    const videos = document.querySelectorAll('video');
    videos.forEach((video) => {
      if (video.hasAttribute('data-ad-monitor')) return;
      video.setAttribute('data-ad-monitor', 'true');

      // Watch for ad indicators in the video's parent containers
      const checkForAd = () => {
        if (!isEnabled) return;

        const parent = video.closest('[class*="ad"], [class*="Ad"], [data-ad-type]');
        if (parent) {
          // This video is inside an ad container - try to skip
          if (video.duration && isFinite(video.duration)) {
            video.currentTime = video.duration;
            video.muted = true;
            video.playbackRate = 16; // Speed through ad if can't skip
            console.log('[AdBlocker] Skipping video ad');
            blockedCount++;
          }
        }
      };

      video.addEventListener('play', checkForAd);
      video.addEventListener('loadeddata', checkForAd);
      video.addEventListener('timeupdate', () => {
        // Periodically check if an ad overlay appeared
        clickSkipButtons();
      });
    });
  }

  // ========== MUTATION OBSERVER ==========

  /**
   * Watch for dynamically added ad elements and remove them immediately
   */
  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      if (!isEnabled) return;

      let shouldScan = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if the added node itself is an ad
              const isAd = isAdElement(node);
              if (isAd) {
                hideElement(node);
                blockedCount++;
                continue;
              }
              // Check if added node contains ad children
              shouldScan = true;
            }
          }
        }
        if (mutation.type === 'attributes') {
          if (mutation.target.nodeType === Node.ELEMENT_NODE) {
            if (isAdElement(mutation.target)) {
              hideElement(mutation.target);
              blockedCount++;
            }
          }
        }
      }

      if (shouldScan) {
        removeAdElements();
        clickSkipButtons();
        monitorVideoPlayers();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'id', 'style', 'src', 'data-ad-type']
    });

    return observer;
  }

  /**
   * Check if an element matches ad patterns
   */
  function isAdElement(el) {
    if (!el || !el.getAttribute) return false;

    const className = (el.className || '').toString().toLowerCase();
    const id = (el.id || '').toLowerCase();
    const src = (el.getAttribute('src') || '').toLowerCase();

    const adPatterns = [
      'ad-', 'ad_', '-ad', '_ad', 'adslot', 'adcontainer', 'adbanner',
      'adoverlay', 'ad-overlay', 'ad-container', 'ad-banner', 'adwrapper',
      'ad-wrapper', 'sponsored', 'preroll', 'midroll', 'postroll',
      'videoAd', 'video-ad', 'ima-', 'vast', 'vpaid', 'mx-ad',
      'adbreak', 'ad-break', 'google_ads', 'googlesyndication',
      'doubleclick', 'amazon-adsystem', 'popup-ad', 'overlay-ad',
      'interstitial', 'adservice'
    ];

    for (const pattern of adPatterns) {
      if (className.includes(pattern) || id.includes(pattern)) {
        return true;
      }
    }

    // Check for ad iframes
    if (el.tagName === 'IFRAME') {
      for (const pattern of ['doubleclick', 'googlesyndication', 'amazon-adsystem', 'ad.', 'ads.']) {
        if (src.includes(pattern)) return true;
      }
    }

    // Check data attributes
    if (el.hasAttribute('data-ad-type') || el.hasAttribute('data-ad-id') || el.hasAttribute('data-ad-slot')) {
      return true;
    }

    return false;
  }

  /**
   * Hide an element immediately
   */
  function hideElement(el) {
    if (!el || el.tagName === 'VIDEO') return;

    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('height', '0', 'important');
    el.style.setProperty('width', '0', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
    el.style.setProperty('position', 'absolute', 'important');
    el.style.setProperty('z-index', '-9999', 'important');
    el.setAttribute('data-ad-blocked', 'true');
  }

  // ========== INJECT PAGE-LEVEL SCRIPT ==========

  /**
   * Inject a script into the page context to intercept ad-related JS functions
   */
  function injectPageScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('content/injected.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.log('[AdBlocker] Could not inject page script:', e.message);
    }
  }

  // ========== REPORTING ==========

  /**
   * Report blocked count to background script periodically
   */
  function reportBlocked() {
    if (blockedCount > 0) {
      try {
        chrome.runtime.sendMessage({
          type: 'AD_BLOCKED_DOM',
          count: blockedCount
        });
      } catch (e) {
        // Extension context may be invalidated
      }
      blockedCount = 0;
    }
  }

  // ========== MESSAGE HANDLER ==========

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TOGGLE_STATE') {
      isEnabled = message.enabled;
      if (isEnabled) {
        removeAdElements();
        clickSkipButtons();
      }
      console.log(`[AdBlocker] ${isEnabled ? 'Enabled' : 'Disabled'}`);
    }
  });

  // ========== INITIALIZATION ==========

  function init() {
    console.log('[AdBlocker] Content script loaded on:', window.location.hostname);

    // Load saved state
    chrome.storage.local.get(['enabled'], (data) => {
      isEnabled = data.enabled !== false; // Default to true
    });

    // Initial scan
    removeAdElements();
    clickSkipButtons();

    // Inject page-level script for JS interception
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        injectPageScript();
        removeAdElements();
        clickSkipButtons();
        monitorVideoPlayers();
      });
    } else {
      injectPageScript();
      monitorVideoPlayers();
    }

    // Setup mutation observer for dynamic ad injection
    setupMutationObserver();

    // Periodic scans as fallback
    setInterval(() => {
      if (isEnabled) {
        removeAdElements();
        clickSkipButtons();
        monitorVideoPlayers();
      }
    }, 2000);

    // Report blocked count periodically
    setInterval(reportBlocked, REPORT_INTERVAL);

    // Final scan after full page load
    window.addEventListener('load', () => {
      setTimeout(() => {
        removeAdElements();
        clickSkipButtons();
        monitorVideoPlayers();
      }, 1000);

      // One more pass after a delay for lazy-loaded ads
      setTimeout(() => {
        removeAdElements();
        clickSkipButtons();
      }, 3000);
    });
  }

  init();
})();
