# ONE FlowCraft Backend 🚀

Backend Node.js pour ONE FlowCraft — gère les Webhooks, Cron, Google Sheets et le proxy CORS.

## Déploiement sur Railway (5 minutes)

### Étape 1 — Push sur GitHub
```bash
git init
git add .
git commit -m "ONE FlowCraft Backend v1"
git remote add origin https://github.com/TON_USERNAME/onefc-backend.git
git push -u origin main
```

### Étape 2 — Déployer sur Railway
1. Va sur **railway.app**
2. Clique **"New Project"**
3. Choisis **"Deploy from GitHub repo"**
4. Sélectionne **onefc-backend**
5. Railway détecte automatiquement Node.js et déploie ✅

### Étape 3 — Récupère ton URL
Dans Railway → ton projet → **Settings** → **Domains** → copie l'URL
Ex: `https://onefc-backend-production.up.railway.app`

### Étape 4 — Configure dans ONE FlowCraft
Dans **Paramètres → Backend URL**, colle ton URL Railway.

---

## Variables d'environnement (optionnel)

Dans Railway → Variables :
```
GOOGLE_CREDENTIALS={"type":"service_account",...}  # Pour Google Sheets
PORT=3001  # Automatique sur Railway
```

---

## Endpoints disponibles

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/status` | GET | Vérifie que le backend tourne |
| `/webhook/:id` | POST | Reçoit un webhook |
| `/webhook/:id/data` | GET | Lit les données reçues |
| `/cron/register` | POST | Enregistre un job cron |
| `/cron/list` | GET | Liste les crons actifs |
| `/cron/:id` | DELETE | Arrête un cron |
| `/sheets/append` | POST | Ajoute une ligne Google Sheets |
| `/sheets/read` | POST | Lit des données Google Sheets |
| `/proxy` | POST | Proxy CORS pour n'importe quelle API |
| `/logs` | GET | Historique des 50 dernières exécutions |
