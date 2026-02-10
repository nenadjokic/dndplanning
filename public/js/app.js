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
    menu.classList.toggle('open');
  });

  document.addEventListener('click', function(e) {
    if (!menu.contains(e.target) && e.target !== btn) {
      menu.classList.remove('open');
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
    if (isOpen) {
      fetchNotifications();
      markRead();
    }
  });

  document.addEventListener('click', function(e) {
    if (isOpen && !dropdown.contains(e.target) && e.target !== bell) {
      isOpen = false;
      dropdown.style.display = 'none';
    }
  });

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
        reaction_type: reactionType,
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

// === Activity Feed Bar ===
(function() {
  var feedBar = document.getElementById('activity-feed-bar');
  if (!feedBar) return;

  var feedMessage = feedBar.querySelector('.activity-message');
  var hideTimeout;
  var animTimeout;

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function showActivity(message, link) {
    if (hideTimeout) clearTimeout(hideTimeout);
    if (animTimeout) clearTimeout(animTimeout);

    var content = '<span class="activity-message-inner">';
    if (link) {
      content += '<a href="' + link + '">' + message + '</a>';
    } else {
      content += message;
    }
    content += '</span>';

    feedMessage.innerHTML = content;
    feedBar.classList.remove('hidden');
    feedBar.style.opacity = '1';

    // After 20 seconds, completely hide the bar
    hideTimeout = setTimeout(function() {
      feedBar.style.opacity = '0';
      animTimeout = setTimeout(function() {
        feedBar.classList.add('hidden');
      }, 300); // Wait for fade out animation
    }, 20000);
  }

  // Start with bar hidden
  feedBar.classList.add('hidden');

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
      // Viber uses text parameter (try both methods for compatibility)
      if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        // Mobile: use viber:// protocol
        shareUrl = 'viber://forward?text=' + encodedFullMessage;
        window.location.href = shareUrl;
      } else {
        // Desktop: copy to clipboard since Viber desktop doesn't have direct share URL
        copyToClipboard(message + '\n' + url);
        alert('Link copied to clipboard! Open Viber and paste it.');
      }
      break;

    case 'telegram':
      // Telegram uses url and text parameters
      shareUrl = 'https://t.me/share/url?url=' + encodedUrl + '&text=' + encodedMessage;
      window.open(shareUrl, '_blank');
      break;

    case 'discord':
      // Discord doesn't have direct share URL, copy to clipboard instead
      copyToClipboard(message + '\n' + url);
      alert('Link copied to clipboard! Paste it in Discord.');
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
      alert('Link copied to clipboard!');
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
