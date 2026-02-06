require('dotenv').config();

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { marked } = require('marked');

const db = require('./db/connection');
const { attachUser } = require('./middleware/auth');
const { flashMiddleware } = require('./middleware/flash');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const sessionRoutes = require('./routes/sessions');
const voteRoutes = require('./routes/votes');
const adminRoutes = require('./routes/admin');
const settingsRoutes = require('./routes/settings');
const calendarRoutes = require('./routes/calendar');
const boardRoutes = require('./routes/board');
const notificationRoutes = require('./routes/notifications');
const historyRoutes = require('./routes/history');
const profileRoutes = require('./routes/profile');
const playersRoutes = require('./routes/players');
const mapRoutes = require('./routes/map');
const lootRoutes = require('./routes/loot');
const analyticsRoutes = require('./routes/analytics');
const dmToolsRoutes = require('./routes/dm-tools');
const diceRoutes = require('./routes/dice');
const dndDataRoutes = require('./routes/dnd-data');
const vaultRoutes = require('./routes/vault');
const adminUpdatesRoutes = require('./routes/admin-updates');

const app = express();
const PORT = process.env.PORT || 3000;

// Enforce SESSION_SECRET in production
if (!process.env.SESSION_SECRET) {
  console.error('ERROR: SESSION_SECRET environment variable is required.');
  console.error('Set it in your .env file or environment.');
  process.exit(1);
}

app.locals.appVersion = require('./package.json').version;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/avatars', express.static(path.join(__dirname, 'data', 'avatars')));
app.use('/maps', express.static(path.join(__dirname, 'data', 'maps')));
app.use('/thumbnails', express.static(path.join(__dirname, 'data', 'thumbnails')));

app.use(session({
  store: new SQLiteStore({
    dir: path.join(__dirname, 'data'),
    db: 'sessions.db'
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

// Simple CSRF Protection (session-based)
app.use((req, res, next) => {
  // Generate CSRF token for session if it doesn't exist
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  // Make token available to views
  res.locals.csrfToken = req.session.csrfToken;
  next();
});

// Viber webhook — must be before CSRF (external webhook)
app.post('/webhooks/viber', express.json(), (req, res) => {
  res.sendStatus(200);
});

// CSRF validation middleware
function csrfProtection(req, res, next) {
  // Skip for GET, HEAD, OPTIONS, and webhooks
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  if (req.path.startsWith('/webhooks/')) {
    return next();
  }

  // Check CSRF token
  const token = req.body._csrf || req.query._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).send('Invalid CSRF token');
  }

  next();
}

// Apply CSRF protection to all routes after session
app.use(csrfProtection);

app.use(flashMiddleware);
app.use(attachUser);

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/sessions', sessionRoutes);
app.use('/votes', voteRoutes);
app.use('/admin', adminRoutes);
app.use('/settings', settingsRoutes);
app.use('/calendar', calendarRoutes);
app.use('/board', boardRoutes);
app.use('/notifications', notificationRoutes);
app.use('/history', historyRoutes);
app.use('/profile', profileRoutes);
app.use('/players', playersRoutes);
app.use('/map', mapRoutes);
app.use('/loot', lootRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/dm-tools', dmToolsRoutes);
app.use('/api/dice', diceRoutes);
app.use('/api/dnd', dndDataRoutes);
app.use('/vault', vaultRoutes);
app.use('/admin', adminUpdatesRoutes);

// PWA install page
const pushService = require('./helpers/push');
const sse = require('./helpers/sse');

// Apply rate limiting to all /api/* routes except SSE
app.use('/api/', (req, res, next) => {
  // Skip rate limiting for SSE endpoint
  if (req.path === '/events') return next();
  apiLimiter(req, res, next);
});

// SSE endpoint for real-time updates (no rate limit - it's long-lived connection)
app.get('/api/events', (req, res) => {
  if (!req.user) return res.status(401).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sse.addClient(res);
});

app.get('/pwa', (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.render('pwa', { vapidPublicKey: pushService.getPublicKey() });
});

// Spell search (uses local 5e.tools database)
app.get('/api/spells/search', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const query = req.query.q || '';
  const level = req.query.level;

  if (query.length < 2) return res.json({ results: [] });

  try {
    let sql = 'SELECT name, level, school, casting_time, range, duration FROM dnd_spells WHERE search_text LIKE ?';
    const params = [`%${query.toLowerCase()}%`];

    if (level !== undefined && level !== '') {
      sql += ' AND level = ?';
      params.push(parseInt(level));
    }

    sql += ' ORDER BY level, name COLLATE NOCASE LIMIT 10';

    const spells = db.prepare(sql).all(...params);

    const results = spells.map(s => ({
      name: s.name,
      level: s.level,
      school: s.school || '',
      castingTime: s.casting_time || '',
      range: s.range || '',
      duration: s.duration || ''
    }));

    res.json({ results });
  } catch (err) {
    console.error('[Spell Search] Error:', err.message);
    res.json({ results: [] });
  }
});

// Spell details (for character sheet autocomplete)
app.get('/api/spells/details', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const name = req.query.name || '';

  if (!name) return res.json({ error: 'No spell name provided' });

  try {
    const normalized = name.toLowerCase();
    const spell = db.prepare('SELECT * FROM dnd_spells WHERE LOWER(name) = ?').get(normalized);

    if (!spell) {
      return res.json({ error: 'Spell not found' });
    }

    const fullData = JSON.parse(spell.raw_data);

    // School mapping
    const schoolMap = {
      'A': 'Abjuration', 'C': 'Conjuration', 'D': 'Divination', 'E': 'Enchantment',
      'V': 'Evocation', 'I': 'Illusion', 'N': 'Necromancy', 'T': 'Transmutation'
    };

    // Source mapping
    const sourceMap = {
      'PHB': "Player's Handbook",
      'XPHB': "Player's Handbook (2024)",
      'XGE': "Xanathar's Guide to Everything",
      'TCE': "Tasha's Cauldron of Everything",
      'SCAG': "Sword Coast Adventurer's Guide",
      'EE': "Elemental Evil Player's Companion"
    };

    // Components
    const components = [];
    if (fullData.components?.v) components.push('V');
    if (fullData.components?.s) components.push('S');
    if (fullData.components?.m) components.push('M');

    // Description
    let description = '';
    if (fullData.entries && Array.isArray(fullData.entries)) {
      description = fullData.entries.map(e => {
        if (typeof e === 'string') return e;
        if (e.type === 'entries' && e.items) return e.items.join(' ');
        return '';
      }).filter(Boolean).join('\n\n');
    }

    // Higher levels
    let higherLevels = '';
    if (fullData.entriesHigherLevel && Array.isArray(fullData.entriesHigherLevel)) {
      higherLevels = fullData.entriesHigherLevel.map(e => {
        if (e.entries && Array.isArray(e.entries)) {
          return e.entries.join(' ');
        }
        return '';
      }).filter(Boolean).join('\n\n');
    }

    // Classes
    let classes = '';
    if (fullData.classes?.fromClassList && Array.isArray(fullData.classes.fromClassList)) {
      classes = fullData.classes.fromClassList.map(c => c.name).join(', ');
    }

    res.json({
      name: fullData.name,
      level: fullData.level,
      school: schoolMap[fullData.school] || fullData.school,
      castingTime: spell.casting_time,
      range: spell.range,
      duration: spell.duration,
      components: components.join(', '),
      material: typeof fullData.components?.m === 'object' ? fullData.components.m.text : fullData.components?.m || '',
      concentration: fullData.duration?.[0]?.concentration || false,
      ritual: fullData.meta?.ritual || false,
      description: marked.parse(description, { breaks: true, gfm: true }),
      higherLevels: higherLevels ? marked.parse(higherLevels, { breaks: true, gfm: true }) : '',
      classes: classes,
      source: sourceMap[fullData.source] || fullData.source || 'Unknown'
    });
  } catch (err) {
    console.error('[Spell Details] Error:', err.message);
    res.json({ error: 'Failed to fetch spell details' });
  }
});

// Push notification API
app.get('/api/push/key', (req, res) => {
  res.json({ publicKey: pushService.getPublicKey() });
});

app.post('/api/push/subscribe', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  pushService.subscribe(req.user.id, subscription);
  res.json({ success: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const { endpoint } = req.body;
  if (endpoint) pushService.unsubscribe(endpoint);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Quest Planner running at http://localhost:${PORT}`);
});
