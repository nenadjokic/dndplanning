/**
 * Hamburger Menu - Collapsible Groups
 * Phase 4.1 Enhancement
 */

(function() {
  'use strict';

  // Initialize collapsible groups
  function initCollapsibleGroups() {
    const toggleButtons = document.querySelectorAll('.hamburger-group-toggle');

    toggleButtons.forEach(button => {
      button.addEventListener('click', function(e) {
        e.stopPropagation();

        const groupName = this.dataset.group;
        const content = document.querySelector(`[data-group-content="${groupName}"]`);

        if (!content) return;

        // Toggle open class
        const isOpen = this.classList.contains('open');

        if (isOpen) {
          // Close
          this.classList.remove('open');
          content.classList.remove('open');
        } else {
          // Open
          this.classList.add('open');
          content.classList.add('open');
        }

        // Save state to localStorage
        const openGroups = getOpenGroups();
        if (isOpen) {
          // Remove from open groups
          const index = openGroups.indexOf(groupName);
          if (index > -1) openGroups.splice(index, 1);
        } else {
          // Add to open groups
          if (!openGroups.includes(groupName)) {
            openGroups.push(groupName);
          }
        }
        localStorage.setItem('hamburgerOpenGroups', JSON.stringify(openGroups));
      });
    });
  }

  // Get open groups from localStorage
  function getOpenGroups() {
    try {
      const stored = localStorage.getItem('hamburgerOpenGroups');
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  }

  // Restore open groups from localStorage
  function restoreOpenGroups() {
    const openGroups = getOpenGroups();

    openGroups.forEach(groupName => {
      const toggle = document.querySelector(`[data-group="${groupName}"]`);
      const content = document.querySelector(`[data-group-content="${groupName}"]`);

      if (toggle && content) {
        toggle.classList.add('open');
        content.classList.add('open');
      }
    });
  }

  // Initialize on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', function() {
    initCollapsibleGroups();
    restoreOpenGroups();
  });

})();
