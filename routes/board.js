const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const { notifyMentions } = require('../helpers/notifications');
const { renderBoardMarkdown } = require('../helpers/markdown');
const sse = require('../helpers/sse');
const router = express.Router();

// Setup upload directory for board images
const uploadDir = path.join(__dirname, '..', 'data', 'uploads', 'board');
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (err) {
  console.warn('Could not create board uploads directory.');
}

// Multer configuration for board image uploads
const boardImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, 'board-' + uniqueSuffix + ext);
    }
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// Image URL validation helper
function isValidImageUrl(url) {
  if (!url) return false;
  url = url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  const allowedHosts = ['giphy.com', 'tenor.com', 'imgur.com', 'i.imgur.com', 'media.giphy.com', 'media.tenor.com'];
  const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace('www.', '');
    if (allowedHosts.some(h => host.includes(h))) return true;
    if (allowedExts.some(ext => parsed.pathname.toLowerCase().endsWith(ext))) return true;
  } catch (e) {}
  return false;
}

// Helper: get user socials
function getUserSocials(userId) {
  const user = db.prepare('SELECT socials FROM users WHERE id = ?').get(userId);
  if (!user || !user.socials) return {};
  try { return JSON.parse(user.socials); } catch (e) { return {}; }
}

// === Category List (main /board page) ===
router.get('/', requireLogin, (req, res) => {
  const categories = db.prepare(`
    SELECT bc.*,
      (SELECT COUNT(*) FROM posts p WHERE p.category_id = bc.id AND p.session_id IS NULL) as topic_count,
      (SELECT COUNT(*) FROM replies r JOIN posts p ON r.post_id = p.id WHERE p.category_id = bc.id AND p.session_id IS NULL) as reply_count,
      (SELECT MAX(COALESCE(
        (SELECT MAX(r2.created_at) FROM replies r2 WHERE r2.post_id = p2.id),
        p2.created_at
      )) FROM posts p2 WHERE p2.category_id = bc.id AND p2.session_id IS NULL) as last_activity
    FROM board_categories bc
    ORDER BY bc.sort_order, bc.name
  `).all();

  // Get last poster for each category
  for (const cat of categories) {
    if (cat.last_activity) {
      const lastPost = db.prepare(`
        SELECT p.id, u.username, u.avatar
        FROM posts p
        JOIN users u ON p.user_id = u.id
        WHERE p.category_id = ? AND p.session_id IS NULL
        ORDER BY COALESCE(
          (SELECT MAX(r.created_at) FROM replies r WHERE r.post_id = p.id),
          p.created_at
        ) DESC
        LIMIT 1
      `).get(cat.id);
      cat.lastPoster = lastPost;
    }
  }

  res.render('board-categories', { categories });
});

// === Topic List (within a category) ===
router.get('/category/:id', requireLogin, (req, res) => {
  const categoryId = parseInt(req.params.id, 10);
  const page = parseInt(req.query.page) || 1;
  const perPage = 20;
  const offset = (page - 1) * perPage;

  const category = db.prepare('SELECT * FROM board_categories WHERE id = ?').get(categoryId);
  if (!category) {
    req.flash('error', 'Category not found.');
    return res.redirect('/board');
  }

  const totalTopics = db.prepare('SELECT COUNT(*) as count FROM posts WHERE category_id = ? AND session_id IS NULL').get(categoryId).count;
  const totalPages = Math.ceil(totalTopics / perPage);

  const topics = db.prepare(`
    SELECT p.id, p.content, p.created_at, p.image_url,
      u.username, u.avatar,
      (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id) as reply_count,
      COALESCE(
        (SELECT MAX(r.created_at) FROM replies r WHERE r.post_id = p.id),
        p.created_at
      ) as last_activity,
      (SELECT u2.username FROM replies r2 JOIN users u2 ON r2.user_id = u2.id WHERE r2.post_id = p.id ORDER BY r2.created_at DESC LIMIT 1) as last_reply_by
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.category_id = ? AND p.session_id IS NULL
    ORDER BY last_activity DESC
    LIMIT ? OFFSET ?
  `).all(categoryId, perPage, offset);

  // Extract title from content (first line or first 80 chars)
  topics.forEach(t => {
    const firstLine = t.content.split('\n')[0].trim();
    t.title = firstLine.length > 80 ? firstLine.substring(0, 77) + '...' : firstLine;
    t.preview = t.content.length > 150 ? t.content.substring(0, 147) + '...' : t.content;
  });

  res.render('board-category', { category, topics, page, totalPages });
});

// === Single Topic View ===
router.get('/topic/:id', requireLogin, (req, res) => {
  const postId = parseInt(req.params.id, 10);

  const post = db.prepare(`
    SELECT p.*, u.username, u.avatar, u.socials, u.id as author_id
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.id = ? AND p.session_id IS NULL
  `).get(postId);

  if (!post) {
    req.flash('error', 'Topic not found.');
    return res.redirect('/board');
  }

  // Get category
  const category = post.category_id ? db.prepare('SELECT * FROM board_categories WHERE id = ?').get(post.category_id) : null;

  // Parse socials
  post.socials = {};
  try { if (post.socials) post.socials = JSON.parse(post.socials); } catch (e) { post.socials = {}; }

  // Render markdown for OP
  post.renderedContent = renderBoardMarkdown(post.content);

  // Get replies
  const replies = db.prepare(`
    SELECT r.*, u.username, u.avatar, u.socials, u.id as author_id
    FROM replies r
    JOIN users u ON r.user_id = u.id
    WHERE r.post_id = ?
    ORDER BY r.created_at ASC
  `).all(postId);

  replies.forEach(r => {
    r.renderedContent = renderBoardMarkdown(r.content);
    try { r.socials = r.socials ? JSON.parse(r.socials) : {}; } catch (e) { r.socials = {}; }
  });

  // Load reactions for post
  const postReactions = {};
  const userPostReactions = {};
  const pr = db.prepare('SELECT emoji, COUNT(*) as count FROM post_reactions WHERE post_id = ? GROUP BY emoji').all(postId);
  postReactions[postId] = { likes: 0, dislikes: 0 };
  for (const r of pr) {
    if (r.emoji === 'like') postReactions[postId].likes = r.count;
    else postReactions[postId].dislikes = r.count;
  }
  const upr = db.prepare('SELECT emoji FROM post_reactions WHERE post_id = ? AND user_id = ?').get(postId, req.user.id);
  if (upr) userPostReactions[postId] = upr.emoji;

  // Load reactions for replies
  const replyReactions = {};
  const userReplyReactions = {};
  const replyIds = replies.map(r => r.id);
  if (replyIds.length > 0) {
    const ph = replyIds.map(() => '?').join(',');
    const rReactions = db.prepare(`SELECT reply_id, emoji, COUNT(*) as count FROM reply_reactions WHERE reply_id IN (${ph}) GROUP BY reply_id, emoji`).all(...replyIds);
    for (const r of rReactions) {
      if (!replyReactions[r.reply_id]) replyReactions[r.reply_id] = { likes: 0, dislikes: 0 };
      if (r.emoji === 'like') replyReactions[r.reply_id].likes = r.count;
      else replyReactions[r.reply_id].dislikes = r.count;
    }
    const urReactions = db.prepare(`SELECT reply_id, emoji FROM reply_reactions WHERE reply_id IN (${ph}) AND user_id = ?`).all(...replyIds, req.user.id);
    for (const ur of urReactions) userReplyReactions[ur.reply_id] = ur.emoji;
  }

  // Load poll
  let poll = null;
  const pollRow = db.prepare('SELECT * FROM polls WHERE post_id = ?').get(postId);
  if (pollRow) {
    const options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY sort_order').all(pollRow.id);
    const voteCounts = db.prepare('SELECT option_id, COUNT(*) as count FROM poll_votes WHERE poll_id = ? GROUP BY option_id').all(pollRow.id);
    const voteMap = {};
    for (const vc of voteCounts) voteMap[vc.option_id] = vc.count;
    const userVote = db.prepare('SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(pollRow.id, req.user.id);
    const totalVotes = db.prepare('SELECT COUNT(*) as count FROM poll_votes WHERE poll_id = ?').get(pollRow.id).count;
    poll = {
      ...pollRow,
      options: options.map(o => ({ ...o, votes: voteMap[o.id] || 0 })),
      userVote: userVote ? userVote.option_id : null,
      totalVotes
    };
  }

  const allUsers = db.prepare('SELECT username FROM users ORDER BY username').all();

  res.render('board-topic', {
    post, replies, category, poll,
    postReactions, userPostReactions,
    replyReactions, userReplyReactions,
    allUsers
  });
});

// === Create New Topic ===
router.post('/', requireLogin, boardImageUpload.single('image_file'), (req, res) => {
  const { content, image_url, poll_question, category_id } = req.body;
  let pollOptions = req.body.poll_options || req.body['poll_options[]'];
  if (pollOptions && !Array.isArray(pollOptions)) pollOptions = [pollOptions];

  if (!content || !content.trim()) {
    req.flash('error', 'Post content is required.');
    return res.redirect('/board');
  }

  // Determine image URL
  let validImageUrl = null;
  if (req.file) {
    validImageUrl = '/uploads/board/' + req.file.filename;
  } else if (image_url && image_url.trim()) {
    if (isValidImageUrl(image_url)) {
      validImageUrl = image_url.trim();
    } else {
      req.flash('error', 'Invalid image URL.');
      return res.redirect(category_id ? '/board/category/' + category_id : '/board');
    }
  }

  // Default to Tavern Talk if no category specified
  let catId = parseInt(category_id) || null;
  if (!catId) {
    const defaultCat = db.prepare("SELECT id FROM board_categories WHERE name = 'Tavern Talk'").get();
    catId = defaultCat ? defaultCat.id : null;
  }

  const result = db.prepare('INSERT INTO posts (user_id, content, image_url, category_id) VALUES (?, ?, ?, ?)').run(req.user.id, content.trim(), validImageUrl, catId);
  const postId = result.lastInsertRowid;

  sse.broadcast('new-comment', { username: req.user.username, postId });

  // Create poll if provided
  if (poll_question && poll_question.trim() && pollOptions) {
    const validOptions = pollOptions.filter(o => o && o.trim());
    if (validOptions.length >= 2) {
      const pollResult = db.prepare('INSERT INTO polls (post_id, user_id, question) VALUES (?, ?, ?)').run(postId, req.user.id, poll_question.trim());
      const pollId = pollResult.lastInsertRowid;
      for (let i = 0; i < validOptions.length; i++) {
        db.prepare('INSERT INTO poll_options (poll_id, option_text, sort_order) VALUES (?, ?, ?)').run(pollId, validOptions[i].trim(), i);
      }
      sse.broadcast('poll-created', { username: req.user.username, question: poll_question.trim() });
    }
  }

  notifyMentions(content.trim(), req.user.id, req.user.username, '/board/topic/' + postId);
  req.flash('success', 'Topic posted.');
  res.redirect('/board/topic/' + postId);
});

// === Reply to Topic ===
router.post('/:id/reply', requireLogin, (req, res) => {
  const { content, image_url } = req.body;
  const postId = parseInt(req.params.id, 10);
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
  if (!post) {
    req.flash('error', 'Post not found.');
    return res.redirect('/board');
  }
  if (!content || !content.trim()) {
    req.flash('error', 'Reply content is required.');
    return res.redirect('/board/topic/' + postId);
  }

  let validImageUrl = null;
  if (image_url && image_url.trim()) {
    if (isValidImageUrl(image_url)) validImageUrl = image_url.trim();
  }

  db.prepare('INSERT INTO replies (post_id, user_id, content, image_url) VALUES (?, ?, ?, ?)').run(postId, req.user.id, content.trim(), validImageUrl);
  sse.broadcast('new-comment', { username: req.user.username });
  notifyMentions(content.trim(), req.user.id, req.user.username, '/board/topic/' + postId);
  req.flash('success', 'Reply posted.');
  res.redirect('/board/topic/' + postId);
});

// === Delete Topic ===
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
  // Clean up related data
  db.prepare('DELETE FROM post_reactions WHERE post_id = ?').run(post.id);
  const replyIds = db.prepare('SELECT id FROM replies WHERE post_id = ?').all(post.id).map(r => r.id);
  if (replyIds.length > 0) {
    const ph = replyIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM reply_reactions WHERE reply_id IN (${ph})`).run(...replyIds);
  }
  db.prepare('DELETE FROM replies WHERE post_id = ?').run(post.id);
  // Delete polls
  const polls = db.prepare('SELECT id FROM polls WHERE post_id = ?').all(post.id);
  for (const p of polls) {
    db.prepare('DELETE FROM poll_votes WHERE poll_id = ?').run(p.id);
    db.prepare('DELETE FROM poll_options WHERE poll_id = ?').run(p.id);
  }
  db.prepare('DELETE FROM polls WHERE post_id = ?').run(post.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  req.flash('success', 'Post deleted.');
  const catId = post.category_id;
  res.redirect(catId ? '/board/category/' + catId : '/board');
});

// === Admin: Create Category ===
router.post('/category', requireLogin, (req, res) => {
  if (req.user.role !== 'admin') {
    req.flash('error', 'Admin only.');
    return res.redirect('/board');
  }
  const { name, description, icon } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Category name is required.');
    return res.redirect('/board');
  }
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM board_categories').get().max || 0;
  db.prepare('INSERT INTO board_categories (name, description, icon, sort_order) VALUES (?, ?, ?, ?)').run(name.trim(), (description || '').trim(), icon || '📋', maxOrder + 1);
  req.flash('success', 'Category created.');
  res.redirect('/board');
});

// === Admin: Edit Category ===
router.post('/category/:id/edit', requireLogin, (req, res) => {
  if (req.user.role !== 'admin') {
    req.flash('error', 'Admin only.');
    return res.redirect('/board');
  }
  const { name, description, icon } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Category name is required.');
    return res.redirect('/board');
  }
  db.prepare('UPDATE board_categories SET name = ?, description = ?, icon = ? WHERE id = ?').run(name.trim(), (description || '').trim(), icon || '📋', req.params.id);
  req.flash('success', 'Category updated.');
  res.redirect('/board');
});

// === Admin: Delete Category ===
router.post('/category/:id/delete', requireLogin, (req, res) => {
  if (req.user.role !== 'admin') {
    req.flash('error', 'Admin only.');
    return res.redirect('/board');
  }
  const catId = parseInt(req.params.id, 10);
  // Move posts to Tavern Talk
  const tavernTalk = db.prepare("SELECT id FROM board_categories WHERE name = 'Tavern Talk'").get();
  if (tavernTalk && tavernTalk.id !== catId) {
    db.prepare('UPDATE posts SET category_id = ? WHERE category_id = ?').run(tavernTalk.id, catId);
  }
  db.prepare('DELETE FROM board_categories WHERE id = ?').run(catId);
  req.flash('success', 'Category deleted. Posts moved to Tavern Talk.');
  res.redirect('/board');
});

// === Reactions (unchanged) ===
router.post('/:postId/react', requireLogin, (req, res) => {
  const { emoji } = req.body;
  const postId = parseInt(req.params.postId, 10);

  if (!['like', 'dislike'].includes(emoji)) {
    return res.status(400).json({ error: 'Invalid reaction type' });
  }

  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const existing = db.prepare('SELECT * FROM post_reactions WHERE post_id = ? AND user_id = ?').get(postId, req.user.id);

  if (existing) {
    if (existing.emoji === emoji) {
      db.prepare('DELETE FROM post_reactions WHERE id = ?').run(existing.id);
    } else {
      db.prepare('UPDATE post_reactions SET emoji = ? WHERE id = ?').run(emoji, existing.id);
    }
  } else {
    db.prepare('INSERT INTO post_reactions (post_id, user_id, emoji) VALUES (?, ?, ?)').run(postId, req.user.id, emoji);
  }

  const likes = db.prepare('SELECT COUNT(*) as count FROM post_reactions WHERE post_id = ? AND emoji = ?').get(postId, 'like').count;
  const dislikes = db.prepare('SELECT COUNT(*) as count FROM post_reactions WHERE post_id = ? AND emoji = ?').get(postId, 'dislike').count;
  const userReaction = db.prepare('SELECT emoji FROM post_reactions WHERE post_id = ? AND user_id = ?').get(postId, req.user.id);

  sse.broadcast('post-reaction', { postId, likes, dislikes });
  if (emoji === 'like' && (!existing || existing.emoji !== 'like')) {
    sse.broadcast('like-activity', { username: req.user.username, postId });
  }

  res.json({ likes, dislikes, userReaction: userReaction ? userReaction.emoji : null });
});

router.post('/reply/:replyId/react', requireLogin, (req, res) => {
  const { emoji } = req.body;
  const replyId = parseInt(req.params.replyId, 10);

  if (!['like', 'dislike'].includes(emoji)) {
    return res.status(400).json({ error: 'Invalid reaction type' });
  }

  const reply = db.prepare('SELECT id FROM replies WHERE id = ?').get(replyId);
  if (!reply) return res.status(404).json({ error: 'Reply not found' });

  const existing = db.prepare('SELECT * FROM reply_reactions WHERE reply_id = ? AND user_id = ?').get(replyId, req.user.id);

  if (existing) {
    if (existing.emoji === emoji) {
      db.prepare('DELETE FROM reply_reactions WHERE id = ?').run(existing.id);
    } else {
      db.prepare('UPDATE reply_reactions SET emoji = ? WHERE id = ?').run(emoji, existing.id);
    }
  } else {
    db.prepare('INSERT INTO reply_reactions (reply_id, user_id, emoji) VALUES (?, ?, ?)').run(replyId, req.user.id, emoji);
  }

  const likes = db.prepare('SELECT COUNT(*) as count FROM reply_reactions WHERE reply_id = ? AND emoji = ?').get(replyId, 'like').count;
  const dislikes = db.prepare('SELECT COUNT(*) as count FROM reply_reactions WHERE reply_id = ? AND emoji = ?').get(replyId, 'dislike').count;
  const userReaction = db.prepare('SELECT emoji FROM reply_reactions WHERE reply_id = ? AND user_id = ?').get(replyId, req.user.id);

  sse.broadcast('reply-reaction', { replyId, likes, dislikes });
  res.json({ likes, dislikes, userReaction: userReaction ? userReaction.emoji : null });
});

// === Polls (unchanged) ===
router.post('/poll/:pollId/vote', requireLogin, (req, res) => {
  const { option_id } = req.body;
  const pollId = parseInt(req.params.pollId, 10);
  const optionId = parseInt(option_id, 10);

  const poll = db.prepare('SELECT id FROM polls WHERE id = ?').get(pollId);
  if (!poll) return res.status(404).json({ error: 'Poll not found' });

  const option = db.prepare('SELECT id FROM poll_options WHERE id = ? AND poll_id = ?').get(optionId, pollId);
  if (!option) return res.status(400).json({ error: 'Invalid option' });

  const existing = db.prepare('SELECT * FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(pollId, req.user.id);
  if (existing) {
    db.prepare('UPDATE poll_votes SET option_id = ? WHERE id = ?').run(optionId, existing.id);
  } else {
    db.prepare('INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)').run(pollId, optionId, req.user.id);
  }

  const options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY sort_order').all(pollId);
  const voteCounts = db.prepare('SELECT option_id, COUNT(*) as count FROM poll_votes WHERE poll_id = ? GROUP BY option_id').all(pollId);
  const voteMap = {};
  for (const vc of voteCounts) voteMap[vc.option_id] = vc.count;
  const totalVotes = db.prepare('SELECT COUNT(*) as count FROM poll_votes WHERE poll_id = ?').get(pollId).count;

  const pollData = {
    options: options.map(o => ({ id: o.id, text: o.option_text, votes: voteMap[o.id] || 0 })),
    totalVotes
  };

  sse.broadcast('poll-vote', { pollId, ...pollData });
  res.json({ ...pollData, userVote: optionId });
});

module.exports = router;
