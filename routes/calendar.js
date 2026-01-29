const express = require('express');
const db = require('../db/connection');
const router = express.Router();

function icalEscape(str) {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function formatICalDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function formatICalDateOnly(dateStr) {
  return dateStr.replace(/-/g, '');
}

router.get('/:token/feed.ics', (req, res) => {
  const user = db.prepare('SELECT id, username, calendar_token FROM users WHERE calendar_token = ?').get(req.params.token);

  if (!user) {
    return res.status(404).send('Calendar not found.');
  }

  // Confirmed sessions
  const sessions = db.prepare(`
    SELECT s.title, s.description, sl.date_time
    FROM sessions s
    JOIN slots sl ON s.confirmed_slot_id = sl.id
    WHERE s.status = 'confirmed'
    ORDER BY sl.date_time
  `).all();

  // User's unavailability days
  const unavailabilities = db.prepare(
    'SELECT date, reason FROM unavailability WHERE user_id = ? ORDER BY date'
  ).all(user.id);

  const now = new Date();
  const stamp = formatICalDate(now);

  let ical = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Quest Planner//D&D Sessions//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:Quest Planner - ${icalEscape(user.username)}`
  ];

  // Session events (3h duration)
  for (const s of sessions) {
    const start = new Date(s.date_time);
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
    const uid = `session-${start.getTime()}@questplanner`;

    ical.push('BEGIN:VEVENT');
    ical.push(`UID:${uid}`);
    ical.push(`DTSTAMP:${stamp}`);
    ical.push(`DTSTART:${formatICalDate(start)}`);
    ical.push(`DTEND:${formatICalDate(end)}`);
    ical.push(`SUMMARY:${icalEscape(s.title)}`);
    if (s.description) {
      ical.push(`DESCRIPTION:${icalEscape(s.description)}`);
    }
    ical.push('END:VEVENT');
  }

  // Unavailability all-day events
  for (const u of unavailabilities) {
    const dateStr = formatICalDateOnly(u.date);
    const nextDate = new Date(u.date + 'T00:00:00');
    nextDate.setDate(nextDate.getDate() + 1);
    const endStr = formatICalDateOnly(nextDate.toISOString().split('T')[0]);
    const uid = `unavail-${user.id}-${u.date}@questplanner`;

    const reason = u.reason ? `, zbog (${u.reason})` : '';
    const summary = `${user.username} ne može da igra D&D na ovaj dan${reason}`;

    ical.push('BEGIN:VEVENT');
    ical.push(`UID:${uid}`);
    ical.push(`DTSTAMP:${stamp}`);
    ical.push(`DTSTART;VALUE=DATE:${dateStr}`);
    ical.push(`DTEND;VALUE=DATE:${endStr}`);
    ical.push(`SUMMARY:${icalEscape(summary)}`);
    ical.push('END:VEVENT');
  }

  ical.push('END:VCALENDAR');

  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'inline; filename="feed.ics"');
  res.send(ical.join('\r\n'));
});

module.exports = router;
