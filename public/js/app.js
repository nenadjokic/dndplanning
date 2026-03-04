// === CSRF Helper ===
function getCsrfToken() {
  var input = document.querySelector('input[name="_csrf"]');
  return input ? input.value : '';
}

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

// === Real-time updates via SSE ===
(function() {
  if (typeof EventSource === 'undefined') return;

  var eventSource = new EventSource('/api/events');

  eventSource.addEventListener('post-reaction', function(e) {
    var data = JSON.parse(e.data);
    var container = document.querySelector('.reaction-buttons[data-post-id="' + data.postId + '"]');
    if (!container) return;
    var likeBtn = container.querySelector('.reaction-btn[data-type="like"] .reaction-count');
    var dislikeBtn = container.querySelector('.reaction-btn[data-type="dislike"] .reaction-count');
    if (likeBtn) likeBtn.textContent = data.likes;
    if (dislikeBtn) dislikeBtn.textContent = data.dislikes;
  });

  eventSource.addEventListener('reply-reaction', function(e) {
    var data = JSON.parse(e.data);
    var container = document.querySelector('.reaction-buttons[data-reply-id="' + data.replyId + '"]');
    if (!container) return;
    var likeBtn = container.querySelector('.reaction-btn[data-type="like"] .reaction-count');
    var dislikeBtn = container.querySelector('.reaction-btn[data-type="dislike"] .reaction-count');
    if (likeBtn) likeBtn.textContent = data.likes;
    if (dislikeBtn) dislikeBtn.textContent = data.dislikes;
  });

  eventSource.addEventListener('poll-vote', function(e) {
    var data = JSON.parse(e.data);
    var container = document.querySelector('.poll-container[data-poll-id="' + data.pollId + '"]');
    if (!container) return;
    var options = container.querySelectorAll('.poll-option');
    options.forEach(function(opt) {
      var oid = parseInt(opt.getAttribute('data-option-id'));
      var info = data.options.find(function(o) { return o.id === oid; });
      if (info) {
        var pct = data.totalVotes > 0 ? Math.round((info.votes / data.totalVotes) * 100) : 0;
        opt.querySelector('.poll-option-bar').style.width = pct + '%';
        opt.querySelector('.poll-option-count').textContent = info.votes + ' (' + pct + '%)';
      }
    });
    var totalEl = container.querySelector('.poll-total');
    if (totalEl) totalEl.textContent = data.totalVotes + ' vote' + (data.totalVotes !== 1 ? 's' : '');
  });

  eventSource.onerror = function() {
    // Reconnect after 5 seconds if connection lost
    setTimeout(function() {
      eventSource.close();
      eventSource = new EventSource('/api/events');
    }, 5000);
  };
})();

// === Hamburger Menu Toggle ===
(function() {
  var btn = document.getElementById('hamburger-btn');
  var menu = document.getElementById('hamburger-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    var isOpen = menu.classList.toggle('open');
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  document.addEventListener('click', function(e) {
    if (!menu.contains(e.target) && e.target !== btn) {
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
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

// === Notifications ===
(function() {
  var bell = document.getElementById('notif-bell');
  var dropdown = document.getElementById('notif-dropdown');
  var badge = document.getElementById('notif-badge');
  var list = document.getElementById('notif-list');
  if (!bell || !dropdown) return;

  var isOpen = false;

  function formatTimeAgo(isoStr) {
    var d = new Date(isoStr + 'Z');
    var now = new Date();
    var diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function renderNotifications(data) {
    if (data.unreadCount > 0) {
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }

    if (data.notifications.length === 0) {
      list.innerHTML = '<div class="notif-empty">No notifications</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < data.notifications.length; i++) {
      var n = data.notifications[i];
      var cls = n.is_read ? '' : ' unread';
      var href = n.link || '#';
      html += '<a href="' + href + '" class="notif-item' + cls + '">' +
        n.message +
        '<span class="notif-item-time">' + formatTimeAgo(n.created_at) + '</span>' +
        '</a>';
    }
    list.innerHTML = html;
  }

  function fetchNotifications() {
    fetch('/notifications/api', { credentials: 'same-origin' })
      .then(function(res) { return res.json(); })
      .then(renderNotifications)
      .catch(function() {});
  }

  function markRead() {
    fetch('/notifications/read', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _csrf: getCsrfToken() })
    })
      .then(function() {
        badge.style.display = 'none';
        var items = list.querySelectorAll('.unread');
        items.forEach(function(el) { el.classList.remove('unread'); });
      })
      .catch(function() {});
  }

  bell.addEventListener('click', function(e) {
    e.stopPropagation();
    isOpen = !isOpen;
    dropdown.style.display = isOpen ? '' : 'none';
    bell.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen) {
      fetchNotifications();
      markRead();
    }
  });

  document.addEventListener('click', function(e) {
    if (isOpen && !dropdown.contains(e.target) && e.target !== bell) {
      isOpen = false;
      dropdown.style.display = 'none';
      bell.setAttribute('aria-expanded', 'false');
    }
  });

  // Mark All Read button
  var markAllBtn = document.getElementById('notif-mark-all-read');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      markRead();
    });
  }

  // Poll for new notifications every 30 seconds
  fetchNotifications();
  setInterval(fetchNotifications, 30000);
})();

// === @Mention Autocomplete ===
(function() {
  var allUsers = window.__allUsers;
  if (!allUsers || allUsers.length === 0) return;

  var activeEl = null;
  var dropdown = null;
  var activeIndex = -1;
  var mentionStart = -1;

  function createDropdown() {
    var el = document.createElement('div');
    el.className = 'mention-autocomplete';
    el.style.display = 'none';
    document.body.appendChild(el);
    return el;
  }

  function closeDropdown() {
    if (dropdown) {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
    }
    activeIndex = -1;
    mentionStart = -1;
  }

  function getCaretCoords(element) {
    // For textarea, create a mirror div
    if (element.tagName === 'TEXTAREA') {
      var rect = element.getBoundingClientRect();
      return {
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX
      };
    }
    // For input
    var rect = element.getBoundingClientRect();
    return {
      top: rect.bottom + window.scrollY,
      left: rect.left + window.scrollX
    };
  }

  function showDropdown(el, matches) {
    if (!dropdown) dropdown = createDropdown();
    if (matches.length === 0) {
      closeDropdown();
      return;
    }

    var coords = getCaretCoords(el);
    dropdown.style.position = 'absolute';
    dropdown.style.top = coords.top + 'px';
    dropdown.style.left = coords.left + 'px';
    dropdown.style.display = '';
    activeIndex = 0;

    var html = '';
    for (var i = 0; i < matches.length; i++) {
      html += '<div class="mention-ac-item' + (i === 0 ? ' active' : '') + '" data-username="' + matches[i] + '">@' + matches[i] + '</div>';
    }
    dropdown.innerHTML = html;

    // Click handlers
    var items = dropdown.querySelectorAll('.mention-ac-item');
    items.forEach(function(item) {
      item.addEventListener('mousedown', function(e) {
        e.preventDefault();
        selectMention(el, item.getAttribute('data-username'));
      });
    });
  }

  function selectMention(el, username) {
    var val = el.value;
    var before = val.substring(0, mentionStart);
    var after = val.substring(el.selectionStart);
    el.value = before + '@' + username + ' ' + after;
    var newPos = before.length + username.length + 2;
    el.setSelectionRange(newPos, newPos);
    el.focus();
    closeDropdown();
  }

  function handleInput(e) {
    var el = e.target;
    var val = el.value;
    var pos = el.selectionStart;

    // Find @ before cursor
    var textBefore = val.substring(0, pos);
    var atIdx = textBefore.lastIndexOf('@');
    if (atIdx === -1) {
      closeDropdown();
      return;
    }

    // Check that @ is at start or preceded by whitespace
    if (atIdx > 0 && !/\s/.test(textBefore.charAt(atIdx - 1))) {
      closeDropdown();
      return;
    }

    var query = textBefore.substring(atIdx + 1);
    // If query contains space, close
    if (/\s/.test(query)) {
      closeDropdown();
      return;
    }

    mentionStart = atIdx;
    activeEl = el;

    var matches = allUsers.filter(function(u) {
      return u.toLowerCase().indexOf(query.toLowerCase()) === 0;
    }).slice(0, 5);

    showDropdown(el, matches);
  }

  function handleKeydown(e) {
    if (!dropdown || dropdown.style.display === 'none') return;
    var items = dropdown.querySelectorAll('.mention-ac-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[activeIndex].classList.remove('active');
      activeIndex = (activeIndex + 1) % items.length;
      items[activeIndex].classList.add('active');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[activeIndex].classList.remove('active');
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      items[activeIndex].classList.add('active');
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (activeIndex >= 0 && activeIndex < items.length) {
        e.preventDefault();
        selectMention(e.target, items[activeIndex].getAttribute('data-username'));
      }
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  }

  document.addEventListener('input', function(e) {
    if (e.target.classList && e.target.classList.contains('mention-input')) {
      handleInput(e);
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.target.classList && e.target.classList.contains('mention-input')) {
      handleKeydown(e);
    }
  });

  document.addEventListener('click', function(e) {
    if (dropdown && !dropdown.contains(e.target)) {
      closeDropdown();
    }
  });
})();

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
        '<input type="text" class="datetime-input" placeholder="Select date & time..." readonly required>' +
        '<input type="hidden" name="slot_dates_date">' +
        '<input type="hidden" name="slot_dates_time">' +
        '<input type="text" name="slot_labels" placeholder="Label (optional, e.g. Evening)">' +
        '<button type="button" class="btn btn-small btn-danger remove-slot" title="Remove slot">&times;</button>' +
        '<div class="slot-unavail-warning"></div>';
      slotsContainer.appendChild(row);

      // Initialize datetime picker for the new input
      var datetimeInput = row.querySelector('.datetime-input');
      if (window.DateTimePicker) {
        new window.DateTimePicker(datetimeInput);
      }
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

// === Active Players Heartbeat ===
(function() {
  var container = document.getElementById('active-players');
  if (!container) return;

  var lastDiceRollAt = null;
  var heartbeatStart = {};  // username -> first consecutive heartbeat time

  function formatDuration(ms) {
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    return h + 'h';
  }

  function renderPlayers(players) {
    var now = new Date();
    var html = '';
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      var hb = new Date(p.last_heartbeat + 'Z');
      var elapsed = now - hb;
      var isAway = elapsed > 60000; // >60s = away

      // Track first consecutive heartbeat for duration
      if (!heartbeatStart[p.username]) {
        heartbeatStart[p.username] = now.getTime();
      }
      var duration = now.getTime() - heartbeatStart[p.username];

      var cls = 'footer-player' + (isAway ? ' away' : '');
      var avatarHtml;
      if (p.avatar) {
        avatarHtml = '<img src="/avatars/' + p.avatar + '" class="footer-player-avatar" alt="">';
      } else {
        avatarHtml = '<span class="footer-player-letter">' + p.username.charAt(0).toUpperCase() + '</span>';
      }

      var statusHtml = isAway ? '<span class="footer-player-status">away</span>' : '<span class="footer-player-status">' + formatDuration(duration) + '</span>';

      html += '<div class="' + cls + '">' + avatarHtml + '<span class="footer-player-name">' + p.username + '</span>' + statusHtml + '</div>';
    }

    // Clean up stale entries from heartbeatStart
    var activeNames = {};
    for (var j = 0; j < players.length; j++) activeNames[players[j].username] = true;
    for (var name in heartbeatStart) {
      if (!activeNames[name]) delete heartbeatStart[name];
    }

    container.innerHTML = html;
  }

  function sendHeartbeat() {
    fetch('/api/dice/presence/heartbeat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _csrf: getCsrfToken() })
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.players) renderPlayers(data.players);
      if (data.lastDiceRollAt && data.lastDiceRollAt !== lastDiceRollAt) {
        var isFirst = lastDiceRollAt === null;
        lastDiceRollAt = data.lastDiceRollAt;
        if (!isFirst) {
          document.dispatchEvent(new CustomEvent('dice-history-update'));
        }
      }
    }).catch(function() {});
  }

  sendHeartbeat();
  setInterval(sendHeartbeat, 15000);
})();

// === Reactions (Like/Dislike) ===
(function() {
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.reaction-btn');
    if (!btn) return;

    var container = btn.closest('.reaction-buttons');
    var postId = container.getAttribute('data-post-id');
    var replyId = container.getAttribute('data-reply-id');
    var sessionId = container.getAttribute('data-session-id');
    var reactionType = btn.getAttribute('data-type');

    var url;
    if (sessionId) {
      // Session comments
      url = postId
        ? '/sessions/' + sessionId + '/comment/' + postId + '/react'
        : '/sessions/' + sessionId + '/reply/' + replyId + '/react';
    } else {
      // Bulletin board
      url = postId ? '/board/' + postId + '/react' : '/board/reply/' + replyId + '/react';
    }

    fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emoji: reactionType,
        _csrf: getCsrfToken()
      })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      // Update UI
      var btns = container.querySelectorAll('.reaction-btn');
      btns.forEach(function(b) {
        b.classList.remove('active');
        var type = b.getAttribute('data-type');
        var count = b.querySelector('.reaction-count');
        if (type === 'like') count.textContent = data.likes;
        else count.textContent = data.dislikes;
        if (data.userReaction === type) b.classList.add('active');
      });
    })
    .catch(function() {});
  });
})();

// === Polls ===
(function() {
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.poll-option');
    if (!btn) return;

    var container = btn.closest('.poll-container');
    var pollId = container.getAttribute('data-poll-id');
    var sessionId = container.getAttribute('data-session-id');
    var optionId = btn.getAttribute('data-option-id');

    var url = sessionId
      ? '/sessions/' + sessionId + '/poll/' + pollId + '/vote'
      : '/board/poll/' + pollId + '/vote';

    fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        option_id: optionId,
        _csrf: getCsrfToken()
      })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      // Update UI
      var options = container.querySelectorAll('.poll-option');
      options.forEach(function(opt) {
        var oid = parseInt(opt.getAttribute('data-option-id'));
        var info = data.options.find(function(o) { return o.id === oid; });
        if (info) {
          var pct = data.totalVotes > 0 ? Math.round((info.votes / data.totalVotes) * 100) : 0;
          opt.querySelector('.poll-option-bar').style.width = pct + '%';
          opt.querySelector('.poll-option-count').textContent = info.votes + ' (' + pct + '%)';
        }
        opt.classList.toggle('selected', oid === data.userVote);
      });
      container.querySelector('.poll-total').textContent = data.totalVotes + ' vote' + (data.totalVotes !== 1 ? 's' : '');
    })
    .catch(function() {});
  });
})();

// Note: checkForUpdate() and performAppUpdate() are defined in admin/users.ejs
// They use Server-Sent Events for real-time progress updates

// === Activity Feed (Toast Notifications) ===
(function() {
  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function showActivity(message, link) {
    // Show as toast notification (info type, 4 seconds)
    if (window.Toast) {
      // Strip HTML tags for toast message
      var tempDiv = document.createElement('div');
      tempDiv.innerHTML = message;
      var plainText = tempDiv.textContent || tempDiv.innerText || '';
      window.Toast.info(plainText, 4000);
    }
  }

  // Listen to SSE events
  if (typeof EventSource === 'undefined') return;

  var eventSource = new EventSource('/api/events');

  eventSource.addEventListener('new-comment', function(e) {
    var data = JSON.parse(e.data);
    var msg = '<strong>' + escapeHtml(data.username) + '</strong> commented';
    if (data.sessionTitle) {
      msg += ' on "<strong>' + escapeHtml(data.sessionTitle) + '</strong>"';
    }
    if (data.content) {
      msg += ': "' + escapeHtml(data.content.substring(0, 100)) + (data.content.length > 100 ? '..."' : '"');
    }
    var link = data.sessionId ? '/sessions/' + data.sessionId : '/board';
    showActivity(msg, link);
  });

  eventSource.addEventListener('new-session', function(e) {
    var data = JSON.parse(e.data);
    var msg = '<strong>' + escapeHtml(data.username) + '</strong> created session: "<strong>' + escapeHtml(data.title) + '</strong>"';
    showActivity(msg, data.sessionId ? '/sessions/' + data.sessionId : null);
  });

  eventSource.addEventListener('new-map', function(e) {
    var data = JSON.parse(e.data);
    var msg = '<strong>' + escapeHtml(data.username) + '</strong> uploaded map: "<strong>' + escapeHtml(data.name) + '</strong>"';
    showActivity(msg, data.mapId ? '/map/' + data.mapId : '/map');
  });

  eventSource.addEventListener('new-loot', function(e) {
    var data = JSON.parse(e.data);
    var msg = '<strong>' + escapeHtml(data.username) + '</strong> added';
    if (data.itemName) {
      msg += ' "<strong>' + escapeHtml(data.itemName) + '</strong>"';
    } else {
      msg += ' items';
    }
    msg += ' to party loot';
    showActivity(msg, '/loot');
  });

  eventSource.addEventListener('handout-reveal', function(e) {
    var data = JSON.parse(e.data);
    var msg = 'DM shared a handout: "<strong>' + escapeHtml(data.title) + '</strong>"';
    showActivity(msg, '/handouts');

    // Build popup content
    var overlay = document.getElementById('handout-reveal-overlay');
    var title = document.getElementById('handout-reveal-title');
    var body = document.getElementById('handout-reveal-body');
    if (!overlay || !title || !body) return;

    title.textContent = data.title;
    body.innerHTML = '';

    if (data.type === 'image' && data.image_path) {
      var img = document.createElement('img');
      img.src = '/uploads/handouts/' + data.image_path;
      img.alt = data.title;
      img.className = 'handout-reveal-img';
      body.appendChild(img);
    } else if (data.content) {
      var textDiv = document.createElement('div');
      textDiv.className = 'handout-reveal-text';
      textDiv.textContent = data.content;
      body.appendChild(textDiv);
    }

    overlay.style.display = 'flex';
    document.getElementById('handout-reveal-close').focus();

    function dismissPopup() {
      overlay.style.display = 'none';
      body.innerHTML = '';
    }
    document.getElementById('handout-reveal-close').onclick = dismissPopup;
    document.getElementById('handout-reveal-dismiss').onclick = dismissPopup;
    overlay.querySelector('.handout-reveal-backdrop').onclick = dismissPopup;

    var escHandler = function(ev) {
      if (ev.key === 'Escape') {
        dismissPopup();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  });

  eventSource.addEventListener('session-confirmed', function(e) {
    var data = JSON.parse(e.data);
    var msg = '<strong>' + escapeHtml(data.username) + '</strong> confirmed session: "<strong>' + escapeHtml(data.sessionTitle) + '</strong>"';
    showActivity(msg, data.sessionId ? '/sessions/' + data.sessionId : null);
  });

  eventSource.addEventListener('session-cancelled', function(e) {
    var data = JSON.parse(e.data);
    var msg = '<strong>' + escapeHtml(data.username) + '</strong> cancelled session: "<strong>' + escapeHtml(data.sessionTitle) + '</strong>"';
    showActivity(msg, data.sessionId ? '/sessions/' + data.sessionId : null);
  });

  eventSource.addEventListener('poll-created', function(e) {
    var data = JSON.parse(e.data);
    var msg = '<strong>' + escapeHtml(data.username) + '</strong> created poll: "<strong>' + escapeHtml(data.question) + '</strong>"';
    showActivity(msg, data.sessionId ? '/sessions/' + data.sessionId : '/board');
  });

  eventSource.addEventListener('like-activity', function(e) {
    var data = JSON.parse(e.data);
    var msg = '<strong>' + escapeHtml(data.username) + '</strong> liked';
    if (data.sessionTitle) {
      msg += ' a comment on "<strong>' + escapeHtml(data.sessionTitle) + '</strong>"';
    } else {
      msg += ' a post';
    }
    var link = data.sessionId ? '/sessions/' + data.sessionId : '/board';
    showActivity(msg, link);
  });

  eventSource.addEventListener('quest-reveal', function(e) {
    var data = JSON.parse(e.data);
    var msg = 'New quest posted: "<strong>' + escapeHtml(data.title) + '</strong>"';
    showActivity(msg, '/quests');
    if (window.Toast) {
      window.Toast.info('New quest: ' + data.title, 6000);
    }
  });

  eventSource.addEventListener('quest-update', function(e) {
    // Refresh if on quest board page
    if (window.location.pathname === '/quests') {
      location.reload();
    }
  });

  eventSource.addEventListener('unavailability-added', function(e) {
    var data = JSON.parse(e.data);
    var msg = '<strong>' + escapeHtml(data.username) + '</strong> added unavailability';
    if (data.date) {
      msg += ' on <strong>' + data.date + '</strong>';
    }
    showActivity(msg, '/profile');
  });

  eventSource.onerror = function() {
    setTimeout(function() {
      eventSource.close();
      eventSource = new EventSource('/api/events');
    }, 5000);
  };
})();

// === Sound Panel (Popup + Set as Default) ===
(function() {
  var panel = document.getElementById('sound-panel');
  var closeBtn = document.getElementById('sound-panel-close');
  var dragHandle = document.getElementById('sound-panel-drag');
  if (!panel) return;

  var isOpen = false;
  var soundWindow = null;
  var currentUrl = null;
  var nowPlayingEl = document.getElementById('sound-now-playing');
  var nowNameEl = document.getElementById('sound-now-name');
  var focusBtn = document.getElementById('sound-now-focus');
  var csrfToken = panel.getAttribute('data-csrf');

  var knownSites = {
    'https://tabletopy.com': 'Tabletopy',
    'https://tabletopaudio.com': 'Tabletop Audio',
    'https://rpg.ambient-mixer.com': 'Ambient Mixer',
    'https://mynoise.net': 'myNoise'
  };

  function getSiteName(url) {
    for (var key in knownSites) {
      if (url.indexOf(key) === 0) return knownSites[key];
    }
    try { return new URL(url).hostname; } catch(e) { return 'Custom'; }
  }

  function updateNowPlaying() {
    if (soundWindow && !soundWindow.closed && currentUrl) {
      nowPlayingEl.style.display = 'flex';
      nowNameEl.textContent = getSiteName(currentUrl);
    } else {
      nowPlayingEl.style.display = 'none';
      currentUrl = null;
    }
  }

  function openSoundSite(url, name) {
    if (soundWindow && !soundWindow.closed) {
      soundWindow.location.href = url;
      soundWindow.focus();
    } else {
      soundWindow = window.open(url, 'QuestPlannerSound', 'width=500,height=700,menubar=no,toolbar=no,location=yes,status=no');
    }
    currentUrl = url;
    updateNowPlaying();
  }

  function updateDefaultStars() {
    var currentDefault = panel.getAttribute('data-sound-default') || '';
    document.querySelectorAll('.sound-site-btn').forEach(function(btn) {
      var star = btn.querySelector('.sound-set-default');
      if (star) {
        star.classList.toggle('active', btn.getAttribute('data-url') === currentDefault);
      }
    });
  }

  function setDefault(url) {
    var body = { sound_default: url || '' };
    if (csrfToken) body._csrf = csrfToken;
    fetch('/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.success) {
        panel.setAttribute('data-sound-default', url || '');
        updateDefaultStars();
        if (url) {
          if (window.Toast) window.Toast.info('Default: ' + getSiteName(url), 3000);
        } else {
          if (window.Toast) window.Toast.info('Default cleared', 3000);
        }
      }
    });
  }

  function toggleSoundPanel() {
    isOpen = !isOpen;
    panel.style.display = isOpen ? 'flex' : 'none';
    localStorage.setItem('sound-panel-open', isOpen ? '1' : '0');
    var navBtn = document.getElementById('nav-sound-btn');
    if (navBtn) navBtn.classList.toggle('active', isOpen);

    if (isOpen) {
      updateNowPlaying();
      // Auto-open default site if no window is already open
      var defaultUrl = panel.getAttribute('data-sound-default');
      if (defaultUrl && (!soundWindow || soundWindow.closed)) {
        openSoundSite(defaultUrl);
      }
    }
  }

  // Check for closed window periodically
  setInterval(function() {
    if (isOpen) updateNowPlaying();
  }, 2000);

  // Site buttons — click opens popup, star sets default
  document.querySelectorAll('.sound-site-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      if (e.target.closest('.sound-set-default')) {
        e.stopPropagation();
        e.preventDefault();
        var url = btn.getAttribute('data-url');
        var currentDefault = panel.getAttribute('data-sound-default');
        setDefault(currentDefault === url ? '' : url);
        return;
      }
      openSoundSite(btn.getAttribute('data-url'), btn.getAttribute('data-name'));
    });
  });

  // Custom URL open
  var customOpenBtn = document.getElementById('sound-custom-open');
  var customUrlInput = document.getElementById('sound-custom-url');
  if (customOpenBtn && customUrlInput) {
    customOpenBtn.addEventListener('click', function() {
      var url = customUrlInput.value.trim();
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        openSoundSite(url, 'Custom');
      }
    });
  }

  // Custom URL set default
  var customDefaultBtn = document.getElementById('sound-custom-default');
  if (customDefaultBtn && customUrlInput) {
    customDefaultBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var url = customUrlInput.value.trim();
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        setDefault(url);
      }
    });
  }

  // Focus button — bring popup to front
  if (focusBtn) {
    focusBtn.addEventListener('click', function() {
      if (soundWindow && !soundWindow.closed) soundWindow.focus();
    });
  }

  // Restore state on load
  var savedOpen = localStorage.getItem('sound-panel-open');
  if (savedOpen === '1') {
    toggleSoundPanel();
  }

  // Restore position
  var savedPos = localStorage.getItem('sound-panel-pos');
  if (savedPos) {
    try {
      var pos = JSON.parse(savedPos);
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
      panel.style.top = pos.top + 'px';
      panel.style.left = pos.left + 'px';
    } catch(e) {}
  }

  updateDefaultStars();

  // Nav button
  var navBtn = document.getElementById('nav-sound-btn');
  if (navBtn) navBtn.addEventListener('click', toggleSoundPanel);

  // Close button
  if (closeBtn) closeBtn.addEventListener('click', toggleSoundPanel);

  // Map toolbar sound buttons
  var mapSoundBtn = document.getElementById('map-sound-btn');
  if (mapSoundBtn) mapSoundBtn.addEventListener('click', toggleSoundPanel);
  var fsSoundBtn = document.getElementById('fs-sound-btn');
  if (fsSoundBtn) fsSoundBtn.addEventListener('click', toggleSoundPanel);

  // Make globally accessible
  window.toggleSoundPanel = toggleSoundPanel;

  // Draggable
  if (dragHandle) {
    var dragging = false, dragOffX = 0, dragOffY = 0;
    dragHandle.addEventListener('mousedown', function(e) {
      if (e.target.closest('.sound-panel-close')) return;
      dragging = true;
      var rect = panel.getBoundingClientRect();
      dragOffX = e.clientX - rect.left;
      dragOffY = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      var x = e.clientX - dragOffX;
      var y = e.clientY - dragOffY;
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
      panel.style.left = Math.max(0, x) + 'px';
      panel.style.top = Math.max(0, y) + 'px';
    });
    document.addEventListener('mouseup', function() {
      if (dragging) {
        dragging = false;
        localStorage.setItem('sound-panel-pos', JSON.stringify({
          top: parseInt(panel.style.top),
          left: parseInt(panel.style.left)
        }));
      }
    });
  }

})();

// === Toggle Share Menu ===
function toggleShareMenu(sessionId) {
  var menu = document.getElementById('share-menu-' + sessionId);
  if (menu.style.display === 'none' || menu.style.display === '') {
    menu.style.display = 'flex';
  } else {
    menu.style.display = 'none';
  }
}

// Close share menu when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.share-main-btn') && !e.target.closest('.share-menu')) {
    var menus = document.querySelectorAll('.share-menu');
    menus.forEach(function(menu) {
      menu.style.display = 'none';
    });
  }
});

// === Share Session ===
function shareSession(platform, sessionId, sessionTitle) {
  var url = window.location.origin + '/sessions/' + sessionId;
  var message = 'Vote for date and time for the next session: ' + sessionTitle;
  var encodedMessage = encodeURIComponent(message);
  var encodedUrl = encodeURIComponent(url);
  var encodedFullMessage = encodeURIComponent(message + '\n' + url);

  var shareUrl;

  switch(platform) {
    case 'whatsapp':
      // WhatsApp uses text parameter
      shareUrl = 'https://wa.me/?text=' + encodedFullMessage;
      window.open(shareUrl, '_blank');
      break;

    case 'viber':
      // Viber uses viber:// protocol
      shareUrl = 'viber://forward?text=' + encodedFullMessage;
      window.location.href = shareUrl;
      break;

    case 'telegram':
      // Telegram uses url and text parameters
      shareUrl = 'https://t.me/share/url?url=' + encodedUrl + '&text=' + encodedMessage;
      window.open(shareUrl, '_blank');
      break;

    case 'discord':
      // Discord doesn't have direct share URL, copy to clipboard instead
      copyToClipboard(message + '\n' + url);
      if (window.Toast) {
        window.Toast.success('Link copied to clipboard! Paste it in Discord.');
      } else {
        alert('Link copied to clipboard! Paste it in Discord.');
      }
      break;

    case 'email':
      // Email using mailto
      var subject = encodeURIComponent('Quest Planner - ' + sessionTitle);
      var body = encodeURIComponent(message + '\n\n' + url);
      shareUrl = 'mailto:?subject=' + subject + '&body=' + body;
      window.location.href = shareUrl;
      break;

    case 'copy':
      // Copy link to clipboard
      copyToClipboard(message + '\n' + url);
      if (window.Toast) {
        window.Toast.success('Link copied to clipboard!');
      } else {
        alert('Link copied to clipboard!');
      }
      break;
  }
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(function() {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  var textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } catch (e) {
    console.error('Failed to copy', e);
  }
  document.body.removeChild(textarea);
}
