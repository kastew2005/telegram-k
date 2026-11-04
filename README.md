# TELEGRAM K

A private, mobile-first Telegram client interface built as a web app.

## Project structure

- `web/` — responsive frontend for GitHub Pages.
- `server/` — Node.js + GramJS backend using Telegram MTProto.
- `server/README.md` — backend setup, routes, secrets, and deployment notes.

## Current implementation

- Premium mobile-first messenger interface.
- Private app unlock screen.
- Telegram phone/code/2-step verification flow handled by the backend.
- Recent chat list, message history, and text sending API.
- AES-256-GCM encrypted Telegram session persistence, with optional Cloudflare R2 storage.
- CORS origin allowlist, HttpOnly session cookies, security headers, and API rate limits.
- GitHub Actions workflows for Pages publishing and backend syntax/dependency checks.

## Important

The frontend and backend are separate services. GitHub Pages hosts only the static frontend; it cannot run the Node.js MTProto backend. The backend still needs to be deployed and configured with private environment secrets before Telegram login can work.

Do not commit or share Telegram API hashes, login codes, 2FA passwords, app passwords, or session strings. See https://core.telegram.org/mtproto/security_guidelines.
