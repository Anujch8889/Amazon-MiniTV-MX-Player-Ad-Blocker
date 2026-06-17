/**
 * Background Service Worker
 * Manages ad blocking state, tracks blocked ads count, and handles extension lifecycle
 */

// Default state
const DEFAULT_STATE = {
  enabled: true,
  totalBlocked: 0,
  sessionBlocked: 0,
  lastUpdated: Date.now()
};

// Initialize extension state on install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set(DEFAULT_STATE);
    console.log('[AdBlocker] Extension installed successfully!');
  } else if (details.reason === 'update') {
    console.log('[AdBlocker] Extension updated to version', chrome.runtime.getManifest().version);
  }

  // Set the uninstall feedback URL (must be http: or https: — mailto: is not supported)
  // Using a Google Forms link for feedback collection
  try {
    chrome.runtime.setUninstallURL('https://docs.google.com/forms/d/e/your-form-id/viewform?usp=pp_url&entry.1=%5BUninstall+Feedback%5D+Amazon+MiniTV+%26+MX+Player+Ad+Blocker');
  } catch (e) {
    console.log('[AdBlocker] Could not set uninstall URL:', e.message);
  }
});

// Track blocked requests using declarativeNetRequest feedback
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(async (info) => {
  try {
    const data = await chrome.storage.local.get(['totalBlocked', 'sessionBlocked']);
    await chrome.storage.local.set({
      totalBlocked: (data.totalBlocked || 0) + 1,
      sessionBlocked: (data.sessionBlocked || 0) + 1,
      lastUpdated: Date.now()
    });
  } catch (e) {
    // Silently handle - onRuleMatchedDebug may not be available in production
  }
});

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATE') {
    chrome.storage.local.get(null, (data) => {
      sendResponse({ ...DEFAULT_STATE, ...data });
    });
    return true; // Keep message channel open for async response
  }

  if (message.type === 'TOGGLE_BLOCKER') {
    chrome.storage.local.get(['enabled'], async (data) => {
      const newEnabled = !data.enabled;
      await chrome.storage.local.set({ enabled: newEnabled });

      // Enable/disable rules
      if (newEnabled) {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds: ['ad_block_rules']
        });
      } else {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          disableRulesetIds: ['ad_block_rules']
        });
      }

      // Notify all matching tabs
      const tabs = await chrome.tabs.query({
        url: [
          '*://*.amazon.in/*',
          '*://*.mxplayer.in/*',
          '*://*.amazonmxplayer.in/*',
          '*://*.amazonmxplayer.com/*'
        ]
      });

      for (const tab of tabs) {
        try {
          chrome.tabs.sendMessage(tab.id, {
            type: 'TOGGLE_STATE',
            enabled: newEnabled
          });
        } catch (e) {
          // Tab might not have content script loaded
        }
      }

      sendResponse({ enabled: newEnabled });
    });
    return true;
  }

  if (message.type === 'RESET_STATS') {
    chrome.storage.local.set({ sessionBlocked: 0 }, () => {
      chrome.action.setBadgeText({ text: '' });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'AD_BLOCKED_DOM') {
    // Content script reports a DOM-level ad block
    chrome.storage.local.get(['totalBlocked', 'sessionBlocked'], async (data) => {
      const count = (message.count || 1);
      await chrome.storage.local.set({
        totalBlocked: (data.totalBlocked || 0) + count,
        sessionBlocked: (data.sessionBlocked || 0) + count,
        lastUpdated: Date.now()
      });
    });
    return true;
  }
});

// Reset session count when browser starts
chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.local.set({ sessionBlocked: 0 });
  chrome.action.setBadgeText({ text: '' });
  console.log('[AdBlocker] Session started - counters reset');
});
