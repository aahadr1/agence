#!/usr/bin/env bash
# Pousse le workspace OpenCode sur le VPS (rsync). À lancer depuis la racine du repo.
#
# Usage:
#   export VPS_HOST=root@46.225.149.251
#   ./scripts/deploy-opencode-vps.sh
#
# Prérequis: clé SSH qui se connecte sans mot de passe au VPS.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${VPS_HOST:-root@46.225.149.251}"

echo "→ Sync vps/leadagent → ${HOST}:/opt/leadagent/"
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude 'data' \
  --exclude 'config' \
  "${ROOT}/vps/leadagent/" "${HOST}:/opt/leadagent/"

echo "→ Sync vps/setup → ${HOST}:/opt/setup/"
rsync -avz --delete \
  "${ROOT}/vps/setup/" "${HOST}:/opt/setup/"

echo ""
echo "OK. Sur le VPS, crée /etc/opencode.env (voir vps/setup/env.example) puis :"
echo "  chmod +x /opt/setup/install.sh && /opt/setup/install.sh"
echo "Pour mettre à jour après un git pull local, relance ce script puis :"
echo "  ssh ${HOST} 'systemctl restart opencode opencode-telegram'"
