#!/bin/sh
# voz.gg agent installer. Downloads the agent and hands off to `voz-gg-agent setup`.
# Usage: curl -fsSL <site>/install-agent.sh | sudo sh -s -- <enrollmentToken>
set -eu

REPO_OWNER="Voziv"
RELEASE_TAG="voz-gg-agent-latest"
INSTALL_PATH="/usr/local/bin/voz-gg-agent"

ENROLLMENT_TOKEN="${1:-}"
if [ -z "${ENROLLMENT_TOKEN}" ]; then
  echo "error: enrollment token required" >&2
  echo "usage: curl -fsSL <site>/install-agent.sh | sudo sh -s -- <enrollmentToken>" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "error: must run as root — the agent installs a system user and a systemd service." >&2
  echo "re-run via sudo: curl -fsSL <site>/install-agent.sh | sudo sh -s -- <enrollmentToken>" >&2
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

BINARY_URL="https://github.com/${REPO_OWNER}/voz.gg/releases/download/${RELEASE_TAG}/voz-gg-agent-${OS}-${ARCH}"

echo "Downloading ${BINARY_URL}"
curl -fsSL "${BINARY_URL}" -o "${INSTALL_PATH}"
chmod +x "${INSTALL_PATH}"

echo "Provisioning agent"
exec "${INSTALL_PATH}" setup \
  --enrollment-token "${ENROLLMENT_TOKEN}" \
  --worker-base-url "${WORKER_BASE_URL}"
