#!/usr/bin/env bash
#
# Script d'installation OpenCode + Telegram bridge sur Ubuntu 24.04.
# À exécuter en tant que root sur le VPS, après avoir mis /etc/opencode.env en place.
#
# Usage: sudo /opt/setup/install.sh

set -euo pipefail

# ── Pré-requis ────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "❌ Lance ce script en root (sudo)."
  exit 1
fi
if [[ ! -f /etc/opencode.env ]]; then
  echo "❌ /etc/opencode.env manquant. Copie env.example puis édite-le."
  exit 1
fi
if [[ ! -d /opt/leadagent ]]; then
  echo "❌ /opt/leadagent manquant. Clone le repo d'abord."
  exit 1
fi
if [[ ! -d /opt/setup ]]; then
  echo "❌ /opt/setup manquant. Clone le repo d'abord."
  exit 1
fi

source /etc/opencode.env

echo "▶ Installation des paquets système..."
apt update -qq
apt install -y ripgrep git ca-certificates curl unzip \
  chromium-browser \
  libnss3 libatk-bridge2.0-0 libxss1 libasound2t64 libgbm1 libxshmfence1 \
  fonts-liberation \
  >/dev/null

# ── Caddy (reverse-proxy + TLS auto) ─────────────────────────────────────────
if ! command -v caddy >/dev/null; then
  echo "▶ Installation de Caddy..."
  apt install -y debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt update -qq
  apt install -y caddy >/dev/null
fi

# ── User dédié `opencode` ─────────────────────────────────────────────────────
if ! id -u opencode >/dev/null 2>&1; then
  echo "▶ Création du user opencode..."
  adduser --disabled-password --gecos "" --home /home/opencode opencode
fi
chown -R opencode:opencode /opt/leadagent

# ── Bun (pour les tools custom + bridge Telegram) ────────────────────────────
if [[ ! -x /home/opencode/.bun/bin/bun ]]; then
  echo "▶ Installation de Bun pour le user opencode..."
  sudo -u opencode bash -c 'curl -fsSL https://bun.sh/install | bash'
fi
# Lien symbolique pour usage global
ln -sf /home/opencode/.bun/bin/bun /usr/local/bin/bun

# ── OpenCode binaire ──────────────────────────────────────────────────────────
if [[ ! -x /usr/local/bin/opencode ]]; then
  echo "▶ Installation d'OpenCode..."
  sudo -u opencode bash -c 'curl -fsSL https://opencode.ai/install | bash'
  # Le script installe dans ~/.opencode/bin/opencode — on linke globalement
  if [[ -x /home/opencode/.opencode/bin/opencode ]]; then
    ln -sf /home/opencode/.opencode/bin/opencode /usr/local/bin/opencode
  elif [[ -x /home/opencode/.local/bin/opencode ]]; then
    ln -sf /home/opencode/.local/bin/opencode /usr/local/bin/opencode
  fi
fi
echo "  → opencode $(opencode --version 2>/dev/null || echo 'not installed')"

# ── Dépendances Bun du workspace ──────────────────────────────────────────────
echo "▶ Installation des dépendances npm du workspace..."
cd /opt/leadagent
sudo -u opencode -H bash -c 'cd /opt/leadagent && /usr/local/bin/bun install'

# ── Playwright (Chromium géré par Playwright) ─────────────────────────────────
echo "▶ Installation des navigateurs Playwright..."
sudo -u opencode -H bash -c 'cd /opt/leadagent && /usr/local/bin/bun x playwright install chromium' || true

# ── XDG_DATA_HOME et XDG_CONFIG_HOME pour OpenCode ───────────────────────────
mkdir -p /opt/leadagent/data /opt/leadagent/config /opt/leadagent/cache
chown -R opencode:opencode /opt/leadagent

# ── Caddyfile ─────────────────────────────────────────────────────────────────
echo "▶ Configuration de Caddy..."
if [[ -n "${OPENCODE_PUBLIC_HOSTNAME:-}" ]]; then
  # Hostname fourni → vrai certif Let's Encrypt
  HASH="$(caddy hash-password --plaintext "${OPENCODE_SERVER_PASSWORD}")"
  cat > /etc/caddy/Caddyfile <<EOF
${OPENCODE_PUBLIC_HOSTNAME} {
  basicauth {
    aaron ${HASH}
  }
  reverse_proxy 127.0.0.1:4096
}
EOF
else
  echo "  ⚠ OPENCODE_PUBLIC_HOSTNAME non défini — Caddy en mode local uniquement."
  cat > /etc/caddy/Caddyfile <<EOF
:80 {
  respond "OpenCode running. Set OPENCODE_PUBLIC_HOSTNAME and re-run install.sh to enable HTTPS."
}
EOF
fi
systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

# ── Services systemd ──────────────────────────────────────────────────────────
echo "▶ Mise en place des services systemd..."
cp /opt/setup/opencode.service /etc/systemd/system/opencode.service
cp /opt/setup/opencode-telegram.service /etc/systemd/system/opencode-telegram.service
systemctl daemon-reload
systemctl enable --now opencode.service
sleep 3
systemctl enable --now opencode-telegram.service

# ── Vérifications ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Vérifications..."
sleep 2
if curl -fs http://127.0.0.1:4096/global/health >/dev/null; then
  echo "  ✓ OpenCode répond sur http://127.0.0.1:4096"
else
  echo "  ✗ OpenCode ne répond pas. Voir : journalctl -u opencode -n 50"
fi
if systemctl is-active --quiet opencode-telegram; then
  echo "  ✓ Telegram bridge actif"
else
  echo "  ✗ Telegram bridge inactif. Voir : journalctl -u opencode-telegram -n 50"
fi

echo ""
echo "✅ Installation terminée."
echo ""
echo "Prochaines étapes :"
echo "  1. Envoie un message à ton bot Telegram"
echo "  2. Si rien : journalctl -u opencode-telegram -f"
echo "  3. Pour les logs OpenCode : journalctl -u opencode -f"
if [[ -n "${OPENCODE_PUBLIC_HOSTNAME:-}" ]]; then
  echo "  4. UI Next.js : pointe OPENCODE_URL vers https://${OPENCODE_PUBLIC_HOSTNAME}"
fi
