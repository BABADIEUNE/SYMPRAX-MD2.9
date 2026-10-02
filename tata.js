import fs from "fs";
import path from "path";
import * as baileysNS from "baileys";
const makeWASocket = baileysNS.default || baileysNS.makeWASocket;
const { useMultiFileAuthState, Browsers, DisconnectReason } = baileysNS;
const fetchLatestBaileysVersion = baileysNS.fetchLatestBaileysVersion;
import P from "pino";
import * as webpair from "./webpair.js";
import * as F from "./functions.js";
import * as S from "./snowi.js";
const { db } = F;

const store = new Map();
const EMOJIS = ["❤️", "🔥", "😂", "👍", "😎", "🙏", "💯", "✨"];
const antiCallNotified = new Set();
const PAIR_NUMBER = String(process.env.PAIR_NUMBER || "243986128356").replace(/[^0-9]/g, "");
let lastCodeAt = 0;
const CODE_GRACE_MS = 90000;
async function askPairCode(sock) {
  if (sock.__dead || sock.authState.creds.registered || Date.now() - lastCodeAt < CODE_GRACE_MS || PAIR_NUMBER.length < 7) return;
  try {
    const code = await sock.requestPairingCode(PAIR_NUMBER);
    lastCodeAt = Date.now();
    webpair.setCode(code);
    console.log("\n==============================================");
    console.log("  CODE DE LIAISON POUR " + PAIR_NUMBER + " :  " + code);
    console.log("  Tu as environ 90 secondes pour l'entrer.");
    console.log("  WhatsApp > Appareils lies > Lier avec code");
    console.log("==============================================\n");
  } catch (e) {
    console.log(`Pair code echoue -> ${e?.message || e} (statut: ${e?.output?.statusCode ?? "?"})`);
  }
}
let aoncTimer = null;
let failCount = 0;
let startLock = false;
let currentSock = null;
let sockGen = 0;
const SESSION_DIR = path.join(process.cwd(), "session");

function wipeSession() {
  try {
    if (fs.existsSync(SESSION_DIR)) {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      console.log("Session non liee nettoyee.");
    }
  } catch (e) {
    console.log("wipeSession:", e?.message || e);
  }
  webpair.setCode(null);
}

function shouldResetUnregistered() {
  try {
    const cf = path.join(SESSION_DIR, "creds.json");
    if (!fs.existsSync(cf)) return false;
    return !JSON.parse(fs.readFileSync(cf, "utf8")).registered;
  } catch {
    return true;
  }
}

function restoreSessionFromEnv() {
  const sessionId = process.env.SESSION_ID;
  if (!sessionId) return;
  const credsFile = path.join(SESSION_DIR, "creds.json");
  if (fs.existsSync(credsFile)) return; // une session existe deja sur le disque, on ne l'ecrase pas
  try {
    const decoded = Buffer.from(sessionId, "base64").toString("utf8");
    JSON.parse(decoded); // valide que c'est bien du JSON avant d'ecrire
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.writeFileSync(credsFile, decoded);
    console.log("[session] Restauree depuis SESSION_ID (env)");
  } catch (e) {
    console.log("[session] Echec restauration SESSION_ID:", e.message);
  }
}

function saveSessionToEnv() {
  try {
    const credsFile = path.join(SESSION_DIR, "creds.json");
    if (!fs.existsSync(credsFile)) return;
    const encoded = Buffer.from(fs.readFileSync(credsFile, "utf8")).toString("base64");
    const envPath = path.join(process.cwd(), ".env");
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
    if (/^SESSION_ID=/m.test(content)) content = content.replace(/^SESSION_ID=.*/m, `SESSION_ID=${encoded}`);
    else content = content.trimEnd() + `\nSESSION_ID=${encoded}\n`;
    fs.writeFileSync(envPath, content);
  } catch {
    // non-fatal, le dossier session reste la source de verite
  }
}

function getBody(m) {
  const mm = F.unwrap(m.message) || {};
  return mm.conversation || mm.extendedTextMessage?.text || mm.imageMessage?.caption || mm.videoMessage?.caption || mm.documentMessage?.caption || "";
}

async function handle(sock, m, type) {
  if (!m.message) return;
  const from = m.key.remoteJid;
  if (!from) return;

  if (from === "status@broadcast") {
    if (db.settings.autostatus && !m.key.fromMe) sock.readMessages([m.key]).catch(() => {});
    return;
  }

  const proto = m.message.protocolMessage;
  if (proto && (proto.type === 0 || proto.type === "REVOKE")) {
    if (db.settings.antidelete && proto.key?.id) {
      const o = store.get(proto.key.id);
      if (o && !o.key.fromMe) {
        const who = (o.key.participant || o.key.remoteJid || "").split("@")[0];
        await sock.sendMessage(sock.user.id, { text: `🛡️ *Message supprimé* de @${who}\nChat: ${o.key.remoteJid}`, mentions: [(o.key.participant || o.key.remoteJid)] }).catch(() => {});
        await sock.sendMessage(sock.user.id, { forward: o }).catch(() => {});
      }
    }
    return;
  }
  store.set(m.key.id, m);
  if (store.size > 1000) store.delete(store.keys().next().value);

  if (m.key.fromMe && type === "append") return;
  const ts = Number(m.messageTimestamp?.low ?? m.messageTimestamp ?? 0);
  if (ts && Date.now() / 1000 - ts > 60) return;

  const body = getBody(m);
  if (db.settings.autoreact && !m.key.fromMe) {
    sock.sendMessage(from, { react: { text: F.rnd(EMOJIS), key: m.key } }).catch(() => {});
  }
  if (body) await S.pre(sock, m, from, body).catch((e) => console.log("antilink:", e.message));

  if (!body.startsWith(".")) return;
  const args = body.slice(1).trim().split(/ +/);
  const cmd = (args.shift() || "").toLowerCase();
  await S.run(sock, m, from, cmd, args.join(" "));
}


setInterval(() => { if (global.gc) { try { global.gc(); } catch {} } }, 60000);
setInterval(() => {
  const usedMB = process.memoryUsage().rss / 1024 / 1024;
  if (usedMB > 400) {
    console.log(`⚠️ RAM trop haute (${usedMB.toFixed(0)}MB > 400MB), redemarrage...`);
    process.exit(1); // le panel/Docker redemarre automatiquement
  }
}, 30000);

async function start(opts = {}) {
  if (startLock) return;
  startLock = true;
  let sock = null;
  try {
    const reset = opts.reset === true || (opts.reset !== false && shouldResetUnregistered());
    if (reset) wipeSession();
    restoreSessionFromEnv();

    let sessionConnected = false;
    const { state, saveCreds } = await useMultiFileAuthState("./session");
    let version;
    try {
      if (typeof fetchLatestBaileysVersion === "function") {
        const latest = await fetchLatestBaileysVersion();
        version = latest.version;
      }
    } catch {}
    const browser = (Browsers.ubuntu && Browsers.ubuntu("Chrome")) || Browsers.macOS("Chrome") || Browsers.macOS("Desktop");
    sock = makeWASocket({
      ...(version ? { version } : {}),
      browser,
      auth: state,
      logger: P({ level: "silent" }),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      qrTimeout: 180000
    });
    const gen = ++sockGen;
    sock.__gen = gen;
    currentSock = sock;
    webpair.setSock(sock);
    sock.ev.on("creds.update", async () => {
      await saveCreds();
      if (sessionConnected) saveSessionToEnv();
    });

    let pairedOk = false;

    sock.ev.on("connection.update", (u) => {
      if (sock.__gen !== sockGen) return;
      if (u.isNewLogin) pairedOk = true;
      if (!sock.authState.creds.registered && u.connection) {
        console.log("Connexion:", u.connection, u.lastDisconnect?.error?.output?.statusCode ?? "");
      }
      if (u.connection === "open") {
        failCount = 0;
        sessionConnected = true;
        saveSessionToEnv();
        webpair.setCode(null);
        console.log(`SYMPRAX MD V1 CONNECTE ✅ ${S.total()} CMDS`);
        clearInterval(aoncTimer);
        aoncTimer = setInterval(() => { if (db.settings.aonc) sock.sendPresenceUpdate("available").catch(() => {}); }, 30000);
      }
      if (u.connection === "close") {
        sock.__dead = true;
        if (currentSock === sock) {
          webpair.setSock(null);
          webpair.setCode(null);
        }
        clearInterval(aoncTimer);
        const code = u.lastDisconnect?.error?.output?.statusCode;
        const registered = pairedOk || !!sock.authState.creds.registered;
        startLock = false;
        if (sock.__gen !== sockGen) return;
        if (code === DisconnectReason.loggedOut) {
          console.log("Session deconnectee. En attente d'un numero sur la page web...");
          setTimeout(() => start({ reset: true }), 2000);
          return;
        }
        failCount = code === 428 ? failCount + 1 : 0;
        const wait = code === 428 ? Math.min(5000 * failCount, 60000) : 3000;
        console.log(`Connexion fermee (code ${code ?? "?"}). Nouvelle tentative dans ${wait / 1000}s...`);
        setTimeout(() => start({ reset: !registered }), wait);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      for (const m of messages) {
        try { await handle(sock, m, type); } catch (e) { console.log("handle:", e.message); }
      }
    });
    sock.ev.on("group-participants.update", (ev) => S.welcome(sock, ev).catch((e) => console.log("welcome:", e.message)));

    // AntiCall : rejette l'appel puis bloque l'appelant (si .anticall on)
    sock.ev.on("call", async (calls) => {
      if (!db.settings.anticall) return;
      for (const call of calls) {
        const callerJid = call.from || call.peerJid || call.chatId;
        if (!callerJid) continue;
        try {
          if (typeof sock.rejectCall === "function" && call.id) await sock.rejectCall(call.id, callerJid);
          else if (typeof sock.sendCallOfferAck === "function" && call.id) await sock.sendCallOfferAck(call.id, callerJid, "reject");
        } catch {}
        if (!antiCallNotified.has(callerJid)) {
          antiCallNotified.add(callerJid);
          setTimeout(() => antiCallNotified.delete(callerJid), 60000);
          sock.sendMessage(callerJid, { text: "📵 Les appels ne sont pas autorises. Tu vas etre bloque." }).catch(() => {});
        }
        setTimeout(() => { sock.updateBlockStatus(callerJid, "block").catch(() => {}); }, 800);
      }
    });

    // Vue automatique des statuts (en plus du cas deja gere dans messages.upsert)
    sock.ev.on("status.update", (s) => {
      if (!db.settings.autostatus) return;
      const keys = Array.isArray(s) ? s : (s?.messages || []);
      for (const item of keys) { const k = item?.key || item; if (k && !k.fromMe) sock.readMessages([k]).catch(() => {}); }
    });

    // Reactions recues (pas d'action specifique pour l'instant, juste ecoute enregistree)
    sock.ev.on("messages.reaction", () => {});
  } catch (e) {
    if (sock) sock.__dead = true;
    if (currentSock === sock) webpair.setSock(null);
    startLock = false;
    console.log("start:", e?.message || e);
    if (!sock || sock.__gen === sockGen) setTimeout(() => start({ reset: true }), 5000);
  }
}

async function recycleSession() {
  const old = currentSock;
  if (old) {
    old.__dead = true;
    sockGen++;
    try { old.end(undefined); } catch {}
  }
  wipeSession();
  startLock = false;
  await start({ reset: false });
  await F.sleep(1200);
}

webpair.setReset(recycleSession);

process.on("unhandledRejection", (e) => console.log("unhandledRejection:", e?.message || e));
process.on("uncaughtException", (e) => console.log("uncaughtException:", e?.message || e));
start();
