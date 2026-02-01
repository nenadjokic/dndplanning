# Quest Planner — Project Instructions

## Release Workflow (ALWAYS follow after completing work)

After finishing all code changes, ALWAYS perform these steps in order:

1. **Update README.md** — bump version in header and "Latest release" line; add a new changelog entry (### vX.X.X) above the previous version with all changes
2. **Update What's New popup** — edit `views/partials/foot.ejs` whatsnew-content section with the new changes, using two sub-sections: "What's New" (h3) and "Bug Fixes" (h3)
3. **Bump version in package.json** — always increment the THIRD decimal (patch) unless explicitly told otherwise (e.g. 0.8.1 -> 0.8.2 -> 0.8.3)
4. **Bump service worker cache** — increment the cache version number in `public/sw.js` (CACHE_NAME)
5. **Git commit** — commit all changes with message format: `vX.X.X: short description`
6. **Git tag** — create tag `vX.X.X`
7. **Git push** — push to origin main with tags: `git push origin main --tags`
8. **GitHub Release** — create a release using `gh release create vX.X.X` with these three sections:

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

- **NEVER use `git push --force`** — the production server pulls with `git pull`; force push breaks that and causes divergent branches
- **NEVER use `git commit --amend`** — always create a NEW commit; amending rewrites history and causes the same force-push problem
- If a small fix is needed after a push, increment the patch version and make a new commit (e.g. 0.8.1 -> 0.8.2)

## Tech Stack Reference

- Backend: Node.js + Express + EJS + SQLite (better-sqlite3)
- Frontend: Vanilla JS, CSS custom properties, MedievalSharp + Crimson Text fonts
- PWA icons: `/public/icons/icon-192.png`, `/public/icons/icon-512.png`
- Main CSS: `/public/css/style.css`
- Version source of truth: `package.json`
- What's New modal: `views/partials/foot.ejs`
- Changelog: bottom of `README.md`
