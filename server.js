require('dotenv').config();

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');

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

const app = express();
const PORT = process.env.PORT || 3000;

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
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Viber webhook — must be before attachUser (no session cookies)
app.post('/webhooks/viber', express.json(), (req, res) => {
  res.sendStatus(200);
});

app.use(flashMiddleware);
app.use(attachUser);

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

// PWA install page
const pushService = require('./helpers/push');

app.get('/pwa', (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.render('pwa', { vapidPublicKey: pushService.getPublicKey() });
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
