/**
 * Quick Post - Smart Defaults for Session Creation
 * Phase 2 Enhancement with Premium DateTime Picker
 */

document.addEventListener('DOMContentLoaded', function() {
  // Smart DateTime Default: Next Sunday at 18:00
  function getNextSunday() {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
    const daysUntilSunday = dayOfWeek === 0 ? 7 : (7 - dayOfWeek); // If today is Sunday, get next Sunday

    const nextSunday = new Date(today);
    nextSunday.setDate(today.getDate() + daysUntilSunday);
    nextSunday.setHours(18, 0, 0, 0); // Set time to 18:00

    return nextSunday;
  }

  // Set smart datetime default for first slot
  const firstSlotInput = document.getElementById('first-slot-datetime');
  if (firstSlotInput && !firstSlotInput.value) {
    const defaultDate = getNextSunday();

    // Wait for DateTimePicker to initialize
    setTimeout(() => {
      const picker = firstSlotInput.dateTimePicker;
      if (picker) {
        picker.selectedDate = new Date(defaultDate);
        picker.viewDate = new Date(defaultDate);
        picker.selectedTime = { hour: 18, minute: 0 };
        picker.renderCalendar();
        picker.updateTimeDisplay();

        // Set display value
        firstSlotInput.value = picker.formatDisplay(picker.selectedDate, picker.selectedTime);

        // Set data attribute
        const dateStr = picker.formatDate(picker.selectedDate);
        const timeStr = picker.formatTime(picker.selectedTime);
        firstSlotInput.dataset.datetime = `${dateStr} ${timeStr}`;
      }
    }, 100);
  }

  // Smart Category Default: Last used or most frequent
  function getSmartCategory() {
    const lastCategory = localStorage.getItem('lastSessionCategory');
    return lastCategory || 'dnd';
  }

  // Set smart category default
  const categorySelect = document.getElementById('category');
  if (categorySelect) {
    categorySelect.value = getSmartCategory();
  }

  // Handle form submission
  const sessionForm = document.getElementById('session-form');
  if (sessionForm) {
    sessionForm.addEventListener('submit', function(e) {
      // Save category preference
      if (categorySelect) {
        localStorage.setItem('lastSessionCategory', categorySelect.value);
      }

      // Split datetime values into separate date and time fields
      const datetimeInputs = sessionForm.querySelectorAll('.datetime-input');
      datetimeInputs.forEach((input, index) => {
        const datetimeValue = input.dataset.datetime;
        if (datetimeValue) {
          const [date, time] = datetimeValue.split(' ');

          // Find or create corresponding hidden fields
          const row = input.closest('.slot-row');
          if (row) {
            let dateField = row.querySelector('input[name="slot_dates_date"]');
            let timeField = row.querySelector('input[name="slot_dates_time"]');

            if (!dateField) {
              dateField = document.createElement('input');
              dateField.type = 'hidden';
              dateField.name = 'slot_dates_date';
              row.appendChild(dateField);
            }

            if (!timeField) {
              timeField = document.createElement('input');
              timeField.type = 'hidden';
              timeField.name = 'slot_dates_time';
              row.appendChild(timeField);
            }

            dateField.value = date;
            timeField.value = time;
          }
        }
      });
    });
  }

  // Add visual feedback when "More Options" is expanded
  const moreOptions = document.querySelector('.more-options');
  if (moreOptions) {
    moreOptions.addEventListener('toggle', function() {
      if (this.open) {
        this.querySelector('summary').textContent = '▲ Hide Options';
      } else {
        this.querySelector('summary').textContent = '▼ More Options';
      }
    });
  }
});
