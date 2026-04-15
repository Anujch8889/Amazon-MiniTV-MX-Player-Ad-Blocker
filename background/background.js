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

    // Update badge with count
    const count = (data.sessionBlocked || 0) + 1;
    const badgeText = count > 999 ? '999+' : count.toString();
    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
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

      const sessionCount = (data.sessionBlocked || 0) + count;
      const badgeText = sessionCount > 999 ? '999+' : sessionCount.toString();
      chrome.action.setBadgeText({ text: badgeText, tabId: sender.tab?.id });
      chrome.action.setBadgeBackgroundColor({ color: '#e74c3c', tabId: sender.tab?.id });
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
