const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const { notifyMentions } = require('../helpers/notifications');
const sse = require('../helpers/sse');
const router = express.Router();

// Setup upload directory for board images
const uploadDir = path.join(__dirname, '..', 'data', 'uploads', 'board');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

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

  // Load reactions for posts
  const postReactions = {};
  const userPostReactions = {};
  if (postIds.length > 0) {
    const ph = postIds.map(() => '?').join(',');
    const reactions = db.prepare(`SELECT post_id, emoji, COUNT(*) as count FROM post_reactions WHERE post_id IN (${ph}) GROUP BY post_id, emoji`).all(...postIds);
    for (const r of reactions) {
      if (!postReactions[r.post_id]) postReactions[r.post_id] = { likes: 0, dislikes: 0 };
      if (r.emoji === 'like') postReactions[r.post_id].likes = r.count;
      else postReactions[r.post_id].dislikes = r.count;
    }
    const userReactions = db.prepare(`SELECT post_id, emoji FROM post_reactions WHERE post_id IN (${ph}) AND user_id = ?`).all(...postIds, req.user.id);
    for (const ur of userReactions) {
      userPostReactions[ur.post_id] = ur.emoji;
    }
  }

  // Load reactions for replies
  const allReplyIds = [];
  for (const pid of postIds) {
    if (replyMap[pid]) {
      for (const r of replyMap[pid]) {
        allReplyIds.push(r.id);
      }
    }
  }
  const replyReactions = {};
  const userReplyReactions = {};
  if (allReplyIds.length > 0) {
    const ph = allReplyIds.map(() => '?').join(',');
    const reactions = db.prepare(`SELECT reply_id, emoji, COUNT(*) as count FROM reply_reactions WHERE reply_id IN (${ph}) GROUP BY reply_id, emoji`).all(...allReplyIds);
    for (const r of reactions) {
      if (!replyReactions[r.reply_id]) replyReactions[r.reply_id] = { likes: 0, dislikes: 0 };
      if (r.emoji === 'like') replyReactions[r.reply_id].likes = r.count;
      else replyReactions[r.reply_id].dislikes = r.count;
    }
    const userReactions = db.prepare(`SELECT reply_id, emoji FROM reply_reactions WHERE reply_id IN (${ph}) AND user_id = ?`).all(...allReplyIds, req.user.id);
    for (const ur of userReactions) {
      userReplyReactions[ur.reply_id] = ur.emoji;
    }
  }

  // Load polls for posts
  const postPolls = {};
  if (postIds.length > 0) {
    const ph = postIds.map(() => '?').join(',');
    const polls = db.prepare(`SELECT * FROM polls WHERE post_id IN (${ph})`).all(...postIds);
    for (const poll of polls) {
      const options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY sort_order').all(poll.id);
      const voteCounts = db.prepare('SELECT option_id, COUNT(*) as count FROM poll_votes WHERE poll_id = ? GROUP BY option_id').all(poll.id);
      const voteMap = {};
      for (const vc of voteCounts) voteMap[vc.option_id] = vc.count;
      const userVote = db.prepare('SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(poll.id, req.user.id);
      const totalVotes = db.prepare('SELECT COUNT(*) as count FROM poll_votes WHERE poll_id = ?').get(poll.id).count;
      postPolls[poll.post_id] = {
        ...poll,
        options: options.map(o => ({ ...o, votes: voteMap[o.id] || 0 })),
        userVote: userVote ? userVote.option_id : null,
        totalVotes
      };
    }
  }

  const allUsers = db.prepare('SELECT username FROM users ORDER BY username').all();
  res.render('board', { posts, replyMap, allUsers, postReactions, userPostReactions, replyReactions, userReplyReactions, postPolls });
});

// Image URL validation helper
function isValidImageUrl(url) {
  if (!url) return false;
  url = url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  // Allow common image hosts and extensions
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

router.post('/', requireLogin, boardImageUpload.single('image_file'), (req, res) => {
  const { content, image_url, poll_question } = req.body;
  // Express with extended:true parses poll_options[] as poll_options
  let pollOptions = req.body.poll_options || req.body['poll_options[]'];
  if (pollOptions && !Array.isArray(pollOptions)) pollOptions = [pollOptions];

  if (!content || !content.trim()) {
    req.flash('error', 'Post content is required.');
    return res.redirect('/board');
  }

  // Determine image URL: prioritize uploaded file over URL
  let validImageUrl = null;

  // Check if file was uploaded
  if (req.file) {
    // Use local path for uploaded file
    validImageUrl = '/uploads/board/' + req.file.filename;
  }
  // Otherwise check if URL was provided
  else if (image_url && image_url.trim()) {
    if (isValidImageUrl(image_url)) {
      validImageUrl = image_url.trim();
    } else {
      req.flash('error', 'Invalid image URL. Use direct image links or Giphy/Tenor/Imgur URLs.');
      return res.redirect('/board');
    }
  }

  const result = db.prepare('INSERT INTO posts (user_id, content, image_url) VALUES (?, ?, ?)').run(req.user.id, content.trim(), validImageUrl);
  const postId = result.lastInsertRowid;

  // Broadcast new comment
  sse.broadcast('new-comment', {
    username: req.user.username,
    postId: postId
  });

  // Create poll if question and at least 2 options provided
  if (poll_question && poll_question.trim() && pollOptions) {
    const validOptions = pollOptions.filter(o => o && o.trim());
    if (validOptions.length >= 2) {
      const pollResult = db.prepare('INSERT INTO polls (post_id, user_id, question) VALUES (?, ?, ?)').run(postId, req.user.id, poll_question.trim());
      const pollId = pollResult.lastInsertRowid;
      for (let i = 0; i < validOptions.length; i++) {
        db.prepare('INSERT INTO poll_options (poll_id, option_text, sort_order) VALUES (?, ?, ?)').run(pollId, validOptions[i].trim(), i);
      }
      // Broadcast poll created
      sse.broadcast('poll-created', {
        username: req.user.username,
        question: poll_question.trim()
      });
    }
  }

  notifyMentions(content.trim(), req.user.id, req.user.username, '/board');
  req.flash('success', 'Message posted to the board.');
  res.redirect('/board');
});

router.post('/:id/reply', requireLogin, (req, res) => {
  const { content, image_url } = req.body;
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) {
    req.flash('error', 'Post not found.');
    return res.redirect('/board');
  }
  if (!content || !content.trim()) {
    req.flash('error', 'Reply content is required.');
    return res.redirect('/board');
  }

  // Validate image URL if provided
  let validImageUrl = null;
  if (image_url && image_url.trim()) {
    if (isValidImageUrl(image_url)) {
      validImageUrl = image_url.trim();
    }
  }

  db.prepare('INSERT INTO replies (post_id, user_id, content, image_url) VALUES (?, ?, ?, ?)').run(post.id, req.user.id, content.trim(), validImageUrl);

  // Broadcast new reply
  sse.broadcast('new-comment', {
    username: req.user.username
  });

  notifyMentions(content.trim(), req.user.id, req.user.username, '/board');
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
  db.prepare('DELETE FROM post_reactions WHERE post_id = ?').run(post.id);
  db.prepare('DELETE FROM replies WHERE post_id = ?').run(post.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  req.flash('success', 'Post deleted.');
  res.redirect('/board');
});

// --- Reactions ---

router.post('/:postId/react', requireLogin, (req, res) => {
  const { emoji } = req.body;
  const postId = parseInt(req.params.postId, 10);

  if (!['like', 'dislike'].includes(emoji)) {
    return res.status(400).json({ error: 'Invalid reaction type' });
  }

  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

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

  // Broadcast to all clients
  sse.broadcast('post-reaction', { postId, likes, dislikes });

  // Broadcast like activity
  if (emoji === 'like' && (!existing || existing.emoji !== 'like')) {
    sse.broadcast('like-activity', {
      username: req.user.username,
      postId: postId
    });
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
  if (!reply) {
    return res.status(404).json({ error: 'Reply not found' });
  }

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

  // Broadcast to all clients
  sse.broadcast('reply-reaction', { replyId, likes, dislikes });

  res.json({ likes, dislikes, userReaction: userReaction ? userReaction.emoji : null });
});

// --- Polls ---

router.post('/poll/:pollId/vote', requireLogin, (req, res) => {
  const { option_id } = req.body;
  const pollId = parseInt(req.params.pollId, 10);
  const optionId = parseInt(option_id, 10);

  const poll = db.prepare('SELECT id FROM polls WHERE id = ?').get(pollId);
  if (!poll) {
    return res.status(404).json({ error: 'Poll not found' });
  }

  const option = db.prepare('SELECT id FROM poll_options WHERE id = ? AND poll_id = ?').get(optionId, pollId);
  if (!option) {
    return res.status(400).json({ error: 'Invalid option' });
  }

  // Upsert vote
  const existing = db.prepare('SELECT * FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(pollId, req.user.id);
  if (existing) {
    db.prepare('UPDATE poll_votes SET option_id = ? WHERE id = ?').run(optionId, existing.id);
  } else {
    db.prepare('INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)').run(pollId, optionId, req.user.id);
  }

  // Return updated results
  const options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY sort_order').all(pollId);
  const voteCounts = db.prepare('SELECT option_id, COUNT(*) as count FROM poll_votes WHERE poll_id = ? GROUP BY option_id').all(pollId);
  const voteMap = {};
  for (const vc of voteCounts) voteMap[vc.option_id] = vc.count;
  const totalVotes = db.prepare('SELECT COUNT(*) as count FROM poll_votes WHERE poll_id = ?').get(pollId).count;

  const pollData = {
    options: options.map(o => ({ id: o.id, text: o.option_text, votes: voteMap[o.id] || 0 })),
    totalVotes
  };

  // Broadcast to all clients
  sse.broadcast('poll-vote', { pollId, ...pollData });

  res.json({
    ...pollData,
    userVote: optionId
  });
});

module.exports = router;
