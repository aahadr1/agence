# VPS — OpenCode Lead Agent

Tout ce qui tourne sur le VPS Hetzner (`46.225.149.251`) est ici.
Le repo Next.js (le reste du monorepo) reste sur Vercel et parle à ce VPS via HTTPS.

## Structure

```
vps/
├── leadagent/              # Workspace OpenCode (config + agents + tools + skills)
│   ├── opencode.json       # Config principale
│   ├── AGENTS.md           # Contexte global "tu es l'agent personnel d'Aaron"
│   ├── package.json        # Deps Bun (@opencode-ai/plugin, supabase, playwright, zod)
│   ├── .opencode/
│   │   ├── agents/         # lead-finder, researcher, enricher, outreach
│   │   ├── skills/         # lead-discovery, lead-enrichment, lead-scoring, outreach-drafting
│   │   ├── tools/          # pappers, societe-com, pages-jaunes, google-maps, ...
│   │   └── plugins/        # audit (logging hook)
│   └── telegram/
│       └── bridge.ts       # Bot Telegram → OpenCode SDK
└── setup/
    ├── install.sh          # Script d'installation complet (à exécuter sur le VPS en root)
    ├── opencode.service    # systemd: serveur OpenCode 24/24
    ├── opencode-telegram.service  # systemd: bridge Telegram 24/24
    ├── Caddyfile           # Reverse proxy TLS + Basic Auth
    └── env.example         # Modèle .env (à copier vers /etc/opencode.env)
```

## Déploiement (première fois)

Tu fais ceci une seule fois pour mettre tout en ligne.

### 1. Préparer ton compte DeepSeek

1. Va sur [`https://platform.deepseek.com`](https://platform.deepseek.com)
2. Crée un compte, charge ~5€ de crédit (paiement par usage ensuite)
3. Crée une API key, copie-la quelque part

### 2. Préparer ton bot Telegram

1. Sur Telegram, ouvre [`@BotFather`](https://t.me/BotFather)
2. Tape `/newbot`, suis les instructions
3. Copie le token (format `7891234567:AAH...xyz`)
4. Trouve ton ID Telegram : ouvre [`@userinfobot`](https://t.me/userinfobot), tape `/start`, copie le `Id` (ex: `123456789`)

### 3. (Optionnel mais recommandé) Pointer un sous-domaine vers le VPS

Sur ton registrar DNS, crée un enregistrement **A** :
- Nom : `opencode` (ou ce que tu veux)
- Valeur : `46.225.149.251`
- TTL : 300

Ça te donnera `opencode.tondomaine.fr` accessible en HTTPS automatique. Sans domaine, on peut quand même tourner via IP, mais Telegram seul fonctionne (il ne contacte jamais le VPS, c'est le VPS qui le contacte).

### 4. Pousser ce repo sur le VPS

Depuis ton Mac :

```bash
cd /Users/aaron/Downloads/agence-main
git add vps/
git commit -m "vps: initial OpenCode workspace"
git push
```

### 5. Sur le VPS, cloner et installer

Connecte-toi en SSH :

```bash
ssh root@46.225.149.251
```

Une fois connecté :

```bash
# Cloner le repo (uniquement le dossier vps/ via sparse checkout)
mkdir -p /opt && cd /opt
git clone --depth 1 --filter=blob:none --sparse https://github.com/TON-USER/TON-REPO.git agence
cd agence
git sparse-checkout set vps
mv vps/leadagent /opt/leadagent
mv vps/setup /opt/setup
cd /opt && rm -rf agence

# Configurer les variables d'environnement
cp /opt/setup/env.example /etc/opencode.env
nano /etc/opencode.env   # mets DEEPSEEK_API_KEY, TELEGRAM_BOT_TOKEN, etc.

# Lancer le script d'installation
chmod +x /opt/setup/install.sh
/opt/setup/install.sh
```

Le script `install.sh` fait :
- Installer ripgrep, git, Caddy, Chromium, Bun
- Créer le user `opencode` et lui donner `/opt/leadagent`
- Installer OpenCode binaire
- Installer les dépendances npm via `bun install`
- Installer Playwright Chromium
- Copier les fichiers systemd et Caddy en place
- Démarrer les services

À la fin, tu pourras envoyer un message à ton bot Telegram et il répondra.

## Mise à jour (après modifications)

Pour mettre à jour les agents/tools/skills sur le VPS après modifs en local :

```bash
# Sur ton Mac
git push

# Sur le VPS
cd /opt/leadagent
git pull   # si git suivi
# OU rsync depuis ton Mac : rsync -av vps/leadagent/ root@46.225.149.251:/opt/leadagent/
sudo systemctl restart opencode opencode-telegram
```

## Coût mensuel estimé

- VPS Hetzner CX33 : ~7,80€
- DeepSeek API : ~5-15€ (usage perso intensif)
- Telegram : 0€
- **Total : ~13-23€/mois**

## Variables d'environnement requises (`/etc/opencode.env`)

| Variable | Source | Obligatoire ? |
|---|---|---|
| `DEEPSEEK_API_KEY` | platform.deepseek.com | Oui |
| `OPENCODE_SERVER_PASSWORD` | random 32+ chars | Oui |
| `TELEGRAM_BOT_TOKEN` | @BotFather | Oui |
| `TELEGRAM_ALLOWED_USER_IDS` | @userinfobot | Oui (sécurité) |
| `SUPABASE_URL` | Supabase dashboard | Oui (pour save_lead) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard | Oui |
| `PAPPERS_API_KEY` | pappers.fr | Recommandé |
| `SOCIETE_API_KEY` | api.societe.com | Recommandé |
| `PAGESPEED_API_KEY` | console.cloud.google.com | Optionnel |
| `OPENCODE_PUBLIC_HOSTNAME` | ex: opencode.agence.fr | Optionnel (TLS) |

## Architecture

```
┌──────────────────┐                        ┌────────────────────────────┐
│  ton téléphone   │ message                │  VPS Hetzner               │
│   Telegram       ├───────long-polling───▶ │  ┌──────────────────────┐  │
└──────────────────┘                        │  │ opencode-telegram    │  │
                                            │  │ bridge.ts (Bun)      │  │
                                            │  └──────────┬───────────┘  │
┌──────────────────┐                        │             │               │
│  Next.js Vercel  │ HTTPS basic auth       │  ┌──────────▼───────────┐  │
│  /lead-agent     ├──────────┐    ┌───────▶│  │ opencode serve       │  │
└──────────────────┘          │    │        │  │ :4096 (loopback)     │  │
                              ▼    │        │  └──────────┬───────────┘  │
                        ┌──────────┴───┐    │             │               │
                        │ Caddy TLS    │    │      ┌──────▼─────────┐    │
                        │ :443         ├────┘      │ DeepSeek V3 API│    │
                        └──────────────┘           └────────────────┘    │
                                            │                             │
                                            │  Tools : Pappers, Societe, │
                                            │  PagesJaunes, Google Maps  │
                                            │  Playwright, save_lead     │
                                            │  → Supabase (CRM/leads)    │
                                            └────────────────────────────┘
```
