const express = require('express');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  const posts = db.prepare(`
    SELECT p.*, u.username, u.avatar
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.session_id IS NULL
    ORDER BY p.created_at DESC
  `).all();

  const postIds = posts.map(p => p.id);
  const replyMap = {};

  if (postIds.length > 0) {
    const placeholders = postIds.map(() => '?').join(',');
    const replies = db.prepare(`
      SELECT r.*, u.username, u.avatar
      FROM replies r
      JOIN users u ON r.user_id = u.id
      WHERE r.post_id IN (${placeholders})
      ORDER BY r.created_at ASC
    `).all(...postIds);

    for (const r of replies) {
      if (!replyMap[r.post_id]) replyMap[r.post_id] = [];
      replyMap[r.post_id].push(r);
    }
  }

  res.render('board', { posts, replyMap });
});

router.post('/', requireLogin, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) {
    req.flash('error', 'Post content is required.');
    return res.redirect('/board');
  }
  db.prepare('INSERT INTO posts (user_id, content) VALUES (?, ?)').run(req.user.id, content.trim());
  req.flash('success', 'Message posted to the board.');
  res.redirect('/board');
});

router.post('/:id/reply', requireLogin, (req, res) => {
  const { content } = req.body;
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) {
    req.flash('error', 'Post not found.');
    return res.redirect('/board');
  }
  if (!content || !content.trim()) {
    req.flash('error', 'Reply content is required.');
    return res.redirect('/board');
  }
  db.prepare('INSERT INTO replies (post_id, user_id, content) VALUES (?, ?, ?)').run(post.id, req.user.id, content.trim());
  req.flash('success', 'Reply posted.');
  res.redirect('/board');
});

router.post('/:id/delete', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) {
    req.flash('error', 'Post not found.');
    return res.redirect('/board');
  }
  if (post.user_id !== req.user.id && req.user.role !== 'admin') {
    req.flash('error', 'You can only delete your own posts.');
    return res.redirect('/board');
  }
  db.prepare('DELETE FROM replies WHERE post_id = ?').run(post.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  req.flash('success', 'Post deleted.');
  res.redirect('/board');
});

module.exports = router;
