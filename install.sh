#!/usr/bin/env bash
# ==============================================================================
# 🌌 Aurora Template Installer & Manager for Rebecca Panel
# https://github.com/Ho3einK84/Aurora
# ==============================================================================
set -euo pipefail

readonly SCRIPT_VERSION="2.0.0"
readonly DEFAULT_TARGET_DIR="/var/lib/rebecca/templates/subscription"
readonly DEFAULT_TARGET_FILE="${DEFAULT_TARGET_DIR}/index.html"
readonly RELEASE_URL="https://github.com/Ho3einK84/Aurora/releases/latest/download/index.html"
readonly RAW_SCRIPT_URL="https://raw.githubusercontent.com/Ho3einK84/Aurora/main/install.sh"

# If invoked via `curl ... | sudo bash` (no args), re-exec from a temp file so interactive /dev/tty reads work cleanly
if [[ ! -t 0 ]] && [[ $# -eq 0 ]] && [[ -z "${AURORA_INSTALL_REEXEC:-}" ]]; then
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
  readonly C_MAGENTA='\033[35m'
  readonly C_CYAN='\033[36m'
  readonly C_WHITE='\033[97m'
else
  readonly C_RESET='' C_BOLD='' C_DIM='' C_RED='' C_GREEN='' C_YELLOW='' C_MAGENTA='' C_CYAN='' C_WHITE=''
fi

log_line()  { printf '%b\n' "$1"; }
log_blank() { printf '\n'; }
ok()        { log_line "${C_GREEN}[✓]${C_RESET} $*"; }
info()      { log_line "${C_CYAN}[i]${C_RESET} $*"; }
warn()      { log_line "${C_YELLOW}[!]${C_RESET} $*"; }
err()       { log_line "${C_RED}[✗]${C_RESET} $*"; exit 1; }

hr() {
  log_line "${C_CYAN}${C_BOLD}────────────────────────────────────────────────────────────────${C_RESET}"
}

check_prereqs() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    err "This installer must be run as root (use sudo)."
  fi
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || err "curl or wget is required (apt install -y curl)."
  command -v python3 >/dev/null 2>&1 || err "python3 is required (apt install -y python3)."
}

# Read current branding fields from an installed Aurora index.html (if present)
CUR_BRAND="Aurora"
CUR_SUPPORT=""
CUR_LANG="en"
CUR_THEME="auroradark"
CUR_LOGO=""
CUR_ANNOUNCE=""
IS_INSTALLED=0

detect_current_config() {
  local target_file=${1:-$DEFAULT_TARGET_FILE}
  IS_INSTALLED=0
  CUR_BRAND="Aurora"
  CUR_SUPPORT=""
  CUR_LANG="en"
  CUR_THEME="auroradark"
  CUR_LOGO=""
  CUR_ANNOUNCE=""

  if [[ ! -f "$target_file" ]]; then
    return 0
  fi

  local parsed
  parsed="$(TARGET_FILE="$target_file" python3 - <<'PYEOF' 2>/dev/null || true
import os, re, json

path = os.environ.get("TARGET_FILE", "")
with open(path, "r", encoding="utf-8", errors="ignore") as f:
    text = f.read()

m = re.search(r"window\.AURORA_BRAND\s*=\s*(\{.*?\});", text)
if not m:
    raise SystemExit(0)

data = json.loads(m.group(1))
def clean(v):
    return str(v or "").replace("\n", " ").replace("\r", "").strip()

print("INSTALLED=1")
print("BRAND=" + clean(data.get("name") or "Aurora"))
print("SUPPORT=" + clean(data.get("supportUrl") or ""))
print("LANG=" + clean(data.get("defaultLang") or data.get("lang") or "en"))
print("THEME=" + clean(data.get("defaultTheme") or data.get("theme") or "auroradark"))
print("LOGO=" + clean(data.get("logo") or ""))
print("ANNOUNCE=" + clean(data.get("announcement") or ""))
PYEOF
)"

  if [[ -n "$parsed" ]]; then
    while IFS='=' read -r k v; do
      case "$k" in
        INSTALLED) IS_INSTALLED="$v" ;;
        BRAND)     CUR_BRAND="${v:-Aurora}" ;;
        SUPPORT)   CUR_SUPPORT="$v" ;;
        LANG)      CUR_LANG="${v:-en}" ;;
        THEME)     CUR_THEME="${v:-auroradark}" ;;
        LOGO)      CUR_LOGO="$v" ;;
        ANNOUNCE)  CUR_ANNOUNCE="$v" ;;
      esac
    done <<< "$parsed"
  fi
}

print_banner() {
  local target_file=${1:-$DEFAULT_TARGET_FILE}
  detect_current_config "$target_file"

  local svc_state="not found"
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet rebecca 2>/dev/null; then
      svc_state="${C_GREEN}active${C_RESET}"
    elif systemctl is-enabled --quiet rebecca 2>/dev/null; then
      svc_state="${C_YELLOW}stopped${C_RESET}"
    fi
  fi

  log_blank
  hr
  log_line "${C_MAGENTA}${C_BOLD}   🌌 Aurora v4.0 — Subscription Template for Rebecca${C_RESET}"
  log_line "${C_DIM}   Installer v${SCRIPT_VERSION} · Single-File · Zero External Requests${C_RESET}"
  hr
  if [[ $IS_INSTALLED -eq 1 ]]; then
    log_line "   ${C_DIM}Status:${C_RESET} ${C_GREEN}Installed${C_RESET} (${C_WHITE}${CUR_BRAND}${C_RESET} · ${CUR_LANG} · ${CUR_THEME})   ${C_DIM}Rebecca:${C_RESET} ${svc_state}"
  else
    log_line "   ${C_DIM}Status:${C_RESET} ${C_YELLOW}Not installed${C_RESET}   ${C_DIM}Rebecca:${C_RESET} ${svc_state}"
  fi
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

  input="$(printf '%s' "$input" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [[ -z "$input" && -n "$default_val" ]]; then
    input="$default_val"
  fi
  printf -v "$__var" '%s' "$input"
}

download_template() {
  local dest=$1
  local parent_dir
  parent_dir="$(dirname "$dest")"
  mkdir -p "$parent_dir"

  # Create a one-time backup of the original non-Aurora template
  if [[ -f "$dest" && ! -f "${dest}.bak" ]]; then
    cp "$dest" "${dest}.bak"
    info "Backed up original template to ${dest}.bak"
  fi

  info "Fetching latest Aurora template..."
  local tmp_dl="${dest}.tmp.$$"
  local dl_ok=0

  # Prefer local dist/index.html when running directly inside a built Aurora checkout
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
  if [[ -f "${script_dir}/dist/index.html" && "${AURORA_FORCE_REMOTE:-0}" != "1" ]]; then
    cp "${script_dir}/dist/index.html" "$tmp_dl"
    dl_ok=1
  else
    if command -v curl >/dev/null 2>&1 && curl -fsSL "$RELEASE_URL" -o "$tmp_dl" 2>/dev/null; then
      dl_ok=1
    elif command -v wget >/dev/null 2>&1 && wget -qO "$tmp_dl" "$RELEASE_URL" 2>/dev/null; then
      dl_ok=1
    fi
  fi

  if [[ $dl_ok -eq 0 || ! -s "$tmp_dl" ]]; then
    rm -f "$tmp_dl"
    err "Failed to download Aurora template from ${RELEASE_URL}"
  fi

  mv -f "$tmp_dl" "$dest"
  chmod 644 "$dest"
  ok "Template installed to ${dest} ($(du -h "$dest" | cut -f1))"
}

patch_branding() {
  local target_file=$1
  local brand_name=${2:-}
  local support_url=${3:-}
  local default_lang=${4:-}
  local default_theme=${5:-}
  local logo_url=${6:-}
  local announce_text=${7:-}

  if [[ ! -f "$target_file" ]]; then
    err "Template file not found: $target_file"
  fi

  TARGET_FILE="$target_file" \
  BRAND_NAME="$brand_name" \
  SUPPORT_URL="$support_url" \
  DEFAULT_LANG="$default_lang" \
  DEFAULT_THEME="$default_theme" \
  LOGO_URL="$logo_url" \
  ANNOUNCE_TEXT="$announce_text" \
  python3 - <<'PYEOF'
import os, re, json, html

target = os.environ["TARGET_FILE"]
brand_name = os.environ.get("BRAND_NAME", "").strip()
support_url = os.environ.get("SUPPORT_URL", "").strip()
default_lang = os.environ.get("DEFAULT_LANG", "").strip().lower()
default_theme = os.environ.get("DEFAULT_THEME", "").strip().lower()
logo_url = os.environ.get("LOGO_URL", "").strip()
announce_text = os.environ.get("ANNOUNCE_TEXT", "").strip()

with open(target, "r", encoding="utf-8") as f:
    content = f.read()

brand_data = {}
m = re.search(r"window\.AURORA_BRAND\s*=\s*(\{.*?\});", content)
if m:
    try:
        brand_data = json.loads(m.group(1))
    except Exception:
        pass

if brand_name:
    brand_data["name"] = brand_name
if support_url == "-" or support_url.lower() == "none":
    brand_data.pop("supportUrl", None)
elif support_url:
    brand_data["supportUrl"] = support_url

if default_lang in ("en", "fa", "ru", "zh"):
    brand_data["defaultLang"] = default_lang
if default_theme in ("auroradark", "amoleddark", "auroralight", "nord"):
    brand_data["defaultTheme"] = default_theme

if logo_url == "-" or logo_url.lower() == "none":
    brand_data.pop("logo", None)
elif logo_url:
    brand_data["logo"] = logo_url

if announce_text == "-" or announce_text.lower() == "none":
    brand_data.pop("announcement", None)
elif announce_text:
    brand_data["announcement"] = announce_text

brand_json = json.dumps(brand_data, ensure_ascii=False)
content = re.sub(
    r"window\.AURORA_BRAND\s*=\s*\{.*?\};",
    lambda _: f"window.AURORA_BRAND = {brand_json};",
    content,
)

if brand_name:
    esc = html.escape(brand_name, quote=True)
    content = re.sub(r"<title>[^<]+</title>", lambda _: f"<title>{esc}</title>", content)
    content = re.sub(r'(<meta\s+name="aurora-brand"\s+content=")[^"]*(")', lambda m: f"{m.group(1)}{esc}{m.group(2)}", content)
    content = re.sub(r'(id="splash-brand"[^>]*>)[^<]+(</p>)', lambda m: f"{m.group(1)}{esc}{m.group(2)}", content)
    content = re.sub(r'(id="brand-name"[^>]*>)[^<]+(</p>)', lambda m: f"{m.group(1)}{esc}{m.group(2)}", content)

if default_theme in ("auroradark", "amoleddark", "auroralight", "nord"):
    content = re.sub(r'(<meta\s+name="aurora-default-theme"\s+content=")[^"]*(")', rf"\g<1>{default_theme}\g<2>", content)
    content = re.sub(r'(<html\b[^>]*\s+data-theme=")[^"]*(")', rf"\g<1>{default_theme}\g<2>", content)

if default_lang in ("en", "fa", "ru", "zh"):
    direction = "rtl" if default_lang == "fa" else "ltr"
    content = re.sub(r'(<meta\s+name="aurora-default-lang"\s+content=")[^"]*(")', rf"\g<1>{default_lang}\g<2>", content)
    content = re.sub(r'(<html\b[^>]*\s+lang=")[^"]*(")', rf"\g<1>{default_lang}\g<2>", content)
    content = re.sub(r'(<html\b[^>]*\s+dir=")[^"]*(")', rf"\g<1>{direction}\g<2>", content)

with open(target, "w", encoding="utf-8") as f:
    f.write(content)
PYEOF

  ok "Branding and preferences saved."
}

restart_rebecca() {
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet rebecca 2>/dev/null; then
      systemctl restart rebecca
      ok "Rebecca service restarted."
    elif systemctl is-enabled --quiet rebecca 2>/dev/null; then
      systemctl start rebecca
      ok "Rebecca service started."
    fi
  fi
}

restore_backup() {
  local target_file=${1:-$DEFAULT_TARGET_FILE}
  local backup_file="${target_file}.bak"
  if [[ -f "$backup_file" ]]; then
    cp "$backup_file" "$target_file"
    ok "Restored backup from ${backup_file}"
    restart_rebecca
  else
    warn "No backup file found at ${backup_file}"
  fi
}

prompt_branding_wizard() {
  local target_file=$1
  detect_current_config "$target_file"

  local brand_name=""
  local support_url=""
  local logo_url=""
  local announce_text=""
  local lang_input=""
  local theme_input=""

  log_blank
  info "Customize Aurora (press Enter to keep current value, or '-' to clear optional fields):"
  read_input "Brand Name" brand_name "$CUR_BRAND"
  read_input "Support Link (e.g. https://t.me/Support)" support_url "$CUR_SUPPORT"
  read_input "Logo URL (optional image URL)" logo_url "$CUR_LOGO"
  read_input "Announcement Banner (optional notice)" announce_text "$CUR_ANNOUNCE"

  log_blank
  log_line "  ${C_BOLD}Default Language:${C_RESET} 1) English (en)  2) فارسی (fa)  3) Русский (ru)  4) 中文 (zh)"
  read_input "Language (1-4 or code)" lang_input "$CUR_LANG"
  local default_lang="$CUR_LANG"
  case "$lang_input" in
    1|en|EN) default_lang="en" ;;
    2|fa|FA) default_lang="fa" ;;
    3|ru|RU) default_lang="ru" ;;
    4|zh|ZH) default_lang="zh" ;;
  esac

  log_blank
  log_line "  ${C_BOLD}Default Theme:${C_RESET} 1) Aurora Dark  2) Amoled Dark  3) Aurora Light  4) Nord"
  read_input "Theme (1-4 or name)" theme_input "$CUR_THEME"
  local default_theme="$CUR_THEME"
  case "$theme_input" in
    1|auroradark|dark) default_theme="auroradark" ;;
    2|amoled*|AMOLED*) default_theme="amoleddark" ;;
    3|auroralight|light*) default_theme="auroralight" ;;
    4|nord*|NORD*) default_theme="nord" ;;
  esac

  patch_branding "$target_file" "$brand_name" "$support_url" "$default_lang" "$default_theme" "$logo_url" "$announce_text"
}

quick_install_or_update() {
  local target_file=${1:-$DEFAULT_TARGET_FILE}
  detect_current_config "$target_file"
  local prev_installed=$IS_INSTALLED
  local saved_brand="$CUR_BRAND"
  local saved_support="$CUR_SUPPORT"
  local saved_lang="$CUR_LANG"
  local saved_theme="$CUR_THEME"
  local saved_logo="$CUR_LOGO"
  local saved_announce="$CUR_ANNOUNCE"

  download_template "$target_file"

  if [[ $prev_installed -eq 1 ]]; then
    patch_branding "$target_file" "$saved_brand" "$saved_support" "$saved_lang" "$saved_theme" "$saved_logo" "$saved_announce"
    info "Preserved existing branding (${saved_brand}, ${saved_lang}, ${saved_theme})."
  fi
  restart_rebecca
  ok "Aurora is up to date and live!"
}

interactive_install() {
  local target_file="$DEFAULT_TARGET_FILE"
  read_input "Template path" target_file "$DEFAULT_TARGET_FILE"
  detect_current_config "$target_file"
  local prev_installed=$IS_INSTALLED
  local saved_brand="$CUR_BRAND"
  local saved_support="$CUR_SUPPORT"
  local saved_lang="$CUR_LANG"
  local saved_theme="$CUR_THEME"
  local saved_logo="$CUR_LOGO"
  local saved_announce="$CUR_ANNOUNCE"

  download_template "$target_file"
  if [[ $prev_installed -eq 1 ]]; then
    patch_branding "$target_file" "$saved_brand" "$saved_support" "$saved_lang" "$saved_theme" "$saved_logo" "$saved_announce"
  fi

  prompt_branding_wizard "$target_file"
  restart_rebecca
  log_blank
  ok "Aurora installation & customization complete!"
}

main() {
  check_prereqs

  local auto=0
  local cli_brand=""
  local cli_support=""
  local cli_lang=""
  local cli_theme=""
  local cli_logo=""
  local cli_announce=""
  local cli_target="$DEFAULT_TARGET_FILE"
  local cli_restart=0
  local cli_restore=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --auto|-a)      auto=1; shift ;;
      --brand|-b)     cli_brand="$2"; shift 2 ;;
      --support|-s)   cli_support="$2"; shift 2 ;;
      --lang|-l)      cli_lang="$2"; shift 2 ;;
      --theme|-m)     cli_theme="$2"; shift 2 ;;
      --logo)         cli_logo="$2"; shift 2 ;;
      --announce)     cli_announce="$2"; shift 2 ;;
      --target|-t)    cli_target="$2"; shift 2 ;;
      --restart|-r)   cli_restart=1; shift ;;
      --restore)      cli_restore=1; shift ;;
      --help|-h)
        print_banner "$cli_target"
        log_line "Usage: sudo bash install.sh [OPTIONS]"
        log_line ""
        log_line "Options:"
        log_line "  -a, --auto                Unattended install/update (preserves existing branding)"
        log_line "  -b, --brand <name>        Set brand name"
        log_line "  -s, --support <url>       Set Telegram/support URL ('-' to clear)"
        log_line "  -l, --lang <code>         Set default language (en, fa, ru, zh)"
        log_line "  -m, --theme <theme>       Set default theme (auroradark, amoleddark, auroralight, nord)"
        log_line "      --logo <url>          Set header logo image URL ('-' to clear)"
        log_line "      --announce <text>     Set announcement banner text ('-' to clear)"
        log_line "  -t, --target <path>       Target index.html path (default: ${DEFAULT_TARGET_FILE})"
        log_line "  -r, --restart             Restart Rebecca service after applying"
        log_line "      --restore             Restore original template backup"
        log_line "  -h, --help                Show this help"
        exit 0
        ;;
      *) warn "Unknown option: $1"; shift ;;
    esac
  done

  if [[ $cli_restore -eq 1 ]]; then
    restore_backup "$cli_target"
    exit 0
  fi

  if [[ $auto -eq 1 || -n "$cli_brand" || -n "$cli_support" || -n "$cli_lang" || -n "$cli_theme" || -n "$cli_logo" || -n "$cli_announce" ]]; then
    print_banner "$cli_target"
    detect_current_config "$cli_target"
    local prev_installed=$IS_INSTALLED
    local b_name="${cli_brand:-$CUR_BRAND}"
    local b_support="${cli_support:-$CUR_SUPPORT}"
    local b_lang="${cli_lang:-$CUR_LANG}"
    local b_theme="${cli_theme:-$CUR_THEME}"
    local b_logo="${cli_logo:-$CUR_LOGO}"
    local b_announce="${cli_announce:-$CUR_ANNOUNCE}"

    download_template "$cli_target"
    if [[ $prev_installed -eq 1 || -n "$cli_brand" || -n "$cli_support" || -n "$cli_lang" || -n "$cli_theme" || -n "$cli_logo" || -n "$cli_announce" ]]; then
      patch_branding "$cli_target" "$b_name" "$b_support" "$b_lang" "$b_theme" "$b_logo" "$b_announce"
    fi
    if [[ $cli_restart -eq 1 ]]; then
      restart_rebecca
    fi
    ok "Done!"
    exit 0
  fi

  print_banner "$cli_target"
  log_line "  ${C_CYAN}1)${C_RESET} Quick Install / Update ${C_DIM}(keeps existing branding)${C_RESET}"
  log_line "  ${C_CYAN}2)${C_RESET} Install + Customize ${C_DIM}(brand, language, theme, logo, banner)${C_RESET}"
  log_line "  ${C_CYAN}3)${C_RESET} Customize Existing Template ${C_DIM}(no download)${C_RESET}"
  log_line "  ${C_CYAN}4)${C_RESET} Restore Original Backup"
  log_line "  ${C_CYAN}0)${C_RESET} Exit"
  log_blank

  local choice=""
  read_input "Select an option (0-4)" choice "1"

  case "$choice" in
    1) quick_install_or_update "$cli_target" ;;
    2) interactive_install ;;
    3)
      read_input "Template path" cli_target "$DEFAULT_TARGET_FILE"
      prompt_branding_wizard "$cli_target"
      restart_rebecca
      ;;
    4)
      read_input "Template path" cli_target "$DEFAULT_TARGET_FILE"
      restore_backup "$cli_target"
      ;;
    0) exit 0 ;;
    *) err "Invalid option: $choice" ;;
  esac
}

main "$@"
