'use strict';

module.exports = {
  version: 1,
  description: 'Session Analytics — no own tables (reads from sessions, votes, etc.)',

  up(db) {
    // No tables required — Analytics reads from core tables (sessions, votes, etc.)
  },

  down(db) {
    // Nothing to drop
  }
};
