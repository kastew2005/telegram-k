# TELEGRAM K backend

Node.js API for the private TELEGRAM K web client. It uses GramJS (Telegram MTProto) and runs separately from GitHub Pages.

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
- `PORT` — supplied by the hosting provider.

### Persistent encrypted session storage

For a free-tier backend that may restart or scale to zero, configure Cloudflare R2 by setting all four variables:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

The backend encrypts the GramJS session with AES-256-GCM before writing it to R2. The encryption key remains a separate backend secret. Leave all four R2 variables empty only for local development or a host with a persistent disk. Never commit real secrets.

## Run locally

```bash
cd server
cp .env.example .env
npm install
npm start
```

The example values are placeholders; the server intentionally refuses to start until the required secrets are configured.

## Security and deployment notes

- Telegram authorization is performed on the backend. The frontend never receives the MTProto session string.
- The saved Telegram session is encrypted with AES-256-GCM before being written to local disk or R2.
- Browser access is restricted by exact CORS origins. Production cookies are HttpOnly, Secure, and SameSite=None. A short-lived bearer token is also returned on unlock and kept only in frontend memory (never localStorage) as a fallback for mobile browsers that block third-party cookies.
- The backend applies security headers, JSON size limits, and request rate limits.
- Browser unlock sessions and pending login challenges are held in memory and expire on process restart. The encrypted Telegram authorization session persists in R2.
- Some mobile browsers restrict third-party cookies. The in-memory bearer-token fallback supports cross-origin requests, but it is lost on reload and the user must unlock again. A same-site custom domain is still preferred.
- This is a personal single-account beta scaffold, not a multi-user service. Do not expose it publicly until deployment and access controls have been verified.

## Candidate free hosting

Koyeb currently documents one free web service per organization (512 MB RAM, 0.1 vCPU, 2 GB SSD), but it scales to zero after one hour without traffic and cannot use persistent volumes on the free instance. That is why R2 is used for the encrypted Telegram session rather than the instance filesystem. Free hosting is suitable for testing, not a production availability guarantee.

Cloudflare R2 currently includes a monthly free allowance for Standard storage (10 GB-month), Class A operations (1 million), and Class B operations (10 million). Check the current limits before deployment.

Review Telegram's official requirements: https://core.telegram.org/api and https://core.telegram.org/mtproto/security_guidelines

## Deployment plan: Koyeb + Cloudflare R2

The repository includes server/Dockerfile and server/.dockerignore. The free Koyeb web instance is intended for testing only: it has 512 MB RAM, 0.1 vCPU, 2 GB SSD, and sleeps after one hour without traffic. It cannot attach a persistent volume, so configure R2 before connecting Telegram.

1. Create a Cloudflare account and open Storage & databases → R2.
2. Create one Standard bucket, for example telegram-k-private.
3. Create an R2 S3 API token with read/write access limited to that bucket. Copy the Account ID, Access Key ID, and Secret Access Key into a password manager; do not send them in ChatGPT.
4. In Koyeb, create a Web Service from the GitHub repository kastew2005/telegram-k.
5. Set the service work directory / build context to server and choose the included Dockerfile.
6. Expose HTTP on port 8787 and configure health check path /health.
7. Add the following environment variables as encrypted secrets in Koyeb:
   - NODE_ENV=production
   - TG_API_ID
   - TG_API_HASH
   - APP_PASSWORD
   - SESSION_ENCRYPTION_KEY
   - FRONTEND_ORIGINS=https://kastew2005.github.io
   - R2_ACCOUNT_ID
   - R2_ACCESS_KEY_ID
   - R2_SECRET_ACCESS_KEY
   - R2_BUCKET=telegram-k-private
8. Deploy and verify the service health endpoint returns the JSON object with ok=true and service=telegram-k-api.
9. Only after the backend URL is live, set window.TK_API_URL in web/config.js to its HTTPS origin.

The R2 Standard free allowance currently includes 10 GB-month storage, 1 million Class A operations, and 10 million Class B operations per month. R2 requires adding the R2 subscription to the Cloudflare account; usage within the included allowance is free. Check the dashboard billing page before use.

Koyeb's free instance scales to zero after one hour without traffic and may take time to wake. This is suitable for initial testing, not guaranteed always-on service.
