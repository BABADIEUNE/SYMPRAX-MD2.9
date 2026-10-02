import * as F from "./functions.js";
const { db, save, num, sleep, rnd } = F;
import axios from "axios";
import crypto from "crypto";

const BOT = "SYMPRAX MD V1";
const START = Date.now();
const CMDS = {};
const CATS = { download: [], group: [], owner: [], tools: [], fun: [] };
const META = {
  download: ["DL", "DOWNLOAD", "dmenu"], group: ["GP", "GROUP", "gmenu"], owner: ["OW", "OWNER", "omenu"],
  tools: ["TL", "TOOLS", "tmenu"], fun: ["FN", "FUN", "fmenu"],
};
function def(cat, names, flags, fn) {
  names = [].concat(names);
  CATS[cat].push(names[0]);
  for (const n of names) CMDS[n] = { fn, ...flags };
}
const total = () => Object.values(CATS).reduce((a, b) => a + b.length, 0);
const fmtUp = (s) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(s % 60)}s`;
};
function sm(s) {
  const map = { a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ғ", g: "ɢ", h: "ʜ", i: "ɪ", j: "ᴊ", k: "ᴋ", l: "ʟ", m: "ᴍ", n: "ɴ", o: "ᴏ", p: "ᴘ", q: "ǫ", r: "ʀ", s: "s", t: "ᴛ", u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x", y: "ʏ", z: "ᴢ" };
  return String(s).replace(/[a-z]/g, (ch) => map[ch] || ch);
}
const POWERED_BY = "> POWERED BY SYMPRAX TECH";
function box(title, items = [], meta = [], { brand = true } = {}) {
  const body = [].concat(items).filter((x) => x !== undefined && x !== null);
  const foot = [].concat(meta).filter((x) => x !== undefined && x !== null && x !== "");
  if (brand) foot.push(POWERED_BY);
  const lines = [`╭〔 ${title} 〕`];
  for (const x of body) lines.push(x === "" ? "│" : `│ › ${x}`);
  for (let i = 0; i < foot.length; i++) lines.push((i === foot.length - 1 ? "╰ " : "├ ") + foot[i]);
  return lines.join("\n");
}
function catText(k) {
  return box(META[k][1], CATS[k].map((x) => "." + x), [`${sm("cmds")} : ${CATS[k].length}`]);
}
async function sendLogo(c, caption, extra = {}) {
  const img = await F.logoBuffer();
  try { return await c.sock.sendMessage(c.from, { image: img, caption, ...extra }, { quoted: c.m }); }
  catch (e) {
    console.log("sendLogo:", e?.message || e);
    return c.sock.sendMessage(c.from, { text: caption, ...extra }, { quoted: c.m });
  }
}

// ---------- contexte ----------
async function makeCtx(sock, m, from, cmd = "", text = "") {
  const mm = F.unwrap(m.message) || {};
  const ci = (mm.extendedTextMessage || mm.imageMessage || mm.videoMessage || mm.audioMessage || mm.documentMessage || mm.stickerMessage || {}).contextInfo || {};
  const isGroup = from.endsWith("@g.us");
  const meta = isGroup ? await sock.groupMetadata(from).catch(() => null) : null;
  const participants = meta?.participants || [];
  const senderJid = m.key.fromMe ? sock.user.id : (m.key.participant || from);
  const same = (p, j) => [p.id, p.jid, p.phoneNumber, p.lid].filter(Boolean).map(num).includes(num(j));
  const isOwner = !!m.key.fromMe || F.owners().includes(num(senderJid));
  const isAdmin = participants.some((p) => same(p, senderJid) && p.admin);
  const isBotAdmin = participants.some((p) => (same(p, sock.user.id) || (sock.user.lid && same(p, sock.user.lid))) && p.admin);
  const q = ci.quotedMessage ? F.unwrap(ci.quotedMessage) : null;
  const qtext = q ? (q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || q.videoMessage?.caption || "") : "";
  const c = {
    sock, m, from, cmd, text, args: text.split(/ +/).filter(Boolean), isGroup, meta, participants, senderJid, isOwner, isAdmin, isBotAdmin,
    ci, quoted: q, qtext, same, me: num(sock.user.id),
    reply: (t, o = {}) => {
      const raw = String(t ?? "");
      const framed = raw.startsWith("╭") ? raw : box("𝐁𝐎𝐓", raw.split("\n"));
      return sock.sendMessage(from, { text: framed, ...o }, { quoted: m });
    },
    send: (content) => sock.sendMessage(from, content, { quoted: m }),
    react: (e) => sock.sendMessage(from, { react: { text: e, key: m.key } }).catch(() => {}),
    input: text || qtext,
    media: async (types) => {
      const x = F.pickMedia(m.message, types) || F.pickMedia(ci.quotedMessage, types);
      return x ? { ...x, buffer: await F.dl(x) } : null;
    },
    target: () => {
      const d = text.replace(/[^0-9]/g, "");
      return ci.mentionedJid?.[0] || ci.participant || (d.length >= 7 ? d + "@s.whatsapp.net" : null);
    },
    img: async (url, caption) => {
      const cap = String(caption ?? "");
      const framed = cap.startsWith("╭") ? cap : box("𝐁𝐎𝐓", cap.split("\n"));
      try {
        if (url === F.LOGO || !url) {
          await sendLogo({ sock, from, m }, framed);
          return;
        }
        const buf = /^https?:\/\//i.test(url) ? await F.buf(url) : url;
        await sock.sendMessage(from, { image: buf, caption: framed }, { quoted: m });
      } catch { await sock.sendMessage(from, { text: framed }, { quoted: m }); }
    },
  };
  return c;
}
function toggle(c, key, label) {
  const a = (c.args[0] || "").toLowerCase();
  const v = a === "on" ? true : a === "off" ? false : !db.settings[key];
  db.settings[key] = v; save();
  return c.reply(`${label}\n${v ? "ON" : "OFF"}`);
}
const needUrl = (c, ex) => { if (!/^https?:\/\//i.test(c.input)) { c.reply("Envoie un lien.\nEx: " + ex); return true; } };

// ================= DOWNLOAD (18) =================
function fmtDur(v) {
  if (v.seconds) { const m = Math.floor(v.seconds / 60), s = v.seconds % 60; return `${m}:${String(s).padStart(2, "0")}`; }
  return v.timestamp || "?";
}
function progressBar(pct, size = 12) {
  const filled = Math.round((pct / 100) * size);
  return "▰".repeat(filled) + "▱".repeat(size - filled);
}
async function sendYtCard(c, v, kind) {
  const dur = fmtDur(v);
  const card = `🎵 *${v.title}*\n👤 ${v.author?.name || "Inconnu"}\n⏱ ${dur}  •  👁 ${v.views ? v.views.toLocaleString("fr-FR") : "?"} vues\n${progressBar(15)} 15%\n⏳ Téléchargement en cours...`;
  if (v.thumbnail) await c.img(v.thumbnail, card); else await c.reply(card);
  const r = await F.ytGet(v.url, kind);
  const sizeInfo = r.buffer ? `\n📦 ${(r.buffer.length / 1048576).toFixed(1)} Mo` : "";
  if (kind === "audio") {
    await c.send({ audio: r.buffer || { url: r.url }, mimetype: "audio/mpeg", fileName: v.title.slice(0, 60) + ".mp3" });
    await c.reply(`✅ *${v.title}*\n⏱ ${dur}${sizeInfo}\n${progressBar(100)} 100%`);
  } else {
    await c.send({ video: r.buffer || { url: r.url }, mimetype: "video/mp4", caption: `🎬 *${v.title}*\n⏱ ${dur}${sizeInfo}` });
  }
}
async function playCmd(c, ex) {
  if (!c.input) return c.reply("Ex: " + ex);
  const v = await F.resolveYT(c.input);
  if (!v) return c.reply("Rien trouvé 😕");
  await sendYtCard(c, v, "audio");
}
def("download", "play", {}, (c) => playCmd(c, ".play calm down"));
def("download", "song", {}, (c) => playCmd(c, ".song calm down"));
def("download", "ytmp3", {}, async (c) => {
  if (!c.input) return c.reply("Ex: .ytmp3 https://youtu.be/xxxx");
  const v = await F.resolveYT(c.input);
  if (!v) return c.reply("Rien trouvé 😕");
  await sendYtCard(c, v, "audio");
});
def("download", "ytmp4", {}, async (c) => {
  if (!c.input) return c.reply("Ex: .ytmp4 https://youtu.be/xxxx");
  const v = await F.resolveYT(c.input);
  if (!v) return c.reply("Rien trouvé 😕");
  await sendYtCard(c, v, "video");
});
def("download", "tiktok", {}, async (c) => {
  if (needUrl(c, ".tiktok https://vm.tiktok.com/xxxx")) return;
  let url = null, cap = "";
  try {
    const d = await F.get("https://www.tikwm.com/api/?hd=1&url=" + encodeURIComponent(c.input));
    url = d?.data?.hdplay || d?.data?.play; cap = d?.data?.title || "";
    if (url && url.startsWith("/")) url = "https://www.tikwm.com" + url;
  } catch {}
  if (!url) { const l = await F.chain([`https://api.siputzx.my.id/api/tiktok/v2?url=${encodeURIComponent(c.input)}`, `https://api.ryzendesu.vip/api/downloader/ttdl?url=${encodeURIComponent(c.input)}`], "video", c.input); url = l?.[0]; }
  if (!url) return c.reply("❌ Impossible de télécharger ce TikTok.");
  await c.send({ video: { url }, caption: cap || "TikTok ✅" });
});
async function social(c, label, apis) {
  if (needUrl(c, `.${c.cmd} <lien ${label}>`)) return;
  await c.reply("⏳ " + label + "...");
  const l = await F.chain(apis(encodeURIComponent(c.input)), "any", c.input);
  if (!l) return c.reply("❌ Téléchargement impossible (lien privé ou API indisponible).");
  const u = l[0];
  if (/\.(jpe?g|png|webp)(\?|$)/i.test(u)) await c.send({ image: { url: u }, caption: label + " ✅" });
  else await c.send({ video: { url: u }, caption: label + " ✅" });
}
def("download", "fb", {}, (c) => social(c, "Facebook", (e) => [`https://api.siputzx.my.id/api/d/facebook?url=${e}`, `https://api.ryzendesu.vip/api/downloader/fbdl?url=${e}`, `https://api.agatz.xyz/api/facebook?url=${e}`]));
def("download", "ig", {}, (c) => social(c, "Instagram", (e) => [`https://api.siputzx.my.id/api/d/igdl?url=${e}`, `https://api.ryzendesu.vip/api/downloader/igdl?url=${e}`, `https://api.agatz.xyz/api/instagram?url=${e}`]));
def("download", "twitter", {}, (c) => social(c, "Twitter", (e) => [`https://api.siputzx.my.id/api/d/twitter?url=${e}`, `https://api.ryzendesu.vip/api/downloader/twitter?url=${e}`, `https://api.agatz.xyz/api/twitter?url=${e}`]));
def("download", "spotify", {}, async (c) => {
  if (needUrl(c, ".spotify https://open.spotify.com/track/xxxx")) return;
  const e = encodeURIComponent(c.input);
  const l = await F.chain([`https://api.siputzx.my.id/api/d/spotify?url=${e}`, `https://api.ryzendesu.vip/api/downloader/spotify?url=${e}`, `https://api.agatz.xyz/api/spotify?url=${e}`], "audio", c.input);
  if (!l) return c.reply("❌ Spotify indisponible pour le moment.");
  await c.send({ audio: { url: l[0] }, mimetype: "audio/mpeg" });
});
def("download", "mediafire", {}, async (c) => {
  if (needUrl(c, ".mediafire https://www.mediafire.com/file/xxxx")) return;
  const html = String(await F.get(c.input, { responseType: "text" }));
  const mt = html.match(/href="(https?:\/\/download[^"]+)"/) || html.match(/aria-label="Download file"[^>]*href="([^"]+)"/);
  if (!mt) return c.reply("❌ Lien MediaFire introuvable.");
  const name = decodeURIComponent(mt[1].split("/").pop().split("?")[0]) || "file";
  await c.reply("⏳ Envoi de " + name);
  await c.send({ document: { url: mt[1] }, fileName: name, mimetype: "application/octet-stream" });
});
def("download", "pinterest", {}, async (c) => {
  if (!c.input) return c.reply("Ex: .pinterest chat mignon  |  .pinterest <lien pin>");
  const e = encodeURIComponent(c.input);
  const isUrl = /^https?:\/\//i.test(c.input);
  const l = await F.chain(isUrl
    ? [`https://api.siputzx.my.id/api/d/pinterest?url=${e}`, `https://api.ryzendesu.vip/api/downloader/pinterest?url=${e}`]
    : [`https://api.siputzx.my.id/api/s/pinterest?query=${e}`, `https://api.ryzendesu.vip/api/search/pinterest?query=${e}`], "image", c.input);
  if (!l) return c.reply("❌ Rien trouvé / API indisponible.");
  for (const u of l.slice(0, isUrl ? 1 : 3)) await c.send({ image: { url: u } });
});
def("download", "gdrive", {}, async (c) => {
  const id = (c.input.match(/[-\w]{25,}/) || [])[0];
  if (!id) return c.reply("Ex: .gdrive https://drive.google.com/file/d/xxxx/view");
  await c.send({ document: { url: `https://drive.google.com/uc?export=download&id=${id}` }, fileName: "gdrive-" + id.slice(0, 6), mimetype: "application/octet-stream" });
});
def("download", "apk", {}, async (c) => {
  if (!c.input) return c.reply("Ex: .apk whatsapp");
  const d = await F.get("https://ws75.aptoide.com/api/7/apps/search?limit=1&query=" + encodeURIComponent(c.input));
  const a = d?.datalist?.list?.[0];
  if (!a?.file?.path) return c.reply("❌ Appli introuvable.");
  const mb = ((a.file.filesize || a.size || 0) / 1048576).toFixed(1);
  if (mb > 100) return c.reply(`❌ ${a.name} pèse ${mb} Mo (trop gros).`);
  await c.reply(`📦 *${a.name}*\nVersion: ${a.file.vername}\nTaille: ${mb} Mo\n⏳ Envoi...`);
  await c.send({ document: { url: a.file.path }, mimetype: "application/vnd.android.package-archive", fileName: a.name + ".apk" });
});
def("download", "img", {}, async (c) => {
  if (!c.input) return c.reply("Ex: .img coucher de soleil");
  const e = encodeURIComponent(c.input);
  const l = await F.chain([`https://api.siputzx.my.id/api/s/pinterest?query=${e}`, `https://api.ryzendesu.vip/api/search/pinterest?query=${e}`], "image");
  if (!l) return c.reply("❌ Aucune image trouvée.");
  for (const u of l.slice(0, 3)) await c.send({ image: { url: u } });
});
def("download", "ss", {}, async (c) => {
  let u = c.input; if (!u) return c.reply("Ex: .ss google.com");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  await c.send({ image: { url: "https://image.thum.io/get/width/1280/crop/900/" + u }, caption: "📸 " + u });
});
def("download", "lyrics", {}, async (c) => {
  if (!c.input) return c.reply("Ex: .lyrics calm down rema");
  const d = await F.get("https://lrclib.net/api/search?q=" + encodeURIComponent(c.input));
  const t = (d || []).find((x) => x.plainLyrics);
  if (!t) return c.reply("❌ Paroles introuvables.");
  await c.reply(`🎤 *${t.trackName}* - ${t.artistName}\n\n${t.plainLyrics.slice(0, 3500)}`);
});
def("download", "ytsearch", {}, async (c) => {
  if (!c.input) return c.reply("Ex: .ytsearch afrobeat mix");
  const r = (await F.ytSearch(c.input)).videos.slice(0, 8);
  if (!r.length) return c.reply("Rien trouvé.");
  await c.reply("🔎 *YouTube*\n\n" + r.map((v, i) => `${i + 1}. ${v.title}\n   ⏱ ${v.timestamp} • ${v.author.name}\n   ${v.url}`).join("\n\n"));
});
def("download", "video", {}, async (c) => {
  if (!c.input) return c.reply("Ex: .video freestyle");
  const v = await F.resolveYT(c.input);
  if (!v) return c.reply("Rien trouvé 😕");
  await sendYtCard(c, v, "video");
});

// ================= GROUP (25) =================
const G = { group: true, admin: true, botAdmin: true };
def("group", "kick", G, async (c) => {
  const u = c.target(); if (!u) return c.reply("Mentionne ou réponds à quelqu'un.");
  if (num(u) === c.me || F.owners().includes(num(u))) return c.reply("Pas lui 😅");
  await c.sock.groupParticipantsUpdate(c.from, [u], "remove"); c.reply("👢 Expulsé");
});
def("group", "add", G, async (c) => {
  const n = c.text.replace(/[^0-9]/g, ""); if (n.length < 7) return c.reply("Ex: .add 237XXXXXXXXX");
  const r = await c.sock.groupParticipantsUpdate(c.from, [n + "@s.whatsapp.net"], "add");
  c.reply(r?.[0]?.status && String(r[0].status) !== "200" ? "⚠️ Impossible (confidentialité ou numéro invalide). Code " + r[0].status : "✅ Ajouté");
});
def("group", "promote", G, async (c) => { const u = c.target(); if (!u) return c.reply("Mentionne quelqu'un."); await c.sock.groupParticipantsUpdate(c.from, [u], "promote"); c.reply("⬆️ Promu admin"); });
def("group", "demote", G, async (c) => { const u = c.target(); if (!u) return c.reply("Mentionne quelqu'un."); await c.sock.groupParticipantsUpdate(c.from, [u], "demote"); c.reply("⬇️ Rétrogradé"); });
def("group", "tagall", { group: true, admin: true }, async (c) => {
  const t = box("𝐓𝐀𝐆𝐀𝐋𝐋", c.participants.map((p) => "@" + num(p.id)), [c.text || "📢 Tout le monde est convoqué", `${sm("membres")} : ${c.participants.length}`]);
  await c.send({ text: t, mentions: c.participants.map((p) => p.id) });
});
def("group", "hidetag", { group: true, admin: true }, async (c) => {
  const t = box("𝐇𝐈𝐃𝐄𝐓𝐀𝐆", [], [c.input || "📢 Annonce"]);
  await c.send({ text: t, mentions: c.participants.map((p) => p.id) });
});
def("group", "kickall1", { group: true, owner: true, botAdmin: true }, async (c) => {
  if (c.args[0] !== "confirm") return c.reply("⚠️ Expulse TOUS les non-admins.\nConfirme avec: .kickall1 confirm");
  const t = c.participants.filter((p) => !p.admin && !c.same(p, c.sock.user.id) && !F.owners().includes(num(p.id))).map((p) => p.id);
  for (let i = 0; i < t.length; i += 10) { await c.sock.groupParticipantsUpdate(c.from, t.slice(i, i + 10), "remove").catch(() => {}); await sleep(1500); }
  c.reply(`✅ ${t.length} membres expulsés`);
});
def("group", "kickall2", { group: true, owner: true, botAdmin: true }, async (c) => {
  if (c.args[0] !== "confirm") return c.reply("⚠️ Expulse les non-admins UN PAR UN (plus lent, plus safe).\nConfirme avec: .kickall2 confirm");
  const t = c.participants.filter((p) => !p.admin && !c.same(p, c.sock.user.id) && !F.owners().includes(num(p.id))).map((p) => p.id);
  for (const u of t) { await c.sock.groupParticipantsUpdate(c.from, [u], "remove").catch(() => {}); await sleep(2000); }
  c.reply(`✅ ${t.length} membres expulsés`);
});
// ---- statut de groupe ----
async function gcContent(c) {
  const x = await c.media(["imageMessage", "videoMessage", "audioMessage"]);
  if (x) {
    const cap = c.text || x.node.caption || undefined;
    if (x.type === "image") return { image: x.buffer, caption: cap };
    if (x.type === "video") return { video: x.buffer, caption: cap };
    return { audio: x.buffer, mimetype: "audio/mp4", ptt: true };
  }
  const t = c.text || c.qtext;
  return t ? { text: t } : null;
}
async function postGroupStatus(sock, jid, content) {
  const B = await import("baileys");
  const secret = crypto.randomBytes(32);
  const inner = content.text !== undefined && !content.image && !content.video && !content.audio
    ? { extendedTextMessage: { text: content.text, backgroundArgb: 0xff075e54, textArgb: 0xffffffff, font: 2 } }
    : await B.generateWAMessageContent(content, { upload: sock.waUploadToServer });
  const msg = B.generateWAMessageFromContent(jid, { messageContextInfo: { messageSecret: secret }, groupStatusMessageV2: { message: { ...inner, messageContextInfo: { messageSecret: secret } } } }, {});
  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
}
async function gcSend(sock, jid, content) {
  try { await postGroupStatus(sock, jid, content); return "groupe"; }
  catch (e1) {
    // plan B : statut classique limite aux membres du groupe
    const meta = await sock.groupMetadata(jid);
    const list = [...new Set([...meta.participants.map((p) => p.id), sock.user.id.split(":")[0] + "@s.whatsapp.net"])];
    await sock.sendMessage("status@broadcast", content, { statusJidList: list, backgroundColor: "#075e54", font: 2 });
    return "classique";
  }
}
const GC_HELP = "Réponds à un texte, une image, une vidéo ou un vocal avec la commande.\nOu écris: .{c} ton texte";
def("group", "gcstatuts1", { group: true }, async (c) => {
  const content = await gcContent(c);
  if (!content) return c.reply("📌 *Statut de CE groupe*\n" + GC_HELP.replace("{c}", "gcstatuts1"));
  const how = await gcSend(c.sock, c.from, content);
  c.reply(how === "groupe" ? "✅ Statut publié dans ce groupe" : "✅ Statut publié (mode classique: visible par les membres de ce groupe)");
});
def("group", "gcstatuts2", {}, async (c) => {
  if (!(c.isOwner || c.isAdmin)) return c.reply("🛡️ Réservé aux admins.");
  const content = await gcContent(c);
  if (!content) return c.reply("📌 *Statut dans TOUS les groupes*\n" + GC_HELP.replace("{c}", "gcstatuts2"));
  const gs = Object.keys(await c.sock.groupFetchAllParticipating());
  await c.reply(`🚀 Publication dans ${gs.length} groupes...`);
  let ok = 0, fail = 0;
  for (const g of gs) { try { await gcSend(c.sock, g, content); ok++; } catch { fail++; } await sleep(2000); }
  c.reply(`✅ Statut publié dans ${ok}/${gs.length} groupes${fail ? `\n⚠️ ${fail} échec(s)` : ""}`);
});
def("group", "antilink", { group: true, admin: true }, async (c) => {
  const a = (c.args[0] || "").toLowerCase();
  if (a === "on") db.antilink[c.from] = "delete"; else if (a === "kick") db.antilink[c.from] = "kick"; else if (a === "off") delete db.antilink[c.from];
  else return c.reply("Ex: .antilink on | kick | off\n(état: " + (db.antilink[c.from] || "off") + ")\n⚠️ Le bot doit être admin.");
  save(); c.reply("🔗 Antilink: " + (db.antilink[c.from] || "off"));
});
def("group", "welcome", { group: true, admin: true }, async (c) => {
  const a = (c.args[0] || "").toLowerCase();
  if (a === "on") db.welcome[c.from] = true; else if (a === "off") delete db.welcome[c.from]; else return c.reply("Ex: .welcome on | off");
  save(); c.reply("👋 Welcome: " + (db.welcome[c.from] ? "on" : "off"));
});
def("group", "link", { group: true, admin: true, botAdmin: true }, async (c) => c.reply("https://chat.whatsapp.com/" + (await c.sock.groupInviteCode(c.from))));
def("group", "revoke", G, async (c) => { await c.sock.groupRevokeInvite(c.from); c.reply("♻️ Lien réinitialisé: https://chat.whatsapp.com/" + (await c.sock.groupInviteCode(c.from))); });
def("group", "open", G, async (c) => { await c.sock.groupSettingUpdate(c.from, "not_announcement"); c.reply("🔓 Groupe ouvert"); });
def("group", "close", G, async (c) => { await c.sock.groupSettingUpdate(c.from, "announcement"); c.reply("🔒 Groupe fermé"); });
def("group", "mute", G, async (c) => { await c.sock.groupSettingUpdate(c.from, "announcement"); c.reply("🔇 Groupe muet (admins seulement)"); });
def("group", "unmute", G, async (c) => { await c.sock.groupSettingUpdate(c.from, "not_announcement"); c.reply("🔊 Groupe ouvert à tous"); });
def("group", "setname", G, async (c) => { if (!c.input) return c.reply("Ex: .setname Nouveau nom"); await c.sock.groupUpdateSubject(c.from, c.input); c.reply("✅ Nom changé"); });
def("group", "setdesc", G, async (c) => { if (!c.input) return c.reply("Ex: .setdesc Nouvelle description"); await c.sock.groupUpdateDescription(c.from, c.input); c.reply("✅ Description changée"); });
def("group", "gpp", G, async (c) => {
  const x = await c.media(["imageMessage"]); if (!x) return c.reply("Envoie/réponds à une image avec .gpp");
  await c.sock.updateProfilePicture(c.from, x.buffer); c.reply("✅ Photo du groupe changée");
});
def("group", "fullpp", { owner: true }, async (c) => {
  const x = await c.media(["imageMessage"]); if (!x) return c.reply("Envoie/réponds à une image avec .fullpp");
  const sharp = (await import("sharp")).default;
  const b = await sharp(x.buffer).resize(640, 640, { fit: "contain", background: "#000000" }).jpeg().toBuffer();
  await c.sock.updateProfilePicture(c.sock.user.id, b); c.reply("✅ Photo du bot changée (sans recadrage)");
});
def("group", "invite", { group: true, botAdmin: true }, async (c) => {
  const n = c.text.replace(/[^0-9]/g, ""); if (n.length < 7) return c.reply("Ex: .invite 237XXXXXXXXX");
  await c.sock.sendMessage(n + "@s.whatsapp.net", { text: `📩 Invitation pour *${c.meta.subject}*\nhttps://chat.whatsapp.com/${await c.sock.groupInviteCode(c.from)}` });
  c.reply("✅ Invitation envoyée");
});
def("group", "del", { group: true, admin: true, botAdmin: true }, async (c) => {
  if (!c.ci.stanzaId) return c.reply("Réponds au message à supprimer.");
  await c.sock.sendMessage(c.from, { delete: { remoteJid: c.from, fromMe: false, id: c.ci.stanzaId, participant: c.ci.participant } });
});
def("group", "gc", { group: true, admin: true, botAdmin: true }, async (c) => {
  const a = (c.args[0] || "").toLowerCase();
  if (a === "open") { await c.sock.groupSettingUpdate(c.from, "not_announcement"); return c.reply("🔓 Ouvert"); }
  if (a === "close") { await c.sock.groupSettingUpdate(c.from, "announcement"); return c.reply("🔒 Fermé"); }
  c.reply("Ex: .gc open | close\nÉtat: " + (c.meta.announce ? "fermé 🔒" : "ouvert 🔓"));
});

// ================= OWNER (15) =================
const O = { owner: true };
def("owner", "aonc", O, (c) => toggle(c, "aonc", "🟢 Toujours en ligne"));
def("owner", "anticall", O, (c) => toggle(c, "anticall", "📵 Anti-appel (rejette + bloque)"));
def("owner", "me", {}, async (c) => {
  const pp = await c.sock.profilePictureUrl(c.senderJid, "image").catch(() => null);
  const t = `👤 *Profil*\nNuméro: ${num(c.senderJid)}\nNom: ${c.m.pushName || "?"}\nOwner: ${c.isOwner ? "oui 👑" : "non"}`;
  pp ? await c.img(pp, t) : await c.reply(t);
});
def("owner", "from", {}, (c) => c.reply(`📍 Chat: ${c.from}\nExpéditeur: ${c.senderJid}\nType: ${c.isGroup ? "groupe" : "privé"}${c.isGroup ? "\nNom: " + c.meta?.subject : ""}`));
def("owner", ["ping", "speed"], {}, async (c) => {
  const t = Date.now();
  await c.sock.sendMessage(c.from, { react: { text: "⚡", key: c.m.key } }).catch(() => {});
  const ms = Date.now() - t;
  return sendLogo(c, box("𝐏𝐈𝐍𝐆", [], [
    `${sm("up")} : ${fmtUp((Date.now() - START) / 1000)}`,
    `${sm("ms")} : ${ms}`,
    `${sm("st")} : Online`
  ]));
});
def("owner", "alive", {}, (c) => sendLogo(c, box("𝐀𝐋𝐈𝐕𝐄", [".menu", ".help", ".ping", ".owner"], [
  `${sm("up")} : ${fmtUp((Date.now() - START) / 1000)}`,
  `${sm("st")} : Online`,
  `${sm("md")} : ${db.settings.mode === "self" ? "Self" : "Public"}`
])));
def("owner", "restart", O, async (c) => { await c.reply("♻️ Redémarrage..."); setTimeout(() => process.exit(0), 1000); });
def("owner", "pair", O, async (c) => {
  const n = c.text.replace(/[^0-9]/g, "");
  if (n.length < 8 || n.length > 15) return c.reply("Ex: .pair 237XXXXXXXXX\n(indicatif + numero, 8-15 chiffres)");
  if (c.sock.authState?.creds?.registered) return c.reply("Deja lie. Supprime le dossier session pour relier un autre numero.");
  if (c.sock.__dead) return c.reply("Connexion fermee, reessaie dans quelques secondes.");
  await c.sock.waitForSocketOpen();
  const raw = String(await c.sock.requestPairingCode(n)).replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const code = raw.length === 8 ? raw.slice(0, 4) + "-" + raw.slice(4) : raw;
  c.reply("🔑 Code: *" + code + "*\nWhatsApp > Appareils liés > Lier avec code");
});
def("owner", "autostatus", O, (c) => toggle(c, "autostatus", "👁️ Auto-vue des statuts"));
def("owner", "antidelete", O, (c) => toggle(c, "antidelete", "🛡️ Anti-delete (renvoyé à l'owner)"));
def("owner", "autoreact", O, (c) => toggle(c, "autoreact", "😀 Auto-réaction"));
def("owner", "mode", O, (c) => {
  const a = (c.args[0] || "").toLowerCase();
  if (!["public", "self"].includes(a)) return c.reply("Ex: .mode public | self\nActuel: " + db.settings.mode);
  db.settings.mode = a; save(); c.reply("⚙️ Mode: " + a);
});
def("owner", "ban", O, (c) => { const u = c.target(); if (!u) return c.reply("Mentionne ou réponds à quelqu'un."); if (!db.banned.includes(num(u))) db.banned.push(num(u)); save(); c.reply("🚫 Banni: " + num(u)); });
def("owner", "unban", O, (c) => { const u = c.target(); if (!u) return c.reply("Mentionne ou réponds à quelqu'un."); db.banned = db.banned.filter((x) => x !== num(u)); save(); c.reply("✅ Débanni: " + num(u)); });
def("owner", "broadcast", O, async (c) => {
  if (!c.input) return c.reply("Ex: .broadcast Message pour tous les groupes");
  const gs = Object.keys(await c.sock.groupFetchAllParticipating()); let ok = 0;
  for (const g of gs) { try { await c.sock.sendMessage(g, { text: "📢 *BROADCAST*\n\n" + c.input }); ok++; } catch {} await sleep(1500); }
  c.reply(`✅ Envoyé à ${ok}/${gs.length} groupes`);
});
def("owner", "info", {}, (c) => {
  const s = db.settings, mem = (process.memoryUsage().rss / 1048576).toFixed(0);
  return sendLogo(c, box("𝐈𝐍𝐅𝐎", [
    ".menu",
    ".help",
    ".ping",
    ".owner"
  ], [
    `${sm("up")} : ${fmtUp((Date.now() - START) / 1000)}`,
    `${sm("st")} : Online`,
    `${sm("md")} : ${s.mode === "self" ? "Self" : "Public"}`,
    `${sm("ram")} : ${mem}M`,
    `${sm("cmds")} : ${total()}`
  ]));
});


// ================= TOOLS (27) =================
def("tools", "sticker", {}, async (c) => {
  const x = await c.media(["imageMessage", "videoMessage"]); if (!x) return c.reply("Envoie/réponds à une image ou vidéo (≤10s) avec .sticker");
  const { Sticker } = await import("wa-sticker-formatter");
  const b = await new Sticker(x.buffer, { pack: BOT, author: "DEV SYMPRAX", type: "full", quality: 60 }).toBuffer();
  await c.send({ sticker: b });
});
def("tools", "tgs", O, async (c) => {
  const TG_TOKEN = process.env.TG_BOT_TOKEN || "";
  if (!TG_TOKEN) return c.reply("⚠️ Ajoute la variable TG_BOT_TOKEN (token de bot Telegram, gratuit via @BotFather) pour activer .tgs");
  const link = c.input || "";
  const mt = link.match(/addstickers\/([A-Za-z0-9_]+)/);
  if (!mt) return c.reply("Ex: .tgs https://t.me/addstickers/NomDuPack");
  const name = mt[1];
  const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;
  await c.reply(`📦 Récupération du pack "${name}"...`);
  let set;
  try {
    const r = await F.get(`${TG_API}/getStickerSet?name=${encodeURIComponent(name)}`);
    if (!r.ok || !r.result?.stickers?.length) return c.reply("❌ Pack introuvable ou vide.");
    set = r.result;
  } catch (e) {
    return c.reply("❌ Erreur Telegram: " + (e.response?.data?.description || e.message));
  }
  const MAX = 30;
  const items = set.stickers.slice(0, MAX);
  const { Sticker } = await import("wa-sticker-formatter");
  let ok = 0, skipped = 0;
  for (const item of items) {
    try {
      const fr = await F.get(`${TG_API}/getFile?file_id=${item.file_id}`);
      const filePath = fr.result.file_path;
      const ext = (filePath.split(".").pop() || "").toLowerCase();
      const raw = await F.buf(`https://api.telegram.org/file/bot${TG_TOKEN}/${filePath}`);
      let out;
      if (ext === "tgs") { skipped++; continue; } // sticker anime vectoriel Telegram (Lottie), pas convertible sans dependance lourde
      if (ext === "webm" || item.is_video) {
        out = await F.ff(raw, ["-vcodec", "libwebp", "-vf", "scale=512:512:force_original_aspect_ratio=decrease,fps=15", "-loop", "0", "-an", "-vsync", "0"], "webp");
        await c.send({ sticker: out });
      } else {
        out = await new Sticker(raw, { pack: set.title || name, author: "Telegram", type: "full", quality: 70 }).toBuffer();
        await c.send({ sticker: out });
      }
      ok++;
      await sleep(400);
    } catch (e) {
      skipped++;
    }
  }
  let msg = `✅ ${ok} sticker(s) envoyé(s) depuis "${set.title || name}"`;
  if (skipped) msg += `\n⚠️ ${skipped} ignoré(s) (format .tgs animé Lottie non supporté, ou erreur de conversion)`;
  if (set.stickers.length > MAX) msg += `\n(limité aux ${MAX} premiers sur ${set.stickers.length})`;
  c.reply(msg);
});
def("tools", "toimg", {}, async (c) => {
  const x = await c.media(["stickerMessage"]); if (!x) return c.reply("Réponds à un sticker avec .toimg");
  const sharpMod = (await import("sharp")).default;
  const b = await sharpMod(x.buffer).png().toBuffer(); await c.send({ image: b, caption: "🖼️" });
});
def("tools", "tomp3", {}, async (c) => {
  const x = await c.media(["videoMessage", "audioMessage"]); if (!x) return c.reply("Réponds à une vidéo/audio avec .tomp3");
  const b = await F.ff(x.buffer, ["-vn", "-acodec", "libmp3lame", "-q:a", "3"], "mp3");
  await c.send({ audio: b, mimetype: "audio/mpeg" });
});
def("tools", "tovn", {}, async (c) => {
  const x = await c.media(["videoMessage", "audioMessage"]); if (!x) return c.reply("Réponds à une vidéo/audio avec .tovn");
  const b = await F.ff(x.buffer, ["-vn", "-c:a", "libopus", "-b:a", "48k"], "ogg");
  await c.send({ audio: b, mimetype: "audio/ogg; codecs=opus", ptt: true });
});
def("tools", "removebg", {}, async (c) => {
  const key = process.env.REMOVEBG_KEY;
  if (!key) return c.reply("⚠️ Ajoute la variable REMOVEBG_KEY (clé gratuite sur remove.bg) pour activer .removebg");
  const x = await c.media(["imageMessage"]); if (!x) return c.reply("Envoie/réponds à une image avec .removebg");
  const fd = new FormData(); fd.append("size", "auto"); fd.append("image_file", new Blob([x.buffer]), "img.png");
  const r = await axios.post("https://api.remove.bg/v1.0/removebg", fd, { headers: { "X-Api-Key": key }, responseType: "arraybuffer", timeout: 60000 });
  await c.send({ image: Buffer.from(r.data), caption: "✂️ Fond retiré" });
});
def("tools", "hd", {}, async (c) => {
  const x = await c.media(["imageMessage"]); if (!x) return c.reply("Envoie/réponds à une image avec .hd");
  const sharp = (await import("sharp")).default; const md = await sharp(x.buffer).metadata();
  const b = await sharp(x.buffer).resize(Math.min(md.width * 2, 4096), null, { kernel: "lanczos3" }).sharpen().jpeg({ quality: 92 }).toBuffer();
  await c.send({ image: b, caption: "✨ Agrandie x2 + netteté" });
});
def("tools", "tts", {}, async (c) => {
  let lang = "fr", t = c.input;
  if (/^[a-z]{2}(-[A-Z]{2})?$/.test(c.args[0] || "") && c.args.length > 1) { lang = c.args[0]; t = c.args.slice(1).join(" "); }
  if (!t) return c.reply("Ex: .tts fr Bonjour tout le monde");
  const b = await F.buf(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(t.slice(0, 200))}`);
  await c.send({ audio: b, mimetype: "audio/mpeg" });
});
def("tools", "vv", {}, async (c) => {
  const x = await c.media(["imageMessage", "videoMessage", "audioMessage"]); if (!x) return c.reply("Réponds à un message « vue unique » avec .vv");
  const o = x.type === "image" ? { image: x.buffer } : x.type === "video" ? { video: x.buffer } : { audio: x.buffer, mimetype: "audio/mpeg" };
  await c.send({ ...o, caption: x.node.caption || undefined });
});
def("tools", "translate", {}, async (c) => {
  let to = "fr", t = c.input;
  if (/^[a-z]{2}(-[A-Za-z]{2})?$/.test(c.args[0] || "") && (c.args.length > 1 || c.qtext)) { to = c.args[0]; t = c.args.slice(1).join(" ") || c.qtext; }
  if (!t) return c.reply("Ex: .translate en Bonjour  (ou réponds à un message)");
  c.reply("🌍 " + (await F.translate(t, to)));
});
def("tools", "weather", {}, async (c) => {
  if (!c.input) return c.reply("Ex: .weather Douala");
  const d = await F.get("https://wttr.in/" + encodeURIComponent(c.input) + "?format=j1");
  const w = d.current_condition[0], a = d.nearest_area?.[0];
  c.reply(`🌤️ *${a?.areaName?.[0]?.value || c.input}* (${a?.country?.[0]?.value || ""})\n${w.weatherDesc[0].value}\n🌡️ ${w.temp_C}°C (ressenti ${w.FeelsLikeC}°C)\n💧 Humidité ${w.humidity}%\n💨 Vent ${w.windspeedKmph} km/h`);
});
def("tools", "wikipedia", {}, async (c) => {
  if (!c.input) return c.reply("Ex: .wikipedia Cameroun");
  const s = await F.get("https://fr.wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&search=" + encodeURIComponent(c.input));
  const title = s?.[1]?.[0]; if (!title) return c.reply("❌ Aucun article.");
  const d = await F.get("https://fr.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title));
  c.reply(`📚 *${d.title}*\n\n${(d.extract || "").slice(0, 1500)}\n\n${d.content_urls?.desktop?.page || ""}`);
});
def("tools", "calc", {}, (c) => {
  const e = c.input.replace(/x/gi, "*").replace(/,/g, ".").replace(/\^/g, "**");
  if (!e || !/^[0-9+\-*/().%\s]+$/.test(e)) return c.reply("Ex: .calc (12+8)*3");
  let r; try { r = Function('"use strict";return (' + e + ")")(); } catch { return c.reply("❌ Calcul invalide"); }
  c.reply("🧮 " + c.input + " = *" + r + "*");
});
def("tools", "ai", {}, async (c) => {
  if (!c.input) return c.reply("Ex: .ai explique-moi la blockchain");
  const sys = "Tu es SYMPRAX MD, un assistant WhatsApp. Réponds de façon claire et concise, dans la langue de l'utilisateur.";
  let out;
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await axios.post("https://api.anthropic.com/v1/messages", { model: "claude-haiku-4-5-20251001", max_tokens: 1000, system: sys, messages: [{ role: "user", content: c.input }] },
      { headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, timeout: 60000 });
    out = r.data.content.map((x) => x.text || "").join("");
  } else if (process.env.OPENAI_API_KEY) {
    const r = await axios.post("https://api.openai.com/v1/chat/completions", { model: "gpt-4o-mini", messages: [{ role: "system", content: sys }, { role: "user", content: c.input }] },
      { headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY }, timeout: 60000 });
    out = r.data.choices[0].message.content;
  } else {
    out = await F.get("https://text.pollinations.ai/" + encodeURIComponent(c.input) + "?system=" + encodeURIComponent(sys), { responseType: "text", timeout: 60000 });
  }
  c.reply("🤖 " + String(out).slice(0, 3800));
});
def("tools", "kimi", {}, async (c) => {
  const SASA_KEY = process.env.SASA_API_KEY || "";
  if (!SASA_KEY) return c.reply("⚠️ Ajoute la variable SASA_API_KEY pour activer .kimi");
  if (!c.input) return c.reply("Ex: .kimi explique-moi la relativite etape par etape");
  try {
    const params = new URLSearchParams({ apikey: SASA_KEY, q: c.input });
    const r = await axios.get(`https://sasa-dev-api.xyz/api/kimi-k2.7?${params.toString()}`, { timeout: 60000 });
    const out = typeof r.data === "string" ? r.data : (r.data?.answer || r.data?.response || r.data?.result || r.data?.message || JSON.stringify(r.data));
    c.reply("🧠 " + String(out).slice(0, 3800));
  } catch (e) {
    throw new Error("Kimi K2.7 indisponible: " + (e.response?.data?.message || e.message));
  }
});
def("tools", "nanobanana", {}, async (c) => {
  const SASA_KEY = process.env.SASA_API_KEY || "";
  if (!SASA_KEY) return c.reply("⚠️ Ajoute la variable SASA_API_KEY pour activer .nanobanana");
  if (!c.input) return c.reply("Ex: .nanobanana un chat astronaute sur la lune\n(optionnel: ajoute une taille a la fin, ex: 1024x1024)");
  let prompt = c.input, size = "";
  const szMatch = prompt.match(/\s(\d{2,4}x\d{2,4})$/i);
  if (szMatch) { size = szMatch[1]; prompt = prompt.slice(0, szMatch.index).trim(); }
  await c.reply("🍌 Génération Nano Banana...");
  try {
    const params = new URLSearchParams({ apikey: SASA_KEY, p: prompt });
    if (size) params.set("size", size);
    const r = await axios.get(`https://sasa-dev-api.xyz/api/nanobanana?${params.toString()}`, { timeout: 90000 });
    let imgUrl = null;
    if (typeof r.data === "string" && /^https?:\/\//.test(r.data.trim())) imgUrl = r.data.trim();
    else if (r.data?.url) imgUrl = r.data.url;
    else if (r.data?.data?.url) imgUrl = r.data.data.url;
    else if (r.data?.result?.url) imgUrl = r.data.result.url;
    else if (r.data?.download_url) imgUrl = r.data.download_url;
    else { const l = F.findMedia(r.data, "image"); if (l?.length) imgUrl = l[0]; }
    if (!imgUrl) return c.reply("❌ Reponse inattendue de l'API (pas de lien image trouve).");
    const buf = await F.buf(imgUrl, { timeout: 60000 });
    await c.send({ image: buf, caption: "🍌 " + prompt });
  } catch (e) {
    throw new Error("Nano Banana indisponible: " + (e.response?.data?.message || e.message));
  }
});
def("tools", "imagine", {}, async (c) => {
  if (!c.input) return c.reply("Ex: .imagine un lion astronaute");
  await c.reply("🎨 Génération...");
  const b = await F.buf("https://image.pollinations.ai/prompt/" + encodeURIComponent(c.input) + "?width=768&height=768&nologo=true", { timeout: 90000 });
  await c.send({ image: b, caption: "🎨 " + c.input });
});
def("tools", "meme", {}, async (c) => { const d = await F.get("https://meme-api.com/gimme"); await c.img(d.url, "😂 " + d.title); });
const JOKES = ["Pourquoi les plongeurs plongent-ils toujours en arrière ? Parce que sinon ils tombent dans le bateau.", "Que dit un escargot sur le dos d'une tortue ? Youhou !", "Pourquoi les poissons détestent l'ordinateur ? Ils ont peur du net.", "Un crocodile qui surveille la pharmacie, c'est un… Lacoste garde."];
def("tools", "joke", {}, async (c) => {
  try {
    const d = await F.get("https://v2.jokeapi.dev/joke/Any?lang=fr&safe-mode");
    if (!d.error) return c.reply("😂 " + (d.joke || d.setup + "\n\n" + d.delivery));
  } catch {}
  c.reply("😂 " + rnd(JOKES));
});
const QUOTES = ["Le succès, c'est tomber sept fois, se relever huit.", "Fais de ta vie un rêve, et d'un rêve une réalité.", "La discipline est le pont entre les objectifs et les accomplissements."];
def("tools", "quote", {}, async (c) => {
  try { const d = await F.get("https://zenquotes.io/api/random"); return c.reply(`💬 ${await F.translate(d[0].q)}\n— ${d[0].a}`); } catch {}
  c.reply("💬 " + rnd(QUOTES));
});
const TRUTHS = ["Quel est ton plus gros secret ?", "Quelle est la dernière chose que tu as cherchée sur Google ?", "Qui est ton crush en ce moment ?", "Quel est ton pire souvenir de honte ?", "As-tu déjà menti à un ami proche ? Sur quoi ?", "Quelle est ta plus grande peur ?", "Quel message n'as-tu jamais osé envoyer ?", "Quel est ton pire défaut ?"];
const DARES = ["Envoie un vocal en chantant ton refrain préféré.", "Change ta photo de profil avec un emoji pendant 1h.", "Écris « je suis le roi/la reine du groupe » en statut.", "Envoie ta dernière photo de la galerie.", "Parle avec un accent bizarre dans ton prochain vocal.", "Fais 20 pompes et envoie la vidéo.", "Dis quelque chose de gentil à chaque admin du groupe."];
def("tools", "truth", {}, (c) => c.reply("🎯 *VÉRITÉ*\n" + rnd(TRUTHS)));
def("tools", "dare", {}, (c) => c.reply("🔥 *ACTION*\n" + rnd(DARES)));
def("tools", "quiz", {}, async (c) => {
  const d = await F.get("https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986");
  const q = d.results?.[0]; if (!q) return c.reply("❌ Quiz indisponible.");
  const dec = decodeURIComponent, good = dec(q.correct_answer);
  const opts = [...q.incorrect_answers.map(dec), good].sort(() => Math.random() - 0.5);
  const L = ["A", "B", "C", "D"];
  await c.reply(`❓ *QUIZ* (${dec(q.category)})\n\n${dec(q.question)}\n\n${opts.map((o, i) => L[i] + ". " + o).join("\n")}\n\n⏳ Réponse dans 20s...`);
  setTimeout(() => c.reply(`✅ Réponse: *${L[opts.indexOf(good)]}. ${good}*`).catch(() => {}), 20000);
});
def("tools", "slot", {}, (c) => {
  const u = F.user(c.senderJid); const bet = parseInt(c.args[0]) || 0;
  if (bet < 0 || bet > u.balance) return c.reply("❌ Mise invalide (solde: " + u.balance + ")");
  const E = ["🍒", "🍋", "🍇", "💎", "7️⃣"]; const r = [rnd(E), rnd(E), rnd(E)];
  let gain = 0; if (r[0] === r[1] && r[1] === r[2]) gain = bet * 5; else if (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]) gain = bet;
  u.balance += gain - bet; save();
  c.reply(`🎰 ${r.join(" | ")}\n${gain > bet ? "🎉 JACKPOT" : gain === bet && bet ? "😌 Mise récupérée" : "😢 Perdu"}\n💰 Solde: ${u.balance}${bet ? "" : "\n(Mise avec .slot 100)"}`);
});
def("tools", "couple", { group: true }, async (c) => {
  const p = c.participants.filter((x) => num(x.id) !== c.me).map((x) => x.id); if (p.length < 2) return c.reply("Pas assez de membres.");
  const a = rnd(p); const b = rnd(p.filter((x) => x !== a));
  const t = box("𝐂𝐎𝐔𝐏𝐋𝐄 𝐃𝐔 𝐉𝐎𝐔𝐑", [`@${num(a)} ❤️ @${num(b)}`], [`${sm("compatibilite")} : ${Math.floor(Math.random() * 51) + 50}%`]);
  await c.send({ text: t, mentions: [a, b] });
});
def("tools", "daily", {}, (c) => {
  const u = F.user(c.senderJid), now = Date.now();
  if (now - u.lastDaily < 86400000) return c.reply("⏳ Reviens dans " + fmtUp((86400000 - (now - u.lastDaily)) / 1000));
  const g = 300 + Math.floor(Math.random() * 401); u.balance += g; u.lastDaily = now; save();
  c.reply(`🎁 +${g} pièces\n💰 Solde: ${u.balance}`);
});
def("tools", "balance", {}, (c) => c.reply("💰 Solde: " + F.user(c.senderJid).balance + " pièces"));
def("tools", "rank", {}, async (c) => {
  const top = Object.entries(db.users).sort((a, b) => b[1].balance - a[1].balance).slice(0, 10);
  if (!top.length) return c.reply("Classement vide.");
  const t = box("𝐓𝐎𝐏 𝟏𝟎 𝐑𝐈𝐂𝐇𝐄𝐒", top.map(([n, u], i) => `${i + 1}. @${n} — ${u.balance}`));
  await c.send({ text: t, mentions: top.map(([n]) => n + "@s.whatsapp.net") });
});
def("tools", "profile", {}, async (c) => {
  const u = F.user(c.senderJid), pp = await c.sock.profilePictureUrl(c.senderJid, "image").catch(() => null);
  const t = `👤 *${c.m.pushName || num(c.senderJid)}*\nNuméro: ${num(c.senderJid)}\n⭐ Niveau: ${Math.floor(u.xp / 100) + 1} (${u.xp} XP)\n💰 Pièces: ${u.balance}\n⌨️ Commandes: ${u.cmds}`;
  pp ? await c.img(pp, t) : await c.reply(t);
});
def("tools", "repo", {}, (c) => c.reply(`📦 *${BOT}*\n${process.env.REPO_URL || "Bot WhatsApp by DEV SYMPRAX"}`));
def("tools", ["web2zip", "sitezip"], {}, async (c) => {
  if (!c.input || !/^https?:\/\//i.test(c.input)) return c.reply("Ex: .web2zip https://example.com");
  await c.reply("🗜️ Archivage du site en cours...");
  try {
    const r = await axios.get("https://api.gifted.co.ke/api/tools/web2zip", { params: { url: c.input }, timeout: 60000 });
    const d = r.data;
    if (!d?.success || !d?.result?.download_url) throw new Error(d?.message || "Echec de l'archivage");
    const res = d.result;
    c.reply(`🗜️ *SITE → ZIP*\n🔗 ${res.siteUrl || c.input}\n📁 Fichiers: ${res.copiedFilesAmount || 1}\n\n📥 ${res.download_url}`);
  } catch (e) { throw new Error("web2zip indisponible: " + (e.response?.data?.message || e.message)); }
});
def("tools", ["web2apk", "toapp"], {}, async (c) => {
  const x = await c.media(["imageMessage"]);
  if (!x) return c.reply("Réponds à une image (icône) avec:\n.web2apk <url> | <nom app> | <package> | <version>\nEx: .web2apk https://youtube.com | YouTube Pro | com.yt.pro | 1.0.0");
  const parts = c.input.split("|").map((s) => s.trim());
  const [url, appName, packageName, versionName = "1.0.0"] = parts;
  if (!url || !appName || !/^https?:\/\//i.test(url)) return c.reply("Format: .web2apk <url> | <nom app> | <package optionnel> | <version optionnelle>");
  await c.reply("🔨 Construction de l'APK... ça peut prendre quelques minutes.");
  try {
    const BASE = "https://webappcreator.amethystlab.org";
    const pkg = packageName || "com." + appName.toLowerCase().replace(/[^a-z0-9]/g, "") + ".app";
    const fd = new FormData();
    fd.append("websiteUrl", url);
    fd.append("appName", appName);
    fd.append("icon", new Blob([x.buffer]), "icon.jpg");
    fd.append("packageName", pkg);
    fd.append("versionName", versionName);
    fd.append("versionCode", "1");
    const r = await axios.post(BASE + "/api/build-apk", fd, { timeout: 120000, maxContentLength: Infinity, maxBodyLength: Infinity });
    const d = r.data;
    if (!d?.success) throw new Error(d?.message || "Echec de la construction");
    const apkUrl = BASE + d.downloadUrl;
    const apkBuf = await F.buf(apkUrl, { timeout: 60000 });
    await c.send({ document: apkBuf, mimetype: "application/vnd.android.package-archive", fileName: `${appName.replace(/\s+/g, "_")}-${versionName}.apk` });
    c.reply(`✅ *${appName}* converti !\n📦 ${pkg}\n🏷️ v${versionName}\n🔗 ${url}`);
  } catch (e) { throw new Error("web2apk indisponible: " + (e.response?.data?.message || e.message)); }
});
def("tools", "wallpaper", {}, async (c) => {
  if (!c.input) return c.reply("Ex: .wallpaper nature");
  try {
    const url = "https://4kwallpapers.com/search/?q=" + encodeURIComponent(c.input);
    const html = await F.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, responseType: "text" });
    const cheerio = (await import("cheerio")).default;
    const $ = cheerio.load(html);
    const items = $(".wallpapers__item").slice(0, 4).map((i, el) => {
      const img = $(el).find("img");
      return img.attr("src");
    }).get().filter(Boolean);
    if (!items.length) return c.reply("❌ Aucun wallpaper trouvé.");
    for (const u of items) await c.send({ image: { url: u }, caption: "🖼️ " + c.input });
  } catch (e) { throw new Error("wallpaper indisponible: " + e.message); }
});

// ================= FUN & UTILS (26) =================
const inp = (c, ex) => { if (!c.input) { c.reply("Ex: " + ex); return null; } return c.input; };
def("fun", "reverse", {}, (c) => { const t = inp(c, ".reverse bonjour"); if (t) c.reply([...t].reverse().join("")); });
def("fun", "upper", {}, (c) => { const t = inp(c, ".upper bonjour"); if (t) c.reply(t.toUpperCase()); });
def("fun", "lower", {}, (c) => { const t = inp(c, ".lower BONJOUR"); if (t) c.reply(t.toLowerCase()); });
def("fun", "b64", {}, (c) => { const t = inp(c, ".b64 bonjour"); if (t) c.reply(Buffer.from(t).toString("base64")); });
def("fun", "unb64", {}, (c) => { const t = inp(c, ".unb64 Ym9uam91cg=="); if (t) c.reply(Buffer.from(t, "base64").toString("utf8")); });
def("fun", "uuid", {}, (c) => c.reply(crypto.randomUUID()));
def("fun", "rand", {}, (c) => { let a = parseInt(c.args[0]), b = parseInt(c.args[1]); if (isNaN(a)) { a = 1; b = 100; } else if (isNaN(b)) { b = a; a = 1; } if (a > b) [a, b] = [b, a]; c.reply("🎲 " + (Math.floor(Math.random() * (b - a + 1)) + a)); });
def("fun", "coin", {}, (c) => c.reply("🪙 " + rnd(["PILE", "FACE"])));
def("fun", "dice", {}, (c) => c.reply("🎲 " + (Math.floor(Math.random() * 6) + 1)));
def("fun", "8ball", {}, (c) => { if (!inp(c, ".8ball est-ce que je vais réussir ?")) return; c.reply("🎱 " + rnd(["Oui, sans aucun doute.", "C'est certain.", "Très probable.", "Demande plus tard.", "Je ne peux pas prédire maintenant.", "Peu probable.", "Non.", "Mes sources disent non.", "Concentre-toi et redemande."])); });
def("fun", "rate", {}, (c) => { const t = inp(c, ".rate mon style"); if (t) c.reply(`⭐ *${t}* : ${Math.floor(Math.random() * 101)}%`); });
def("fun", "pick", {}, (c) => { const o = c.input.split(/[|,]/).map((x) => x.trim()).filter(Boolean); if (o.length < 2) return c.reply("Ex: .pick pizza | burger | tacos"); c.reply("👉 " + rnd(o)); });
def("fun", "password", {}, (c) => {
  const n = Math.min(Math.max(parseInt(c.args[0]) || 12, 6), 64), cs = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?";
  c.reply("🔐 " + Array.from(crypto.randomBytes(n), (b) => cs[b % cs.length]).join(""));
});
def("fun", "sha", {}, (c) => { const t = inp(c, ".sha bonjour"); if (t) c.reply(crypto.createHash("sha256").update(t).digest("hex")); });
const TZ = () => process.env.TZ_DEFAULT || "Africa/Douala";
def("fun", "time", {}, (c) => { const z = c.args[0] || TZ(); try { c.reply(`🕐 ${z}\n${new Date().toLocaleTimeString("fr-FR", { timeZone: z })}`); } catch { c.reply("Fuseau invalide. Ex: .time Europe/Paris"); } });
def("fun", "date", {}, (c) => { const z = c.args[0] || TZ(); try { c.reply(`📅 ${new Date().toLocaleDateString("fr-FR", { timeZone: z, weekday: "long", year: "numeric", month: "long", day: "numeric" })}`); } catch { c.reply("Fuseau invalide."); } });
def("fun", "binary", {}, (c) => { const t = inp(c, ".binary abc"); if (t) c.reply([...Buffer.from(t)].map((b) => b.toString(2).padStart(8, "0")).join(" ")); });
def("fun", "unbinary", {}, (c) => { const t = inp(c, ".unbinary 01100001"); if (!t) return; if (!/^[01\s]+$/.test(t)) return c.reply("Que des 0 et 1."); c.reply(Buffer.from(t.trim().split(/\s+/).map((b) => parseInt(b, 2))).toString("utf8")); });
const MORSE = { a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.", h: "....", i: "..", j: ".---", k: "-.-", l: ".-..", m: "--", n: "-.", o: "---", p: ".--.", q: "--.-", r: ".-.", s: "...", t: "-", u: "..-", v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--..", 0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----." };
const UNMORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
def("fun", "morse", {}, (c) => {
  const t = inp(c, ".morse sos"); if (!t) return;
  if (/^[.\-/\s]+$/.test(t)) return c.reply(t.trim().split(/\s*\/\s*/).map((w) => w.split(/\s+/).map((x) => UNMORSE[x] || "?").join("")).join(" "));
  c.reply(t.toLowerCase().split("").map((ch) => (ch === " " ? "/" : MORSE[ch] || "")).filter(Boolean).join(" "));
});
def("fun", "count", {}, (c) => { const t = inp(c, ".count votre texte"); if (t) c.reply(`🔢 Caractères: ${[...t].length}\nMots: ${t.trim().split(/\s+/).length}\nLignes: ${t.split("\n").length}`); });
def("fun", "mock", {}, (c) => { const t = inp(c, ".mock je suis très intelligent"); if (t) c.reply([...t].map((ch, i) => (i % 2 ? ch.toUpperCase() : ch.toLowerCase())).join("")); });
def("fun", "owner", {}, (c) => {
  const o = [...new Set([...F.owners(), c.me])];
  return sendLogo(c, box("𝐎𝐖𝐍𝐄𝐑", o.map((n) => "wa.me/" + n), [
    `${sm("st")} : Online`,
    `${sm("md")} : ${db.settings.mode === "self" ? "Self" : "Public"}`
  ]));
});
def("fun", "uptime", {}, (c) => c.reply("⏱️ " + fmtUp((Date.now() - START) / 1000)));
def("fun", "bmi", {}, (c) => {
  const w = parseFloat(c.args[0]), h = parseFloat(c.args[1]) / 100; if (!w || !h) return c.reply("Ex: .bmi 70 175  (kg cm)");
  const b = w / (h * h); c.reply(`⚖️ IMC: *${b.toFixed(1)}* — ${b < 18.5 ? "Maigreur" : b < 25 ? "Normal" : b < 30 ? "Surpoids" : "Obésité"}`);
});
def("fun", "age", {}, (c) => {
  const d = new Date(c.args[0]); if (isNaN(d)) return c.reply("Ex: .age 2000-05-14");
  const n = new Date(); let y = n.getFullYear() - d.getFullYear(), mo = n.getMonth() - d.getMonth(), da = n.getDate() - d.getDate();
  if (da < 0) { mo--; da += 30; } if (mo < 0) { y--; mo += 12; }
  c.reply(`🎂 ${y} ans, ${mo} mois, ${da} jours`);
});
def("fun", "percent", {}, (c) => { const a = parseFloat(c.args[0]), b = parseFloat(c.args[1]); if (isNaN(a) || isNaN(b)) return c.reply("Ex: .percent 20 150  (20% de 150)"); c.reply(`➗ ${a}% de ${b} = *${(a * b) / 100}*`); });

// ================= MENUS =================
const NAV = {
  menu: async (c) => {
    const ownerNum = (F.owners()[0] || num(c.me) || "?");
    const cap = box("𝐁𝐎𝐓", [
      ".menu",
      ".help",
      ".ping",
      ".owner",
      ...Object.keys(META).map((k) => "." + META[k][2])
    ], [
      `${sm("owner")} : wa.me/${ownerNum}`,
      `${sm("uptime")} : ${fmtUp((Date.now() - START) / 1000)}`,
      `${sm("commands")} : ${total()}`,
      `${sm("status")} : Online`,
      `${sm("mode")} : ${db.settings.mode === "self" ? "Self" : "Public"}`
    ]);
    await sendLogo(c, cap);
  },
  help: async (c) => {
    const cap = box("𝐇𝐄𝐋𝐏", Object.keys(META).map((k) => `.${META[k][2]} ${META[k][1]}`), [
      `${sm("up")} : ${fmtUp((Date.now() - START) / 1000)}`,
      `${sm("st")} : Online`,
      `${sm("md")} : ${db.settings.mode === "self" ? "Self" : "Public"}`
    ]);
    await sendLogo(c, cap);
  }
};
for (const k of Object.keys(META)) NAV[META[k][2]] = (c) => sendLogo(c, catText(k));
for (const [n, fn] of Object.entries(NAV)) CMDS[n] = { fn, nav: true };

// ================= EXECUTION =================
async function run(sock, m, from, cmd, text) {
  const h = CMDS[cmd]; if (!h) return;
  const c = await makeCtx(sock, m, from, cmd, text);
  if (db.banned.includes(num(c.senderJid)) && !c.isOwner) return;
  if (db.settings.mode === "self" && !c.isOwner) return;
  if (h.owner && !c.isOwner) return c.reply("owner only");
  if (h.group && !c.isGroup) return c.reply("group only");
  if (h.admin && !(c.isOwner || c.isAdmin)) return c.reply("admin only");
  if (h.botAdmin && !c.isBotAdmin) return c.reply("bot must be admin");
  const u = F.user(c.senderJid); u.cmds++; u.xp += 5; save();
  c.react("⏳");
  try { await h.fn(c); c.react("✅"); }
  catch (e) { console.log("[" + cmd + "]", e.message); c.react("❌"); await c.reply("❌ Erreur: " + String(e.message || e).slice(0, 200)); }
}
async function pre(sock, m, from, body) {
  if (!from.endsWith("@g.us") || !db.antilink[from] || m.key.fromMe) return;
  if (!/(chat\.whatsapp\.com\/|https?:\/\/)/i.test(body)) return;
  const c = await makeCtx(sock, m, from);
  if (c.isAdmin || c.isOwner || !c.isBotAdmin) return;
  await sock.sendMessage(from, { delete: m.key }).catch(() => {});
  await sock.sendMessage(from, { text: `⚠️ @${num(c.senderJid)} les liens sont interdits ici.`, mentions: [c.senderJid] });
  if (db.antilink[from] === "kick") await sock.groupParticipantsUpdate(from, [c.senderJid], "remove").catch(() => {});
}
async function welcome(sock, ev) {
  if (!db.welcome[ev.id]) return;
  const meta = await sock.groupMetadata(ev.id).catch(() => null);
  for (const p of ev.participants) {
    const jid = typeof p === "string" ? p : p.id;
    if (ev.action === "add") await sock.sendMessage(ev.id, { text: box("𝐖𝐄𝐋𝐂𝐎𝐌𝐄", [`@${num(jid)}`], [`${sm("gp")} : ${meta?.subject || "groupe"}`]), mentions: [jid] });
    else if (ev.action === "remove") await sock.sendMessage(ev.id, { text: box("𝐋𝐄𝐀𝐕𝐄", [`@${num(jid)}`]), mentions: [jid] });
  }
}
export { run, pre, welcome, total, CMDS };
