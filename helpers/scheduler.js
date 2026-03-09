/**
 * Auto Reminders — node-cron scheduler
 * Sends Discord/push notifications for upcoming confirmed sessions.
 * Runs every 15 minutes + 5s after startup.
 */
const cron = require('node-cron');
const db = require('../db/connection');
const notifier = require('./notifier');
const pushService = require('./push');

function checkReminders() {
  try {
    const now = new Date();

    // 24-hour reminders: sessions between 23h and 25h from now
    const from24 = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    const to24 = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);

    const sessions24h = db.prepare(`
      SELECT s.id, s.title, s.reminder_24h_sent,
        sl.date_time
      FROM sessions s
      JOIN slots sl ON s.confirmed_slot_id = sl.id
      WHERE s.status = 'confirmed'
        AND s.reminder_24h_sent = 0
        AND sl.date_time BETWEEN ? AND ?
    `).all(from24, to24);

    for (const session of sessions24h) {
      const playerList = db.prepare(`
        SELECT u.username FROM votes v
        JOIN users u ON v.user_id = u.id
        JOIN slots sl ON v.slot_id = sl.id
        WHERE sl.session_id = ? AND v.status = 'available'
      `).all(session.id).map(r => r.username);

      notifier.send('session_reminder', {
        title: session.title,
        timeUntil: '24 hours',
        playerList,
        link: '/sessions/' + session.id
      }).catch(() => {});

      pushService.sendToAll(
        'Quest Tomorrow!',
        `"${session.title}" starts in 24 hours!`,
        '/sessions/' + session.id
      ).catch(() => {});

      db.prepare('UPDATE sessions SET reminder_24h_sent = 1 WHERE id = ?').run(session.id);
      console.log(`[Scheduler] 24h reminder sent for session #${session.id}: ${session.title}`);
    }

    // 1-hour reminders: sessions between 45min and 75min from now
    const from1 = new Date(now.getTime() + 45 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    const to1 = new Date(now.getTime() + 75 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);

    const sessions1h = db.prepare(`
      SELECT s.id, s.title, s.reminder_1h_sent,
        sl.date_time
      FROM sessions s
      JOIN slots sl ON s.confirmed_slot_id = sl.id
      WHERE s.status = 'confirmed'
        AND s.reminder_1h_sent = 0
        AND sl.date_time BETWEEN ? AND ?
    `).all(from1, to1);

    for (const session of sessions1h) {
      const playerList = db.prepare(`
        SELECT u.username FROM votes v
        JOIN users u ON v.user_id = u.id
        JOIN slots sl ON v.slot_id = sl.id
        WHERE sl.session_id = ? AND v.status = 'available'
      `).all(session.id).map(r => r.username);

      notifier.send('session_reminder', {
        title: session.title,
        timeUntil: '1 hour',
        playerList,
        link: '/sessions/' + session.id
      }).catch(() => {});

      pushService.sendToAll(
        'Quest Starting Soon!',
        `"${session.title}" starts in 1 hour!`,
        '/sessions/' + session.id
      ).catch(() => {});

      db.prepare('UPDATE sessions SET reminder_1h_sent = 1 WHERE id = ?').run(session.id);
      console.log(`[Scheduler] 1h reminder sent for session #${session.id}: ${session.title}`);
    }
  } catch (err) {
    console.error('[Scheduler] Error checking reminders:', err.message);
  }
}

// Run every 15 minutes
cron.schedule('*/15 * * * *', checkReminders);

// Also run 5 seconds after startup to catch any missed reminders
setTimeout(checkReminders, 5000);

console.log('[Scheduler] Auto-reminder scheduler started (every 15 min)');

// --- Database Auto-Backup ---
const { runScheduledBackup } = require('./backup');

// Run daily at 3:00 AM
cron.schedule('0 3 * * *', () => {
  console.log('[Scheduler] Running daily database backup...');
  runScheduledBackup().catch(err => {
    console.error('[Scheduler] Backup failed:', err.message);
  });
});

console.log('[Scheduler] Database auto-backup scheduled (daily at 3:00 AM)');

module.exports = { checkReminders };
