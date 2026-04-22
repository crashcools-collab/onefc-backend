const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json());

// ═══ STOCKAGE EN MÉMOIRE ═══
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

// ═══ DÉMARRAGE ═══
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ ONE FlowCraft Backend démarré sur port ${PORT}`);
  console.log(`📡 Status : http://localhost:${PORT}/status`);
});
