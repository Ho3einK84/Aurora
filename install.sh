#!/usr/bin/env bash
# ==============================================================================
# 🌌 Aurora Template Installer for Rebecca Panel
# https://github.com/Ho3einK84/Aurora
# ==============================================================================
set -euo pipefail

readonly SCRIPT_VERSION="1.0.1"
readonly DEFAULT_TARGET_DIR="/var/lib/rebecca/templates/subscription"
readonly DEFAULT_TARGET_FILE="${DEFAULT_TARGET_DIR}/index.html"
readonly DEFAULT_BACKUP_FILE="${DEFAULT_TARGET_FILE}.aurora.bak"
readonly RELEASE_URL="https://github.com/Ho3einK84/Aurora/releases/latest/download/index.html"
readonly RAW_SCRIPT_URL="https://raw.githubusercontent.com/Ho3einK84/Aurora/main/install.sh"

# If invoked via curl | bash, re-exec from a real temp file so /dev/tty reads work
if [[ ! -t 0 ]] && [[ -z "${AURORA_INSTALL_REEXEC:-}" ]]; then
  tmpfile="$(mktemp /tmp/aurora-install-XXXXXX.sh)"
  cleanup() { rm -f "$tmpfile"; }
  trap cleanup EXIT
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$RAW_SCRIPT_URL" -o "$tmpfile"
  else
    wget -qO "$tmpfile" "$RAW_SCRIPT_URL"
  fi
  chmod 700 "$tmpfile"
  export AURORA_INSTALL_REEXEC=1
  exec bash "$tmpfile" "$@"
fi

# Terminal colors
if [[ -t 1 ]]; then
  readonly C_RESET='\033[0m'
  readonly C_BOLD='\033[1m'
  readonly C_DIM='\033[2m'
  readonly C_RED='\033[31m'
  readonly C_GREEN='\033[32m'
  readonly C_YELLOW='\033[33m'
  readonly C_BLUE='\033[34m'
  readonly C_MAGENTA='\033[35m'
  readonly C_CYAN='\033[36m'
  readonly C_WHITE='\033[97m'
else
  readonly C_RESET='' C_BOLD='' C_DIM='' C_RED='' C_GREEN='' C_YELLOW='' C_BLUE='' C_MAGENTA='' C_CYAN='' C_WHITE=''
fi

log_line() { printf '%b\n' "$1"; }
log_blank() { printf '\n'; }
ok()   { log_line "${C_GREEN}[✓]${C_RESET} $*"; }
info() { log_line "${C_CYAN}[i]${C_RESET} $*"; }
warn() { log_line "${C_YELLOW}[!]${C_RESET} $*"; }
err()  { log_line "${C_RED}[✗]${C_RESET} $*"; exit 1; }

hr() {
  log_line "${C_CYAN}${C_BOLD}────────────────────────────────────────────────────────────────${C_RESET}"
}

print_banner() {
  log_blank
  hr
  log_line "${C_MAGENTA}${C_BOLD}   🌌 Aurora — Subscription Template for Rebecca Panel${C_RESET}"
  log_line "${C_DIM}   Version ${SCRIPT_VERSION} · Fast, Self-Contained & Customizable${C_RESET}"
  hr
  log_blank
}

read_input() {
  local prompt=$1
  local __var=$2
  local default_val=${3:-}
  local input=""
  if [[ -n "$default_val" ]]; then
    prompt="${prompt} [${C_DIM}${default_val}${C_RESET}]: "
  else
    prompt="${prompt}: "
  fi

  if [[ -r /dev/tty ]]; then
    IFS= read -r -p "$(printf '%b' "$prompt")" input </dev/tty || true
  else
    IFS= read -r -p "$(printf '%b' "$prompt")" input || true
  fi

  input="$(echo -e "${input}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [[ -z "$input" && -n "$default_val" ]]; then
    input="$default_val"
  fi
  printf -v "$__var" '%s' "$input"
}

check_prereqs() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    err "This installer must be run as root. Try again with sudo."
  fi
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || err "Neither curl nor wget found. Please install curl: apt update && apt install -y curl"
  command -v python3 >/dev/null 2>&1 || err "Python 3 is required for safe branding patches. Please install it: apt update && apt install -y python3"
}

download_template() {
  local dest=$1
  local parent_dir
  parent_dir="$(dirname "$dest")"
  mkdir -p "$parent_dir"

  # Backup existing template if not backed up yet
  if [[ -f "$dest" && ! -f "${dest}.bak" ]]; then
    info "Creating backup of current template at: ${dest}.bak"
    cp "$dest" "${dest}.bak"
  fi

  info "Downloading latest Aurora release template..."
  local dl_ok=0
  if command -v curl >/dev/null 2>&1; then
    if curl -fsSL "$RELEASE_URL" -o "$dest"; then
      dl_ok=1
    fi
  fi
  if [[ $dl_ok -eq 0 ]] && command -v wget >/dev/null 2>&1; then
    if wget -qO "$dest" "$RELEASE_URL"; then
      dl_ok=1
    fi
  fi

  if [[ $dl_ok -eq 0 || ! -s "$dest" ]]; then
    # Fallback to local dist/index.html if we are running inside the Aurora git repository
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
    if [[ -f "${script_dir}/dist/index.html" ]]; then
      warn "Could not download remote release. Using local ${script_dir}/dist/index.html"
      cp "${script_dir}/dist/index.html" "$dest"
    else
      err "Failed to download Aurora template from ${RELEASE_URL}"
    fi
  fi

  chmod 644 "$dest"
  ok "Aurora template successfully saved to: ${dest} ($(du -h "$dest" | cut -f1))"
}

patch_branding() {
  local target_file=$1
  local brand_name=$2
  local support_url=$3

  if [[ ! -f "$target_file" ]]; then
    err "Target file not found: $target_file"
  fi

  info "Applying custom branding configuration..."

  python3 - <<PYEOF
import re, json, sys

target = "$target_file"
brand_name = """$brand_name""".strip()
support_url = """$support_url""".strip()

with open(target, 'r', encoding='utf-8') as f:
    content = f.read()

# Build updated brand object
brand_data = {}
m = re.search(r'window\.AURORA_BRAND\s*=\s*(\{.*?\});', content)
if m:
    try:
        brand_data = json.loads(m.group(1))
    except Exception:
        pass

if brand_name:
    brand_data["name"] = brand_name
if support_url:
    brand_data["supportUrl"] = support_url

brand_json = json.dumps(brand_data, ensure_ascii=False)
content = re.sub(r'window\.AURORA_BRAND\s*=\s*\{.*?\};', f'window.AURORA_BRAND = {brand_json};', content)

if brand_name:
    # Update title and meta tags
    content = re.sub(r'<title>[^<]+</title>', f'<title>{brand_name}</title>', content)
    content = re.sub(r'(<meta\s+name="aurora-brand"\s+content=")[^"]*(")', rf'\g<1>{brand_name}\g<2>', content)
    content = re.sub(r'(id="splash-brand"[^>]*>)[^<]+(</p>)', rf'\g<1>{brand_name}\g<2>', content)
    content = re.sub(r'(id="brand-name"[^>]*>)[^<]+(</p>)', rf'\g<1>{brand_name}\g<2>', content)

with open(target, 'w', encoding='utf-8') as f:
    f.write(content)

print("Branding patched successfully.")
PYEOF

  ok "Branding applied to ${target_file}"
}

restart_rebecca() {
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet rebecca; then
      info "Restarting Rebecca service (systemctl restart rebecca)..."
      systemctl restart rebecca
      ok "Rebecca service restarted successfully."
    elif systemctl is-enabled --quiet rebecca 2>/dev/null; then
      info "Starting Rebecca service..."
      systemctl start rebecca
      ok "Rebecca service started."
    else
      info "Rebecca systemd service not active. You may need to reload your container or service."
    fi
  fi
}

restore_backup() {
  local target_file=$1
  local backup_file="${target_file}.bak"
  if [[ -f "$backup_file" ]]; then
    cp "$backup_file" "$target_file"
    ok "Backup restored from ${backup_file} to ${target_file}"
    restart_rebecca
  else
    warn "No backup file found at ${backup_file}"
  fi
}

interactive_install() {
  local target_file="$DEFAULT_TARGET_FILE"
  local target_input=""
  read_input "Enter Rebecca subscription template path" target_input "$target_file"
  target_file="$target_input"

  download_template "$target_file"

  log_blank
  info "Customize your brand information (press Enter to keep default):"
  local brand_name=""
  local support_url=""
  read_input "Brand Name (e.g. MyVPN)" brand_name "Aurora"
  read_input "Support URL (e.g. https://t.me/MySupport)" support_url ""

  if [[ -n "$brand_name" || -n "$support_url" ]]; then
    patch_branding "$target_file" "$brand_name" "$support_url"
  fi

  log_blank
  local do_restart=""
  read_input "Restart Rebecca service now? (y/n)" do_restart "y"
  if [[ "$do_restart" =~ ^[Yy] ]]; then
    restart_rebecca
  fi

  log_blank
  hr
  ok "Installation and customization completed!"
  info "Template Path: ${C_WHITE}${target_file}${C_RESET}"
  if [[ -n "$brand_name" ]]; then
    info "Brand Name:   ${C_WHITE}${brand_name}${C_RESET}"
  fi
  hr
}

# Main entry point
check_prereqs

# Non-interactive CLI flag parsing
AUTO=0
CLI_BRAND=""
CLI_SUPPORT=""
CLI_TARGET="$DEFAULT_TARGET_FILE"
CLI_RESTART=0
CLI_RESTORE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --auto|-a) AUTO=1; shift ;;
    --brand|-b) CLI_BRAND="$2"; shift 2 ;;
    --support|-s) CLI_SUPPORT="$2"; shift 2 ;;
    --target|-t) CLI_TARGET="$2"; shift 2 ;;
    --restart|-r) CLI_RESTART=1; shift ;;
    --restore) CLI_RESTORE=1; shift ;;
    --help|-h)
      print_banner
      log_line "Usage: sudo bash install.sh [OPTIONS]"
      log_line ""
      log_line "Options:"
      log_line "  -a, --auto              Run unattended full installation"
      log_line "  -b, --brand <name>      Set brand name"
      log_line "  -s, --support <url>     Set Telegram/Web support link"
      log_line "  -t, --target <path>     Target index.html path (default: ${DEFAULT_TARGET_FILE})"
      log_line "  -r, --restart           Restart Rebecca service after installation"
      log_line "      --restore           Restore original template from backup"
      log_line "  -h, --help              Show this help message"
      exit 0
      ;;
    *) warn "Unknown argument: $1"; shift ;;
  esac
done

if [[ $CLI_RESTORE -eq 1 ]]; then
  restore_backup "$CLI_TARGET"
  exit 0
fi

if [[ $AUTO -eq 1 || -n "$CLI_BRAND" || -n "$CLI_SUPPORT" ]]; then
  print_banner
  download_template "$CLI_TARGET"
  if [[ -n "$CLI_BRAND" || -n "$CLI_SUPPORT" ]]; then
    patch_branding "$CLI_TARGET" "$CLI_BRAND" "$CLI_SUPPORT"
  fi
  if [[ $CLI_RESTART -eq 1 ]]; then
    restart_rebecca
  fi
  ok "Automated installation finished successfully!"
  exit 0
fi

# Interactive Menu
print_banner
log_line "${C_BOLD}Please select an action:${C_RESET}"
log_line "  ${C_CYAN}1)${C_RESET} Install / Update Aurora (Interactive Setup)"
log_line "  ${C_CYAN}2)${C_RESET} Quick Install with Defaults"
log_line "  ${C_CYAN}3)${C_RESET} Customize Branding on Existing Template"
log_line "  ${C_CYAN}4)${C_RESET} Restore Backup Template"
log_line "  ${C_CYAN}5)${C_RESET} Restart Rebecca Service"
log_line "  ${C_CYAN}0)${C_RESET} Exit"
log_blank

CHOICE=""
read_input "Choose an option (0-5)" CHOICE "1"

case "$CHOICE" in
  1)
    interactive_install
    ;;
  2)
    download_template "$DEFAULT_TARGET_FILE"
    restart_rebecca
    ok "Aurora installed with default settings."
    ;;
  3)
    read_input "Target template path" CLI_TARGET "$DEFAULT_TARGET_FILE"
    read_input "Brand Name" CLI_BRAND "Aurora"
    read_input "Support URL" CLI_SUPPORT ""
    patch_branding "$CLI_TARGET" "$CLI_BRAND" "$CLI_SUPPORT"
    restart_rebecca
    ;;
  4)
    read_input "Target template path" CLI_TARGET "$DEFAULT_TARGET_FILE"
    restore_backup "$CLI_TARGET"
    ;;
  5)
    restart_rebecca
    ;;
  0)
    info "Exiting."
    exit 0
    ;;
  *)
    warn "Invalid option. Exiting."
    exit 1
    ;;
esac
