#!/usr/bin/env bash
# Run once on a fresh Ubuntu Lightsail instance (22.04 / 24.04).
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Re-run with sudo: sudo bash deploy/lightsail-setup.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git

install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin

systemctl enable --now docker

if id ubuntu &>/dev/null; then
  usermod -aG docker ubuntu || true
fi

echo
echo "Docker is ready. Next:"
echo "  1. Put the app in /opt/zpm (git clone or scp)"
echo "  2. Create server/.env with OPENAI_API_KEY=..."
echo "  3. sudo bash deploy/lightsail-up.sh"
