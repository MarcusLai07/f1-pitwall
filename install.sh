#!/usr/bin/env bash
# Pit Wall installer for macOS. Pit Wall runs in Chrome and other Chromium browsers
# (Edge, Brave, Arc, Opera, Vivaldi, Dia, ...). One command installs, the same command updates:
#
#   curl -fsSL https://raw.githubusercontent.com/MarcusLai07/f1-pitwall/main/install.sh | bash
#
# It downloads the latest release (the built extension) into ~/PitWall. Updates go into
# the same folder, so the browser keeps Pit Wall's layouts and settings.
#
# Options (after `bash -s --` when piped):
#   --dir PATH     where to put Pit Wall (default ~/PitWall, or PITWALL_DIR)
#   --uninstall    delete that folder (then remove Pit Wall from the extensions page)
set -euo pipefail

REPO="MarcusLai07/f1-pitwall"
ZIP_URL="https://github.com/$REPO/releases/latest/download/pit-wall.zip"
DEST="${PITWALL_DIR:-$HOME/PitWall}"
UNINSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall) UNINSTALL=1 ;;
    --dir) [[ -n "${2:-}" ]] || { echo "--dir needs a path" >&2; exit 2; }; DEST="$2"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

bold=$'\033[1m'; dim=$'\033[2m'; accent=$'\033[38;5;160m'; ok=$'\033[32m'; reset=$'\033[0m'
say() { printf '%s\n' "$*"; }
step() { printf '\n%s›%s %s\n' "$accent" "$reset" "$*"; }
done_() { printf '  %s✓%s %s\n' "$ok" "$reset" "$*"; }

# A folder this script may replace: empty, missing, or an earlier Pit Wall install
is_pitwall() { [[ -f "$1/manifest.json" ]] && grep -q '"name": "Pit Wall"' "$1/manifest.json"; }

say ""
say "${bold}${accent}▌Pit Wall${reset}${bold}: F1 timing, map and telemetry in one window${reset}"

if [[ $UNINSTALL == 1 ]]; then
  if is_pitwall "$DEST"; then rm -rf "$DEST"; done_ "Deleted $DEST"
  else say "  Nothing to remove at $DEST."; fi
  say ""
  say "  Last step: remove Pit Wall from your browser's extensions page."
  exit 0
fi

if [[ -e "$DEST" ]] && ! is_pitwall "$DEST" && [[ -n "$(ls -A "$DEST" 2>/dev/null)" ]]; then
  say "  $DEST already exists and isn't a Pit Wall folder, so it was left alone. Pick another with --dir PATH." >&2
  exit 1
fi

step "Downloading the latest Pit Wall"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$ZIP_URL" -o "$TMP/pit-wall.zip" || { say "  Couldn't download $ZIP_URL" >&2; exit 1; }
unzip -q "$TMP/pit-wall.zip" -d "$TMP/ext"
is_pitwall "$TMP/ext" || { say "  The download isn't a Pit Wall build." >&2; exit 1; }
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$TMP/ext/manifest.json" | head -1)"
PREVIOUS=""
is_pitwall "$DEST" && PREVIOUS="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$DEST/manifest.json" | head -1)"
mkdir -p "$DEST"
# Same folder every time: the browser ties the extension (and its saved layouts) to it
rsync -a --delete "$TMP/ext/" "$DEST/"
if [[ -n "$PREVIOUS" && "$PREVIOUS" != "$VERSION" ]]; then done_ "Updated $PREVIOUS → $VERSION in $DEST"
else done_ "Pit Wall $VERSION in $DEST"; fi

# ---------- open a Chromium browser's extensions page ----------
# Your default browser if it's Chromium-based, otherwise the first one installed.
# PITWALL_BROWSER="App Name" picks one; "none" skips this (and the clipboard).
CHROMIUM_IDS="com.google.chrome com.google.chrome.beta com.google.chrome.canary com.microsoft.edgemac com.brave.browser company.thebrowser.browser company.thebrowser.dia com.vivaldi.vivaldi com.operasoftware.opera com.operasoftware.operagx org.chromium.chromium"
CHROMIUM_APPS=("Google Chrome" "Microsoft Edge" "Brave Browser" "Arc" "Dia" "Vivaldi" "Opera" "Opera GX" "Chromium")
BROWSER="${PITWALL_BROWSER:-}"
BROWSER_ID=""
[[ "$BROWSER" == none ]] || printf '%s' "$DEST" | pbcopy 2>/dev/null || true
if [[ -n "$BROWSER" && "$BROWSER" != none ]]; then
  BROWSER_ID="$(osascript -e "id of app \"$BROWSER\"" 2>/dev/null || true)"
elif [[ -z "$BROWSER" ]]; then
  DEFAULT_ID="$(defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers 2>/dev/null \
    | awk '/LSHandlerRoleAll/{id=$3} /LSHandlerURLScheme = https;/{print id; exit}' | tr -d '";' | tr '[:upper:]' '[:lower:]')"
  if [[ -n "$DEFAULT_ID" && " $CHROMIUM_IDS " == *" $DEFAULT_ID "* ]]; then
    BROWSER_ID="$DEFAULT_ID"
  else
    for b in "${CHROMIUM_APPS[@]}"; do
      if [[ -d "/Applications/$b.app" ]]; then BROWSER_ID="$(osascript -e "id of app \"$b\"" 2>/dev/null || true)"; break; fi
    done
  fi
fi
if [[ -n "$BROWSER_ID" ]]; then
  BROWSER="$(mdfind "kMDItemCFBundleIdentifier == '$BROWSER_ID'c" 2>/dev/null | head -1 | xargs -I{} basename {} .app)"
  case "$(printf '%s' "$BROWSER_ID" | tr '[:upper:]' '[:lower:]')" in
    com.microsoft.edgemac) EXT_URL="edge://extensions" ;;
    com.operasoftware.*) EXT_URL="opera://extensions" ;;
    com.vivaldi.vivaldi) EXT_URL="vivaldi://extensions" ;;
    *) EXT_URL="chrome://extensions" ;;
  esac
  open -b "$BROWSER_ID" "$EXT_URL" 2>/dev/null || true
elif [[ "$BROWSER" != none ]]; then
  BROWSER=""
  say ""
  say "  ${dim}No Chromium browser found. Pit Wall runs in Chrome, Edge, Brave, Arc, Opera, Vivaldi or Dia.${reset}"
fi

say ""
if [[ -n "$PREVIOUS" ]]; then
  say "${bold}${ok}✓ Done.${reset}${bold} Click ↻ on Pit Wall in the extensions page to load the new version.${reset}"
else
  say "${bold}${ok}✓ Downloaded.${reset}${bold} One last step in $([[ -z "$BROWSER" || "$BROWSER" == none ]] && echo "your browser" || echo "$BROWSER")${reset} (the extensions page should be open):"
  say ""
  say "  ${bold}1${reset}  Turn on ${bold}Developer mode${reset} (top right)"
  say "  ${bold}2${reset}  Click ${bold}Load unpacked${reset}, press ${bold}⌘⇧G${reset}, paste ${bold}⌘V${reset}, press Return, then ${bold}Select${reset}"
  say "     ${dim}(the folder path is on your clipboard: $DEST)${reset}"
  say "  ${bold}3${reset}  Pin Pit Wall from the puzzle menu and click it"
  say ""
  say "  Then open ${bold}Sessions${reset} → ${bold}Sign in to F1 TV${reset} with your F1 account for replays, cars on the map, telemetry and team radio."
fi
say "  ${dim}Update anytime by running the same command again.${reset}"
say ""
