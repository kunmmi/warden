#!/usr/bin/env bash
# warden installer for macOS/Linux — installs Node (if needed) + warden.
#
#   curl -fsSL https://raw.githubusercontent.com/kunmmi/warden/main/install.sh | bash
#
# Safe to re-run. Installs Node only via a package manager you already have
# (Homebrew / fnm); otherwise it points you to nodejs.org rather than guessing.
set -euo pipefail

grn() { printf "  \033[32m%s\033[0m\n" "$1"; }
ylw() { printf "  \033[33m%s\033[0m\n" "$1"; }
red() { printf "  \033[31m%s\033[0m\n" "$1"; }
dim() { printf "  \033[2m%s\033[0m\n" "$1"; }

echo
grn "warden -- setting the wall"
dim "setting up your rig..."
echo

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v maj rest min
  v=$(node -v | sed 's/^v//')
  maj=${v%%.*}; rest=${v#*.}; min=${rest%%.*}
  [ "$maj" -gt 22 ] || { [ "$maj" -eq 22 ] && [ "$min" -ge 12 ]; }
}

RERUN="curl -fsSL https://raw.githubusercontent.com/kunmmi/warden/main/install.sh | bash"

if node_ok; then
  grn "[ok] node $(node -v) already installed"
else
  ylw "[..] Node 22.12+ not found -- installing..."
  if command -v brew >/dev/null 2>&1; then
    brew install node
  elif command -v fnm >/dev/null 2>&1; then
    fnm install 22 && fnm use 22
  else
    red "No Homebrew or fnm found to install Node automatically."
    dim "Install Node 22.12+ from https://nodejs.org/en/download (or via nvm), then re-run:"
    dim "  $RERUN"
    exit 1
  fi
  if ! node_ok; then
    red "Node installed but this shell still sees an old/none version."
    dim "Open a new terminal (or 'fnm use 22'), then re-run:  $RERUN"
    exit 1
  fi
  grn "[ok] node $(node -v) installed"
fi

ylw "[..] installing warden (global)..."
# Installed from the repo, NOT from the npm name "warden" — that name belongs to
# an unrelated package (a Panopticon wrapper), so `npm i -g warden` silently
# installs a stranger's code instead of this project. Nothing is published to
# npm under a warden-owned name yet; until it is, the repo IS the source.
npm install -g "github:kunmmi/warden"

echo
grn "warden is ready. next:"
dim "  warden setup     # confirm the rig"
dim "  warden onboard   # keys, strategy, basket"
dim "  warden start     # dashboard at localhost:3100 + the worker"
echo

# nudge about PATH if npm's global bin isn't on it (the "command not found" trap)
prefix=$(npm prefix -g 2>/dev/null || true)
if [ -n "$prefix" ] && ! printf ':%s:' "$PATH" | grep -q ":$prefix/bin:"; then
  ylw "Add npm's global bin to PATH (then reopen your shell):"
  dim "  echo 'export PATH=\"$prefix/bin:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
  echo
fi
