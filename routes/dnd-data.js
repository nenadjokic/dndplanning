const express = require('express');
const router = express.Router();
const db = require('../db/connection');

/**
 * D&D Data API Routes (5e.tools data)
 * Replaces Open5e API with local database
 */

// GET /api/dnd/spells - List all spells with search and filtering
router.get('/spells', (req, res) => {
  try {
    const { search, level, school, source, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT id, name, source, level, school, casting_time, range, components, duration, description FROM dnd_spells WHERE 1=1';
    const params = [];

    // Search by name or description
    if (search) {
      query += ' AND search_text LIKE ?';
      params.push(`%${search.toLowerCase()}%`);
    }

    // Filter by level
    if (level !== undefined) {
      query += ' AND level = ?';
      params.push(parseInt(level));
    }

    // Filter by school
    if (school) {
      query += ' AND school = ?';
      params.push(school);
    }

    // Filter by source
    if (source) {
      query += ' AND source = ?';
      params.push(source);
    }

    // Order by level, then name
    query += ' ORDER BY level, name COLLATE NOCASE';

    // Pagination
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const spells = db.prepare(query).all(...params);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as count FROM dnd_spells WHERE 1=1';
    const countParams = [];

    if (search) {
      countQuery += ' AND search_text LIKE ?';
      countParams.push(`%${search.toLowerCase()}%`);
    }
    if (level !== undefined) {
      countQuery += ' AND level = ?';
      countParams.push(parseInt(level));
    }
    if (school) {
      countQuery += ' AND school = ?';
      countParams.push(school);
    }
    if (source) {
      countQuery += ' AND source = ?';
      countParams.push(source);
    }

    const { count } = db.prepare(countQuery).get(...countParams);

    res.json({
      results: spells,
      count: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error fetching spells:', error);
    res.status(500).json({ error: 'Failed to fetch spells' });
  }
});

// GET /api/dnd/spells/:id - Get single spell with full data
router.get('/spells/:id', (req, res) => {
  try {
    const spell = db.prepare('SELECT * FROM dnd_spells WHERE id = ?').get(req.params.id);

    if (!spell) {
      return res.status(404).json({ error: 'Spell not found' });
    }

    // Parse raw_data to include full details
    spell.full_data = JSON.parse(spell.raw_data);
    delete spell.raw_data;

    res.json(spell);
  } catch (error) {
    console.error('Error fetching spell:', error);
    res.status(500).json({ error: 'Failed to fetch spell' });
  }
});

// GET /api/dnd/classes - List all classes
router.get('/classes', (req, res) => {
  try {
    const { search, source } = req.query;

    let query = 'SELECT id, name, source, hit_die FROM dnd_classes WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND search_text LIKE ?';
      params.push(`%${search.toLowerCase()}%`);
    }

    if (source) {
      query += ' AND source = ?';
      params.push(source);
    }

    query += ' ORDER BY name COLLATE NOCASE';

    const classes = db.prepare(query).all(...params);

    res.json({
      results: classes,
      count: classes.length
    });
  } catch (error) {
    console.error('Error fetching classes:', error);
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
});

// GET /api/dnd/classes/:id - Get single class with full data
router.get('/classes/:id', (req, res) => {
  try {
    const cls = db.prepare('SELECT * FROM dnd_classes WHERE id = ?').get(req.params.id);

    if (!cls) {
      return res.status(404).json({ error: 'Class not found' });
    }

    cls.full_data = JSON.parse(cls.raw_data);
    delete cls.raw_data;

    res.json(cls);
  } catch (error) {
    console.error('Error fetching class:', error);
    res.status(500).json({ error: 'Failed to fetch class' });
  }
});

// GET /api/dnd/races - List all races
router.get('/races', (req, res) => {
  try {
    const { search, source } = req.query;

    let query = 'SELECT id, name, source, size, speed FROM dnd_races WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND search_text LIKE ?';
      params.push(`%${search.toLowerCase()}%`);
    }

    if (source) {
      query += ' AND source = ?';
      params.push(source);
    }

    query += ' ORDER BY name COLLATE NOCASE';

    const races = db.prepare(query).all(...params);

    res.json({
      results: races,
      count: races.length
    });
  } catch (error) {
    console.error('Error fetching races:', error);
    res.status(500).json({ error: 'Failed to fetch races' });
  }
});

// GET /api/dnd/races/:id - Get single race with full data
router.get('/races/:id', (req, res) => {
  try {
    const race = db.prepare('SELECT * FROM dnd_races WHERE id = ?').get(req.params.id);

    if (!race) {
      return res.status(404).json({ error: 'Race not found' });
    }

    race.full_data = JSON.parse(race.raw_data);
    delete race.raw_data;

    res.json(race);
  } catch (error) {
    console.error('Error fetching race:', error);
    res.status(500).json({ error: 'Failed to fetch race' });
  }
});

// GET /api/dnd/items - List all items with search and filtering
router.get('/items', (req, res) => {
  try {
    const { search, type, rarity, source, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT id, name, source, type, rarity, value, weight FROM dnd_items WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND search_text LIKE ?';
      params.push(`%${search.toLowerCase()}%`);
    }

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    if (rarity) {
      query += ' AND rarity = ?';
      params.push(rarity);
    }

    if (source) {
      query += ' AND source = ?';
      params.push(source);
    }

    query += ' ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const items = db.prepare(query).all(...params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM dnd_items WHERE 1=1';
    const countParams = [];

    if (search) {
      countQuery += ' AND search_text LIKE ?';
      countParams.push(`%${search.toLowerCase()}%`);
    }
    if (type) {
      countQuery += ' AND type = ?';
      countParams.push(type);
    }
    if (rarity) {
      countQuery += ' AND rarity = ?';
      countParams.push(rarity);
    }
    if (source) {
      countQuery += ' AND source = ?';
      countParams.push(source);
    }

    const { count } = db.prepare(countQuery).get(...countParams);

    res.json({
      results: items,
      count: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// GET /api/dnd/items/:id - Get single item with full data
router.get('/items/:id', (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM dnd_items WHERE id = ?').get(req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    item.full_data = JSON.parse(item.raw_data);
    delete item.raw_data;

    res.json(item);
  } catch (error) {
    console.error('Error fetching item:', error);
    res.status(500).json({ error: 'Failed to fetch item' });
  }
});

// GET /api/dnd/stats - Get database statistics
router.get('/stats', (req, res) => {
  try {
    const meta = db.prepare('SELECT * FROM dnd_data_meta WHERE id = 1').get();
    res.json(meta);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
