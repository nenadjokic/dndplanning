/**
 * D&D Data Modals - Classes, Races, Spells, etc.
 * Shared across all pages
 */

(function() {
  'use strict';

  // === Class Modal ===

  function showClassModal(className) {
    // Remove existing modal
    var existing = document.querySelector('.dnd-modal-overlay');
    if (existing) existing.remove();

    // Create modal overlay
    var overlay = document.createElement('div');
    overlay.className = 'dnd-modal-overlay';
    overlay.innerHTML = '<div class="dnd-modal"><div class="dnd-modal-header"><h3 class="dnd-modal-title">Loading...</h3><button class="dnd-modal-close">&times;</button></div><div class="dnd-modal-body"><p>Fetching class details...</p></div></div>';

    document.body.appendChild(overlay);

    // Close on overlay click or close button
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay || e.target.classList.contains('dnd-modal-close')) {
        overlay.remove();
      }
    });

    // Close on Escape
    var escHandler = function(e) {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Search for class by name
    fetch('/api/dnd/classes?search=' + encodeURIComponent(className))
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data.results || data.results.length === 0) {
          overlay.querySelector('.dnd-modal-title').textContent = className;
          overlay.querySelector('.dnd-modal-body').innerHTML = '<p>Class not found in database.</p>';
          return;
        }

        // Get the first match (should be exact or closest)
        var classMatch = data.results[0];

        // Fetch full class details
        return fetch('/api/dnd/classes/' + classMatch.id);
      })
      .then(function(res) {
        if (!res) return; // No class found in search
        return res.json();
      })
      .then(function(cls) {
        if (!cls) return; // No class found

        var fullData = cls.full_data || {};

        overlay.querySelector('.dnd-modal-title').textContent = cls.name;

        var html = '';

        // Source header
        if (cls.source) {
          html += '<div class="dnd-source-header">📖 Source: ' + cls.source + '</div>';
        }

        // Basic info
        html += '<div class="dnd-modal-meta">';
        if (cls.hit_die) {
          html += '<span class="dnd-modal-meta-item"><strong>Hit Die:</strong> d' + cls.hit_die + '</span>';
        }
        html += '</div>';

        // Description
        if (fullData.desc && fullData.desc.length > 0) {
          html += '<div class="dnd-modal-section">';
          html += '<h4>Description</h4>';
          fullData.desc.forEach(function(p) {
            html += '<p>' + p + '</p>';
          });
          html += '</div>';
        }

        // Proficiencies
        if (fullData.prof_armor || fullData.prof_weapons || fullData.prof_tools || fullData.prof_saving_throws || fullData.prof_skills) {
          html += '<div class="dnd-modal-section">';
          html += '<h4>Proficiencies</h4>';

          if (fullData.prof_armor) {
            html += '<p><strong>Armor:</strong> ' + fullData.prof_armor + '</p>';
          }
          if (fullData.prof_weapons) {
            html += '<p><strong>Weapons:</strong> ' + fullData.prof_weapons + '</p>';
          }
          if (fullData.prof_tools) {
            html += '<p><strong>Tools:</strong> ' + fullData.prof_tools + '</p>';
          }
          if (fullData.prof_saving_throws) {
            html += '<p><strong>Saving Throws:</strong> ' + fullData.prof_saving_throws + '</p>';
          }
          if (fullData.prof_skills) {
            html += '<p><strong>Skills:</strong> ' + fullData.prof_skills + '</p>';
          }

          html += '</div>';
        }

        // Equipment
        if (fullData.equipment) {
          html += '<div class="dnd-modal-section">';
          html += '<h4>Starting Equipment</h4>';
          html += '<p>' + fullData.equipment + '</p>';
          html += '</div>';
        }

        // Spellcasting
        if (fullData.spellcasting_ability) {
          html += '<div class="dnd-modal-section">';
          html += '<h4>Spellcasting</h4>';
          html += '<p><strong>Spellcasting Ability:</strong> ' + fullData.spellcasting_ability + '</p>';
          if (fullData.spellcasting && fullData.spellcasting.length > 0) {
            fullData.spellcasting.forEach(function(p) {
              html += '<p>' + p + '</p>';
            });
          }
          html += '</div>';
        }

        // Class Features
        if (fullData.archetypes && fullData.archetypes.length > 0) {
          html += '<div class="dnd-modal-section">';
          html += '<h4>Subclasses</h4>';
          fullData.archetypes.forEach(function(arch) {
            html += '<p><strong>' + arch.name + '</strong></p>';
            if (arch.desc && arch.desc.length > 0) {
              arch.desc.forEach(function(p) {
                html += '<p class="dnd-indent">' + p + '</p>';
              });
            }
          });
          html += '</div>';
        }

        overlay.querySelector('.dnd-modal-body').innerHTML = html;
      })
      .catch(function(err) {
        console.error('Error fetching class:', err);
        overlay.querySelector('.dnd-modal-title').textContent = className;
        overlay.querySelector('.dnd-modal-body').innerHTML = '<p>Could not load class details.</p>';
      });
  }

  // === Initialize Class Links ===

  function initClassLinks() {
    // Find all elements with data-class attribute
    var classLinks = document.querySelectorAll('[data-class]');

    classLinks.forEach(function(link) {
      var className = link.getAttribute('data-class');
      if (!className) return;

      // Add clickable class for styling
      link.classList.add('dnd-class-link');

      link.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        showClassModal(className);
      });
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initClassLinks);
  } else {
    initClassLinks();
  }

  // Export for use in other scripts
  window.showClassModal = showClassModal;
  window.initClassLinks = initClassLinks;
})();
