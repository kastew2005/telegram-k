# TELEGRAM K backend

Node.js API for the private TELEGRAM K web client. It uses GramJS (Telegram MTProto) and must run as a separate backend service. GitHub Pages cannot run Node.js.

## Implemented API

- `GET /health` — service health check.
- `POST /api/unlock` and `POST /api/lock` — private app password gate.
- `GET /api/auth/status` — app and Telegram connection status.
- `POST /api/telegram/start` — request a Telegram login code.
- `POST /api/telegram/verify` — verify the code.
- `POST /api/telegram/password` — handle Telegram 2-step verification.
- `GET /api/chats` — fetch recent dialogs.
- `GET /api/chats/:id/messages` — fetch recent messages.
- `POST /api/chats/:id/messages` — send a message.
- `POST /api/telegram/logout` — disconnect and remove the saved Telegram session.

## Environment

Copy `.env.example` to `.env` for local development and set:

- `TG_API_ID` and `TG_API_HASH` — from https://my.telegram.org/apps.
- `APP_PASSWORD` — a separate long password to unlock this private web app.
- `SESSION_ENCRYPTION_KEY` — exactly 32 random bytes encoded as 64 hex characters. Generate with `openssl rand -hex 32`.
- `FRONTEND_ORIGINS` — comma-separated exact origins allowed to call the API.
- `DATA_DIR` — directory on a persistent disk for the encrypted Telegram session.
- `PORT` — supplied by the hosting provider.

Never commit real secrets. Do not send Telegram login codes, Telegram 2FA passwords, API hashes, app passwords, or session strings through ChatGPT or issue trackers.

## Run locally

```bash
cd server
cp .env.example .env
npm install
npm start
```

The example environment values are placeholders; the server intentionally refuses to start until all required secrets are configured.

## Security and deployment notes

- Telegram authorization is performed on the backend. The frontend never receives the MTProto session string.
- The saved Telegram session is encrypted with AES-256-GCM and written with restrictive file permissions. The host must provide persistent disk storage and preserve `SESSION_ENCRYPTION_KEY` across restarts.
- Browser access is restricted by exact CORS origins. Production cookies are HttpOnly, Secure, and SameSite=None for a cross-origin frontend.
- The backend also applies security headers, JSON size limits, and request rate limits.
- The in-memory browser unlock session and pending login challenge expire on process restart. The Telegram authorization session is persisted encrypted.
- Some mobile browsers restrict third-party cookies. A same-site custom domain for the frontend and API is the preferred production setup; verify cookie behavior on iOS Safari before public use.
- This initial API is a personal single-account scaffold, not a multi-user service. Do not expose it publicly until a private deployment and access policy have been verified.

Review Telegram's official requirements: https://core.telegram.org/api and https://core.telegram.org/mtproto/security_guidelines
