/**
 * Markdown rendering for Bulletin Board posts
 * Sanitizes output to prevent XSS
 */
const { marked } = require('marked');

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true
});

/**
 * Render markdown content safely for board posts/replies
 * Strips dangerous HTML while preserving formatting
 */
function renderBoardMarkdown(text) {
  if (!text) return '';

  // Convert @mentions before markdown processing
  text = text.replace(/@([\w.]+)/g, '**@$1**');

  let html = marked.parse(text);

  // Strip dangerous tags (script, iframe, object, embed, form, input, style, link, meta)
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  html = html.replace(/<iframe\b[^>]*>.*?<\/iframe>/gi, '');
  html = html.replace(/<(object|embed|form|input|button|textarea|select|style|link|meta|base)\b[^>]*\/?>/gi, '');
  html = html.replace(/<\/(object|embed|form|input|button|textarea|select|style|link|meta|base)>/gi, '');

  // Strip event handlers
  html = html.replace(/\s+on\w+\s*=\s*(['"])[^'"]*\1/gi, '');
  html = html.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');

  // Strip javascript: URLs
  html = html.replace(/href\s*=\s*(['"])javascript:[^'"]*\1/gi, 'href=$1#$1');

  // Add mention styling
  html = html.replace(/<strong>@([\w.]+)<\/strong>/g, '<span class="mention">@$1</span>');

  return html;
}

module.exports = { renderBoardMarkdown };
