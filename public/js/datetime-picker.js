/**
 * Premium DateTime Picker for Quest Planner
 * Medieval-themed, touch-friendly, respects user time format
 */

(function() {
  'use strict';

  // Get preferences from global window variables (set by EJS)
  const timeFormat = window.__timeFormat || '24h';
  const is12Hour = timeFormat === '12h';
  const weekStart = window.__weekStart || 'monday';

  // Month names for display
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];

  // Day names - adjust order based on week start preference
  const dayNamesBase = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayNames = weekStart === 'monday'
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : dayNamesBase;

  class DateTimePicker {
    constructor(input, options = {}) {
      this.input = input;
      this.dateOnly = options.dateOnly || input.classList.contains('date-only');
      this.selectedDate = input.value ? new Date(input.value + 'T00:00:00') : null;
      this.viewDate = this.selectedDate ? new Date(this.selectedDate) : new Date();
      this.selectedTime = { hour: 18, minute: 0 }; // Default 6 PM

      // Parse existing value if present
      if (input.dataset.datetime) {
        const parts = input.dataset.datetime.split(' ');
        if (parts.length === 2) {
          this.selectedDate = new Date(parts[0] + 'T00:00:00');
          this.viewDate = new Date(this.selectedDate);
          const timeParts = parts[1].split(':');
          this.selectedTime = {
            hour: parseInt(timeParts[0], 10),
            minute: parseInt(timeParts[1], 10)
          };
        }
      }

      this.createPicker();
      this.attachEvents();
    }

    createPicker() {
      this.picker = document.createElement('div');
      this.picker.className = 'datetime-picker';
      this.picker.innerHTML = `
        <div class="datetime-picker-header">
          <button type="button" class="picker-nav" data-action="prev-month">‹</button>
          <div class="picker-month-year">
            <select class="picker-month-select"></select>
            <select class="picker-year-select"></select>
          </div>
          <button type="button" class="picker-nav" data-action="next-month">›</button>
        </div>
        <div class="datetime-picker-days-header"></div>
        <div class="datetime-picker-days"></div>
        ${!this.dateOnly ? `
        <div class="datetime-picker-time">
          <label>Time:</label>
          <div class="time-controls">
            <div class="time-input-group">
              <button type="button" class="time-btn" data-action="hour-up">▲</button>
              <input type="text" class="time-input hour-input" maxlength="2" value="18">
              <button type="button" class="time-btn" data-action="hour-down">▼</button>
            </div>
            <span class="time-separator">:</span>
            <div class="time-input-group">
              <button type="button" class="time-btn" data-action="minute-up">▲</button>
              <input type="text" class="time-input minute-input" maxlength="2" value="00">
              <button type="button" class="time-btn" data-action="minute-down">▼</button>
            </div>
            ${is12Hour ? '<select class="ampm-select"><option value="AM">AM</option><option value="PM" selected>PM</option></select>' : ''} <!-- 18:00 = 6 PM -->
          </div>
        </div>
        ` : ''}
        <div class="datetime-picker-footer">
          <button type="button" class="btn btn-outline btn-small" data-action="today">Today</button>
          <button type="button" class="btn btn-outline btn-small" data-action="clear">Clear</button>
          <button type="button" class="btn btn-primary btn-small" data-action="confirm">Set</button>
        </div>
      `;

      // Append picker to body to avoid stacking context issues
      document.body.appendChild(this.picker);
      this.picker.style.display = 'none';
      this.picker.style.position = 'fixed'; // Changed from absolute to fixed

      // Cache elements
      this.monthSelect = this.picker.querySelector('.picker-month-select');
      this.yearSelect = this.picker.querySelector('.picker-year-select');
      this.daysEl = this.picker.querySelector('.datetime-picker-days');
      this.daysHeaderEl = this.picker.querySelector('.datetime-picker-days-header');
      this.hourInput = this.picker.querySelector('.hour-input');
      this.minuteInput = this.picker.querySelector('.minute-input');
      this.ampmSelect = this.picker.querySelector('.ampm-select');

      // Populate month and year dropdowns
      this.populateMonthSelect();
      this.populateYearSelect();

      // Render initial state
      this.renderDaysHeader();
      this.renderCalendar();

      // Only update time display if not date-only mode
      if (!this.dateOnly) {
        this.updateTimeDisplay();
      }
    }

    attachEvents() {
      // Toggle picker on input click
      this.input.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });

      // Picker button actions
      this.picker.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.target.closest('[data-action]');
        if (!btn) return;

        const action = btn.dataset.action;
        switch(action) {
          case 'prev-month':
            this.viewDate.setMonth(this.viewDate.getMonth() - 1);
            this.renderCalendar();
            break;
          case 'next-month':
            this.viewDate.setMonth(this.viewDate.getMonth() + 1);
            this.renderCalendar();
            break;
          case 'today':
            this.selectToday();
            break;
          case 'clear':
            this.clear();
            break;
          case 'confirm':
            this.confirm();
            break;
          case 'hour-up':
            this.adjustTime('hour', 1);
            break;
          case 'hour-down':
            this.adjustTime('hour', -1);
            break;
          case 'minute-up':
            this.adjustTime('minute', 15);
            break;
          case 'minute-down':
            this.adjustTime('minute', -15);
            break;
        }
      });

      // Day selection
      this.daysEl.addEventListener('click', (e) => {
        const dayBtn = e.target.closest('.picker-day');
        if (!dayBtn || dayBtn.classList.contains('other-month')) return;

        const day = parseInt(dayBtn.dataset.day, 10);
        this.selectDate(day);
      });

      // Time input changes (only if not date-only mode)
      if (!this.dateOnly && this.hourInput && this.minuteInput) {
        this.hourInput.addEventListener('change', () => this.updateTimeFromInputs());
        this.minuteInput.addEventListener('change', () => this.updateTimeFromInputs());
        if (this.ampmSelect) {
          this.ampmSelect.addEventListener('change', () => this.updateTimeFromInputs());
        }
      }

      // Month and year select changes
      this.monthSelect.addEventListener('change', () => {
        this.viewDate.setMonth(parseInt(this.monthSelect.value, 10));
        this.renderCalendar();
      });

      this.yearSelect.addEventListener('change', () => {
        this.viewDate.setFullYear(parseInt(this.yearSelect.value, 10));
        this.renderCalendar();
      });

      // Close picker when clicking outside
      document.addEventListener('click', (e) => {
        if (!this.picker.contains(e.target) && e.target !== this.input) {
          this.hide();
        }
      });
    }

    populateMonthSelect() {
      this.monthSelect.innerHTML = monthNames.map((name, index) =>
        `<option value="${index}">${name}</option>`
      ).join('');
      this.monthSelect.value = this.viewDate.getMonth();
    }

    populateYearSelect() {
      const currentYear = new Date().getFullYear();
      const startYear = 1920;
      const endYear = 2100;

      let options = '';
      for (let year = startYear; year <= endYear; year++) {
        options += `<option value="${year}">${year}</option>`;
      }

      this.yearSelect.innerHTML = options;
      this.yearSelect.value = this.viewDate.getFullYear();
    }

    renderDaysHeader() {
      this.daysHeaderEl.innerHTML = dayNames.map(day =>
        `<div class="picker-day-name">${day}</div>`
      ).join('');
    }

    renderCalendar() {
      // Update month and year selects
      this.monthSelect.value = this.viewDate.getMonth();
      this.yearSelect.value = this.viewDate.getFullYear();

      const year = this.viewDate.getFullYear();
      const month = this.viewDate.getMonth();
      let firstDay = new Date(year, month, 1).getDay();

      // Adjust firstDay if week starts on Monday
      if (weekStart === 'monday') {
        firstDay = (firstDay === 0) ? 6 : firstDay - 1;
      }

      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const daysInPrevMonth = new Date(year, month, 0).getDate();

      let html = '';

      // Previous month days
      for (let i = firstDay - 1; i >= 0; i--) {
        html += `<button type="button" class="picker-day other-month">${daysInPrevMonth - i}</button>`;
      }

      // Current month days
      for (let day = 1; day <= daysInMonth; day++) {
        const isSelected = this.selectedDate &&
          this.selectedDate.getDate() === day &&
          this.selectedDate.getMonth() === month &&
          this.selectedDate.getFullYear() === year;

        const isToday = this.isToday(year, month, day);

        const classes = ['picker-day'];
        if (isSelected) classes.push('selected');
        if (isToday) classes.push('today');

        html += `<button type="button" class="${classes.join(' ')}" data-day="${day}">${day}</button>`;
      }

      // Next month days
      const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
      const remainingCells = totalCells - (firstDay + daysInMonth);
      for (let day = 1; day <= remainingCells; day++) {
        html += `<button type="button" class="picker-day other-month">${day}</button>`;
      }

      this.daysEl.innerHTML = html;
    }

    isToday(year, month, day) {
      const today = new Date();
      return today.getFullYear() === year &&
             today.getMonth() === month &&
             today.getDate() === day;
    }

    selectDate(day) {
      this.selectedDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth(), day);
      this.renderCalendar();
    }

    selectToday() {
      const today = new Date();
      this.selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      this.viewDate = new Date(this.selectedDate);
      this.renderCalendar();
    }

    updateTimeDisplay() {
      // Skip if date-only mode or inputs don't exist
      if (this.dateOnly || !this.hourInput || !this.minuteInput) {
        return;
      }

      let displayHour = this.selectedTime.hour;

      if (is12Hour) {
        const isPM = displayHour >= 12;
        displayHour = displayHour % 12 || 12;
        if (this.ampmSelect) {
          this.ampmSelect.value = isPM ? 'PM' : 'AM';
        }
      }

      this.hourInput.value = String(displayHour).padStart(2, '0');
      this.minuteInput.value = String(this.selectedTime.minute).padStart(2, '0');
    }

    updateTimeFromInputs() {
      // Skip if date-only mode or inputs don't exist
      if (this.dateOnly || !this.hourInput || !this.minuteInput) {
        return;
      }

      let hour = parseInt(this.hourInput.value, 10) || 0;
      const minute = parseInt(this.minuteInput.value, 10) || 0;

      if (is12Hour && this.ampmSelect) {
        const isPM = this.ampmSelect.value === 'PM';
        if (hour === 12) {
          hour = isPM ? 12 : 0;
        } else {
          hour = isPM ? hour + 12 : hour;
        }
      }

      // Clamp values
      hour = Math.max(0, Math.min(23, hour));
      this.selectedTime = {
        hour,
        minute: Math.max(0, Math.min(59, minute))
      };

      this.updateTimeDisplay();
    }

    adjustTime(unit, delta) {
      // Skip if date-only mode
      if (this.dateOnly) {
        return;
      }

      if (unit === 'hour') {
        this.selectedTime.hour = (this.selectedTime.hour + delta + 24) % 24;
      } else {
        this.selectedTime.minute = (this.selectedTime.minute + delta + 60) % 60;
      }
      this.updateTimeDisplay();
    }

    confirm() {
      if (!this.selectedDate) {
        if (window.Toast) {
          window.Toast.info('Please select a date');
        } else {
          alert('Please select a date');
        }
        return;
      }

      const dateStr = this.formatDate(this.selectedDate);

      if (this.dateOnly) {
        // Date-only mode: just store and display the date
        this.input.dataset.date = dateStr;
        this.input.value = this.formatDateDisplay(this.selectedDate);
      } else {
        // DateTime mode: store and display both date and time
        const timeStr = this.formatTime(this.selectedTime);
        this.input.dataset.datetime = `${dateStr} ${timeStr}`;
        this.input.value = this.formatDisplay(this.selectedDate, this.selectedTime);
      }

      this.hide();

      // Trigger change event
      this.input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    clear() {
      this.selectedDate = null;
      this.input.value = '';
      this.input.dataset.datetime = '';
      this.hide();
      this.input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    formatDate(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    formatTime(time) {
      return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
    }

    formatDisplay(date, time) {
      const dateStr = `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;

      let hour = time.hour;
      let ampm = '';

      if (is12Hour) {
        ampm = hour >= 12 ? ' PM' : ' AM';
        hour = hour % 12 || 12;
      }

      const timeStr = `${hour}:${String(time.minute).padStart(2, '0')}${ampm}`;

      return `${dateStr} at ${timeStr}`;
    }

    formatDateDisplay(date) {
      return `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    }

    show() {
      const rect = this.input.getBoundingClientRect();
      const vh = window.innerHeight;
      const isMobile = window.innerWidth <= 768;

      this.picker.style.display = 'block';

      // Let browser render so we can measure actual height
      const pickerHeight = this.picker.offsetHeight || 400;

      if (isMobile) {
        // Center vertically on mobile, CSS handles horizontal centering
        let top = Math.max(8, (vh - pickerHeight) / 2);
        this.picker.style.top = `${top}px`;
        this.picker.style.left = '50%';
      } else {
        // Desktop: position below input, flip above if no space
        let top = rect.bottom + 5;
        if (top + pickerHeight > vh - 10) {
          // Try above
          if (rect.top > pickerHeight + 10) {
            top = rect.top - pickerHeight - 5;
          } else {
            // Center in viewport
            top = Math.max(10, (vh - pickerHeight) / 2);
          }
        }
        this.picker.style.top = `${top}px`;
        this.picker.style.left = `${rect.left}px`;
      }

      setTimeout(() => this.picker.classList.add('visible'), 10);
    }

    hide() {
      this.picker.classList.remove('visible');
      setTimeout(() => this.picker.style.display = 'none', 300);
    }

    toggle() {
      if (this.picker.style.display === 'none') {
        this.show();
      } else {
        this.hide();
      }
    }
  }

  // Initialize all datetime pickers
  function initDateTimePickers() {
    // Initialize full datetime pickers
    document.querySelectorAll('.datetime-input').forEach(input => {
      if (!input.dateTimePicker) {
        input.dateTimePicker = new DateTimePicker(input);
      }
    });

    // Initialize date-only pickers
    document.querySelectorAll('.date-only').forEach(input => {
      if (!input.dateTimePicker) {
        input.dateTimePicker = new DateTimePicker(input, { dateOnly: true });
      }
    });
  }

  // Auto-initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDateTimePickers);
  } else {
    initDateTimePickers();
  }

  // Export for manual initialization
  window.DateTimePicker = DateTimePicker;
  window.initDateTimePickers = initDateTimePickers;

})();
