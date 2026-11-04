# TELEGRAM K backend

This service must run on a persistent Node.js hosting provider. GitHub Pages only serves static files and cannot run this backend.

## Required backend secrets
- `TG_API_ID`
- `TG_API_HASH`
- `SESSION_ENCRYPTION_KEY` — a strong random key generated for this deployment

Do not put these values in frontend files, GitHub commits, logs, or support chats. Do not store Telegram session strings in browser localStorage. Encrypt persisted authorization sessions at rest and restrict access to the owner.

## Planned implementation
1. Add a maintained MTProto client library and server-side authorization flow.
2. Add rate limits, CSRF/origin checks, secure cookies, and encrypted session storage.
3. Implement only the API routes required by the web client.
4. Add explicit logout/revoke-session handling and avoid logging codes or credentials.

No Telegram login or messaging endpoints are exposed in this initial scaffold. See https://core.telegram.org/mtproto and https://core.telegram.org/mtproto/security_guidelines before implementation.
