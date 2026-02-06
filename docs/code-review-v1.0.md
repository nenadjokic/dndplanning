# Quest Planner v1.0 Code Review Report

**Review Date:** February 6, 2026
**Reviewer:** Code Review Agent (Live Playwright Testing + Static Analysis)
**Test Environment:** localhost:3000
**Test Credentials:** admin/test123
**Version Reviewed:** 0.9.28

---

## Executive Summary

**Overall Verdict: REQUEST CHANGES - Critical Security Issues Must Be Fixed**

Quest Planner is a well-architected D&D session scheduling application with clean code organization, proper input sanitization for XSS, and parameterized SQL queries. However, it has **three critical security vulnerabilities** that must be addressed before any v1.0 release:

1. **MISSING CSRF Protection** - All POST routes are vulnerable
2. **NO Rate Limiting** - Login and API endpoints can be brute-forced
3. **Weak Fallback Session Secret** - Default secret is publicly visible in code

### Scores

| Category | Score |
|----------|-------|
| SQL Injection Prevention | 10/10 PASS |
| XSS Protection | 10/10 PASS |
| CSRF Protection | 0/10 FAIL |
| Rate Limiting | 0/10 FAIL |
| Authentication | 8/10 GOOD |
| Authorization | 9/10 GOOD |
| Code Quality | 8/10 GOOD |
| Architecture | 9/10 EXCELLENT |

---

## Live Testing Results (Playwright)

### XSS Protection Test

**Test:** Posted `<script>alert('XSS')</script> Test post` to bulletin board

**Result: PASS**
- Payload rendered as plain text
- No script execution
- EJS templates properly escape HTML

### Console Errors

**Result: MINOR**
- Only error: `favicon.ico` 404 (cosmetic)
- Warning: Three.js library version mismatch (non-critical)

### Network Requests

**Result: PASS**
- API endpoints require authentication
- No sensitive data in network responses
- SSE properly validates `req.user` before streaming

---

## CRITICAL SECURITY ISSUES (Must Fix Before v1.0)

### 1. [BLOCKER] Missing CSRF Protection

**Severity:** CRITICAL
**Risk:** High - All forms vulnerable to Cross-Site Request Forgery

**Issue:**
- NO CSRF tokens in any forms
- No `csurf` package in dependencies
- Attackers can perform actions on behalf of logged-in users

**Vulnerable Routes (30+ endpoints):**
- POST `/login` - Can force login to attacker account
- POST `/sessions/:id/confirm` - Can confirm/cancel sessions
- POST `/admin/users/:id/delete` - Can delete users
- POST `/board` - Can post spam
- POST `/votes/:sessionId` - Can manipulate votes
- All other POST routes

**Remediation:**
```javascript
// server.js
const csrf = require('csurf');
const csrfProtection = csrf({ cookie: false });

app.use(csrfProtection);
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});
```

```html
<!-- All forms -->
<input type="hidden" name="_csrf" value="<%= csrfToken %>">
```

---

### 2. [BLOCKER] No Rate Limiting

**Severity:** CRITICAL
**Risk:** High - Brute force attacks, API abuse

**Issue:**
- No rate limiting on `/login` endpoint
- No rate limiting on API routes
- Attackers can perform unlimited password guessing

**Remediation:**
```javascript
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many login attempts, please try again later.'
});

app.post('/login', loginLimiter, authRoutes);

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60
});

app.use('/api/', apiLimiter);
```

---

### 3. [BLOCKER] Weak Fallback Session Secret

**Location:** `server.js:56`

```javascript
secret: process.env.SESSION_SECRET || 'fallback-secret',
```

**Issue:**
- If `SESSION_SECRET` is not set, app uses hardcoded `'fallback-secret'`
- This secret is publicly visible in the GitHub repository
- Attackers can forge session cookies

**Remediation:**
```javascript
if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required');
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  // ... rest of config
}));
```

---

## MODERATE SECURITY ISSUES

### 4. Dependency Vulnerabilities

**npm audit results:**
- `form-data <2.5.4` (CRITICAL)
- `qs <6.14.1` (HIGH)
- `tar <=7.5.6` (HIGH)

**Vulnerable Package:** `node-telegram-bot-api@0.67.0`

**Remediation:**
```bash
npm audit fix --force
# Or remove Telegram integration if not used
```

---

### 5. Weak Password Requirements

**Location:** `routes/auth.js`

**Current:** Minimum 4 characters
**Recommended:** Minimum 8 characters

```javascript
if (password.length < 8) {
  req.flash('error', 'Password must be at least 8 characters.');
  return res.redirect('/register');
}
```

---

## CODE QUALITY FINDINGS

### SQL Injection Prevention: PASS

All queries use parameterized statements:
```javascript
db.prepare('SELECT * FROM users WHERE username = ?').get(username)
db.prepare('INSERT INTO votes (slot_id, user_id, status) VALUES (?, ?, ?)').run(...)
```

**Verdict:** No SQL injection vulnerabilities found. Excellent use of prepared statements.

---

### XSS Protection: PASS

**Server-Side:** EJS templates escape HTML
```javascript
<%- post.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') %>
```

**Client-Side:** JavaScript escapes before inserting
```javascript
function escapeHtml(str) {
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
```

---

### Authentication & Authorization: GOOD

**Middleware:** Proper role-based access control
```javascript
requireLogin(req, res, next)  // Proper redirect
requireDM(req, res, next)     // Role check (dm or admin)
requireAdmin(req, res, next)  // Admin-only check
```

**Password Hashing:** bcrypt with 10 rounds (secure)

---

### Architecture: EXCELLENT

**Pattern:** Routes → Controllers → Database

**File Structure:**
```
server.js (424 LOC)
routes/ (3,417 LOC total)
  - sessions.js (643 LOC)
  - profile.js (405 LOC)
  - admin.js (336 LOC)
  - board.js (323 LOC)
db/connection.js (332 LOC)
helpers/ (6 utility modules)
```

**Total Backend LOC:** ~3,800

---

### SSE Implementation: GOOD

```javascript
function addClient(res) {
  clients.add(res);

  const keepalive = setInterval(() => {
    res.write(':keepalive\n\n');
  }, 30000);

  res.on('close', () => {
    clearInterval(keepalive);
    clients.delete(res);
  });
}
```

**Minor Concern:** No maximum client limit. Recommend adding:
```javascript
const MAX_SSE_CLIENTS = 500;

function addClient(res) {
  if (clients.size >= MAX_SSE_CLIENTS) {
    res.status(503).end('Server at capacity');
    return;
  }
  // ...
}
```

---

## Security Checklist Summary

| Area | Status | Notes |
|------|--------|-------|
| SQL Injection | ✅ PASS | Parameterized queries throughout |
| XSS | ✅ PASS | Proper escaping in templates + client JS |
| CSRF | ❌ FAIL | **No CSRF protection** |
| Rate Limiting | ❌ FAIL | **No rate limits** |
| Session Security | ⚠️ PARTIAL | Good config, weak fallback secret |
| Authentication | ✅ PASS | Proper bcrypt + middleware |
| Authorization | ✅ PASS | Role checks on all protected routes |
| Input Validation | ✅ PASS | Username, URL, content validation |
| Dependency Security | ⚠️ MODERATE | Telegram bot dep has vulnerabilities |
| Password Strength | ⚠️ WEAK | Min 4 chars (should be 8+) |

---

## STRENGTHS

1. **Clean Architecture** - Well-organized routes, proper separation
2. **SQL Injection Prevention** - 100% parameterized queries
3. **XSS Protection** - Robust escaping on server and client
4. **Authorization** - Proper role checks (admin, DM, player)
5. **Code Readability** - Clear variable names, good comments
6. **SSE Implementation** - Proper cleanup, no memory leaks
7. **PWA Support** - Service workers, push notifications
8. **Image URL Validation** - Whitelist-based approach

---

## BEFORE MERGE CHECKLIST

### Critical (Must Fix)

```
[ ] 1. Add CSRF protection (csurf package) - All POST routes
[ ] 2. Add rate limiting (express-rate-limit) - Login + API
[ ] 3. Enforce SESSION_SECRET - Throw error if not set
[ ] 4. Fix dependency vulnerabilities - npm audit fix
```

### Important (Should Fix)

```
[ ] 5. Increase password minimum from 4 to 8 characters
[ ] 6. Add CSP headers for image sources
[ ] 7. Add SSE client limit (max 500 connections)
[ ] 8. Add favicon.ico (eliminate 404 error)
```

### Nice to Have

```
[ ] 9. Optimize N+1 queries on session detail page
[ ] 10. Add logging middleware (Morgan)
[ ] 11. Add error tracking (Sentry)
[ ] 12. Add integration tests
```

---

## Codebase Statistics

- **Total Backend LOC:** ~3,800
- **Total Routes:** 17 files
- **Total API Endpoints:** 50+
- **Database Tables:** 25+
- **EJS Templates:** 28 files
- **Client-side JS:** ~2,000 LOC

**Tech Stack:**
- Node.js + Express.js
- SQLite (better-sqlite3) with WAL mode
- EJS templating
- Vanilla JavaScript
- Three.js + cannon-es (3D dice roller)
- Leaflet.js (maps)
- Chart.js (analytics)
- Server-Sent Events (real-time)

---

## Final Recommendation

**APPROVE WITH CHANGES**

Quest Planner is well-built with clean code and good security fundamentals. However, **three critical security issues must be fixed before v1.0:**

1. CSRF protection (all POST routes)
2. Rate limiting (login + API)
3. Session secret enforcement

**Estimated Fix Time:** 2-4 hours

Once fixed, the application is production-ready for small D&D groups (5-20 users).

---

**Review Complete:** 2026-02-06
**Method:** Live Playwright testing + Static code analysis
