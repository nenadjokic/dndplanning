'use strict';

module.exports = {
  /**
   * Called when the addon is loaded. Reserved for future initialization.
   */
  onLoad(db) {
    // No-op for now
  },

  /**
   * Clean up all map-related data when a user is deleted.
   */
  onUserDelete(db, userId) {
    // Remove user's token assignments
    db.prepare('DELETE FROM npc_token_assignments WHERE user_id = ?').run(userId);

    // Remove user's player tokens from all maps
    db.prepare(`
      DELETE FROM token_conditions WHERE token_id IN (
        SELECT id FROM map_tokens WHERE placed_by = ?
      )
    `).run(userId);
    db.prepare('DELETE FROM map_tokens WHERE placed_by = ?').run(userId);

    // Remove NPC tokens placed by user (and their conditions/assignments)
    const npcPlacements = db.prepare('SELECT id FROM map_npc_tokens WHERE placed_by = ?').all(userId);
    for (const p of npcPlacements) {
      db.prepare('DELETE FROM npc_token_conditions WHERE npc_map_token_id = ?').run(p.id);
      db.prepare('DELETE FROM npc_token_assignments WHERE npc_token_id = ?').run(p.id);
      db.prepare('DELETE FROM combat_participants WHERE npc_map_token_id = ?').run(p.id);
    }
    db.prepare('DELETE FROM map_npc_tokens WHERE placed_by = ?').run(userId);

    // Remove NPC library entries created by user
    const npcTokens = db.prepare('SELECT id FROM npc_tokens WHERE created_by = ?').all(userId);
    for (const n of npcTokens) {
      db.prepare('DELETE FROM npc_token_categories WHERE npc_token_id = ?').run(n.id);
    }
    db.prepare('DELETE FROM npc_tokens WHERE created_by = ?').run(userId);

    // Remove NPC categories created by user
    db.prepare('DELETE FROM npc_categories WHERE created_by = ?').run(userId);

    // Remove map locations created by user
    db.prepare('DELETE FROM map_locations WHERE created_by = ?').run(userId);

    // Remove loot chests created by user (and their items)
    const chests = db.prepare('SELECT id FROM map_loot_chests WHERE created_by = ?').all(userId);
    for (const c of chests) {
      db.prepare('DELETE FROM chest_items WHERE chest_id = ?').run(c.id);
    }
    db.prepare('DELETE FROM map_loot_chests WHERE created_by = ?').run(userId);

    // Remove maps created by user (cascade cleanup)
    const maps = db.prepare('SELECT id FROM maps WHERE created_by = ?').all(userId);
    for (const m of maps) {
      db.prepare('DELETE FROM map_links WHERE source_map_id = ? OR target_map_id = ?').run(m.id, m.id);
      db.prepare('DELETE FROM combat_encounters WHERE map_id = ?').run(m.id);
    }
    db.prepare('DELETE FROM maps WHERE created_by = ?').run(userId);
  }
};
