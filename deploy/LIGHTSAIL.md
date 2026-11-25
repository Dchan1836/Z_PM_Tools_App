# Host Z PM on AWS Lightsail (Docker Compose)

This is the fastest path: one Lightsail VM running the same `app` + `postgres` stack you use locally. OpenAI stays outside the instance.

## 1. Create the instance

1. AWS Console → **Lightsail** → **Create instance**.
2. Platform: **Linux/Unix**.
3. Blueprint: **OS Only** → **Ubuntu 24.04** (or 22.04).
4. Size: at least **2 GB RAM** (node + Postgres + NetworkX). 4 GB is more comfortable.
5. Name it (for example `zpm`) and create it.
6. Optional but recommended: **Networking** → create a **static IP** and attach it to the instance.

## 2. Open the firewall

In the instance **Networking** tab, under IPv4 firewall, allow:

| Application | Port |
|-------------|------|
| SSH         | 22   |
| HTTP        | 80   |

Do **not** open 5432/5433. Postgres stays on the Docker network only.

## 3. Copy the app onto the instance

SSH in (Lightsail browser SSH or your key):

```bash
sudo mkdir -p /opt/zpm
sudo chown ubuntu:ubuntu /opt/zpm
```

**Option A — git**

```bash
cd /opt
git clone YOUR_REPO_URL zpm
cd /opt/zpm
```

**Option B — from your PC (PowerShell)**

```powershell
scp -i your-lightsail.pem -r .\* ubuntu@YOUR_STATIC_IP:/opt/zpm/
```

Skip `node_modules`, `.venv`, and local `server/.env` if you prefer to create `.env` only on the server.

## 4. Install Docker (once)

```bash
cd /opt/zpm
sudo bash deploy/lightsail-setup.sh
# log out and back in so the docker group applies, or use sudo for compose
```

## 5. Configure secrets

```bash
cd /opt/zpm
cp server/.env.example server/.env
nano server/.env
```

Set at least:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-6-luna
POSTGRES_PASSWORD=pick-a-long-random-password
```

`DATABASE_URL` on Lightsail is set by Compose to the internal `postgres` service; you do not need localhost:5433 there.

## 6. Start the stack

```bash
cd /opt/zpm
sudo bash deploy/lightsail-up.sh
```

That runs:

```bash
docker compose -f docker-compose.yml -f docker-compose.lightsail.yml up -d --build
```

The UI and API are on **port 80** → http://YOUR_STATIC_IP/

## 7. Smoke check

- Browser: open the static IP, sign in (`demo` passwords for sample users).
- Logs: `sudo docker compose -f docker-compose.yml -f docker-compose.lightsail.yml logs -f app`
- Restart after reboot: containers use `restart: unless-stopped`, so they come back with the VM.

## Updates later

```bash
cd /opt/zpm
git pull   # or scp new files
sudo bash deploy/lightsail-up.sh
```

## Optional next steps (not required)

- Point a domain’s A record at the static IP.
- Put **Caddy** or Lightsail load balancer + HTTPS in front of port 80.
- Snapshot the instance or schedule volume backups of `zpm-pg`.
- Change default sample passwords after the first login if this instance is public.

## Local vs Lightsail Compose files

| Command | What happens |
|---------|----------------|
| `docker compose up --build -d` | Local: app on **4000**, Postgres also on host **5433** (`docker-compose.override.yml`) |
| `deploy/lightsail-up.sh` | Lightsail: app on **80**, Postgres **not** published to the internet |
