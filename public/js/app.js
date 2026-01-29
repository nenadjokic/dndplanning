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
