const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json());

// ═══ MIDDLEWARE MOT DE PASSE ═══
const ADMIN_PWD = process.env.ADMIN_PWD || '090219';

function checkAuth(req, res, next) {
  // Les webhooks et routes API restent accessibles sans mot de passe
  const publicRoutes = ['/webhook/', '/status'];
  if (publicRoutes.some(r => req.path.startsWith(r))) return next();
  
  // Vérifie le cookie de session
  const cookie = req.headers.cookie || '';
  if (cookie.includes('onefc_auth=ok')) return next();
  
  // Vérifie le header Authorization (pour les appels API depuis FlowCraft)
  const auth = req.headers['x-onefc-key'];
  if (auth === ADMIN_PWD) return next();

  // Si POST sur /login → vérifie le mot de passe
  if (req.path === '/login' && req.method === 'POST') return next();

  // Sinon → page de login
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ONE FlowCraft — Accès sécurisé</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0620;color:#e8e0ff;font-family:'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background-image:radial-gradient(ellipse at top left,rgba(180,94,255,.2),transparent 50%),radial-gradient(ellipse at bottom right,rgba(77,199,255,.1),transparent 50%)}
  .card{background:#140a2e;border:1px solid #2d1f5c;border-radius:20px;padding:48px;max-width:400px;width:90%;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,.6)}
  .logo{font-size:28px;font-weight:900;background:linear-gradient(135deg,#b45eff,#4dc7ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:4px;margin-bottom:6px}
  .sub{font-size:12px;color:#9b8dbf;letter-spacing:2px;margin-bottom:32px}
  .label{font-size:11px;font-weight:700;color:#9b8dbf;letter-spacing:1.5px;text-transform:uppercase;display:block;margin-bottom:10px;text-align:left}
  .dots{display:flex;justify-content:center;gap:10px;margin-bottom:24px}
  .dot{width:12px;height:12px;border-radius:50%;border:2px solid #2d1f5c;transition:all .2s}
  input[type=password]{width:100%;padding:14px 18px;background:#1a1040;border:1.5px solid #2d1f5c;border-radius:10px;color:#e8e0ff;font-size:20px;letter-spacing:8px;text-align:center;outline:none;margin-bottom:16px;font-family:monospace}
  input[type=password]:focus{border-color:#b45eff;box-shadow:0 0 0 3px rgba(180,94,255,.15)}
  button{width:100%;padding:14px;background:linear-gradient(135deg,#b45eff,#4dc7ff);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;letter-spacing:2px;cursor:pointer;margin-bottom:12px}
  button:hover{opacity:.9;transform:translateY(-1px)}
  .err{color:#ff5555;font-size:12px;height:18px;margin-top:4px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">ONE FC</div>
  <div class="sub">🔐 ACCÈS SÉCURISÉ</div>
  <label class="label">Mot de passe</label>
  <div class="dots">
    <div class="dot" id="d1"></div><div class="dot" id="d2"></div>
    <div class="dot" id="d3"></div><div class="dot" id="d4"></div>
    <div class="dot" id="d5"></div><div class="dot" id="d6"></div>
  </div>
  <form method="POST" action="/login">
    <input type="password" name="pwd" id="pwd" maxlength="6" placeholder="••••••" autocomplete="off" autofocus
      oninput="for(let i=1;i<=6;i++){document.getElementById('d'+i).style.background=i<=this.value.length?'#b45eff':'';document.getElementById('d'+i).style.borderColor=i<=this.value.length?'#b45eff':'#2d1f5c';document.getElementById('d'+i).style.boxShadow=i<=this.value.length?'0 0 8px #b45eff':'';}">
    <button type="submit">ENTRER ▶</button>
    ${req.query.err ? '<div class="err">❌ Mot de passe incorrect</div>' : '<div class="err"></div>'}
  </form>
</div>
</body>
</html>`);
}

// Route login POST
app.post('/login', express.urlencoded({ extended: true }), (req, res) => {
  if (req.body.pwd === ADMIN_PWD) {
    res.setHeader('Set-Cookie', 'onefc_auth=ok; Path=/; HttpOnly; SameSite=Strict');
    res.redirect('/');
  } else {
    res.redirect('/?err=1');
  }
});

// Route déconnexion
app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'onefc_auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  res.redirect('/');
});

app.use(checkAuth);


const webhookData = {};   // données reçues par webhook
const cronJobs = {};      // jobs cron actifs
const execLogs = [];      // historique des exécutions

// ═══════════════════════════════════════════
// WEBHOOKS — Recevoir des données externes
// ═══════════════════════════════════════════

// Crée un endpoint webhook unique
app.post('/webhook/:id', (req, res) => {
  const id = req.params.id;
  const data = req.body;
  const ts = new Date().toISOString();

  webhookData[id] = { data, receivedAt: ts };

  execLogs.push({ type: 'webhook', id, data, ts });
  console.log(`📥 Webhook reçu [${id}]:`, JSON.stringify(data).slice(0, 100));

  res.json({ ok: true, id, receivedAt: ts });
});

// Récupère les dernières données d'un webhook
app.get('/webhook/:id/data', (req, res) => {
  const d = webhookData[req.params.id];
  if (!d) return res.json({ ok: false, message: 'Aucune donnée reçue' });
  res.json({ ok: true, ...d });
});

// ═══════════════════════════════════════════
// CRON — Déclencheurs automatiques
// ═══════════════════════════════════════════

// Enregistre un job cron
app.post('/cron/register', (req, res) => {
  const { id, schedule, callbackUrl } = req.body;
  if (!id || !schedule || !callbackUrl) {
    return res.status(400).json({ ok: false, message: 'id, schedule et callbackUrl requis' });
  }

  // Arrête le job existant si besoin
  if (cronJobs[id]) { cronJobs[id].stop(); }

  try {
    cronJobs[id] = cron.schedule(schedule, async () => {
      console.log(`⏰ Cron [${id}] déclenché : ${new Date().toLocaleTimeString()}`);
      try {
        await fetch(callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ triggered_at: new Date().toISOString(), cron_id: id })
        });
        execLogs.push({ type: 'cron', id, ts: new Date().toISOString(), status: 'ok' });
      } catch (e) {
        execLogs.push({ type: 'cron', id, ts: new Date().toISOString(), status: 'error', error: e.message });
      }
    });

    res.json({ ok: true, id, schedule, message: `Cron "${id}" enregistré` });
  } catch (e) {
    res.status(400).json({ ok: false, message: `Expression CRON invalide : ${e.message}` });
  }
});

// Liste les crons actifs
app.get('/cron/list', (req, res) => {
  res.json({ ok: true, jobs: Object.keys(cronJobs) });
});

// Arrête un cron
app.delete('/cron/:id', (req, res) => {
  const id = req.params.id;
  if (cronJobs[id]) { cronJobs[id].stop(); delete cronJobs[id]; }
  res.json({ ok: true, message: `Cron "${id}" arrêté` });
});

// ═══════════════════════════════════════════
// GOOGLE SHEETS
// ═══════════════════════════════════════════

app.post('/sheets/append', async (req, res) => {
  const { spreadsheetId, range, values, credentials } = req.body;

  if (!spreadsheetId || !values) {
    return res.status(400).json({ ok: false, message: 'spreadsheetId et values requis' });
  }

  try {
    let auth;

    if (credentials) {
      // Credentials Service Account fournis dans la requête
      auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(credentials),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else if (process.env.GOOGLE_CREDENTIALS) {
      // Credentials en variable d'environnement Railway
      auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else {
      return res.status(400).json({ ok: false, message: 'Credentials Google manquants. Configure GOOGLE_CREDENTIALS dans Railway.' });
    }

    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: range || 'Sheet1',
      valueInputOption: 'USER_ENTERED',
      resource: { values: Array.isArray(values[0]) ? values : [values] },
    });

    const updated = response.data.updates?.updatedRows || 1;
    console.log(`📊 Google Sheets [${spreadsheetId}] : ${updated} ligne(s) ajoutée(s)`);
    res.json({ ok: true, updatedRows: updated });

  } catch (e) {
    console.error('Sheets erreur:', e.message);
    res.status(500).json({ ok: false, message: e.message });
  }
});

// Lire des données Sheets
app.post('/sheets/read', async (req, res) => {
  const { spreadsheetId, range, credentials } = req.body;
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(credentials || process.env.GOOGLE_CREDENTIALS),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: range || 'Sheet1' });
    res.json({ ok: true, values: response.data.values || [] });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// ═══════════════════════════════════════════
// PROXY CORS — Pour éviter les erreurs CORS
// ═══════════════════════════════════════════

app.post('/proxy', async (req, res) => {
  const { url, method = 'POST', headers = {}, body } = req.body;
  if (!url) return res.status(400).json({ ok: false, message: 'URL requise' });

  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { text }; }
    res.status(response.status).json({ ok: response.ok, status: response.status, data });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// ═══════════════════════════════════════════
// LOGS & STATUS
// ═══════════════════════════════════════════

app.get('/logs', (req, res) => {
  res.json({ ok: true, logs: execLogs.slice(-50) });
});

app.get('/status', (req, res) => {
  res.json({
    ok: true,
    status: '🟢 ONE FlowCraft Backend en ligne',
    version: '1.0.0',
    webhooks: Object.keys(webhookData).length,
    crons: Object.keys(cronJobs).length,
    uptime: Math.floor(process.uptime()) + 's'
  });
});

// ═══ PAGE D'ACCUEIL ═══
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ONE FlowCraft Backend</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0620;color:#e8e0ff;font-family:'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background-image:radial-gradient(ellipse at top left,rgba(180,94,255,.2),transparent 50%),radial-gradient(ellipse at bottom right,rgba(77,199,255,.1),transparent 50%)}
  .card{background:#140a2e;border:1px solid #2d1f5c;border-radius:20px;padding:48px;max-width:520px;width:90%;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,.6)}
  .logo{font-size:28px;font-weight:900;background:linear-gradient(135deg,#b45eff,#4dc7ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:4px;margin-bottom:6px}
  .sub{font-size:12px;color:#9b8dbf;letter-spacing:2px;margin-bottom:32px}
  .status{display:inline-flex;align-items:center;gap:8px;padding:8px 18px;background:rgba(0,230,147,.1);border:1px solid rgba(0,230,147,.3);border-radius:20px;font-size:13px;color:#00e693;margin-bottom:32px}
  .dot{width:8px;height:8px;border-radius:50%;background:#00e693;box-shadow:0 0 8px #00e693;animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  .endpoints{text-align:left;background:#1a1040;border-radius:12px;padding:20px;margin-bottom:24px}
  .ep-title{font-size:11px;font-weight:700;color:#b45eff;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px}
  .ep{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:13px}
  .ep:last-child{border-bottom:none}
  .method{padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;min-width:40px;text-align:center}
  .get{background:rgba(77,199,255,.15);color:#4dc7ff}
  .post{background:rgba(0,230,147,.15);color:#00e693}
  .del{background:rgba(255,85,85,.15);color:#ff5555}
  .path{color:#e8e0ff;font-family:monospace}
  .desc{color:#9b8dbf;font-size:11px;margin-left:auto}
  .stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:24px}
  .stat{background:#1a1040;border-radius:10px;padding:14px;text-align:center}
  .stat-val{font-size:22px;font-weight:700;color:#b45eff}
  .stat-lbl{font-size:10px;color:#9b8dbf;margin-top:3px;letter-spacing:1px;text-transform:uppercase}
  .footer{font-size:11px;color:#9b8dbf}
</style>
</head>
<body>
<div class="card">
  <div class="logo">ONE FC</div>
  <div class="sub">◆ BACKEND RAILWAY</div>
  <div class="status"><div class="dot"></div>EN LIGNE — v1.0.0</div>
  <div class="stats">
    <div class="stat"><div class="stat-val">${Object.keys(webhookData).length}</div><div class="stat-lbl">Webhooks</div></div>
    <div class="stat"><div class="stat-val">${Object.keys(cronJobs).length}</div><div class="stat-lbl">Crons</div></div>
    <div class="stat"><div class="stat-val">${Math.floor(process.uptime())}s</div><div class="stat-lbl">Uptime</div></div>
  </div>
  <div class="endpoints">
    <div class="ep-title">◆ Endpoints disponibles</div>
    <div class="ep"><span class="method get">GET</span><span class="path">/status</span><span class="desc">Statut JSON</span></div>
    <div class="ep"><span class="method post">POST</span><span class="path">/webhook/:id</span><span class="desc">Recevoir webhook</span></div>
    <div class="ep"><span class="method post">POST</span><span class="path">/cron/register</span><span class="desc">Créer un cron</span></div>
    <div class="ep"><span class="method post">POST</span><span class="path">/sheets/append</span><span class="desc">Google Sheets</span></div>
    <div class="ep"><span class="method post">POST</span><span class="path">/proxy</span><span class="desc">Proxy CORS</span></div>
    <div class="ep"><span class="method get">GET</span><span class="path">/logs</span><span class="desc">Historique</span></div>
  </div>
  <div class="footer">ONE FlowCraft Backend • Railway • US West • <a href="/logout" style="color:#ff5555;text-decoration:none">🔒 Déconnexion</a></div>
</div>
</body>
</html>`);
});

// ═══ DÉMARRAGE ═══
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ ONE FlowCraft Backend démarré sur port ${PORT}`);
  console.log(`📡 Status : http://localhost:${PORT}/status`);
});
