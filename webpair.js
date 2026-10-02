import express from "express";
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let sockInstance = null;
let lastCode = null;
let lastPairNumber = null;
let pairBusy = false;
let resetSession = null;

function setSock(s) { sockInstance = s; }
function setReset(fn) { resetSession = fn; }
function formatPairCode(code) {
  const c = String(code || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (c.length === 8) return c.slice(0, 4) + "-" + c.slice(4);
  return String(code || "");
}
function setCode(c, n) {
  lastCode = c || null;
  lastPairNumber = c ? String(n || lastPairNumber || "").replace(/[^0-9]/g, "") || null : null;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function sockReady() {
  return !!(sockInstance && !sockInstance.__dead && !sockInstance.authState?.creds?.registered);
}
async function waitSock(ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (sockInstance && !sockInstance.__dead) {
      try {
        await sockInstance.waitForSocketOpen();
        if (sockInstance && !sockInstance.__dead) return sockInstance;
      } catch {}
    }
    await sleep(400);
  }
  throw new Error("Bot pas pret, reessaie dans quelques secondes");
}

const PAGE = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SYMPRAX MD — Pairing</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #dce8df;
      --ink: #1c2e24;
      --muted: #5b7264;
      --green: #1f9a54;
      --green-deep: #167a42;
      --card: #e4eee6;
      --shadow-d: #b7c7bb;
      --shadow-l: #f7fff9;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { min-height: 100%; }
    body {
      font-family: Outfit, system-ui, sans-serif;
      color: var(--ink);
      background: radial-gradient(1200px 700px at 10% -10%, #f3faf4 0%, var(--bg) 55%);
      overflow-x: hidden;
    }
    .scene { position: relative; min-height: 100vh; display: grid; place-items: center; padding: 32px 18px 48px; }
    .goo-wrap {
      position: absolute; inset: 0; overflow: hidden; pointer-events: none;
      filter: url(#goo);
    }
    .blob {
      position: absolute; border-radius: 50%;
      animation: float 18s ease-in-out infinite;
    }
    .b1 { width: 340px; height: 340px; left: -80px; top: -70px; background: #9fe0b6; animation-duration: 16s; }
    .b2 { width: 280px; height: 280px; right: -60px; top: 12%; background: #7fd4c2; animation-duration: 22s; animation-delay: -4s; }
    .b3 { width: 220px; height: 220px; left: 18%; bottom: -80px; background: #c8ec9a; animation-duration: 19s; animation-delay: -8s; }
    .b4 { width: 160px; height: 160px; right: 18%; bottom: 8%; background: #86d98b; animation-duration: 14s; animation-delay: -2s; }
    @keyframes float {
      0%, 100% { transform: translate(0, 0) scale(1); }
      33% { transform: translate(28px, -22px) scale(1.08); }
      66% { transform: translate(-22px, 18px) scale(0.94); }
    }
    .card {
      position: relative; z-index: 2; width: min(440px, 100%);
      background: var(--card);
      border-radius: 32px;
      padding: 36px 28px 28px;
      box-shadow:
        14px 14px 28px var(--shadow-d),
        -14px -14px 28px var(--shadow-l);
    }
    .logo {
      width: 72px; height: 72px; margin: 0 auto 18px;
      border-radius: 24px;
      display: grid; place-items: center;
      background: var(--card);
      box-shadow: 8px 8px 16px var(--shadow-d), -8px -8px 16px var(--shadow-l);
    }
    .logo svg { width: 36px; height: 36px; }
    h1 { text-align: center; font-size: 1.55rem; letter-spacing: -0.03em; font-weight: 800; }
    .sub { text-align: center; color: var(--muted); margin: 6px 0 22px; font-size: 0.95rem; }
    .status {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      margin: 0 auto 22px; padding: 8px 14px; width: fit-content;
      border-radius: 999px;
      background: var(--card);
      box-shadow: inset 4px 4px 8px var(--shadow-d), inset -4px -4px 8px var(--shadow-l);
      font-size: 0.78rem; font-weight: 600; color: var(--muted); letter-spacing: 0.04em;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #c9a227; }
    .status.ok .dot { background: var(--green); box-shadow: 0 0 0 4px rgba(31,154,84,.18); }
    .status.busy .dot { background: #2f80ed; }
    .status.err .dot { background: #c44536; }
    label { display: block; font-size: 0.78rem; font-weight: 600; color: var(--muted); margin-bottom: 8px; letter-spacing: 0.04em; }
    .field {
      display: flex; align-items: center; gap: 10px;
      background: var(--card);
      border-radius: 18px; padding: 4px 4px 4px 16px;
      box-shadow: inset 6px 6px 12px var(--shadow-d), inset -6px -6px 12px var(--shadow-l);
    }
    .plus { font-weight: 700; color: var(--green-deep); }
    input {
      flex: 1; border: 0; outline: 0; background: transparent;
      font: 600 1.05rem Outfit, sans-serif; color: var(--ink); padding: 14px 8px;
    }
    .go {
      width: 100%; margin-top: 16px; border: 0; cursor: pointer;
      border-radius: 18px; padding: 16px 18px;
      font: 700 1rem Outfit, sans-serif; color: #f4fff7;
      background: linear-gradient(180deg, #27b463 0%, var(--green-deep) 100%);
      box-shadow: 8px 8px 16px var(--shadow-d), -6px -6px 14px var(--shadow-l);
      transition: transform .15s ease, filter .15s ease;
    }
    .go:hover { filter: brightness(1.05); transform: translateY(-1px); }
    .go:active { transform: translateY(1px); box-shadow: inset 4px 4px 10px rgba(0,0,0,.18); }
    .go:disabled { opacity: .65; cursor: wait; transform: none; }
    .hint { text-align: center; color: var(--muted); font-size: 0.82rem; margin-top: 16px; line-height: 1.45; }
    .result { margin-top: 22px; display: none; }
    .result.show { display: block; }
    .code-box {
      border-radius: 22px; padding: 18px 16px 14px; text-align: center;
      background: var(--card);
      box-shadow: inset 6px 6px 12px var(--shadow-d), inset -6px -6px 12px var(--shadow-l);
    }
    .code-label { font-size: 0.72rem; font-weight: 700; letter-spacing: .14em; color: var(--muted); }
    .code {
      margin: 8px 0 12px; font-size: 2rem; font-weight: 800; letter-spacing: .18em;
      color: var(--green-deep);
    }
    .copy {
      border: 0; cursor: pointer; border-radius: 14px; padding: 10px 16px;
      font: 700 .85rem Outfit, sans-serif; color: var(--green-deep); background: var(--card);
      box-shadow: 6px 6px 12px var(--shadow-d), -6px -6px 12px var(--shadow-l);
    }
    .err {
      display: none; margin-top: 14px; padding: 12px 14px; border-radius: 14px;
      color: #7a241c; background: #f3ddd9;
      box-shadow: inset 3px 3px 8px rgba(150,70,60,.16);
      font-size: 0.88rem;
    }
    .err.show { display: block; }
    footer { text-align: center; margin-top: 22px; font-size: .75rem; color: var(--muted); }
  </style>
</head>
<body>
  <svg width="0" height="0" style="position:absolute">
    <filter id="goo">
      <feGaussianBlur in="SourceGraphic" stdDeviation="16" result="blur"/>
      <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" result="goo"/>
      <feBlend in="SourceGraphic" in2="goo"/>
    </filter>
  </svg>
  <div class="scene">
    <div class="goo-wrap" aria-hidden="true">
      <div class="blob b1"></div>
      <div class="blob b2"></div>
      <div class="blob b3"></div>
      <div class="blob b4"></div>
    </div>
    <main class="card">
      <div class="logo">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 3c4.97 0 9 3.81 9 8.5 0 2.15-.86 4.12-2.28 5.62L20 21l-4.2-1.4A9.3 9.3 0 0 1 12 20C7.03 20 3 16.19 3 11.5S7.03 3 12 3Z" stroke="#167a42" stroke-width="1.8"/>
          <path d="M8.2 10.2c.2 2.4 2.3 4.5 4.8 4.8" stroke="#1f9a54" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </div>
      <h1>SYMPRAX MD V1</h1>
      <p class="sub">Entre ton numero, recois le code de liaison.</p>
      <div id="st" class="status"><span class="dot"></span><span id="stt">Connexion...</span></div>
      <form id="f">
        <label for="number">NUMERO WHATSAPP</label>
        <div class="field">
          <span class="plus">+</span>
          <input id="number" name="number" inputmode="numeric" autocomplete="tel" placeholder="237XXXXXXXXX" maxlength="16" required>
        </div>
        <button class="go" id="btn" type="submit">Obtenir le code</button>
      </form>
      <div id="err" class="err"></div>
      <div id="res" class="result">
        <div class="code-box">
          <div class="code-label">CODE DE LIAISON</div>
          <div class="code" id="code"></div>
          <button class="copy" id="copy" type="button">Copier</button>
        </div>
      </div>
      <p class="hint">WhatsApp &gt; Appareils lies &gt; Lier un appareil &gt; Lier avec un numero de telephone</p>
      <footer>DEV SYMPRAX</footer>
    </main>
  </div>
  <script>
    const st = document.getElementById("st");
    const stt = document.getElementById("stt");
    const f = document.getElementById("f");
    const btn = document.getElementById("btn");
    const err = document.getElementById("err");
    const res = document.getElementById("res");
    const codeEl = document.getElementById("code");
    const copy = document.getElementById("copy");
    function setStatus(kind, text) {
      st.className = "status " + kind;
      stt.textContent = text;
    }
    function showErr(m) {
      err.textContent = m || "";
      err.classList.toggle("show", !!m);
    }
    async function ping() {
      try {
        const r = await fetch("/status");
        const d = await r.json();
        if (d.registered) setStatus("ok", "Deja lie");
        else if (d.ready) setStatus("ok", "Pret a lier");
        else setStatus("", "Connexion...");
      } catch { setStatus("err", "Hors ligne"); }
    }
    ping();
    setInterval(ping, 4000);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      showErr("");
      const number = document.getElementById("number").value.replace(/[^0-9]/g, "");
      if (number.length < 8 || number.length > 15) { showErr("Numero invalide. Indicatif + numero, 8 a 15 chiffres."); return; }
      btn.disabled = true;
      setStatus("busy", "Generation du code...");
      try {
        const r = await fetch("/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number }) });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        codeEl.textContent = d.code;
        res.classList.add("show");
        setStatus("ok", "Code pret");
      } catch (ex) {
        showErr(ex.message || "Erreur");
        setStatus("err", "Echec");
      } finally { btn.disabled = false; }
    });
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(codeEl.textContent.replace("-", "")); copy.textContent = "Copie"; setTimeout(() => copy.textContent = "Copier", 1200); } catch {}
    });
  </script>
</body>
</html>`;

async function pair(num) {
  const phone = String(num || "").replace(/[^0-9]/g, "");
  if (phone.length < 8 || phone.length > 15) throw new Error("Numero invalide (indicatif + numero, 8-15 chiffres)");
  if (sockInstance?.authState?.creds?.registered) throw new Error("Bot deja lie. Supprime la session pour relier.");
  if (lastCode && lastPairNumber === phone && sockReady()) return lastCode;
  if (pairBusy) throw new Error("Pairing deja en cours, reessaie");
  pairBusy = true;
  try {
    if (lastPairNumber && lastPairNumber !== phone && typeof resetSession === "function") {
      lastCode = null;
      lastPairNumber = null;
      await resetSession();
    }
    const sock = await waitSock();
    if (sock.authState?.creds?.registered) throw new Error("Bot deja lie. Supprime la session pour relier.");
    const raw = await sock.requestPairingCode(phone);
    const code = formatPairCode(raw);
    lastCode = code;
    lastPairNumber = phone;
    console.log("Code pairing pour " + phone + " : " + code);
    return code;
  } finally {
    pairBusy = false;
  }
}

app.get("/", (_req, res) => res.type("html").send(PAGE));
app.post("/pair", async (req, res) => {
  try { res.json({ code: await pair(req.body.number) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/pair", async (req, res) => {
  try { res.json({ code: await pair(req.query.number) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/status", (_req, res) => {
  res.json({
    ready: sockReady(),
    registered: !!sockInstance?.authState?.creds?.registered,
    code: lastCode,
    number: lastPairNumber
  });
});
app.get("/health", (_req, res) => res.send("ok"));

const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;
app.listen(PORT, () => {
  console.log("WEB PAIR sur le port " + PORT);
  let publicUrl = null;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) publicUrl = "https://" + process.env.RAILWAY_PUBLIC_DOMAIN;
  else if (process.env.RAILWAY_STATIC_URL) publicUrl = process.env.RAILWAY_STATIC_URL;
  else if (process.env.PANEL_PUBLIC_URL) publicUrl = process.env.PANEL_PUBLIC_URL;
  console.log("==============================================");
  if (publicUrl) {
    console.log("  OUVRE CE LIEN POUR TE CONNECTER :");
    console.log("  " + publicUrl);
  } else {
    console.log("  Lien a ouvrir : <adresse-de-ton-panel>:" + PORT);
    console.log("  (regarde l'onglet Network/Networking de ton panel");
    console.log("   pour l'adresse exacte, ex: seven.hopto.org:" + PORT + ")");
    console.log("  Astuce: definis PANEL_PUBLIC_URL dans les variables");
    console.log("  pour que ce lien s'affiche automatiquement ici.");
  }
  console.log("==============================================");
});
export { setSock, setCode, setReset, formatPairCode, pair };
