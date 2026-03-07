/**
 * AddonManager — Central orchestrator for Quest Planner addon system
 *
 * Discovers, loads, enables/disables, and mounts addons.
 * Handles migrations, nav items, dashboard widgets, CSS/JS injection.
 */

const fs = require('fs');
const path = require('path');

class AddonManager {
  constructor(db, app) {
    this.db = db;
    this.app = app;
    this.addons = new Map();       // addonId -> AddonInfo
    this.enabledSet = new Set();   // Set of enabled addon IDs for fast lookup
    this._navItems = [];
    this._cssFiles = [];
    this._jsFiles = [];

    // Ensure addon system tables exist
    this._ensureTables();
  }

  _ensureTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS addon_state (
        addon_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        installed_at TEXT NOT NULL DEFAULT (datetime('now')),
        version TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'preinstalled'
          CHECK(type IN ('preinstalled', 'community'))
      );

      CREATE TABLE IF NOT EXISTS addon_migrations (
        addon_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        description TEXT,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(addon_id, version)
      );

      CREATE TABLE IF NOT EXISTS addon_repositories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        added_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /**
   * Scan addons/ (preinstalled) and data/addons/ (community) directories
   */
  discover() {
    const preinstalledDir = path.join(__dirname, '..', 'addons');
    const communityDir = path.join(__dirname, '..', 'data', 'addons');

    this._scanDir(preinstalledDir, 'preinstalled');
    this._scanDir(communityDir, 'community');

    console.log(`[AddonManager] Discovered ${this.addons.size} addons`);
    return this.addons;
  }

  _scanDir(dir, type) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const addonDir = path.join(dir, entry.name);
      const manifestPath = path.join(addonDir, 'addon.json');

      if (!fs.existsSync(manifestPath)) {
        console.warn(`[AddonManager] Skipping ${entry.name}: no addon.json`);
        continue;
      }

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        if (!manifest.id || !manifest.name || !manifest.version) {
          console.warn(`[AddonManager] Skipping ${entry.name}: missing required fields in addon.json`);
          continue;
        }

        this.addons.set(manifest.id, {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description || '',
          author: manifest.author || 'Unknown',
          category: manifest.category || 'Other',
          icon: manifest.icon || (manifest.navItems && manifest.navItems[0] && manifest.navItems[0].icon) || 'puzzle',
          type: type,
          enabled: false,
          dir: addonDir,
          manifest: manifest,
          hooks: null,
          migrations: []
        });
      } catch (err) {
        console.error(`[AddonManager] Error parsing ${entry.name}/addon.json:`, err.message);
      }
    }
  }

  /**
   * Load all discovered addons — check DB state, parse hooks, prepare migrations
   */
  loadAll() {
    for (const [id, addon] of this.addons) {
      this._loadAddon(addon);
    }

    // Auto-register any new preinstalled addons not yet in addon_state
    for (const [id, addon] of this.addons) {
      const state = this.db.prepare('SELECT * FROM addon_state WHERE addon_id = ?').get(id);
      if (!state && addon.type === 'preinstalled') {
        // New preinstalled addon — auto-enable
        this.db.prepare(
          'INSERT INTO addon_state (addon_id, enabled, version, type) VALUES (?, 1, ?, ?)'
        ).run(id, addon.version, 'preinstalled');
        addon.enabled = true;
        this.enabledSet.add(id);
      } else if (state) {
        addon.enabled = !!state.enabled;
        if (addon.enabled) this.enabledSet.add(id);
      }
    }

    // Run pending migrations for enabled addons
    for (const [id, addon] of this.addons) {
      if (addon.enabled) {
        this._runMigrations(addon);
      }
    }

    console.log(`[AddonManager] ${this.enabledSet.size} addons enabled`);
  }

  _loadAddon(addon) {
    // Load hooks.js
    const hooksPath = path.join(addon.dir, 'hooks.js');
    if (fs.existsSync(hooksPath)) {
      try {
        addon.hooks = require(hooksPath);
      } catch (err) {
        console.error(`[AddonManager] Error loading hooks for ${addon.id}:`, err.message);
        addon.hooks = {};
      }
    } else {
      addon.hooks = {};
    }

    // Scan migrations
    const migrationsDir = path.join(addon.dir, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.js'))
        .sort();

      addon.migrations = files.map(f => {
        try {
          const m = require(path.join(migrationsDir, f));
          return m;
        } catch (err) {
          console.error(`[AddonManager] Error loading migration ${addon.id}/${f}:`, err.message);
          return null;
        }
      }).filter(Boolean);
    }
  }

  _runMigrations(addon) {
    if (!addon.migrations.length) return;

    for (const migration of addon.migrations) {
      const applied = this.db.prepare(
        'SELECT * FROM addon_migrations WHERE addon_id = ? AND version = ?'
      ).get(addon.id, migration.version);

      if (!applied) {
        try {
          console.log(`[AddonManager] Running migration ${addon.id} v${migration.version}: ${migration.description}`);
          migration.up(this.db);
          this.db.prepare(
            'INSERT INTO addon_migrations (addon_id, version, description) VALUES (?, ?, ?)'
          ).run(addon.id, migration.version, migration.description || '');
        } catch (err) {
          console.error(`[AddonManager] Migration failed ${addon.id} v${migration.version}:`, err.message);
        }
      }
    }
  }

  /**
   * Mount routes, static assets, register nav items, CSS/JS for all enabled addons
   */
  mountAll() {
    const express = require('express');
    this._navItems = [];
    this._cssFiles = [];
    this._jsFiles = [];

    for (const [id, addon] of this.addons) {
      if (!addon.enabled) continue;

      const ctx = this._createContext(addon);

      // Call onLoad hook
      if (addon.hooks.onLoad) {
        try {
          addon.hooks.onLoad(ctx);
        } catch (err) {
          console.error(`[AddonManager] onLoad failed for ${addon.id}:`, err.message);
        }
      }

      // Mount routes
      this._mountRoutes(addon);
      addon._routesMounted = true;

      // Mount static assets
      const publicDir = path.join(addon.dir, addon.manifest.publicDir || 'public');
      if (fs.existsSync(publicDir)) {
        this.app.use(`/addons/${addon.id}`, express.static(publicDir));
      }

      // Register nav items
      if (addon.manifest.navItems) {
        for (const item of addon.manifest.navItems) {
          this._navItems.push({ ...item, addonId: addon.id });
        }
      }

      // Register CSS files
      if (addon.manifest.css) {
        for (const css of addon.manifest.css) {
          this._cssFiles.push(`/addons/${addon.id}/${css}?v=${addon.version}`);
        }
      }

      // Register JS files
      if (addon.manifest.js) {
        for (const js of addon.manifest.js) {
          this._jsFiles.push(`/addons/${addon.id}/${js}?v=${addon.version}`);
        }
      }

      // Mount upload directories as static paths
      if (addon.manifest.uploadDirs) {
        for (const dir of addon.manifest.uploadDirs) {
          const uploadPath = path.join(__dirname, '..', 'data', 'uploads', dir);
          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
          }
          this.app.use(`/uploads/${dir}`, express.static(uploadPath));
        }
      }
    }

    // Sort nav items by group then sort order
    this._navItems.sort((a, b) => {
      if (a.group !== b.group) return (a.group || '').localeCompare(b.group || '');
      return (a.sort || 0) - (b.sort || 0);
    });
  }

  _mountRoutes(addon) {
    const routeConfigs = addon.manifest.routes;

    // Skip if routes is not an array of {path, file} objects
    // (string routes like "/board" are mounted in server.js with addon-guard)
    if (!routeConfigs || !Array.isArray(routeConfigs)) {
      // Auto-detect routes/main.js only for community addons
      if (addon.type === 'community') {
        const mainRoute = path.join(addon.dir, 'routes', 'main.js');
        if (fs.existsSync(mainRoute)) {
          try {
            const router = require(mainRoute);
            const mountPath = addon.manifest.mountPath || `/${addon.id}`;
            this.app.use(mountPath, router);
          } catch (err) {
            console.error(`[AddonManager] Failed to mount routes for ${addon.id}:`, err.message);
          }
        }
      }
      return;
    }

    for (const rc of routeConfigs) {
      if (!rc || !rc.path || !rc.file) continue;
      try {
        const routeFile = path.join(addon.dir, rc.file);
        const router = require(routeFile);
        this.app.use(rc.path, router);
      } catch (err) {
        console.error(`[AddonManager] Failed to mount route ${rc.path} for ${addon.id}:`, err.message);
      }
    }
  }

  _createContext(addon) {
    return {
      db: this.db,
      app: this.app,
      sse: require('../helpers/sse'),
      notifications: require('../helpers/notifications'),
      addonManager: this,
      addonDir: addon.dir,
      dataDir: path.join(__dirname, '..', 'data'),
      require: require
    };
  }

  // --- Public API ---

  isEnabled(addonId) {
    return this.enabledSet.has(addonId);
  }

  getAll() {
    return Array.from(this.addons.values());
  }

  getNavItems(user) {
    if (!user) return [];
    return this._navItems.filter(item => {
      if (!item.roles) return true;
      return item.roles.includes(user.role);
    });
  }

  getAddonCSS() {
    return this._cssFiles;
  }

  getAddonJS() {
    return this._jsFiles;
  }

  /**
   * Get dashboard widget data from all enabled addons
   */
  getDashboardWidgets(user, isDM) {
    const widgets = [];

    for (const [id, addon] of this.addons) {
      if (!addon.enabled) continue;
      if (!addon.manifest.dashboardWidgets) continue;
      if (!addon.hooks.getDashboardData) continue;

      try {
        const ctx = this._createContext(addon);
        const data = addon.hooks.getDashboardData(ctx, user, isDM);

        for (const widgetDef of addon.manifest.dashboardWidgets) {
          // Check role access
          if (widgetDef.roles && !widgetDef.roles.includes(user.role)) continue;

          const templatePath = path.join(addon.dir, 'views', widgetDef.template);
          widgets.push({
            id: widgetDef.id,
            label: widgetDef.label,
            position: widgetDef.position || 'bottom',
            sort: widgetDef.sort || 50,
            templatePath: templatePath,
            data: data[widgetDef.id] || {},
            addonId: addon.id
          });
        }
      } catch (err) {
        console.error(`[AddonManager] getDashboardData failed for ${addon.id}:`, err.message);
      }
    }

    widgets.sort((a, b) => a.sort - b.sort);
    return widgets;
  }

  /**
   * Get addon view paths for EJS resolution
   */
  getViewPaths() {
    const paths = [];
    for (const [id, addon] of this.addons) {
      if (!addon.enabled) continue;
      const viewsDir = path.join(addon.dir, 'views');
      if (fs.existsSync(viewsDir)) {
        paths.push(viewsDir);
      }
    }
    return paths;
  }

  /**
   * Call onUserDelete on all enabled addons
   */
  handleUserDelete(userId) {
    for (const [id, addon] of this.addons) {
      if (!addon.enabled || !addon.hooks.onUserDelete) continue;
      try {
        const ctx = this._createContext(addon);
        addon.hooks.onUserDelete(ctx, userId);
      } catch (err) {
        console.error(`[AddonManager] onUserDelete failed for ${addon.id}:`, err.message);
      }
    }
  }

  /**
   * Enable an addon
   */
  enable(addonId) {
    const addon = this.addons.get(addonId);
    if (!addon) throw new Error(`Addon not found: ${addonId}`);

    this.db.prepare(
      'INSERT OR REPLACE INTO addon_state (addon_id, enabled, version, type) VALUES (?, 1, ?, ?)'
    ).run(addonId, addon.version, addon.type);

    addon.enabled = true;
    this.enabledSet.add(addonId);
  }

  /**
   * Disable an addon
   */
  disable(addonId) {
    const addon = this.addons.get(addonId);
    if (!addon) throw new Error(`Addon not found: ${addonId}`);

    this.db.prepare('UPDATE addon_state SET enabled = 0 WHERE addon_id = ?').run(addonId);
    addon.enabled = false;
    this.enabledSet.delete(addonId);

    if (addon.hooks.onDisable) {
      try {
        const ctx = this._createContext(addon);
        addon.hooks.onDisable(ctx);
      } catch (err) {
        console.error(`[AddonManager] onDisable failed for ${addonId}:`, err.message);
      }
    }
  }

  /**
   * Soft-reload: recalculate nav items, CSS/JS lists after enable/disable.
   * No server restart needed — addon-guard already checks isEnabled() per request.
   */
  reload() {
    const express = require('express');
    this._navItems = [];
    this._cssFiles = [];
    this._jsFiles = [];

    for (const [id, addon] of this.addons) {
      if (!addon.enabled) continue;

      // Run pending migrations for newly enabled addons
      this._runMigrations(addon);

      // Mount routes if not already mounted
      if (!addon._routesMounted) {
        this._mountRoutes(addon);

        // Mount static assets
        const publicDir = path.join(addon.dir, addon.manifest.publicDir || 'public');
        if (fs.existsSync(publicDir)) {
          this.app.use(`/addons/${addon.id}`, express.static(publicDir));
        }

        addon._routesMounted = true;
      }

      // Register nav items
      if (addon.manifest.navItems) {
        for (const item of addon.manifest.navItems) {
          this._navItems.push({ ...item, addonId: addon.id });
        }
      }

      // Register CSS files
      if (addon.manifest.css) {
        for (const css of addon.manifest.css) {
          this._cssFiles.push(`/addons/${addon.id}/${css}?v=${addon.version}`);
        }
      }

      // Register JS files
      if (addon.manifest.js) {
        for (const js of addon.manifest.js) {
          this._jsFiles.push(`/addons/${addon.id}/${js}?v=${addon.version}`);
        }
      }
    }

    // Sort nav items by group then sort order
    this._navItems.sort((a, b) => {
      if (a.group !== b.group) return (a.group || '').localeCompare(b.group || '');
      return (a.sort || 0) - (b.sort || 0);
    });

    // Update Express view paths to include addon views
    const mainViews = path.join(__dirname, '..', 'views');
    const addonViews = this.getViewPaths();
    this.app.set('views', [mainViews, ...addonViews]);

    console.log(`[AddonManager] Reloaded — ${this.enabledSet.size} addons enabled`);
  }

  /**
   * Delete all data for an addon (run down migrations)
   */
  deleteData(addonId) {
    const addon = this.addons.get(addonId);
    if (!addon) throw new Error(`Addon not found: ${addonId}`);

    // Run down migrations in reverse order
    const reversedMigrations = [...addon.migrations].reverse();
    for (const migration of reversedMigrations) {
      if (migration.down) {
        try {
          console.log(`[AddonManager] Running down migration ${addonId} v${migration.version}`);
          migration.down(this.db);
        } catch (err) {
          console.error(`[AddonManager] Down migration failed ${addonId} v${migration.version}:`, err.message);
        }
      }
    }

    // Remove migration records
    this.db.prepare('DELETE FROM addon_migrations WHERE addon_id = ?').run(addonId);
  }

  /**
   * Uninstall a community addon (delete data + remove files)
   */
  uninstall(addonId) {
    const addon = this.addons.get(addonId);
    if (!addon) throw new Error(`Addon not found: ${addonId}`);
    if (addon.type !== 'community') throw new Error('Cannot uninstall preinstalled addons');

    this.disable(addonId);
    this.deleteData(addonId);

    // Remove files
    fs.rmSync(addon.dir, { recursive: true, force: true });

    // Remove from state
    this.db.prepare('DELETE FROM addon_state WHERE addon_id = ?').run(addonId);
    this.addons.delete(addonId);
  }

  /**
   * Install addon from uploaded ZIP (.qpa)
   */
  async installFromZip(zipPath) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);

    // Find addon.json in the zip
    const manifestEntry = zip.getEntry('addon.json');
    if (!manifestEntry) throw new Error('No addon.json found in package');

    const manifest = JSON.parse(manifestEntry.getData().toString('utf-8'));
    if (!manifest.id || !manifest.name || !manifest.version) {
      throw new Error('Invalid addon.json: missing required fields');
    }

    // Extract to data/addons/<id>/
    const targetDir = path.join(__dirname, '..', 'data', 'addons', manifest.id);
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetDir, { recursive: true });
    zip.extractAllTo(targetDir, true);

    return manifest.id;
  }
}

module.exports = AddonManager;
