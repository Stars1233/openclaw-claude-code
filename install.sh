#!/usr/bin/env bash
# One-line installer for openclaw-claude-code
# Usage: curl -fsSL https://raw.githubusercontent.com/Enderfga/openclaw-claude-code/main/install.sh | bash
set -euo pipefail

PLUGIN_NAME="openclaw-claude-code"
NPM_PACKAGE="@enderfga/openclaw-claude-code"
EXT_DIR="${HOME}/.openclaw/extensions"
LINK_PATH="${EXT_DIR}/${PLUGIN_NAME}"
CONFIG_FILE="${HOME}/.openclaw/openclaw.json"

info()  { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m!\033[0m %s\n' "$*"; }
fail()  { printf '\033[1;31m✘\033[0m %s\n' "$*" >&2; exit 1; }

# ── Prerequisites ────────────────────────────────────────
command -v npm  >/dev/null 2>&1 || fail "npm not found. Install Node.js first: https://nodejs.org"
command -v openclaw >/dev/null 2>&1 || fail "openclaw not found. Install OpenClaw first: https://docs.openclaw.ai"

# ── Step 1: npm install ─────────────────────────────────
info "Installing ${NPM_PACKAGE} via npm..."
npm install -g "${NPM_PACKAGE}" --silent 2>&1 | tail -1

PKG_PATH="$(npm root -g)/${NPM_PACKAGE}"
[ -d "${PKG_PATH}" ] || fail "npm install succeeded but package not found at ${PKG_PATH}"
ok "Installed $(node -e "console.log(require('${PKG_PATH}/package.json').version)")"

# ── Step 2: Symlink into OpenClaw extensions ─────────────
mkdir -p "${EXT_DIR}"

if [ -L "${LINK_PATH}" ]; then
    EXISTING="$(readlink "${LINK_PATH}")"
    if [ "${EXISTING}" = "${PKG_PATH}" ]; then
        ok "Symlink already correct"
    else
        info "Updating symlink (was → ${EXISTING})"
        rm "${LINK_PATH}"
        ln -s "${PKG_PATH}" "${LINK_PATH}"
        ok "Symlink updated → ${PKG_PATH}"
    fi
elif [ -e "${LINK_PATH}" ]; then
    warn "${LINK_PATH} exists but is not a symlink — skipping (remove it manually if needed)"
else
    ln -s "${PKG_PATH}" "${LINK_PATH}"
    ok "Symlink created → ${PKG_PATH}"
fi

# ── Step 3: Add plugin entry to openclaw.json ────────────
if [ -f "${CONFIG_FILE}" ]; then
    if python3 -c "
import json, sys
with open('${CONFIG_FILE}') as f:
    cfg = json.load(f)
entries = cfg.get('plugins', {}).get('entries', {})
if '${PLUGIN_NAME}' in entries:
    sys.exit(0)  # already configured
sys.exit(1)
" 2>/dev/null; then
        ok "Plugin already configured in openclaw.json"
    else
        info "Adding plugin entry to openclaw.json..."
        python3 -c "
import json
with open('${CONFIG_FILE}') as f:
    cfg = json.load(f)
cfg.setdefault('plugins', {}).setdefault('entries', {})['${PLUGIN_NAME}'] = {}
with open('${CONFIG_FILE}', 'w') as f:
    json.dump(cfg, f, indent=2)
    f.write('\n')
" 2>/dev/null && ok "Plugin entry added to openclaw.json" \
              || warn "Could not auto-configure — add \"${PLUGIN_NAME}\": {} to plugins.entries in openclaw.json"
    fi
else
    warn "openclaw.json not found at ${CONFIG_FILE} — configure the plugin manually after setup"
fi

# ── Step 4: Verify ───────────────────────────────────────
echo ""
info "Verifying installation..."
if openclaw plugins list 2>/dev/null | grep -q "${PLUGIN_NAME}"; then
    ok "openclaw-claude-code is loaded!"
else
    warn "Plugin installed but not yet loaded — restart OpenClaw gateway: openclaw gateway restart"
fi

echo ""
ok "Done! Restart the gateway to activate: openclaw gateway restart"
echo "  Docs: https://github.com/Enderfga/openclaw-claude-code"
