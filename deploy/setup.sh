#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════
# Jordan Clinic Dashboard — Server Bootstrap Script
# ═══════════════════════════════════════════════════
# Run this ONCE on a fresh Ubuntu 22.04 / 24.04 server.
# Requires: root or sudo access, domain DNS pointed at this server.
# ═══════════════════════════════════════════════════

# ─── Config ───────────────────────────────────────
DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: $0 <your-domain.com>"
  exit 1
fi

log() { echo -e "\033[1;32m==>\033[0m $*"; }
err() { echo -e "\033[1;31mERROR:\033[0m $*" >&2; }

# ─── Prerequisites ────────────────────────────────
log "Updating system packages…"
sudo apt-get update -qq && sudo apt-get upgrade -y -qq

log "Installing Docker…"
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sudo bash
  sudo usermod -aG docker "$USER"
else
  log "Docker already installed, skipping."
fi

log "Installing Docker Compose plugin…"
if ! docker compose version &>/dev/null; then
  sudo apt-get install -y -qq docker-compose-plugin
fi

log "Installing other tools (curl, git, ufw, certbot)…"
sudo apt-get install -y -qq curl git ufw certbot python3-certbot-nginx

# ─── Firewall ────────────────────────────────────
log "Configuring UFW firewall…"
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# Jordan dashboard (temporary — direct ports for testing)
sudo ufw allow 3000/tcp
sudo ufw allow 4000/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 8443/tcp
sudo ufw --force enable

# ─── Project directory ───────────────────────────
PROJECT_DIR="/opt/jordan-dashboard"
sudo mkdir -p "$PROJECT_DIR/deploy"
sudo chown -R "$USER:$USER" "$PROJECT_DIR"

# ─── SSL certificate ─────────────────────────────
log "Obtaining SSL certificate for $DOMAIN …"
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN" || {
  log "Certbot can also be run manually later."
}
log "Certificate will be used directly from /etc/letsencrypt/live/$DOMAIN/"

# ─── Nginx config ────────────────────────────────
log "Updating nginx.conf with domain $DOMAIN …"
sed -i "s/server_name _;/server_name $DOMAIN;/g" "$PROJECT_DIR/deploy/nginx.conf"
sed -i "s/__DOMAIN__/$DOMAIN/g" "$PROJECT_DIR/deploy/nginx.conf"

# ─── Cert renewal hook ───────────────────────────
log "Setting up Let's Encrypt auto-renewal with nginx reload…"
# certbot renew --deploy-hook ensures nginx reloads ONLY after successful renewal
sudo crontab -l 2>/dev/null | grep -q certbot || {
  sudo crontab -l 2>/dev/null
  echo "0 3 * * * /usr/bin/certbot renew --quiet --deploy-hook 'docker exec jordan-nginx nginx -s reload'"
} | sudo crontab -

# ─── Next steps ──────────────────────────────────
cat <<EOF

╔══════════════════════════════════════════════════════════════╗
║  Bootstrap complete!                                        ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  1. Copy your .env to:  $PROJECT_DIR/.env                    ║
║                                                              ║
║  2. Deploy via GitHub Actions or manually:                   ║
║                                                              ║
║     cd $PROJECT_DIR                                          ║
║     docker compose pull                                      ║
║     docker compose up -d                                     ║
║                                                              ║
║  3. SSH key for GitHub Actions:                              ║
║     ssh-keygen -t ed25519 -f ~/.ssh/deploy_key               ║
║     Add public key to ~/.ssh/authorized_keys                 ║
║                                                              ║
║  4. GitHub secrets needed:                                   ║
║     SERVER_HOST  SERVER_USER  SERVER_SSH_KEY                 ║
║     JWT_SECRET   ENCRYPTION_KEY  DATABASE_PASSWORD           ║
║     JORDAN_API_*  LEAD_WEBHOOK_SECRET                        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
EOF
