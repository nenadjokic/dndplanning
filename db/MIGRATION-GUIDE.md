# Database Migration Guide

## Overview

This document explains the database schema evolution and how to handle migrations when upgrading Quest Planner.

---

## Schema History

### Pre-v2.0.0 (Legacy Schema)

**post_reactions & reply_reactions:**
- Column: `reaction_type TEXT NOT NULL CHECK(reaction_type IN ('like', 'dislike'))`
- Constraint: `UNIQUE(post_id, user_id)` - allowed only 1 reaction per user per post
- **Problem:** Users couldn't use multiple different emoji reactions

**polls:**
- Columns: `post_id`, `reply_id`, `question`, `created_at`
- **Missing:** `user_id` column
- **Problem:** Couldn't track who created the poll

### v2.0.0+ (Current Schema)

**post_reactions & reply_reactions:**
- Column: `emoji TEXT NOT NULL`
- Constraint: `UNIQUE(post_id, user_id, emoji)` - allows multiple different reactions
- **Benefit:** Users can use 👍, ❤️, 😂, etc. on the same post

**polls:**
- Columns: `post_id`, `user_id`, `question`, `created_at`
- **Removed:** `reply_id` (was unused)
- **Added:** `user_id` (tracks poll creator)

---

## Migration Scripts

### For Production Servers (Upgrading from older versions)

If you're upgrading from **any version before v2.0.0**, you MUST run the migration script:

```bash
# Pull latest code
git pull origin main

# Rebuild Docker image (to get migration script)
docker-compose build
docker-compose up -d

# Run complete migration
docker exec quest-planner node db/migrate-v2-complete.js

# Restart to load new schema
docker restart quest-planner
```

### For Fresh Installations

Fresh installations automatically get the correct schema from:
- `routes/install.js` (web installer)
- `db/connection.js` (auto-initialization)

No migration needed.

---

## Files Involved in Schema Management

| File | Purpose | When Executed |
|------|---------|---------------|
| `db/schema.sql` | Base schema (legacy, not used anymore) | Never (deprecated) |
| `db/connection.js` | Auto-creates tables on app start | Every app start |
| `routes/install.js` | Web installer schema | First-time setup via /install |
| `db/migrate-v2-complete.js` | Migration for v2.0.x | Manual run when upgrading |

---

## How to Add New Schema Changes (For Developers)

When you need to add a new table or column:

### 1. Update ALL Schema Files

You MUST update these files to keep them in sync:

- [ ] `db/connection.js` - Add `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE`
- [ ] `routes/install.js` - Add to the main schema SQL
- [ ] Create a new migration script: `db/migrate-vX.X.js`

### 2. Test Migration Locally

Before deploying:

```bash
# 1. Create a copy of an OLD production database
cp production-backup.db test-old.db

# 2. Run migration on the old database
node db/migrate-vX.X.js

# 3. Start the app and test all features
npm start

# 4. Verify no errors in console or logs
```

### 3. Migration Script Template

```javascript
#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data', 'dndplanning.db'));

function columnExists(table, column) {
  const info = db.pragma(`table_info(${table})`);
  return info.some(col => col.name === column);
}

function tableExists(table) {
  const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return !!result;
}

try {
  let changesMade = 0;

  // Add your migration logic here
  if (!tableExists('new_table')) {
    db.exec(`
      CREATE TABLE new_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      )
    `);
    changesMade++;
    console.log('✅ new_table created');
  }

  if (!columnExists('users', 'new_column')) {
    db.exec('ALTER TABLE users ADD COLUMN new_column TEXT');
    changesMade++;
    console.log('✅ users.new_column added');
  }

  db.close();
  console.log(`\n✅ Migration complete! Changes made: ${changesMade}`);

  if (changesMade > 0) {
    console.log('\n🔄 Restart your application:');
    console.log('   docker restart quest-planner');
  }

} catch (error) {
  console.error('❌ Migration failed:', error.message);
  db.close();
  process.exit(1);
}
```

---

## Common Mistakes to Avoid

### ❌ DON'T:
1. **Don't change existing columns directly** - SQLite doesn't support `ALTER COLUMN`, you need to recreate the table
2. **Don't forget to update all 3 files** - connection.js, install.js, and migration script
3. **Don't test only on fresh databases** - always test migration on OLD production databases
4. **Don't use `DROP TABLE` without backing up data** - always preserve user data
5. **Don't skip the migration script** - even if you update connection.js, old databases won't auto-migrate

### ✅ DO:
1. **Always provide a migration script** for production servers
2. **Test migrations on copies of production databases** before deploying
3. **Preserve user data** when changing schemas (use INSERT...SELECT)
4. **Document schema changes** in this file and in commit messages
5. **Use transactions** (`BEGIN TRANSACTION` / `COMMIT`) for safety

---

## Debugging Migration Issues

### Check Current Schema

```bash
# Connect to database
sqlite3 data/dndplanning.db

# Show all tables
.tables

# Show table schema
.schema post_reactions

# Check if column exists
PRAGMA table_info(post_reactions);

# Exit
.quit
```

### Common Errors

**Error:** `NOT NULL constraint failed: post_reactions.reaction_type`
- **Cause:** Old code using `reaction_type`, but table has `emoji`
- **Fix:** Run migration script to rename column

**Error:** `table polls has no column named user_id`
- **Cause:** Old polls table schema
- **Fix:** Run migration script to add user_id

**Error:** `UNIQUE constraint failed`
- **Cause:** Constraint mismatch (old: `UNIQUE(post_id, user_id)`, new: `UNIQUE(post_id, user_id, emoji)`)
- **Fix:** Run migration script to recreate table with correct constraint

---

## Version Compatibility Matrix

| Quest Planner Version | Database Schema Version | Migration Required |
|-----------------------|------------------------|-------------------|
| v0.1.0 - v0.9.22 | Legacy (basic) | Yes |
| v0.9.23 - v1.0.17 | Legacy (reactions v1) | Yes |
| v1.0.18 - v1.0.x | Transitional | Yes |
| v2.0.0+ | Current (v2) | No (if migrated) |

---

## Contact

If you encounter migration issues, check:
1. Server logs: `docker logs quest-planner --tail 100`
2. Database schema: `sqlite3 data/dndplanning.db ".schema"`
3. Migration output: Output from `migrate-v2-complete.js`

For help, open an issue: https://github.com/nenadjokic/dndplanning/issues
