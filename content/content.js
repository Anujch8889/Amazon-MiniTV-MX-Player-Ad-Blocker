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

  // Detect if we're on MX Player
  const isMXPlayer = window.location.hostname.includes('mxplayer.in') || 
                     window.location.hostname.includes('amazonmxplayer');


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

    // Google IMA SDK - only target specific ad UI elements, NOT the entire player
    '.ima-ad-container',
    '#ima-ad-container',
    // REMOVED: '[class*="ima-"]' - this hides the entire MX Player video player!
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

        // Don't remove elements that contain the actual video player
        if (isVideoPlayerOrParent(el)) return;

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
   * Check if an element IS the video player or contains the video player
   */
  function isVideoPlayerOrParent(el) {
    if (!el) return false;
    
    // Check if this element contains a <video> element
    if (el.querySelector && el.querySelector('video')) return true;
    
    // Check if this element is a known player container
    const className = (el.getAttribute('class') || '').toLowerCase();
    const id = (el.getAttribute('id') || '').toLowerCase();
    
    const playerPatterns = [
      'player-container', 'player_container', 'playercontainer',
      'video-player', 'video_player', 'videoplayer',
      'player-wrapper', 'player_wrapper', 'playerwrapper',
      'mx-player', 'mxplayer', 'content-player',
      'bitmovinplayer', 'shaka-player', 'jw-player',
      'html5-video', 'video-container', 'videocontainer',
      'media-player', 'mediaplayer'
    ];
    
    for (const pattern of playerPatterns) {
      if (className.includes(pattern) || id.includes(pattern)) return true;
    }
    
    return false;
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

  const stuckVideoTracker = new WeakMap();

  const LOADER_SELECTORS = [
    '.atvwebplayersdk-player-loading',
    '.atvwebplayersdk-loading-overlay',
    '.atvwebplayersdk-spinner',
    '.mx-loader',
    '.mx-player-loading',
    '[class*="loading-overlay" i]',
    '[class*="player-loading" i]',
    '[class*="spinner-container" i]',
    '[class*="Spinner_container"]',
    '[class*="Spinner_spinner"]',
    '[class*="Spinner_large"]',
    '[id*="loading-overlay" i]',
    '[id*="player-loading" i]'
  ];

  /**
   * Hide any visible player loader/spinner overlays for normal content
   */
  function hideStuckLoaders(video) {
    if (!isEnabled) return;

    // Verify that this video itself is not an ad
    let isAdVideo = false;
    let currentEl = video.parentElement;
    while (currentEl && currentEl !== document.body) {
      if (isAdElement(currentEl) || currentEl.hasAttribute('data-ad-type')) {
        isAdVideo = true;
        break;
      }
      currentEl = currentEl.parentElement;
    }

    if (!isAdVideo) {
      LOADER_SELECTORS.forEach(selector => {
        try {
          const loaders = document.querySelectorAll(selector);
          loaders.forEach(loader => {
            if (loader && loader.style.display !== 'none') {
              loader.style.setProperty('display', 'none', 'important');
              loader.style.setProperty('visibility', 'hidden', 'important');
              console.log('[AdBlocker] Hidden stuck loader:', selector);
            }
          });
        } catch (e) {}
      });
    }
  }

  /**
   * Detect and resolve players frozen on ad-loading (paused at 0 seconds)
   */
  function checkStuckVideo(video) {
    if (!isEnabled) return;

    // Only inspect video if it is paused at the beginning (currentTime === 0)
    if (video.paused && video.currentTime === 0) {
      // Check if a loader overlay is currently visible on the page
      const loaderSelectors = LOADER_SELECTORS;

      let loaderVisible = false;
      for (const selector of loaderSelectors) {
        try {
          const loader = document.querySelector(selector);
          if (loader && loader.style.display !== 'none' && getComputedStyle(loader).display !== 'none') {
            loaderVisible = true;
            break;
          }
        } catch (e) {}
      }

      if (loaderVisible) {
        let state = stuckVideoTracker.get(video);
        if (!state) {
          state = { firstSeen: Date.now() };
          stuckVideoTracker.set(video, state);
        } else if (Date.now() - state.firstSeen > 3000) {
          // Stuck on startup for more than 3 seconds with loader visible: force play and clean up
          console.log('[AdBlocker] Video stuck loading on startup. Forcing playback...');
          video.play().catch(e => {});
          hideStuckLoaders(video);
          stuckVideoTracker.delete(video);
        }
      } else {
        stuckVideoTracker.delete(video);
      }
    } else {
      stuckVideoTracker.delete(video);
    }
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

        // Traverse up the tree to find if any parent container matches ad patterns.
        // This is much more precise than using querySelector/closest with [class*="ad"]
        // which matches common words like "fade", "loaded", "loading", "shadow", "download", etc.
        let parent = null;
        let currentEl = video.parentElement;
        while (currentEl && currentEl !== document.body) {
          if (isAdElement(currentEl) || currentEl.hasAttribute('data-ad-type')) {
            parent = currentEl;
            break;
          }
          currentEl = currentEl.parentElement;
        }

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

        // Check if the video is playing normal content but the loader is stuck
        if (video.currentTime > 0.5 && !video.paused) {
          hideStuckLoaders(video);
        }
      });

      // Also listen to the playing/play events to hide loaders immediately
      video.addEventListener('playing', () => {
        hideStuckLoaders(video);
      });
      video.addEventListener('play', () => {
        // Give a tiny timeout for player rendering, then check loaders
        setTimeout(() => hideStuckLoaders(video), 200);
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

    // Never treat video player containers as ads
    if (isVideoPlayerOrParent(el)) return false;

    // Use getAttribute('class') or getAttribute('id') to safely handle SVGAnimatedString objects
    const className = (el.getAttribute('class') || '').toString().toLowerCase();
    const id = (el.getAttribute('id') || '').toString().toLowerCase();
    const src = (el.getAttribute('src') || '').toString().toLowerCase();

    // On MX Player, be more conservative — only match very specific ad patterns
    const adPatterns = isMXPlayer ? [
      'ad-overlay', 'ad-container', 'ad-banner', 'adoverlay', 'adcontainer', 'adbanner',
      'adslot', 'ad-slot', 'adwrapper', 'ad-wrapper',
      'videoad', 'video-ad', 'preroll', 'midroll', 'postroll',
      'mx-ad', 'mxad', 'google_ads', 'googlesyndication',
      'doubleclick', 'amazon-adsystem', 'popup-ad', 'popupad',
      'overlay-ad', 'overlayad', 'interstitial', 'adservice',
      'adtimeindicator', 'videoadui', 'bannerad'
    ] : [
      'ad-', 'ad_', '-ad', '_ad', 'adslot', 'adcontainer', 'adbanner',
      'adoverlay', 'ad-overlay', 'ad-container', 'ad-banner', 'adwrapper',
      'ad-wrapper', 'sponsored', 'preroll', 'midroll', 'postroll',
      'videoad', 'video-ad', 'ima-', 'vast', 'vpaid', 'mx-ad', 'mxad',
      'adbreak', 'ad-break', 'google_ads', 'googlesyndication',
      'doubleclick', 'amazon-adsystem', 'popup-ad', 'popupad',
      'overlay-ad', 'overlayad', 'interstitial', 'adservice',
      'adtimeindicator', 'videoadui', 'bannerad', 'activeview'
    ];

    for (const pattern of adPatterns) {
      if (className.includes(pattern) || id.includes(pattern)) {
        // Double-check: don't flag if it's a player element
        if (el.tagName === 'VIDEO') return false;
        if (el.querySelector && el.querySelector('video')) return false;
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
    if (el.hasAttribute('data-ad-type') || 
        el.hasAttribute('data-ad-id') || 
        el.hasAttribute('data-ad-slot') ||
        el.hasAttribute('data-ad-unit')) {
      return true;
    }

    return false;
  }

  /**
   * Hide an element immediately
   */
  function hideElement(el) {
    if (!el || el.tagName === 'VIDEO') return;

    // Don't hide elements that contain the video player
    if (isVideoPlayerOrParent(el)) return;

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

  let activeSecondCounter = 0;

  /**
   * Tracks active video playback time to determine when to show rating popup
   */
  function trackActiveTime() {
    if (!isEnabled) return;
    
    const video = document.querySelector('video');
    // If a video exists on the page and is actively playing, increment active time
    if (video && !video.paused && video.currentTime > 0) {
      activeSecondCounter++;
      
      // Every 60 seconds (1 minute), write to storage and check rating
      if (activeSecondCounter >= 60) {
        activeSecondCounter = 0;
        
        chrome.storage.local.get(['activeTimeSeconds', 'hasRated', 'ratingShowTimestamps'], (data) => {
          if (data.hasRated) return; // User already rated, do nothing
          
          const newTime = (data.activeTimeSeconds || 0) + 60;
          chrome.storage.local.set({ activeTimeSeconds: newTime }, () => {
            // Check if user has used the extension for 2 hours (7200 seconds)
            if (newTime >= 7200) {
              checkAndTriggerRating(data.ratingShowTimestamps || []);
            }
          });
        });
      }
    }
  }

  /**
   * Validates frequency conditions (max 2 times per 24 hours) and triggers modal
   */
  function checkAndTriggerRating(timestamps) {
    // Filter out timestamps older than 24 hours (86,400,000 ms)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentShows = timestamps.filter(ts => ts > oneDayAgo);
    
    // Limit to 2 shows in 24 hours
    if (recentShows.length < 2) {
      // Check if modal is already on the page
      if (document.querySelector('.adblocker-rating-overlay')) return;
      
      // Show the rating popup!
      showRatingPopup(recentShows);
    }
  }

  /**
   * Injects and shows the custom rating modal dialog
   */
  function showRatingPopup(recentShows) {
    // Add current show timestamp
    recentShows.push(Date.now());
    chrome.storage.local.set({ ratingShowTimestamps: recentShows });

    // Create modal elements
    const overlay = document.createElement('div');
    overlay.className = 'adblocker-rating-overlay';
    
    const extensionId = chrome.runtime.id;
    const storeLink = `https://chromewebstore.google.com/detail/${extensionId}/reviews`;
    
    overlay.innerHTML = `
      <div class="adblocker-rating-card">
        <div class="adblocker-rating-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="white"/>
          </svg>
        </div>
        <h2 class="adblocker-rating-title">Enjoying Ad-Free Streaming?</h2>
        <p class="adblocker-rating-text">Please take 10 seconds to rate us on the Chrome Web Store! Your support helps us keep the extension free and updated.</p>
        <div class="adblocker-rating-stars">
          <span class="adblocker-rating-star" data-index="1">★</span>
          <span class="adblocker-rating-star" data-index="2">★</span>
          <span class="adblocker-rating-star" data-index="3">★</span>
          <span class="adblocker-rating-star" data-index="4">★</span>
          <span class="adblocker-rating-star" data-index="5">★</span>
        </div>
        <div class="adblocker-rating-buttons">
          <button class="adblocker-rating-btn-primary" id="adblocker-rate-now">Rate Now</button>
          <button class="adblocker-rating-btn-secondary" id="adblocker-rate-later">Maybe Later</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Trigger transition
    setTimeout(() => overlay.classList.add('active'), 50);
    
    // Handle star interactions
    const stars = overlay.querySelectorAll('.adblocker-rating-star');
    stars.forEach(star => {
      star.addEventListener('mouseover', () => {
        const index = parseInt(star.getAttribute('data-index'));
        stars.forEach(s => {
          const sIdx = parseInt(s.getAttribute('data-index'));
          if (sIdx <= index) {
            s.classList.add('active');
          } else {
            s.classList.remove('active');
          }
        });
      });
      
      star.addEventListener('click', () => {
        chrome.storage.local.set({ hasRated: true });
        window.open(storeLink, '_blank');
        closeModal();
      });
    });
    
    // Handle click outside card to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal();
      }
    });

    const rateNowBtn = overlay.querySelector('#adblocker-rate-now');
    rateNowBtn.addEventListener('click', () => {
      chrome.storage.local.set({ hasRated: true });
      window.open(storeLink, '_blank');
      closeModal();
    });
    
    const rateLaterBtn = overlay.querySelector('#adblocker-rate-later');
    rateLaterBtn.addEventListener('click', closeModal);
    
    function closeModal() {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 300);
    }
  }

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

        // Perform proactive loader stuck checks
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
          // If video is stuck paused at currentTime === 0 (ad block freeze), check and auto-play it after 3 seconds
          checkStuckVideo(video);
          
          // If video is actively playing but loader is still visible, hide it
          if (video.currentTime > 0.5 && !video.paused) {
            hideStuckLoaders(video);
          }
        });

        // Track active time and check for rating popup
        trackActiveTime();
      }
    }, 1000); // Faster interval for responsive stuck checks

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

      // MX Player recovery: if video player container is empty, the ad blocker detection
      // may have prevented player initialization. Try to recover.
      if (isMXPlayer) {
        setTimeout(() => {
          const playerContainer = document.querySelector('#mx-video-player');
          const videoEl = document.querySelector('video');
          
          if (playerContainer && !videoEl) {
            console.log('[AdBlocker] MX Player recovery: player container empty, attempting reload...');
            
            // injected.js already handles mxAdBlockerEventTriggered bypass at page load.
            // If the player still didn't initialize, a page reload with our script
            // already in place (from document_start) should fix the timing issue.
            
            // Only reload once - use a flag to prevent infinite reload loop
            if (!sessionStorage.getItem('adBlockerReloaded')) {
              sessionStorage.setItem('adBlockerReloaded', 'true');
              window.location.reload();
            }
          }
        }, 4000);
      }
    });
  }

  init();
})();
