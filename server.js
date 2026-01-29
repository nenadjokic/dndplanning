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

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

app.use(flashMiddleware);
app.use(attachUser);

app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/sessions', sessionRoutes);
app.use('/votes', voteRoutes);
app.use('/admin', adminRoutes);

app.listen(PORT, () => {
  console.log(`Quest Planner running at http://localhost:${PORT}`);
});
