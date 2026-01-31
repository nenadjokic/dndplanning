const express = require('express');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  // Summary stats
  const totalSessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
  const completedSessions = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'completed'").get().count;
  const cancelledSessions = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'cancelled'").get().count;

  // Average players per session (based on 'available' votes for sessions that have a confirmed slot)
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

  // Sessions per month (last 12 months)
  const monthlyData = db.prepare(`
    SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
    FROM sessions
    WHERE created_at >= date('now', '-12 months')
    GROUP BY month
    ORDER BY month
  `).all();

  // Fill in missing months
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const found = monthlyData.find(m => m.month === key);
    months.push({ month: key, count: found ? found.count : 0 });
  }

  // Popular day of week (from confirmed slot dates)
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

  // Fill in all days
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = dayNames.map((name, i) => {
    const found = dayData.find(d => d.day_num === i);
    return { day: name, count: found ? found.count : 0 };
  });

  // Player attendance (% of sessions where each player voted 'available')
  const confirmedCount = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status IN ('confirmed', 'completed')").get().count;
  const attendance = db.prepare(`
    SELECT u.username, COUNT(DISTINCT s.id) as attended
    FROM users u
    JOIN votes v ON v.user_id = u.id AND v.status = 'available'
    JOIN slots sl ON v.slot_id = sl.id
    JOIN sessions s ON sl.session_id = s.id AND s.status IN ('confirmed', 'completed')
    WHERE u.role = 'player'
    GROUP BY u.id
    ORDER BY attended DESC
  `).all().map(row => ({
    username: row.username,
    attended: row.attended,
    pct: confirmedCount > 0 ? Math.round((row.attended / confirmedCount) * 100) : 0
  }));

  // Streak: consecutive weeks with at least one confirmed/completed session
  const weeklySessionDates = db.prepare(`
    SELECT DISTINCT strftime('%Y-%W', sl.date_time) as week
    FROM sessions s
    JOIN slots sl ON sl.id = s.confirmed_slot_id
    WHERE s.status IN ('confirmed', 'completed')
    ORDER BY week DESC
  `).all().map(r => r.week);

  let streak = 0;
  if (weeklySessionDates.length > 0) {
    // Get current week key
    const currentWeek = getWeekKey(new Date());
    // Check if the most recent session week is this week or last week
    const latestWeek = weeklySessionDates[0];
    const prevWeek = getWeekKey(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    if (latestWeek === currentWeek || latestWeek === prevWeek) {
      streak = 1;
      for (let i = 1; i < weeklySessionDates.length; i++) {
        // Check if weeks are consecutive (simple: adjacent in the sorted list means consecutive presence)
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
    avgPlayers,
    months,
    days,
    attendance,
    streak
  };

  res.render('analytics', { analyticsData });
});

function getWeekKey(date) {
  const d = new Date(date);
  const dayNum = d.getDay();
  d.setDate(d.getDate() - dayNum + (dayNum === 0 ? -6 : 1)); // Monday
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
