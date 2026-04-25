#!/usr/bin/env sh
# Install @agent-score/pay — agent-friendly CLI wallet for x402 + MPP payments.
#
# Usage:
#   curl -fsSL https://agentscore.sh/install-pay.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/agentscore/pay/main/install.sh | sh
#
# Strategy:
#   1. If npm is available, `npm install -g @agent-score/pay` — works everywhere.
#   2. Otherwise, download the prebuilt native binary from the latest GitHub Release
#      to ~/.local/bin/agentscore-pay (no Node runtime required).

set -eu

REPO="agentscore/pay"
BIN_NAME="agentscore-pay"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  ESC="$(printf '\033')"
  CYAN="${ESC}[36m"
  YELLOW="${ESC}[33m"
  GREEN="${ESC}[32m"
  RED="${ESC}[31m"
  RESET="${ESC}[0m"
else
  CYAN=""
  YELLOW=""
  GREEN=""
  RED=""
  RESET=""
fi

note() { printf '%s\n' "${CYAN}→${RESET} $1"; }
warn() { printf '%s\n' "${YELLOW}!${RESET} $1" >&2; }
ok()   { printf '%s\n' "${GREEN}✓${RESET} $1"; }
die()  { printf '%s\n' "${RED}✗${RESET} $1" >&2; exit 1; }

detect_target() {
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  arch=$(uname -m)
  case "$os" in
    darwin)
      case "$arch" in
        arm64|aarch64) echo "darwin-arm64" ;;
        x86_64) echo "darwin-x64" ;;
        *) die "Unsupported macOS architecture: $arch" ;;
      esac
      ;;
    linux)
      case "$arch" in
        arm64|aarch64) echo "linux-arm64" ;;
        x86_64) echo "linux-x64" ;;
        *) die "Unsupported Linux architecture: $arch" ;;
      esac
      ;;
    *) die "Unsupported OS: $os (try the npm path: npm i -g @agent-score/pay)" ;;
  esac
}

install_via_npm() {
  note "Installing via npm (global)..."
  npm install -g @agent-score/pay
  ok "Installed. Try: $BIN_NAME --version"
}

install_native_binary() {
  target=$(detect_target)
  asset="$BIN_NAME-$target"
  url="https://github.com/$REPO/releases/latest/download/$asset"

  note "Downloading native binary for $target from $url"
  mkdir -p "$INSTALL_DIR"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$INSTALL_DIR/$BIN_NAME"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$INSTALL_DIR/$BIN_NAME"
  else
    die "Need curl or wget to download the binary."
  fi
  chmod +x "$INSTALL_DIR/$BIN_NAME"
  ok "Installed to $INSTALL_DIR/$BIN_NAME"

  case ":$PATH:" in
    *":$INSTALL_DIR:"*) : ;;
    *) warn "$INSTALL_DIR is not on your PATH. Add: export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
  esac
  ok "Try: $BIN_NAME --version"
}

main() {
  if command -v npm >/dev/null 2>&1; then
    install_via_npm
  else
    note "npm not found; falling back to native binary download."
    install_native_binary
  fi
}

main "$@"
