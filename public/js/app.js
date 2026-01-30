// === Live Clock ===
(function() {
  var clockEl = document.getElementById('nav-clock');
  if (!clockEl) return;
  var fmt = window.__timeFormat || '24h';
  var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function updateClock() {
    var now = new Date();
    var day = days[now.getDay()];
    var mon = months[now.getMonth()];
    var dd = now.getDate();
    var h = now.getHours();
    var m = now.getMinutes();
    var timeStr;
    if (fmt === '12h') {
      var ampm = h >= 12 ? 'PM' : 'AM';
      var h12 = h % 12 || 12;
      timeStr = h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
    } else {
      timeStr = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    }
    clockEl.textContent = day + ', ' + mon + ' ' + dd + ' ' + timeStr;
  }
  updateClock();
  setInterval(updateClock, 1000);
})();

// === Auto-theme recheck ===
(function() {
  var raw = document.documentElement.getAttribute('data-raw-theme');
  if (raw !== 'auto') return;
  setInterval(function() {
    var h = new Date().getHours();
    var theme = (h >= 6 && h < 19) ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  }, 60000);
})();

// === Time Select Populator ===
function populateTimeSelect(select) {
  var fmt = window.__timeFormat || '24h';
  select.innerHTML = '';
  for (var h = 0; h < 24; h++) {
    for (var m = 0; m < 60; m += 30) {
      var val = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
      var label;
      if (fmt === '12h') {
        var ampm = h >= 12 ? 'PM' : 'AM';
        var h12 = h % 12 || 12;
        label = h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
      } else {
        label = val;
      }
      var opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      select.appendChild(opt);
    }
  }
}

// === Unavailability Check for Slot Date Inputs ===
function checkSlotUnavailability(dateInput) {
  var data = window.__unavailData;
  if (!data) return;
  var row = dateInput.closest('.slot-row');
  if (!row) return;
  var warning = row.querySelector('.slot-unavail-warning');
  if (!warning) return;
  var val = dateInput.value;
  if (!val) {
    warning.classList.remove('visible');
    warning.textContent = '';
    return;
  }
  var matches = data.filter(function(u) { return u.date === val; });
  if (matches.length > 0) {
    var names = matches.map(function(u) {
      return u.username + (u.reason ? ' (' + u.reason + ')' : '');
    }).join(', ');
    warning.textContent = 'Unavailable: ' + names;
    warning.classList.add('visible');
  } else {
    warning.classList.remove('visible');
    warning.textContent = '';
  }
}

// === DOM Ready ===
document.addEventListener('DOMContentLoaded', function() {
  var addSlotBtn = document.getElementById('add-slot');
  var slotsContainer = document.getElementById('slots-container');

  // Populate all existing time selects
  document.querySelectorAll('.time-select').forEach(function(sel) {
    populateTimeSelect(sel);
  });

  // Wire unavailability check on existing date inputs
  document.querySelectorAll('#slots-container input[type="date"]').forEach(function(inp) {
    inp.addEventListener('change', function() { checkSlotUnavailability(inp); });
  });

  if (addSlotBtn && slotsContainer) {
    addSlotBtn.addEventListener('click', function() {
      var row = document.createElement('div');
      row.className = 'slot-row';
      row.innerHTML =
        '<input type="date" name="slot_dates_date" required>' +
        '<select name="slot_dates_time" class="time-select"></select>' +
        '<input type="text" name="slot_labels" placeholder="Label (optional, e.g. Evening)">' +
        '<button type="button" class="btn btn-small btn-danger remove-slot" title="Remove slot">&times;</button>' +
        '<div class="slot-unavail-warning"></div>';
      slotsContainer.appendChild(row);
      var sel = row.querySelector('.time-select');
      populateTimeSelect(sel);
      var dateInp = row.querySelector('input[type="date"]');
      dateInp.addEventListener('change', function() { checkSlotUnavailability(dateInp); });
    });

    slotsContainer.addEventListener('click', function(e) {
      if (e.target.classList.contains('remove-slot')) {
        var rows = slotsContainer.querySelectorAll('.slot-row');
        if (rows.length > 1) {
          e.target.closest('.slot-row').remove();
        }
      }
    });
  }

  // Auto-dismiss flash messages
  document.querySelectorAll('.flash').forEach(function(el) {
    setTimeout(function() {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.5s';
      setTimeout(function() { el.remove(); }, 500);
    }, 4000);
  });
});

// Admin: check for updates
function checkForUpdate() {
  var resultDiv = document.getElementById('update-result');
  if (!resultDiv) return;
  resultDiv.innerHTML = '<p style="color: var(--text-secondary);">Checking...</p>';

  fetch('/admin/check-update')
    .then(function(res) { return res.json(); })
    .then(function(data) {
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
          '<code style="background: var(--bg-darker); padding: 0.3rem 0.6rem; border-radius: 4px;">git pull && docker compose up -d --build</code>' +
          (data.releaseUrl ? '<br><br><a href="' + data.releaseUrl + '" target="_blank">View release notes</a>' : '') +
          '</div>';
      } else {
        resultDiv.innerHTML = '<p style="color: var(--green-light);">You are running the latest version (v' + data.currentVersion + ').</p>';
      }
    })
    .catch(function() {
      resultDiv.innerHTML = '<p style="color: var(--red-light);">Could not check for updates.</p>';
    });
}
