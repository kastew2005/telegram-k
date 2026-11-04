# TELEGRAM K

A private, mobile-first Telegram client interface.

## Architecture
- `web/` — static frontend, suitable for GitHub Pages.
- `server/` — separate Node.js backend for Telegram MTProto. It must run on a server runtime; GitHub Pages cannot host it.
- Telegram API credentials belong only in backend environment secrets (`TG_API_ID`, `TG_API_HASH`). Never commit credentials or Telegram session data.

## Status
Initial secure project scaffold. Telegram authorization and messaging are not implemented yet.

## Development
Frontend: open `web/index.html` locally or publish the `web/` directory with GitHub Pages.
Backend setup is documented in `server/README.md`.

## Security
Never ask users to share Telegram login codes, passwords, 2FA passwords, API hashes, or session strings in chat or issue trackers. Follow Telegram's MTProto security requirements: https://core.telegram.org/mtproto/security_guidelines
