#!/usr/bin/env bash
# One-shot setup on a fresh Debian/Ubuntu VPS.
#
# Written to be run once, fast, while you still have the borrowed laptop:
#
#   scp .treblo-secrets.json treblo/request.json root@YOUR_VPS:/tmp/
#   ssh root@YOUR_VPS 'bash -s' < deploy/setup.sh
#
# After this the box runs on its own and you only need an SSH app on your
# phone to check on it. Safe to re-run; it won't clobber your config.
set -euo pipefail

REPO="${TREBLO_REPO:-https://github.com/freelivingclub1-beep/clash.git}"
BRANCH="${TREBLO_BRANCH:-claude/treblo-song-generator-concept-aj98g6}"
APP_DIR=/opt/treblo
STATE_DIR=/var/lib/treblo
ENV_FILE=/etc/treblo.env

log() { printf '\n==> %s\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
    echo "Run as root (or with sudo)." >&2
    exit 1
fi

log "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv git >/dev/null

log "Creating the treblo user"
id -u treblo &>/dev/null || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin treblo
install -d -o treblo -g treblo -m 0750 "$STATE_DIR"

log "Fetching the code"
if [[ -d "$APP_DIR/.git" ]]; then
    git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
    git -C "$APP_DIR" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
else
    git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

log "Building the virtualenv"
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip
# Nothing to install: HttpDriver is stdlib only. Uncomment for Claude lyrics.
# "$APP_DIR/.venv/bin/pip" install --quiet anthropic

log "Installing the captured request and credentials"
moved=0
for f in request.json; do
    if [[ -f "/tmp/$f" ]]; then
        install -o treblo -g treblo -m 0640 "/tmp/$f" "$APP_DIR/treblo/$f"
        moved=1
    fi
done
if [[ -f /tmp/.treblo-secrets.json ]]; then
    install -o treblo -g treblo -m 0600 /tmp/.treblo-secrets.json "$APP_DIR/.treblo-secrets.json"
    shred -u /tmp/.treblo-secrets.json 2>/dev/null || rm -f /tmp/.treblo-secrets.json
    moved=1
fi
[[ $moved -eq 1 ]] || log "WARNING: no request.json / .treblo-secrets.json in /tmp -- scp them over"

log "Writing $ENV_FILE"
if [[ ! -f "$ENV_FILE" ]]; then
    cat > "$ENV_FILE" <<'ENVEOF'
# Polling endpoint, with {job_id} where the id goes.
TREBLO_STATUS_URL=https://treblo.com/api/CHANGE_ME/{job_id}
# yeat must stay first.
TREBLO_TAGS=yeat trap piano
TREBLO_BARS=16
ENVEOF
    chmod 0600 "$ENV_FILE"
    log "EDIT $ENV_FILE and set TREBLO_STATUS_URL before starting."
else
    log "Keeping your existing $ENV_FILE"
fi

log "Installing the service"
install -m 0644 "$APP_DIR/deploy/treblo.service" /etc/systemd/system/treblo.service
systemctl daemon-reload
systemctl enable treblo.service >/dev/null

cat <<'DONE'

Setup complete. Two things left:

  1. nano /etc/treblo.env      # set TREBLO_STATUS_URL
  2. systemctl start treblo

From your phone afterwards, over SSH:

  systemctl status treblo          # is it alive
  journalctl -u treblo -f          # watch it work
  /opt/treblo/.venv/bin/python -m treblo.cli --db /var/lib/treblo/treblo.db status
  /opt/treblo/.venv/bin/python -m treblo.cli --db /var/lib/treblo/treblo.db songs

When your Treblo session cookie expires the service will say so in the log.
Re-capture and replace /opt/treblo/.treblo-secrets.json, then restart.
DONE
