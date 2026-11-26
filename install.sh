#!/usr/bin/env bash
# ==============================================================================
# 🌌 Aurora Template Installer & Manager for Rebecca Panel
# https://github.com/Ho3einK84/Aurora
# ==============================================================================
set -euo pipefail

readonly SCRIPT_VERSION="2.1.1"
readonly DEFAULT_TARGET_DIR="/var/lib/rebecca/templates/subscription"
readonly DEFAULT_TARGET_FILE="${DEFAULT_TARGET_DIR}/index.html"
readonly RELEASE_URL="https://github.com/Ho3einK84/Aurora/releases/latest/download/index.html"
readonly RAW_SCRIPT_URL="https://raw.githubusercontent.com/Ho3einK84/Aurora/main/install.sh"

# If invoked via `curl ... | sudo bash` (no args), re-exec from a temp file so interactive /dev/tty reads work cleanly
if [[ ! -t 0 ]] && [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]:-}" == "main" || "${BASH_SOURCE[0]:-}" == "stdin" ]] && [[ -z "${AURORA_INSTALL_REEXEC:-}" ]]; then
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
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || err "curl or wget is required (apt install -y curl)."
  command -v python3 >/dev/null 2>&1 || err "python3 is required (apt install -y python3)."
}

require_root_if_needed() {
  local target_file=${1:-$DEFAULT_TARGET_FILE}
  local need_restart=${2:-0}
  if [[ "${EUID:-$(id -u)}" -eq 0 || "${AURORA_ALLOW_NON_ROOT:-0}" == "1" ]]; then
    return 0
  fi
  if [[ "$need_restart" -eq 1 ]]; then
    err "Restarting Rebecca service requires root (use sudo)."
  fi
  local check_dir
  check_dir="$(dirname "$target_file")"
  while [[ ! -e "$check_dir" && "$check_dir" != "/" && "$check_dir" != "." ]]; do
    check_dir="$(dirname "$check_dir")"
  done
  if [[ ! -w "$check_dir" ]] || [[ -e "$target_file" && ! -w "$target_file" ]]; then
    err "This installer must be run as root to write ${target_file} (use sudo)."
  fi
}

# Read current branding fields from an installed Aurora index.html (if present)
CUR_BRAND="Aurora"
CUR_SUPPORT=""
CUR_LANG="en"
CUR_THEME="auroradark"
CUR_LOGO=""
CUR_ANNOUNCE=""
CUR_SERVER_BREAKDOWN="1"
CUR_BRAND_RAW=""
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
  CUR_SERVER_BREAKDOWN="1"
  CUR_BRAND_RAW=""

  if [[ ! -f "$target_file" ]]; then
    return 0
  fi

  local parsed
  parsed="$(TARGET_FILE="$target_file" python3 - <<'PYEOF' 2>/dev/null || true
import os, re, json, base64

path = os.environ.get("TARGET_FILE", "")
with open(path, "r", encoding="utf-8", errors="ignore") as f:
    text = f.read()

m = re.search(r"window\.AURORA_BRAND\s*=\s*", text)
if not m:
    raise SystemExit(0)

dec = json.JSONDecoder()
data, _ = dec.raw_decode(text, m.end())
if not isinstance(data, dict):
    raise SystemExit(0)

def clean(v):
    return str(v or "").replace("\n", " ").replace("\r", "").strip()

def enc(v):
    return base64.b64encode(str(v).encode("utf-8")).decode("ascii")

sb = data.get("serverBreakdown")
if sb is None:
    sb = data.get("showServerUsage")
if sb is None:
    m_sb = re.search(r'<meta\s+name="aurora-server-breakdown"\s+content="([^"]*)"', text)
    if m_sb and m_sb.group(1).lower() in ("false", "0", "no", "off", "disabled"):
        sb = False
    else:
        sb = True

print("INSTALLED:1")
print("BRAND_B64:" + enc(clean(data.get("name") or "Aurora")))
print("SUPPORT_B64:" + enc(clean(data.get("supportUrl") or "")))
print("LANG_B64:" + enc(clean(data.get("defaultLang") or data.get("lang") or "en")))
print("THEME_B64:" + enc(clean(data.get("defaultTheme") or data.get("theme") or "auroradark")))
print("LOGO_B64:" + enc(clean(data.get("logo") or "")))
print("ANNOUNCE_B64:" + enc(clean(data.get("announcement") or "")))
print("RAW_JSON_B64:" + enc(json.dumps(data, ensure_ascii=False)))
print("SERVER_BREAKDOWN:" + ("1" if sb else "0"))
PYEOF
)"

  local b64_dec
  b64_dec() { python3 -c 'import sys,base64; s=sys.argv[1]; s+="="*((4-len(s)%4)%4); sys.stdout.write(base64.b64decode(s).decode("utf-8"))' "$1" 2>/dev/null || true; }

  if [[ -n "$parsed" ]]; then
    while IFS=':' read -r k v; do
      case "$k" in
        INSTALLED)        IS_INSTALLED="$v" ;;
        BRAND_B64)        CUR_BRAND="$(b64_dec "$v")"; CUR_BRAND="${CUR_BRAND:-Aurora}" ;;
        SUPPORT_B64)      CUR_SUPPORT="$(b64_dec "$v")" ;;
        LANG_B64)         CUR_LANG="$(b64_dec "$v")"; CUR_LANG="${CUR_LANG:-en}" ;;
        THEME_B64)        CUR_THEME="$(b64_dec "$v")"; CUR_THEME="${CUR_THEME:-auroradark}" ;;
        LOGO_B64)         CUR_LOGO="$(b64_dec "$v")" ;;
        ANNOUNCE_B64)     CUR_ANNOUNCE="$(b64_dec "$v")" ;;
        RAW_JSON_B64)     CUR_BRAND_RAW="$(b64_dec "$v")" ;;
        SERVER_BREAKDOWN) CUR_SERVER_BREAKDOWN="${v:-1}" ;;
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

  local sb_status="${C_GREEN}enabled${C_RESET}"
  if [[ "$CUR_SERVER_BREAKDOWN" == "0" ]]; then
    sb_status="${C_YELLOW}disabled${C_RESET}"
  fi

  log_blank
  hr
  log_line "${C_MAGENTA}${C_BOLD}   🌌 Aurora v4.3.2 — Subscription Template for Rebecca${C_RESET}"
  log_line "${C_DIM}   Installer v${SCRIPT_VERSION} · Single-File · Zero External Requests${C_RESET}"
  hr
  if [[ $IS_INSTALLED -eq 1 ]]; then
    log_line "   ${C_DIM}Status:${C_RESET} ${C_GREEN}Installed${C_RESET} (${C_WHITE}${CUR_BRAND}${C_RESET} · ${CUR_LANG} · ${CUR_THEME} · nodes: ${sb_status})   ${C_DIM}Rebecca:${C_RESET} ${svc_state}"
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
  local server_breakdown=${8:-}
  local seed_brand_json=${9:-}

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
  SERVER_BREAKDOWN="$server_breakdown" \
  SEED_BRAND_JSON="$seed_brand_json" \
  python3 - <<'PYEOF'
import os, re, json, html

target = os.environ["TARGET_FILE"]
brand_name = os.environ.get("BRAND_NAME", "").strip()
support_url = os.environ.get("SUPPORT_URL", "").strip()
default_lang = os.environ.get("DEFAULT_LANG", "").strip().lower()
default_theme = os.environ.get("DEFAULT_THEME", "").strip().lower()
logo_url = os.environ.get("LOGO_URL", "").strip()
announce_text = os.environ.get("ANNOUNCE_TEXT", "").strip()
server_breakdown = os.environ.get("SERVER_BREAKDOWN", "").strip().lower()
seed_brand_json = os.environ.get("SEED_BRAND_JSON", "").strip()

with open(target, "r", encoding="utf-8") as f:
    content = f.read()

dec = json.JSONDecoder()
brand_data = {}
m = re.search(r"window\.AURORA_BRAND\s*=\s*", content)
span_end = -1
if m:
    try:
        parsed_cur, end_idx = dec.raw_decode(content, m.end())
        if isinstance(parsed_cur, dict):
            brand_data.update(parsed_cur)
        semi = re.match(r"\s*;", content[end_idx:])
        span_end = end_idx + (semi.end() if semi else 0)
    except Exception:
        span_end = -1

if seed_brand_json:
    try:
        seed_obj = json.loads(seed_brand_json)
        if isinstance(seed_obj, dict):
            brand_data.update(seed_obj)
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
if default_theme in ("auroradark", "amoleddark", "auroralight", "rebecca"):
    brand_data["defaultTheme"] = default_theme

if logo_url == "-" or logo_url.lower() == "none":
    brand_data.pop("logo", None)
elif logo_url:
    brand_data["logo"] = logo_url

if announce_text == "-" or announce_text.lower() == "none":
    brand_data.pop("announcement", None)
elif announce_text:
    brand_data["announcement"] = announce_text

if server_breakdown in ("0", "false", "no", "off", "disable", "disabled"):
    brand_data["serverBreakdown"] = False
elif server_breakdown in ("1", "true", "yes", "on", "enable", "enabled"):
    brand_data["serverBreakdown"] = True

brand_json = json.dumps(brand_data, ensure_ascii=False).replace("</", "<\\/")
for bad in ("{{", "{%", "{#"):
    if bad in brand_json:
        brand_json = brand_json.replace(bad, bad[0] + "\\u200b" + bad[1])

if m and span_end > m.start():
    content = content[:m.start()] + f"window.AURORA_BRAND = {brand_json};" + content[span_end:]

if brand_name:
    esc = html.escape(brand_name, quote=True)
    content = re.sub(r"<title>[^<]+</title>", lambda _: f"<title>{esc}</title>", content)
    content = re.sub(r'(<meta\s+name="aurora-brand"\s+content=")[^"]*(")', lambda m: f"{m.group(1)}{esc}{m.group(2)}", content)
    content = re.sub(r'(id="splash-brand"[^>]*>)[^<]+(</p>)', lambda m: f"{m.group(1)}{esc}{m.group(2)}", content)
    content = re.sub(r'(id="brand-name"[^>]*>)[^<]+(</p>)', lambda m: f"{m.group(1)}{esc}{m.group(2)}", content)

if default_theme in ("auroradark", "amoleddark", "auroralight", "rebecca"):
    content = re.sub(r'(<meta\s+name="aurora-default-theme"\s+content=")[^"]*(")', lambda m: f"{m.group(1)}{default_theme}{m.group(2)}", content)
    content = re.sub(r'(<html\b[^>]*\s+data-theme=")[^"]*(")', lambda m: f"{m.group(1)}{default_theme}{m.group(2)}", content)

if default_lang in ("en", "fa", "ru", "zh"):
    direction = "rtl" if default_lang == "fa" else "ltr"
    content = re.sub(r'(<meta\s+name="aurora-default-lang"\s+content=")[^"]*(")', lambda m: f"{m.group(1)}{default_lang}{m.group(2)}", content)
    content = re.sub(r'(<html\b[^>]*\s+lang=")[^"]*(")', lambda m: f"{m.group(1)}{default_lang}{m.group(2)}", content)
    content = re.sub(r'(<html\b[^>]*\s+dir=")[^"]*(")', lambda m: f"{m.group(1)}{direction}{m.group(2)}", content)

sb_state = brand_data.get("serverBreakdown")
if sb_state is not None:
    sb_val = "false" if sb_state is False else "true"
    if re.search(r'<meta\s+name="aurora-server-breakdown"', content):
        content = re.sub(r'(<meta\s+name="aurora-server-breakdown"\s+content=")[^"]*(")', lambda m: f"{m.group(1)}{sb_val}{m.group(2)}", content)
    else:
        content = re.sub(
            r'(<meta\s+name="aurora-default-lang"[^>]*>)',
            lambda m: f'{m.group(1)}\n    <meta name="aurora-server-breakdown" content="{sb_val}" />',
            content
        )

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
  local sb_input=""

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
  log_line "  ${C_BOLD}Default Theme:${C_RESET} 1) Aurora Dark  2) Amoled Dark  3) Aurora Light  4) Rebecca"
  read_input "Theme (1-4 or name)" theme_input "$CUR_THEME"
  local default_theme="$CUR_THEME"
  case "$theme_input" in
    1|auroradark|dark) default_theme="auroradark" ;;
    2|amoled*|AMOLED*) default_theme="amoleddark" ;;
    3|auroralight|light*) default_theme="auroralight" ;;
    4|rebecca*|REBECCA*) default_theme="rebecca" ;;
  esac

  log_blank
  log_line "  ${C_BOLD}Server Breakdown (Usage by Server / تفکیک سرور):${C_RESET} 1) Enabled [فعال]  2) Disabled [غیرفعال]"
  local sb_def="1"
  [[ "$CUR_SERVER_BREAKDOWN" == "0" ]] && sb_def="2"
  read_input "Server Breakdown (1=enable, 2=disable)" sb_input "$sb_def"
  local server_breakdown="1"
  case "$sb_input" in
    2|disable*|off|false|0) server_breakdown="0" ;;
    *) server_breakdown="1" ;;
  esac

  patch_branding "$target_file" "$brand_name" "$support_url" "$default_lang" "$default_theme" "$logo_url" "$announce_text" "$server_breakdown"
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
  local saved_sb="$CUR_SERVER_BREAKDOWN"
  local saved_raw="$CUR_BRAND_RAW"

  download_template "$target_file"

  if [[ $prev_installed -eq 1 ]]; then
    patch_branding "$target_file" "$saved_brand" "$saved_support" "$saved_lang" "$saved_theme" "$saved_logo" "$saved_announce" "$saved_sb" "$saved_raw"
    info "Preserved existing branding (${saved_brand}, ${saved_lang}, ${saved_theme}, nodes: $([[ "$saved_sb" == "0" ]] && echo disabled || echo enabled))."
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
  local saved_sb="$CUR_SERVER_BREAKDOWN"
  local saved_raw="$CUR_BRAND_RAW"

  download_template "$target_file"
  if [[ $prev_installed -eq 1 ]]; then
    patch_branding "$target_file" "$saved_brand" "$saved_support" "$saved_lang" "$saved_theme" "$saved_logo" "$saved_announce" "$saved_sb" "$saved_raw"
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
  local cli_server_breakdown=""
  local cli_target="$DEFAULT_TARGET_FILE"
  local cli_restart=0
  local cli_restore=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --auto|-a)      auto=1; shift ;;
      --brand|-b)     [[ $# -ge 2 ]] || err "Option $1 requires an argument."; cli_brand="$2"; shift 2 ;;
      --support|-s)   [[ $# -ge 2 ]] || err "Option $1 requires an argument."; cli_support="$2"; shift 2 ;;
      --lang|-l)      [[ $# -ge 2 ]] || err "Option $1 requires an argument."; cli_lang="$2"; shift 2 ;;
      --theme|-m)     [[ $# -ge 2 ]] || err "Option $1 requires an argument."; cli_theme="$2"; shift 2 ;;
      --logo)         [[ $# -ge 2 ]] || err "Option $1 requires an argument."; cli_logo="$2"; shift 2 ;;
      --announce)     [[ $# -ge 2 ]] || err "Option $1 requires an argument."; cli_announce="$2"; shift 2 ;;
      --server-breakdown) [[ $# -ge 2 ]] || err "Option $1 requires an argument."; cli_server_breakdown="$2"; shift 2 ;;
      --disable-server-breakdown|--no-server-breakdown) cli_server_breakdown="0"; shift ;;
      --enable-server-breakdown) cli_server_breakdown="1"; shift ;;
      --target|-t)    [[ $# -ge 2 ]] || err "Option $1 requires an argument."; cli_target="$2"; shift 2 ;;
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
        log_line "  -m, --theme <theme>       Set default theme (auroradark, amoleddark, auroralight, rebecca)"
        log_line "      --logo <url>          Set header logo image URL ('-' to clear)"
        log_line "      --announce <text>     Set announcement banner text ('-' to clear)"
        log_line "      --server-breakdown <0|1>  Enable (1) or disable (0) usage by server breakdown"
        log_line "      --no-server-breakdown     Disable usage by server breakdown (تفکیک سرور)"
        log_line "      --enable-server-breakdown Enable usage by server breakdown (default)"
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
    require_root_if_needed "$cli_target" 1
    restore_backup "$cli_target"
    exit 0
  fi

  if [[ $auto -eq 1 || -n "$cli_brand" || -n "$cli_support" || -n "$cli_lang" || -n "$cli_theme" || -n "$cli_logo" || -n "$cli_announce" || -n "$cli_server_breakdown" ]]; then
    require_root_if_needed "$cli_target" "$cli_restart"
    print_banner "$cli_target"
    detect_current_config "$cli_target"
    local prev_installed=$IS_INSTALLED
    local b_name="${cli_brand:-$CUR_BRAND}"
    local b_support="${cli_support:-$CUR_SUPPORT}"
    local b_lang="${cli_lang:-$CUR_LANG}"
    local b_theme="${cli_theme:-$CUR_THEME}"
    local b_logo="${cli_logo:-$CUR_LOGO}"
    local b_announce="${cli_announce:-$CUR_ANNOUNCE}"
    local b_sb="${cli_server_breakdown:-$CUR_SERVER_BREAKDOWN}"
    local saved_raw="$CUR_BRAND_RAW"

    download_template "$cli_target"
    if [[ $prev_installed -eq 1 || -n "$cli_brand" || -n "$cli_support" || -n "$cli_lang" || -n "$cli_theme" || -n "$cli_logo" || -n "$cli_announce" || -n "$cli_server_breakdown" ]]; then
      patch_branding "$cli_target" "$b_name" "$b_support" "$b_lang" "$b_theme" "$b_logo" "$b_announce" "$b_sb" "$saved_raw"
    fi
    if [[ $cli_restart -eq 1 ]]; then
      restart_rebecca
    fi
    ok "Done!"
    exit 0
  fi

  if [[ "${EUID:-$(id -u)}" -ne 0 && "${AURORA_ALLOW_NON_ROOT:-0}" != "1" ]]; then
    err "Interactive installation must be run as root (use sudo)."
  fi
  print_banner "$cli_target"
  log_line "  ${C_CYAN}1)${C_RESET} Quick Install / Update ${C_DIM}(keeps existing branding)${C_RESET}"
  log_line "  ${C_CYAN}2)${C_RESET} Install + Customize ${C_DIM}(brand, language, theme, logo, banner, breakdown)${C_RESET}"
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
