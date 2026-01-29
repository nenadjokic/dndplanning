// Slot picker: add/remove slot rows
document.addEventListener('DOMContentLoaded', () => {
  const addSlotBtn = document.getElementById('add-slot');
  const slotsContainer = document.getElementById('slots-container');

  if (addSlotBtn && slotsContainer) {
    addSlotBtn.addEventListener('click', () => {
      const row = document.createElement('div');
      row.className = 'slot-row';
      row.innerHTML = `
        <input type="datetime-local" name="slot_dates" required>
        <input type="text" name="slot_labels" placeholder="Label (optional, e.g. Evening)">
        <button type="button" class="btn btn-small btn-danger remove-slot" title="Remove slot">&times;</button>
      `;
      slotsContainer.appendChild(row);
    });

    slotsContainer.addEventListener('click', (e) => {
      if (e.target.classList.contains('remove-slot')) {
        const rows = slotsContainer.querySelectorAll('.slot-row');
        if (rows.length > 1) {
          e.target.closest('.slot-row').remove();
        }
      }
    });
  }

  // Auto-dismiss flash messages
  document.querySelectorAll('.flash').forEach(el => {
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.5s';
      setTimeout(() => el.remove(), 500);
    }, 4000);
  });
});

// Admin: check for updates
function checkForUpdate() {
  const resultDiv = document.getElementById('update-result');
  if (!resultDiv) return;
  resultDiv.innerHTML = '<p style="color: var(--text-secondary);">Checking...</p>';

  fetch('/admin/check-update')
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        resultDiv.innerHTML = '<p style="color: var(--red-light);">' + data.error + '</p>';
        return;
      }
      if (data.updateAvailable) {
        resultDiv.innerHTML =
          '<div class="flash flash-success">' +
          '<strong>Update available!</strong> v' + data.currentVersion + ' &rarr; v' + data.latestVersion +
          (data.releaseName ? ' &mdash; ' + data.releaseName : '') +
          '<br><br>To update, run:<br>' +
          '<code style="background: var(--bg-darker); padding: 0.3rem 0.6rem; border-radius: 4px;">docker compose pull && docker compose up -d</code>' +
          (data.releaseUrl ? '<br><br><a href="' + data.releaseUrl + '" target="_blank">View release notes</a>' : '') +
          '</div>';
      } else {
        resultDiv.innerHTML = '<p style="color: var(--green-light);">You are running the latest version (v' + data.currentVersion + ').</p>';
      }
    })
    .catch(() => {
      resultDiv.innerHTML = '<p style="color: var(--red-light);">Could not check for updates.</p>';
    });
}
