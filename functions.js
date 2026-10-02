import "./env.js";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import axios from "axios";
import sharp from "sharp";
import ytSearch from "yt-search";
import { downloadContentFromMessage } from "baileys";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOGO = String(process.env.LOGO_URL || "").trim();
const UA = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
let logoBuf = null;
async function makeFallbackLogo() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
    <defs>
      <radialGradient id="bg" cx="50%" cy="38%" r="75%">
        <stop offset="0%" stop-color="#0f2e1c"/>
        <stop offset="100%" stop-color="#040c07"/>
      </radialGradient>
      <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#36f08a"/>
        <stop offset="100%" stop-color="#0fae5e"/>
      </linearGradient>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="14" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="800" height="800" fill="url(#bg)"/>
    <circle cx="400" cy="320" r="168" fill="none" stroke="url(#ring)" stroke-width="16" filter="url(#glow)"/>
    <circle cx="400" cy="320" r="168" fill="none" stroke="#0a1f14" stroke-width="2"/>
    <path d="M320 260l100 60-100 60z" fill="url(#ring)" filter="url(#glow)"/>
    <text x="400" y="600" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="800" letter-spacing="4" fill="#eafff2">SYMPRAX</text>
    <text x="400" y="655" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="500" letter-spacing="10" fill="#36f08a">M D  B O T</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}
async function logoBuffer() {
  if (logoBuf && logoBuf.length > 1000) return logoBuf;
  const urls = [...new Set([LOGO].filter((u) => /^https?:\/\//i.test(u)))];
  for (const u of urls) {
    try {
      const b = Buffer.from(await (await axios.get(u, { timeout: 20000, responseType: "arraybuffer", headers: { "User-Agent": UA } })).data);
      const ok = b.length > 2000 && (b[0] === 0xff || b[0] === 0x89 || b[0] === 0x47 || (b[0] === 0x52 && b[1] === 0x49));
      if (ok) { logoBuf = await sharp(b).jpeg({ quality: 88 }).toBuffer(); return logoBuf; }
    } catch (e) {
      console.log("logo url fail:", u, e?.message || e);
    }
  }
  logoBuf = await makeFallbackLogo();
  return logoBuf;
}
logoBuffer().catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (j) => String(j || "").split("@")[0].split(":")[0];
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

// ---------- mini base de donnees (data.json) ----------
const DB_FILE = path.join(__dirname, "data.json");
const defaults = {
  settings: { mode: "public", autostatus: false, antidelete: false, autoreact: false, aonc: false },
  antilink: {}, welcome: {}, banned: [], users: {},
};
let db = JSON.parse(JSON.stringify(defaults));
try {
  const l = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  db = { ...db, ...l, settings: { ...defaults.settings, ...(l.settings || {}) } };
} catch {}
let _t = null;
function save() {
  clearTimeout(_t);
  _t = setTimeout(() => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch {} }, 500);
}
function user(jid) {
  const n = num(jid);
  db.users[n] = db.users[n] || { balance: 0, xp: 0, lastDaily: 0, cmds: 0 };
  return db.users[n];
}
const owners = () => (process.env.OWNER || "").split(",").map((x) => x.replace(/[^0-9]/g, "")).filter(Boolean);

// ---------- HTTP ----------
async function get(url, opt = {}) {
  return (await axios.get(url, { timeout: 30000, headers: { "User-Agent": UA }, ...opt })).data;
}
async function buf(url, opt = {}) {
  return Buffer.from(await get(url, { responseType: "arraybuffer", ...opt }));
}
function findMedia(o, kind, skip) {
  const out = [];
  (function w(v, k) {
    if (typeof v === "string") { if (/^https?:\/\//.test(v) && v !== skip) out.push({ v, k: String(k || "") }); }
    else if (Array.isArray(v)) v.forEach((x) => w(x, k));
    else if (v && typeof v === "object") for (const [kk, x] of Object.entries(v)) w(x, kk);
  })(o, "");
  const isImg = (u) => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u) || /thumb|cover|poster|preview|avatar/i.test(u);
  let c = out;
  if (kind === "video" || kind === "audio") c = out.filter((x) => !isImg(x.v) && !isImg(x.k));
  else if (kind === "image") c = out.filter((x) => /\.(jpe?g|png|webp)/i.test(x.v) || /image|img|pin|url/i.test(x.k));
  const pref = /download|dl|mp3|mp4|audio|video|hd|nowm|url|link/i;
  c = c.slice().sort((a, b) => pref.test(b.k) - pref.test(a.k));
  return [...new Set(c.map((x) => x.v))];
}
async function chain(urls, kind, skip) {
  for (const u of urls) {
    try {
      const d = await get(u, { timeout: 25000 });
      const l = findMedia(d, kind, skip);
      if (l.length) return l;
    } catch {}
  }
  return null;
}

// ---------- ffmpeg / yt-dlp ----------
function tmp(ext) { return path.join(os.tmpdir(), Date.now() + "_" + Math.random().toString(36).slice(2) + "." + ext); }
function ff(input, args, ext) {
  return new Promise((res, rej) => {
    const i = tmp("in"), o = tmp(ext);
    fs.writeFileSync(i, input);
    const clean = () => { fs.rmSync(i, { force: true }); fs.rmSync(o, { force: true }); };
    const p = spawn("ffmpeg", ["-y", "-i", i, ...args, o]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { clean(); rej(e); });
    p.on("close", (code) => {
      try { const b = code === 0 ? fs.readFileSync(o) : null; clean(); b ? res(b) : rej(new Error("ffmpeg: " + err.slice(-200))); }
      catch (e) { clean(); rej(e); }
    });
  });
}
function ytdlp(url, kind) {
  return new Promise((res, rej) => {
    const id = "yt" + Date.now() + Math.random().toString(36).slice(2, 6);
    const base = path.join(os.tmpdir(), id);
    const args = kind === "audio"
      ? ["-x", "--audio-format", "mp3", "-o", base + ".%(ext)s"]
      : ["-f", "best[height<=480][ext=mp4]/best[height<=480]/best", "--merge-output-format", "mp4", "-o", base + ".%(ext)s"];
    // Contournement anti-bot YouTube : ces clients (android/tv_embedded) passent plus souvent que le client web par defaut sur IP cloud
    args.push("--extractor-args", "youtube:player_client=android,tv_embedded,web_embedded");
    if (process.env.YT_COOKIES_FILE && fs.existsSync(process.env.YT_COOKIES_FILE)) args.push("--cookies", process.env.YT_COOKIES_FILE);
    args.push("--no-playlist", "--max-filesize", "60M", "--no-warnings", url);
    const p = spawn("yt-dlp", args);
    let err = "";
    const kill = setTimeout(() => p.kill("SIGKILL"), 120000);
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(kill); rej(e); });
    p.on("close", (code) => {
      clearTimeout(kill);
      const f = fs.readdirSync(os.tmpdir()).find((x) => x.startsWith(id));
      if (code === 0 && f) { const fp = path.join(os.tmpdir(), f); const b = fs.readFileSync(fp); fs.rmSync(fp, { force: true }); res(b); }
      else rej(new Error(err.slice(-200) || "yt-dlp echec"));
    });
  });
}
async function ytGet(url, kind) {
  try { return { buffer: await ytdlp(url, kind) }; } catch (e) { console.log("yt-dlp:", String(e.message).slice(0, 150)); }
  const enc = encodeURIComponent(url);
  const t = kind === "audio" ? "ytmp3" : "ytmp4";
  const l = await chain([
    `https://api.siputzx.my.id/api/d/${t}?url=${enc}`,
    `https://api.ryzendesu.vip/api/downloader/${t}?url=${enc}`,
    `https://api.agatz.xyz/api/${t}?url=${enc}`,
  ], kind, url);
  if (l && l.length) return { url: l[0] };
  throw new Error("Telechargement impossible pour le moment (YouTube ou APIs bloques). Reessaie plus tard.");
}
async function resolveYT(text) {
  const m = String(text).match(/(?:youtu\.be\/|v=|shorts\/)([\w-]{11})/);
  if (m) { const v = await ytSearch({ videoId: m[1] }).catch(() => null); if (v) return v; return { title: "YouTube", url: "https://www.youtube.com/watch?v=" + m[1], timestamp: "?", author: { name: "?" } }; }
  return (await ytSearch(text)).videos[0] || null;
}

// ---------- medias WhatsApp ----------
function unwrap(msg) {
  if (!msg) return null;
  const inner = msg.viewOnceMessageV2?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2Extension?.message ||
    msg.ephemeralMessage?.message || msg.documentWithCaptionMessage?.message;
  return inner ? unwrap(inner) : msg;
}
function pickMedia(msg, types) {
  msg = unwrap(msg);
  if (!msg) return null;
  for (const t of types) if (msg[t]) return { type: t.replace("Message", ""), node: msg[t], name: t };
  return null;
}
async function dl(x) {
  const s = await downloadContentFromMessage(x.node, x.type);
  const chunks = [];
  for await (const ch of s) chunks.push(ch);
  return Buffer.concat(chunks);
}
async function translate(text, to = "fr") {
  const d = await get("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" + to + "&dt=t&q=" + encodeURIComponent(text));
  return d[0].map((x) => x[0]).join("");
}

export { LOGO, logoBuffer, sleep, num, rnd, db, save, user, owners, get, buf, findMedia, chain, ff, ytGet, resolveYT, unwrap, pickMedia, dl, translate, ytSearch };
