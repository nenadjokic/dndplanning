/**
 * Premium Toast Notification System for Quest Planner
 * Medieval-themed, auto-dismiss, stacked notifications
 */

(function() {
  'use strict';

  const MAX_TOASTS = 3;
  const DURATIONS = {
    success: 3000,
    error: 5000,
    info: 4000
  };

  const ICONS = {
    success: '✓',
    error: '✕',
    info: 'ℹ'
  };

  let toastContainer = null;
  let activeToasts = [];

  // Initialize toast container
  function initToastContainer() {
    if (toastContainer) return;

    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  /**
   * Show a toast notification
   * @param {string} message - The message to display
   * @param {string} type - 'success', 'error', or 'info'
   * @param {number} duration - Auto-dismiss duration in ms (optional)
   */
  function showToast(message, type = 'info', duration = null) {
    initToastContainer();

    // Remove oldest toast if at max capacity
    if (activeToasts.length >= MAX_TOASTS) {
      const oldest = activeToasts.shift();
      removeToast(oldest, true);
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = ICONS[type] || ICONS.info;

    const messageEl = document.createElement('span');
    messageEl.className = 'toast-message';
    messageEl.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Close notification');
    closeBtn.onclick = () => removeToast(toast);

    toast.appendChild(icon);
    toast.appendChild(messageEl);
    toast.appendChild(closeBtn);

    toastContainer.appendChild(toast);
    activeToasts.push(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('toast-visible'), 10);

    // Auto-dismiss
    const dismissDuration = duration || DURATIONS[type] || DURATIONS.info;
    toast.dismissTimeout = setTimeout(() => removeToast(toast), dismissDuration);

    return toast;
  }

  /**
   * Remove a toast notification
   * @param {HTMLElement} toast - The toast element to remove
   * @param {boolean} immediate - Skip animation and remove immediately
   */
  function removeToast(toast, immediate = false) {
    if (!toast || !toast.parentNode) return;

    clearTimeout(toast.dismissTimeout);

    const index = activeToasts.indexOf(toast);
    if (index > -1) {
      activeToasts.splice(index, 1);
    }

    if (immediate) {
      toast.remove();
    } else {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 300);
    }
  }

  /**
   * Show success toast
   */
  function success(message, duration) {
    return showToast(message, 'success', duration);
  }

  /**
   * Show error toast
   */
  function error(message, duration) {
    return showToast(message, 'error', duration);
  }

  /**
   * Show info toast
   */
  function info(message, duration) {
    return showToast(message, 'info', duration);
  }

  // Export to window
  window.Toast = {
    show: showToast,
    success: success,
    error: error,
    info: info,
    remove: removeToast
  };

  // Auto-show flash messages on page load
  document.addEventListener('DOMContentLoaded', function() {
    const flashSuccess = document.querySelector('meta[name="flash-success"]');
    const flashError = document.querySelector('meta[name="flash-error"]');
    const flashInfo = document.querySelector('meta[name="flash-info"]');

    if (flashSuccess) {
      success(flashSuccess.getAttribute('content'));
    }
    if (flashError) {
      error(flashError.getAttribute('content'));
    }
    if (flashInfo) {
      info(flashInfo.getAttribute('content'));
    }
  });

})();
