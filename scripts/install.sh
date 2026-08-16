#!/usr/bin/env bash
# x402scan installer — macOS and Linux.
#   curl -fsSL https://raw.githubusercontent.com/YOUR_USER/x402scan/main/scripts/install.sh | bash
set -euo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$OFF" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$OFF" "$*"; }
die()  { printf '%s✗%s %s\n' "$RED" "$OFF" "$*" >&2; exit 1; }

say ""
say "${BOLD}x402scan installer${OFF}"
say "${DIM}measure the machine-payment economy from chain data${OFF}"
say ""

# --- Node ---
if ! command -v node >/dev/null 2>&1; then
  die "Node.js not found. Install Node 18+ first:
    macOS:   brew install node
    Ubuntu:  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
    Any OS:  https://nodejs.org"
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node $(node -v) found, but 18+ is required (built-in fetch). Upgrade: https://nodejs.org"
fi
ok "Node $(node -v)"

command -v npm >/dev/null 2>&1 || die "npm not found. It normally ships with Node."

# --- Install ---
say "${DIM}installing…${OFF}"
if npm install -g x402scan >/dev/null 2>&1; then
  ok "installed globally"
else
  warn "global install failed — likely a permissions issue"
  say ""
  say "  Fix without sudo (recommended):"
  say "    ${DIM}mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global${OFF}"
  say "    ${DIM}echo 'export PATH=~/.npm-global/bin:\$PATH' >> ~/.profile && . ~/.profile${OFF}"
  say "    ${DIM}npm install -g x402scan${OFF}"
  say ""
  say "  Or skip installing entirely:"
  say "    ${DIM}npx x402scan scan base${OFF}"
  exit 1
fi

# --- Verify ---
if ! command -v x402scan >/dev/null 2>&1; then
  warn "installed, but 'x402scan' is not on your PATH"
  say "  Add npm's global bin directory:"
  say "    ${DIM}export PATH=\"\$(npm prefix -g)/bin:\$PATH\"${OFF}"
  exit 1
fi
ok "$(x402scan --version 2>/dev/null || echo 'x402scan ready')"

say ""
say "${BOLD}Try it${OFF}"
say "  ${DIM}x402scan scan base${OFF}          measure Base"
say "  ${DIM}x402scan scan${OFF}               compare all chains"
say ""
say "${BOLD}Connect to Claude Code${OFF}"
say "  ${DIM}claude mcp add --scope user x402scan -- npx -y x402scan mcp${OFF}"
say ""
