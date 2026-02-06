# Quest Planner — Project Instructions

## Development & Testing Workflow

When making code changes, ALWAYS follow this workflow:

### 1. Start Test Server
- Run `npm start` in background
- Provide test URL and credentials to user

### 2. Test Credentials
All test users have password: `test123`

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `test123` |
| Player | `player1` | `test123` |

If passwords need reset, run:
```js
node -e "
const bcrypt = require('bcryptjs');
const db = require('better-sqlite3')('./data/dndplanning.db');
const hash = bcrypt.hashSync('test123', 10);
db.prepare('UPDATE users SET password = ?').run(hash);
db.close();
"
```

### 3. Make Changes (NO versioning yet)
- Implement requested features/fixes
- Do NOT update version numbers
- Do NOT commit to git

### 4. User Testing & Iteration
- User tests on localhost:3000
- If issues found → fix and restart server
- Repeat until user confirms "OK" or "puštaj"

### 5. Final Release (ONLY after user confirms)
Once user says "OK", "puštaj", "sve je dobro", etc:
1. Update README.md (version + changelog)
2. Update What's New modal in `views/partials/foot.ejs`
3. Bump version in `package.json`
4. Bump cache version in `public/sw.js`
5. Git commit: `vX.X.X: short description`
6. Git tag: `vX.X.X`
7. Git push: `git push origin main --tags`
8. GitHub Release: `gh release create vX.X.X`
9. **STOP the test server** to free resources

## Playwright Agents

When user requests Playwright-based agents (code review, design review, or any agent using browser automation):

1. **STOP localhost:3000 first** — ensure clean environment before spawning agents
2. **Do NOT pre-start the server** — let agents start the server themselves as needed
3. Agents manage their own server lifecycle for isolation

## Release Notes Format

```
## What's New
- (new features)

## Bug Fixes
- (bug fixes, or "None" if no fixes)

## Support the Project
If you enjoy Quest Planner, consider supporting development:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/nenadjokic)
[![PayPal](https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/nenadjokicRS)
```

## Git Rules

- **NEVER use `git push --force`** — production server uses `git pull`; force push breaks that
- **NEVER use `git commit --amend`** — always create NEW commits
- If a fix is needed after push, increment patch version and make new commit

## Version Numbering

- Always increment the THIRD decimal (patch): `0.9.28 -> 0.9.29`
- When patch reaches 9, continue to 10, 11, etc: `0.9.9 -> 0.9.10` (NOT `0.10.0`)
- Only bump minor/major when explicitly requested

## Tech Stack Reference

- Backend: Node.js + Express + EJS + SQLite (better-sqlite3)
- Frontend: Vanilla JS, CSS custom properties, MedievalSharp + Crimson Text fonts
- PWA icons: `/public/icons/icon-192.png`, `/public/icons/icon-512.png`
- Main CSS: `/public/css/style.css`
- Version source of truth: `package.json`
- What's New modal: `views/partials/foot.ejs`
- Changelog: bottom of `README.md`

## External APIs

- **Open5e API** (`https://api.open5e.com/v2/`) — D&D 5e reference data
  - Species: `/v2/species/`
  - Classes: `/v2/classes/`
  - Spells: `/v2/spells/`
  - Items: `/v2/items/`
  - Search by name: `?name__icontains=query`
  - Filter by level: `?level=0` (cantrips), `?level=1`, etc.
