/**
 * Auto-Save for Settings & Profile
 * Phase 2.3 Enhancement
 */

(function() {
  'use strict';

  /**
   * Initialize auto-save for a form
   * @param {string} formId - Form element ID
   * @param {string} endpoint - POST endpoint for saving
   * @param {number} debounceMs - Debounce delay in milliseconds
   */
  function initAutoSave(formId, endpoint, debounceMs = 500) {
    const form = document.getElementById(formId);
    if (!form) return;

    let saveTimeout;
    let savingIndicator;

    // Create or get save status indicator
    function getStatusIndicator(field) {
      // For radio buttons, show one indicator per form-group (not per radio)
      if (field.type === 'radio') {
        const formGroup = field.closest('.form-group');
        if (!formGroup) return null;

        let indicator = formGroup.querySelector('.save-status');
        if (!indicator) {
          indicator = document.createElement('span');
          indicator.className = 'save-status';
          formGroup.appendChild(indicator);
        }
        return indicator;
      }

      // For other fields, add to parent element
      let indicator = field.parentElement.querySelector('.save-status');
      if (!indicator) {
        indicator = document.createElement('span');
        indicator.className = 'save-status';
        field.parentElement.appendChild(indicator);
      }
      return indicator;
    }

    // Show status (saving, saved, error)
    function showStatus(field, status, message) {
      const indicator = getStatusIndicator(field);
      indicator.className = `save-status ${status}`;

      if (status === 'saving') {
        indicator.innerHTML = '<span class="status-icon">⏳</span> Saving...';
      } else if (status === 'saved') {
        indicator.innerHTML = '<span class="status-icon">✓</span> Saved';
        setTimeout(() => {
          indicator.style.opacity = '0';
          setTimeout(() => {
            indicator.innerHTML = '';
            indicator.style.opacity = '1';
          }, 300);
        }, 2000);
      } else if (status === 'error') {
        indicator.innerHTML = '<span class="status-icon">✗</span> ' + (message || 'Error saving');
      }
    }

    // Auto-save handler
    function handleChange(event) {
      const field = event.target;

      clearTimeout(saveTimeout);
      showStatus(field, 'saving');

      saveTimeout = setTimeout(() => {
        const formData = new FormData(form);
        const urlParams = new URLSearchParams(formData);

        fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: urlParams
        })
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            showStatus(field, 'saved');

            // Apply theme change immediately (without reload)
            if (field.name === 'theme' && field.checked) {
              const theme = field.value;
              document.documentElement.setAttribute('data-raw-theme', theme);

              if (theme === 'auto') {
                const h = new Date().getHours();
                const effectiveTheme = (h >= 6 && h < 19) ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', effectiveTheme);
              } else {
                document.documentElement.setAttribute('data-theme', theme);
              }
            }
          } else {
            showStatus(field, 'error', data.message);
          }
        })
        .catch(error => {
          console.error('Auto-save error:', error);
          showStatus(field, 'error', 'Connection error');
        });
      }, debounceMs);
    }

    // Attach change listeners to form fields
    const autoSaveFields = form.querySelectorAll('input[data-autosave], select[data-autosave], textarea[data-autosave]');

    autoSaveFields.forEach(field => {
      // For text inputs and textareas, use 'input' event with debounce
      if (field.type === 'text' || field.tagName === 'TEXTAREA') {
        field.addEventListener('input', handleChange);
      }
      // For selects, checkboxes, radios, dates - use 'change' event
      else {
        field.addEventListener('change', handleChange);
      }
    });

    console.log(`[Auto-Save] Initialized for #${formId} (${autoSaveFields.length} fields)`);
  }

  // Initialize on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', function() {
    // Auto-save for Settings page
    initAutoSave('settings-form', '/settings', 500);

    // Auto-save for Profile page (if separate form exists)
    initAutoSave('profile-form', '/profile', 500);
  });

  // Export for manual initialization if needed
  window.initAutoSave = initAutoSave;
})();
