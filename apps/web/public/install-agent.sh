#!/bin/sh
# voz.gg status-monitor agent installer.
# Usage: curl -fsSL <site>/install-agent.sh | sh -s -- <enrollmentToken>
set -eu

REPO_OWNER="Voziv"
RELEASE_TAG="status-monitor-latest"
INSTALL_PATH="/usr/local/bin/voz-status-monitor"
CONFIG_DIR="/etc/voz-status-monitor"
CONFIG_PATH="${CONFIG_DIR}/config.json"
SERVICE_PATH="/etc/systemd/system/voz-status-monitor.service"

ENROLLMENT_TOKEN="${1:-}"
if [ -z "${ENROLLMENT_TOKEN}" ]; then
  echo "error: enrollment token required" >&2
  echo "usage: curl -fsSL <site>/install-agent.sh | sh -s -- <enrollmentToken>" >&2
  exit 1
fi

# Same origin as the script. Allow override for local testing.
WORKER_BASE_URL="${VOZ_WORKER_BASE_URL:-https://voz.gg}"

case "$(uname -s)" in
  Linux) OS="linux" ;;
  Darwin) OS="darwin" ;;
  *) echo "error: unsupported OS $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) ARCH="amd64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *) echo "error: unsupported arch $(uname -m)" >&2; exit 1 ;;
esac

BINARY_URL="https://github.com/${REPO_OWNER}/voz.gg/releases/download/${RELEASE_TAG}/status-monitor-${OS}-${ARCH}"

echo "Downloading ${BINARY_URL}"
curl -fsSL "${BINARY_URL}" -o "${INSTALL_PATH}"
chmod +x "${INSTALL_PATH}"

echo "Enrolling agent"
ENROLL_RESPONSE="$(curl -fsSL -X POST "${WORKER_BASE_URL}/api/agents/enroll" \
  -H 'Content-Type: application/json' \
  -d "{\"enrollmentToken\":\"${ENROLLMENT_TOKEN}\"}")"

# The agent re-reads/refreshes config itself; the installer writes the bootstrap file.
mkdir -p "${CONFIG_DIR}"
printf '%s' "${ENROLL_RESPONSE}" | "${INSTALL_PATH}" -write-config \
  -config "${CONFIG_PATH}" \
  -worker-base-url "${WORKER_BASE_URL}"

cat > "${SERVICE_PATH}" <<UNIT
[Unit]
Description=voz.gg status-monitor agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${INSTALL_PATH} -config ${CONFIG_PATH}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl enable --now voz-status-monitor.service
  echo "voz-status-monitor started"
else
  echo "systemctl not found; binary installed at ${INSTALL_PATH}, run it with -config ${CONFIG_PATH}" >&2
fi
