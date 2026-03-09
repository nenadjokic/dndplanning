'use strict';

/**
 * Notifier — central event bus for session notifications.
 * Messaging addons (Discord Bot, Telegram, Viber) register their handlers here.
 * Core routes call notifier.send(type, data) once; all registered addons receive it.
 */
class Notifier {
  constructor() {
    this._handlers = new Map();
  }

  register(name, handler) {
    this._handlers.set(name, handler);
    console.log(`[Notifier] ${name} registered`);
  }

  unregister(name) {
    this._handlers.delete(name);
    console.log(`[Notifier] ${name} unregistered`);
  }

  async send(type, data) {
    for (const [name, handler] of this._handlers) {
      try {
        await handler(type, data);
      } catch (err) {
        console.error(`[Notifier] ${name} failed for ${type}:`, err.message);
      }
    }
  }
}

module.exports = new Notifier();
