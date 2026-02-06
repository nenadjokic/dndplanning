-- 5e.tools data tables
-- Stores spells, classes, races, and items from 5e.tools

-- Spells table
CREATE TABLE IF NOT EXISTS dnd_spells (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  level INTEGER NOT NULL,
  school TEXT,
  casting_time TEXT,
  range TEXT,
  components TEXT,
  duration TEXT,
  description TEXT,
  raw_data TEXT NOT NULL, -- Full JSON from 5e.tools
  search_text TEXT, -- Concatenated searchable text
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_spells_name ON dnd_spells(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_spells_level ON dnd_spells(level);
CREATE INDEX IF NOT EXISTS idx_spells_school ON dnd_spells(school);
CREATE INDEX IF NOT EXISTS idx_spells_source ON dnd_spells(source);
CREATE INDEX IF NOT EXISTS idx_spells_search ON dnd_spells(search_text);

-- Classes table
CREATE TABLE IF NOT EXISTS dnd_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  hit_die INTEGER,
  proficiencies TEXT,
  raw_data TEXT NOT NULL, -- Full JSON from 5e.tools
  search_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_classes_name ON dnd_classes(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_classes_source ON dnd_classes(source);

-- Races table
CREATE TABLE IF NOT EXISTS dnd_races (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  size TEXT,
  speed INTEGER,
  abilities TEXT,
  raw_data TEXT NOT NULL, -- Full JSON from 5e.tools
  search_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_races_name ON dnd_races(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_races_source ON dnd_races(source);

-- Items table
CREATE TABLE IF NOT EXISTS dnd_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  type TEXT,
  rarity TEXT,
  value INTEGER,
  weight REAL,
  raw_data TEXT NOT NULL, -- Full JSON from 5e.tools
  search_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_name ON dnd_items(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_items_type ON dnd_items(type);
CREATE INDEX IF NOT EXISTS idx_items_rarity ON dnd_items(rarity);
CREATE INDEX IF NOT EXISTS idx_items_source ON dnd_items(source);

-- Metadata table to track last import
CREATE TABLE IF NOT EXISTS dnd_data_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_import_date TEXT,
  import_version TEXT,
  spell_count INTEGER DEFAULT 0,
  class_count INTEGER DEFAULT 0,
  race_count INTEGER DEFAULT 0,
  item_count INTEGER DEFAULT 0
);

INSERT OR IGNORE INTO dnd_data_meta (id) VALUES (1);
