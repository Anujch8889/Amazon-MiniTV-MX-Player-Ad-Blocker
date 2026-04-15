/**
 * Popup Script - Handles UI interactions and state management
 */

document.addEventListener('DOMContentLoaded', () => {
  const toggleInput = document.getElementById('toggle-input');
  const statusText = document.getElementById('status-text');
  const statusBadge = document.getElementById('status-badge');
  const sessionCount = document.getElementById('session-count');
  const totalCount = document.getElementById('total-count');
  const resetBtn = document.getElementById('reset-btn');
  const shieldIcon = document.getElementById('shield-icon');
  const container = document.querySelector('.popup-container');

  // ========== LOAD INITIAL STATE ==========
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
    if (response) {
      updateUI(response.enabled !== false, response.sessionBlocked || 0, response.totalBlocked || 0);
    }
  });

  // ========== TOGGLE HANDLER ==========
  toggleInput.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: 'TOGGLE_BLOCKER' }, (response) => {
      if (response) {
        updateUI(response.enabled);
      }
    });
  });

  // ========== RESET HANDLER ==========
  resetBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESET_STATS' }, (response) => {
      if (response && response.success) {
        animateCountTo(sessionCount, 0);
        // Add a small visual feedback
        resetBtn.style.color = '#2ed573';
        setTimeout(() => {
          resetBtn.style.color = '';
        }, 800);
      }
    });
  });

  // ========== UI UPDATE FUNCTION ==========
  function updateUI(enabled, session, total) {
    toggleInput.checked = enabled;

    if (enabled) {
      statusText.textContent = 'Protection Active';
      statusBadge.textContent = 'ON';
      statusBadge.className = 'toggle-status active';
      shieldIcon.classList.remove('disabled');
      container.classList.remove('disabled');
    } else {
      statusText.textContent = 'Protection Paused';
      statusBadge.textContent = 'OFF';
      statusBadge.className = 'toggle-status inactive';
      shieldIcon.classList.add('disabled');
      container.classList.add('disabled');
    }

    if (session !== undefined) {
      animateCountTo(sessionCount, session);
    }
    if (total !== undefined) {
      animateCountTo(totalCount, total);
    }
  }

  // ========== COUNT ANIMATION ==========
  function animateCountTo(element, target) {
    const current = parseInt(element.textContent) || 0;
    const diff = target - current;
    const steps = Math.min(Math.abs(diff), 20);

    if (steps === 0) {
      element.textContent = formatNumber(target);
      return;
    }

    const increment = diff / steps;
    let step = 0;

    const interval = setInterval(() => {
      step++;
      const value = Math.round(current + increment * step);
      element.textContent = formatNumber(value);

      if (step >= steps) {
        element.textContent = formatNumber(target);
        clearInterval(interval);
      }
    }, 30);
  }

  // ========== FORMAT NUMBERS ==========
  function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  // ========== AUTO-REFRESH STATS ==========
  setInterval(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      if (response) {
        const session = response.sessionBlocked || 0;
        const total = response.totalBlocked || 0;
        animateCountTo(sessionCount, session);
        animateCountTo(totalCount, total);
      }
    });
  }, 3000);
});
