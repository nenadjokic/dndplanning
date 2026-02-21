const express = require('express');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  // === SUMMARY STATS ===
  const totalSessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
  const completedSessions = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'completed'").get().count;
  const cancelledSessions = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'cancelled'").get().count;
  const openSessions = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'open'").get().count;

  // Average players per session
  const avgResult = db.prepare(`
    SELECT AVG(player_count) as avg_players FROM (
      SELECT s.id, COUNT(DISTINCT v.user_id) as player_count
      FROM sessions s
      JOIN slots sl ON sl.session_id = s.id
      JOIN votes v ON v.slot_id = sl.id AND v.status = 'available'
      WHERE s.status IN ('confirmed', 'completed')
      GROUP BY s.id
    )
  `).get();
  const avgPlayers = avgResult.avg_players ? avgResult.avg_players.toFixed(1) : '0';

  // Completion rate
  const finishedSessions = completedSessions + cancelledSessions;
  const completionRate = finishedSessions > 0 ? Math.round((completedSessions / finishedSessions) * 100) : 0;

  // === GUILD AGE ===
  const firstUser = db.prepare('SELECT created_at FROM users ORDER BY id ASC LIMIT 1').get();
  let guildAgeDays = 0;
  if (firstUser && firstUser.created_at) {
    guildAgeDays = Math.floor((Date.now() - new Date(firstUser.created_at).getTime()) / (1000 * 60 * 60 * 24));
  }

  // === SESSIONS PER MONTH (last 12 months) ===
  const monthlyData = db.prepare(`
    SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
    FROM sessions
    WHERE created_at >= date('now', '-12 months')
    GROUP BY month
    ORDER BY month
  `).all();

  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const found = monthlyData.find(m => m.month === key);
    months.push({ month: key, count: found ? found.count : 0 });
  }

  // === POPULAR DAY OF WEEK ===
  const dayData = db.prepare(`
    SELECT
      CASE CAST(strftime('%w', sl.date_time) AS INTEGER)
        WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue'
        WHEN 3 THEN 'Wed' WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' WHEN 6 THEN 'Sat'
      END as day_name,
      CAST(strftime('%w', sl.date_time) AS INTEGER) as day_num,
      COUNT(*) as count
    FROM sessions s
    JOIN slots sl ON sl.id = s.confirmed_slot_id
    WHERE s.status IN ('confirmed', 'completed')
    GROUP BY day_num
    ORDER BY day_num
  `).all();

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = dayNames.map((name, i) => {
    const found = dayData.find(d => d.day_num === i);
    return { day: name, count: found ? found.count : 0 };
  });

  // === SESSION CATEGORY BREAKDOWN ===
  const categoryBreakdown = db.prepare(`
    SELECT COALESCE(category, 'Uncategorized') as category, COUNT(*) as count
    FROM sessions
    GROUP BY category
    ORDER BY count DESC
  `).all();

  // === COMPLETION RATE DATA (for donut chart) ===
  const completionData = {
    completed: completedSessions,
    cancelled: cancelledSessions,
    open: openSessions
  };

  // === ATTENDANCE (all users) ===
  const confirmedCount = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status IN ('confirmed', 'completed')").get().count;
  const attendance = db.prepare(`
    SELECT u.username, COUNT(DISTINCT s.id) as attended
    FROM users u
    JOIN votes v ON v.user_id = u.id AND v.status = 'available'
    JOIN slots sl ON v.slot_id = sl.id
    JOIN sessions s ON sl.session_id = s.id AND s.status IN ('confirmed', 'completed')
    GROUP BY u.id
    ORDER BY attended DESC
  `).all().map(row => ({
    username: row.username,
    attended: row.attended,
    pct: confirmedCount > 0 ? Math.round((row.attended / confirmedCount) * 100) : 0
  }));

  // === MOST ACCEPTING (all users) ===
  const topAccepter = db.prepare(`
    SELECT u.username,
           COUNT(CASE WHEN v.status = 'available' THEN 1 END) as accepts,
           COUNT(*) as total_votes,
           ROUND(CAST(COUNT(CASE WHEN v.status = 'available' THEN 1 END) AS FLOAT) / COUNT(*) * 100) as accept_pct
    FROM users u
    JOIN votes v ON v.user_id = u.id
    GROUP BY u.id
    HAVING total_votes >= 3
    ORDER BY accept_pct DESC, accepts DESC
    LIMIT 1
  `).get();

  // === MOST DECLINING (all users) ===
  const topDecliner = db.prepare(`
    SELECT u.username,
           COUNT(CASE WHEN v.status = 'unavailable' THEN 1 END) as declines,
           COUNT(*) as total_votes,
           ROUND(CAST(COUNT(CASE WHEN v.status = 'unavailable' THEN 1 END) AS FLOAT) / COUNT(*) * 100) as decline_pct
    FROM users u
    JOIN votes v ON v.user_id = u.id
    GROUP BY u.id
    ORDER BY declines DESC
    LIMIT 1
  `).get();

  // === MOST ACTIVE (all users) ===
  const mostActive = db.prepare(`
    SELECT u.username,
           (SELECT COUNT(*) FROM posts WHERE user_id = u.id) as posts,
           (SELECT COUNT(*) FROM replies WHERE user_id = u.id) as replies,
           (SELECT COUNT(*) FROM comments WHERE user_id = u.id) as comments,
           (SELECT COUNT(*) FROM votes WHERE user_id = u.id) as votes,
           ((SELECT COUNT(*) FROM posts WHERE user_id = u.id) +
            (SELECT COUNT(*) FROM replies WHERE user_id = u.id) +
            (SELECT COUNT(*) FROM comments WHERE user_id = u.id) +
            (SELECT COUNT(*) FROM votes WHERE user_id = u.id)) as total_activity
    FROM users u
    ORDER BY total_activity DESC
    LIMIT 1
  `).get();

  // === FASTEST VOTER (avg response time per user) ===
  const fastestVoter = db.prepare(`
    SELECT u.username,
           AVG((julianday(v.created_at) - julianday(s.created_at)) * 24) as avg_hours,
           COUNT(*) as vote_count
    FROM users u
    JOIN votes v ON v.user_id = u.id
    JOIN slots sl ON v.slot_id = sl.id
    JOIN sessions s ON sl.session_id = s.id
    WHERE v.created_at IS NOT NULL AND s.created_at IS NOT NULL
      AND julianday(v.created_at) > julianday(s.created_at)
    GROUP BY u.id
    HAVING vote_count >= 3
    ORDER BY avg_hours ASC
    LIMIT 1
  `).get();

  // === AVERAGE RESPONSE TIME ===
  const avgResponseTime = db.prepare(`
    SELECT AVG(response_seconds) / 3600.0 as avg_hours
    FROM (
      SELECT s.id,
             (julianday(MIN(v.created_at)) - julianday(s.created_at)) * 86400 as response_seconds
      FROM sessions s
      JOIN slots sl ON sl.session_id = s.id
      JOIN votes v ON v.slot_id = sl.id
      WHERE s.created_at IS NOT NULL AND v.created_at IS NOT NULL
      GROUP BY s.id
      HAVING response_seconds > 0
    )
  `).get();

  // === MOST POPULAR CATEGORY ===
  const popularCategory = db.prepare(`
    SELECT category, COUNT(*) as count
    FROM sessions
    WHERE category IS NOT NULL AND category != ''
    GROUP BY category
    ORDER BY count DESC
    LIMIT 1
  `).get();

  // === LONGEST DROUGHT (max gap between consecutive sessions) ===
  const sessionDates = db.prepare(`
    SELECT sl.date_time
    FROM sessions s
    JOIN slots sl ON sl.id = s.confirmed_slot_id
    WHERE s.status IN ('confirmed', 'completed')
    ORDER BY sl.date_time ASC
  `).all();

  let longestDrought = 0;
  let droughtStart = null;
  let droughtEnd = null;
  for (let i = 1; i < sessionDates.length; i++) {
    const prev = new Date(sessionDates[i - 1].date_time);
    const curr = new Date(sessionDates[i].date_time);
    const gapDays = Math.floor((curr - prev) / (1000 * 60 * 60 * 24));
    if (gapDays > longestDrought) {
      longestDrought = gapDays;
      droughtStart = sessionDates[i - 1].date_time;
      droughtEnd = sessionDates[i].date_time;
    }
  }

  // === PLAYER VOTE HEATMAP ===
  const heatmapSessions = db.prepare(`
    SELECT s.id, s.title, sl.date_time
    FROM sessions s
    JOIN slots sl ON sl.id = s.confirmed_slot_id
    WHERE s.status IN ('confirmed', 'completed')
    ORDER BY sl.date_time DESC
    LIMIT 10
  `).all();

  const heatmapUsers = db.prepare(`
    SELECT id, username FROM users ORDER BY username ASC
  `).all();

  const heatmapVotes = {};
  if (heatmapSessions.length > 0) {
    const sessionIds = heatmapSessions.map(s => s.id);
    const placeholders = sessionIds.map(() => '?').join(',');
    const votes = db.prepare(`
      SELECT v.user_id, sl.session_id, v.status
      FROM votes v
      JOIN slots sl ON v.slot_id = sl.id
      WHERE sl.session_id IN (${placeholders})
        AND sl.id = (SELECT confirmed_slot_id FROM sessions WHERE id = sl.session_id)
    `).all(...sessionIds);

    for (const v of votes) {
      if (!heatmapVotes[v.user_id]) heatmapVotes[v.user_id] = {};
      heatmapVotes[v.user_id][v.session_id] = v.status;
    }
  }

  const heatmap = {
    sessions: heatmapSessions.map(s => ({
      id: s.id,
      title: s.title ? s.title.substring(0, 15) : 'Session',
      date: s.date_time
    })),
    users: heatmapUsers.map(u => ({
      username: u.username,
      votes: heatmapSessions.map(s => heatmapVotes[u.id] ? (heatmapVotes[u.id][s.id] || null) : null)
    })).filter(u => u.votes.some(v => v !== null))
  };

  // === BULLETIN BOARD STATS ===
  const totalPosts = db.prepare('SELECT COUNT(*) as count FROM posts WHERE session_id IS NULL').get().count;
  const totalReplies = db.prepare('SELECT COUNT(*) as count FROM replies r JOIN posts p ON r.post_id = p.id WHERE p.session_id IS NULL').get().count;

  const topPoster = db.prepare(`
    SELECT u.username, COUNT(*) as post_count
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.session_id IS NULL
    GROUP BY u.id
    ORDER BY post_count DESC
    LIMIT 1
  `).get();

  const mostRepliedTopic = db.prepare(`
    SELECT p.id, SUBSTR(p.content, 1, 50) as title,
           (SELECT COUNT(*) FROM replies WHERE post_id = p.id) as reply_count
    FROM posts p
    WHERE p.session_id IS NULL
    ORDER BY reply_count DESC
    LIMIT 1
  `).get();

  // === STREAK ===
  const weeklySessionDates = db.prepare(`
    SELECT DISTINCT strftime('%Y-%W', sl.date_time) as week
    FROM sessions s
    JOIN slots sl ON sl.id = s.confirmed_slot_id
    WHERE s.status IN ('confirmed', 'completed')
    ORDER BY week DESC
  `).all().map(r => r.week);

  let streak = 0;
  if (weeklySessionDates.length > 0) {
    const currentWeek = getWeekKey(new Date());
    const latestWeek = weeklySessionDates[0];
    const prevWeek = getWeekKey(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    if (latestWeek === currentWeek || latestWeek === prevWeek) {
      streak = 1;
      for (let i = 1; i < weeklySessionDates.length; i++) {
        const expectedPrev = getWeekKey(new Date(weekToDate(weeklySessionDates[i - 1]).getTime() - 7 * 24 * 60 * 60 * 1000));
        if (weeklySessionDates[i] === expectedPrev) {
          streak++;
        } else {
          break;
        }
      }
    }
  }

  const analyticsData = {
    totalSessions,
    completedSessions,
    cancelledSessions,
    openSessions,
    avgPlayers,
    completionRate,
    completionData,
    guildAgeDays,
    months,
    days,
    categoryBreakdown,
    attendance,
    streak,
    topAccepter: topAccepter || null,
    topDecliner: topDecliner || null,
    mostActive: mostActive || null,
    fastestVoter: fastestVoter ? { username: fastestVoter.username, avgHours: fastestVoter.avg_hours.toFixed(1) } : null,
    avgResponseTime: avgResponseTime && avgResponseTime.avg_hours ? avgResponseTime.avg_hours.toFixed(1) : null,
    popularCategory: popularCategory || null,
    longestDrought: longestDrought > 0 ? { days: longestDrought, start: droughtStart, end: droughtEnd } : null,
    heatmap,
    boardStats: {
      totalPosts,
      totalReplies,
      topPoster: topPoster || null,
      mostRepliedTopic: mostRepliedTopic && mostRepliedTopic.reply_count > 0 ? mostRepliedTopic : null
    }
  };

  res.render('analytics', { analyticsData });
});

function getWeekKey(date) {
  const d = new Date(date);
  const dayNum = d.getDay();
  d.setDate(d.getDate() - dayNum + (dayNum === 0 ? -6 : 1));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return d.getFullYear() + '-' + String(weekNum).padStart(2, '0');
}

function weekToDate(weekKey) {
  const parts = weekKey.split('-');
  const year = parseInt(parts[0], 10);
  const week = parseInt(parts[1], 10);
  const d = new Date(year, 0, 1 + (week - 1) * 7);
  const dayNum = d.getDay();
  d.setDate(d.getDate() - dayNum + (dayNum === 0 ? -6 : 1));
  return d;
}

module.exports = router;
