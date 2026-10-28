#!/usr/bin/env bash
# Sets up Chrome for Testing 146.0.7680.72 — the station browser (NFR-COMP-01) —
# so `npm test` and `npm run e2e` run on it instead of the Chromium that comes
# with the pinned @playwright/test. Linux x64 only (that is what Chrome for
# Testing ships as a headless shell zip we can use the same way everywhere).
#
# It downloads the headless shell once into <dir>, builds a folder of links in
# the layout Playwright 1.56.1 looks for (chromium_headless_shell-1194), and
# prints the two exports to use:
#
#   eval "$(scripts/chrome-146.sh ~/.cache/debug-capture-chrome-146)"
#   npm run check
#
# Needs curl and unzip.
set -euo pipefail

VERSION=146.0.7680.72
DIR=${1:?usage: scripts/chrome-146.sh <dir>}
mkdir -p "$DIR"
DIR=$(cd "$DIR" && pwd)

SHELL_DIR="$DIR/chrome-headless-shell-linux64"
if [ ! -x "$SHELL_DIR/chrome-headless-shell" ]; then
  # The zip goes into its own folder: downloaded files stay apart from scripts.
  curl -fsSL -o "$DIR/shell.zip" \
    "https://storage.googleapis.com/chrome-for-testing-public/$VERSION/linux64/chrome-headless-shell-linux64.zip"
  unzip -q -o "$DIR/shell.zip" -d "$DIR"
  rm "$DIR/shell.zip"
fi
ln -sfn chrome-headless-shell "$SHELL_DIR/headless_shell"

# Playwright 1.56.1 expects build 1194 at this path; the link points it at 146.
LINKS="$DIR/pw"
mkdir -p "$LINKS/chromium_headless_shell-1194"
ln -sfn "$SHELL_DIR" "$LINKS/chromium_headless_shell-1194/chrome-linux"
touch "$LINKS/chromium_headless_shell-1194/INSTALLATION_COMPLETE"

echo "export PLAYWRIGHT_BROWSERS_PATH='$LINKS'"
echo "export CHROME_BIN='$SHELL_DIR/chrome-headless-shell'"
