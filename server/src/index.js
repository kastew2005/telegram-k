import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import {
  createCipheriv, createDecipheriv, randomBytes, randomUUID,
  timingSafeEqual
} from "node:crypto";
import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "../data"));
const SESSION_FILE = path.join(DATA_DIR, "telegram.session.enc");
const PORT = Number(process.env.PORT || 8787);
const IS_PROD = process.env.NODE_ENV === "production";
const COOKIE_NAME = "tk_session";
const COOKIE_TTL_MS = 12 * 60 * 60 * 1000;

const required = ["TG_API_ID", "TG_API_HASH", "APP_PASSWORD", "SESSION_ENCRYPTION_KEY"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}
if (!/^[0-9a-fA-F]{64}$/.test(process.env.SESSION_ENCRYPTION_KEY)) {
  throw new Error("SESSION_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes).");
}
const apiId = Number(process.env.TG_API_ID);
if (!Number.isInteger(apiId) || apiId <= 0) throw new Error("TG_API_ID must be a positive integer.");

const encryptionKey = Buffer.from(process.env.SESSION_ENCRYPTION_KEY, "hex");
const r2Names = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
const r2Configured = r2Names.filter((name) => Boolean(process.env[name])).length;
if (r2Configured !== 0 && r2Configured !== r2Names.length) {
  throw new Error("Configure all four R2 variables or leave all four empty.");
}
const r2 = r2Configured === r2Names.length ? new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
}) : null;
const SESSION_OBJECT_KEY = "telegram-k/private/session.enc";
const appPassword = Buffer.from(process.env.APP_PASSWORD, "utf8");
const allowedOrigins = new Set(
  (process.env.FRONTEND_ORIGINS || "http://localhost:5173,http://localhost:8787")
    .split(",").map((v) => v.trim()).filter(Boolean)
);

const app = express();
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "16kb" }));

app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin) {
    if (!allowedOrigins.has(origin)) return res.status(403).json({ error: "Origin not allowed." });
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-8", legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });

const browserSessions = new Map();
const loginChallenges = new Map();
let telegramClient = null;
let dialogsCache = new Map();

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? ["", ""] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}
function setSessionCookie(res, token) {
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(token)}`, "HttpOnly", "Path=/", IS_PROD ? "SameSite=None" : "SameSite=Lax", `Max-Age=${Math.floor(COOKIE_TTL_MS / 1000)}`];
  if (IS_PROD) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; ${IS_PROD ? "SameSite=None; Secure" : "SameSite=Lax"}; Max-Age=0`);
}
function issueBrowserSession(res) {
  const token = randomBytes(32).toString("base64url");
  browserSessions.set(token, Date.now() + COOKIE_TTL_MS);
  setSessionCookie(res, token);
}
function requireBrowserSession(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const expires = token && browserSessions.get(token);
  if (!expires || expires < Date.now()) {
    if (token) browserSessions.delete(token);
    return res.status(401).json({ error: "App is locked. Unlock it to continue." });
  }
  next();
}
function encryptSession(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: ciphertext.toString("base64") });
}
function decryptSession(payload) {
  const record = JSON.parse(payload);
  if (record.v !== 1) throw new Error("Unsupported encrypted session format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(record.data, "base64")), decipher.final()]).toString("utf8");
}
async function persistTelegramSession(client) {
  const encrypted = encryptSession(client.session.save());
  if (r2) {
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET, Key: SESSION_OBJECT_KEY,
      Body: encrypted, ContentType: "application/octet-stream"
    }));
    return;
  }
  await mkdir(DATA_DIR, { recursive: true });
  const temp = `${SESSION_FILE}.tmp`;
  await writeFile(temp, encrypted, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, SESSION_FILE);
}
async function readPersistedSession() {
  if (r2) {
    try {
      const result = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: SESSION_OBJECT_KEY }));
      return await result.Body.transformToString();
    } catch (error) {
      if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }
  try { return await readFile(SESSION_FILE, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function deletePersistedSession() {
  if (r2) {
    await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: SESSION_OBJECT_KEY }));
    return;
  }
  try { await (await import("node:fs/promises")).unlink(SESSION_FILE); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
async function createTelegramClient(session = "") {
  const client = new TelegramClient(new StringSession(session), apiId, process.env.TG_API_HASH, {
    connectionRetries: 5,
    autoReconnect: true,
    requestRetries: 3
  });
  await client.connect();
  return client;
}
async function restoreSavedSession() {
  try {
    const encrypted = await readPersistedSession();
    if (!encrypted) return;
    const session = decryptSession(encrypted);
    const client = await createTelegramClient(session);
    if (await client.isUserAuthorized()) {
      telegramClient = client;
      console.log("Encrypted Telegram session restored.");
    } else {
      await client.disconnect();
    }
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not restore Telegram session:", error.message);
  }
}
function cleanText(value, max = 4000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}
function requireTelegram(req, res, next) {
  if (!telegramClient) return res.status(409).json({ error: "Telegram account is not connected yet." });
  next();
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "telegram-k-api" }));

app.post("/api/unlock", authLimiter, (req, res) => {
  const supplied = req.body?.password;
  if (typeof supplied !== "string" || !safeEqual(supplied, appPassword.toString("utf8"))) {
    return res.status(401).json({ error: "Incorrect app password." });
  }
  issueBrowserSession(res);
  res.json({ ok: true });
});

app.post("/api/lock", (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) browserSessions.delete(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/status", requireBrowserSession, (_req, res) => {
  res.json({ unlocked: true, telegramConnected: Boolean(telegramClient) });
});

app.post("/api/telegram/start", apiLimiter, authLimiter, requireBrowserSession, async (req, res) => {
  const phoneNumber = cleanText(req.body?.phoneNumber, 32);
  if (!/^\+[1-9]\d{6,14}$/.test(phoneNumber)) {
    return res.status(400).json({ error: "Enter the phone number in international format, for example +31612345678." });
  }
  let client;
  try {
    client = await createTelegramClient();
    const sent = await client.sendCode({ apiId, apiHash: process.env.TG_API_HASH }, phoneNumber);
    const challengeId = randomUUID();
    loginChallenges.set(challengeId, { client, phoneNumber, phoneCodeHash: sent.phoneCodeHash, expiresAt: Date.now() + 5 * 60 * 1000 });
    res.json({ challengeId, codeType: sent.isCodeViaApp ? "app" : "sms" });
  } catch (error) {
    if (client) await client.disconnect().catch(() => {});
    console.error("Telegram code request failed:", error.message);
    res.status(400).json({ error: "Telegram could not send a login code. Check the number and try again later." });
  }
});

app.post("/api/telegram/verify", apiLimiter, requireBrowserSession, async (req, res) => {
  const challengeId = cleanText(req.body?.challengeId, 64);
  const code = cleanText(req.body?.code, 16);
  const challenge = loginChallenges.get(challengeId);
  if (!challenge || challenge.expiresAt < Date.now()) {
    loginChallenges.delete(challengeId);
    return res.status(410).json({ error: "Login challenge expired. Request a new code." });
  }
  try {
    await challenge.client.signIn({
      phoneNumber: challenge.phoneNumber,
      phoneCodeHash: challenge.phoneCodeHash,
      phoneCode: code
    });
    telegramClient = challenge.client;
    loginChallenges.delete(challengeId);
    await persistTelegramSession(telegramClient);
    res.json({ ok: true, needsPassword: false });
  } catch (error) {
    if (error.errorMessage === "SESSION_PASSWORD_NEEDED" || error.message?.includes("SESSION_PASSWORD_NEEDED")) {
      res.json({ ok: true, needsPassword: true, challengeId });
    } else {
      console.error("Telegram code verification failed:", error.message);
      res.status(400).json({ error: "The code was not accepted. Check it and try again." });
    }
  }
});

app.post("/api/telegram/password", apiLimiter, requireBrowserSession, async (req, res) => {
  const challengeId = cleanText(req.body?.challengeId, 64);
  const password = req.body?.password;
  const challenge = loginChallenges.get(challengeId);
  if (!challenge || challenge.expiresAt < Date.now()) {
    loginChallenges.delete(challengeId);
    return res.status(410).json({ error: "Login challenge expired. Start again." });
  }
  if (typeof password !== "string" || password.length > 256) return res.status(400).json({ error: "Invalid password." });
  try {
    await challenge.client.checkPassword(password);
    telegramClient = challenge.client;
    loginChallenges.delete(challengeId);
    await persistTelegramSession(telegramClient);
    res.json({ ok: true });
  } catch (error) {
    console.error("Telegram 2FA verification failed:", error.message);
    res.status(401).json({ error: "The Telegram two-step verification password was not accepted." });
  }
});

app.get("/api/chats", apiLimiter, requireBrowserSession, requireTelegram, async (_req, res) => {
  try {
    const dialogs = await telegramClient.getDialogs({ limit: 60 });
    dialogsCache = new Map();
    const chats = dialogs.map((dialog) => {
      const id = String(dialog.id);
      dialogsCache.set(id, dialog.entity);
      const last = dialog.message;
      return {
        id,
        title: dialog.title || dialog.name || "Telegram chat",
        unreadCount: Number(dialog.unreadCount || 0),
        lastMessage: last?.message || "",
        lastMessageDate: last?.date ? new Date(last.date * 1000).toISOString() : null,
        isGroup: Boolean(dialog.isGroup),
        isChannel: Boolean(dialog.isChannel)
      };
    });
    res.json({ chats });
  } catch (error) {
    console.error("Could not load dialogs:", error.message);
    res.status(502).json({ error: "Could not load Telegram chats." });
  }
});

app.get("/api/chats/:id/messages", apiLimiter, requireBrowserSession, requireTelegram, async (req, res) => {
  const entity = dialogsCache.get(cleanText(req.params.id, 64));
  if (!entity) return res.status(404).json({ error: "Chat not found. Refresh the chat list." });
  try {
    const messages = await telegramClient.getMessages(entity, { limit: 40 });
    res.json({ messages: messages.map((message) => ({
      id: String(message.id),
      text: message.message || "",
      date: message.date ? new Date(message.date * 1000).toISOString() : null,
      outgoing: Boolean(message.out),
      senderId: message.senderId ? String(message.senderId) : null,
      media: Boolean(message.media)
    })).reverse() });
  } catch (error) {
    console.error("Could not load messages:", error.message);
    res.status(502).json({ error: "Could not load messages for this chat." });
  }
});

app.post("/api/chats/:id/messages", apiLimiter, requireBrowserSession, requireTelegram, async (req, res) => {
  const entity = dialogsCache.get(cleanText(req.params.id, 64));
  const message = cleanText(req.body?.message, 4096);
  if (!entity) return res.status(404).json({ error: "Chat not found. Refresh the chat list." });
  if (!message) return res.status(400).json({ error: "Message cannot be empty." });
  try {
    const sent = await telegramClient.sendMessage(entity, { message });
    res.json({ ok: true, messageId: String(sent.id) });
  } catch (error) {
    console.error("Could not send message:", error.message);
    res.status(502).json({ error: "Telegram could not send this message." });
  }
});

app.post("/api/telegram/logout", apiLimiter, requireBrowserSession, async (_req, res) => {
  if (telegramClient) {
    await telegramClient.disconnect().catch(() => {});
    telegramClient = null;
  }
  try { await deletePersistedSession(); }
  catch (error) { console.error("Could not remove encrypted session:", error.message); }
  dialogsCache.clear();
  res.json({ ok: true });
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled API error:", error.message);
  res.status(500).json({ error: "Unexpected server error." });
});

await restoreSavedSession();
app.listen(PORT, "0.0.0.0", () => console.log(`TELEGRAM K API listening on port ${PORT}`));
