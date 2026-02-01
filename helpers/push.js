const webpush = require('web-push');
const db = require('../db/connection');

class PushService {
  constructor() {
    this._configured = false;
    this._configure();
  }

  _configure() {
    try {
      const vapid = db.prepare('SELECT * FROM vapid_config WHERE id = 1').get();
      if (vapid) {
        const notifConfig = db.prepare('SELECT public_url FROM notification_config WHERE id = 1').get();
        const subject = (notifConfig && notifConfig.public_url) ? notifConfig.public_url : 'mailto:questplanner@example.com';
        webpush.setVapidDetails(subject, vapid.public_key, vapid.private_key);
        this._configured = true;
      }
    } catch (e) {
      console.error('[Push] Failed to configure:', e.message);
    }
  }

  getPublicKey() {
    const vapid = db.prepare('SELECT public_key FROM vapid_config WHERE id = 1').get();
    return vapid ? vapid.public_key : null;
  }

  subscribe(userId, subscription) {
    db.prepare(`
      INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth)
      VALUES (?, ?, ?, ?)
    `).run(userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth);
  }

  unsubscribe(endpoint) {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }

  async sendToAll(title, body, url) {
    if (!this._configured) return;

    const subs = db.prepare('SELECT * FROM push_subscriptions').all();
    const payload = JSON.stringify({ title, body, url: url || '/' });

    for (const sub of subs) {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth }
      };
      try {
        await webpush.sendNotification(pushSub, payload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired or invalid — remove it
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        } else {
          console.error('[Push] Send error:', err.message);
        }
      }
    }
  }

  async sendToUser(userId, title, body, url) {
    if (!this._configured) return;

    const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
    const payload = JSON.stringify({ title, body, url: url || '/' });

    for (const sub of subs) {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth }
      };
      try {
        await webpush.sendNotification(pushSub, payload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        }
      }
    }
  }
}

const pushService = new PushService();
module.exports = pushService;
