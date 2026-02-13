#!/bin/bash

set -e

REPO="worktoolai/limitai"
BINARY_NAME="limitai"
INSTALL_DIR="$HOME/.local/bin"

# Parse arguments
VERSION=""
UNINSTALL=false
require_option_value() {
    local opt="$1"
    local val="${2-}"
    if [ -z "$val" ] || [[ "$val" == -* ]]; then
        echo "Error: ${opt} requires a value" >&2
        exit 1
    fi
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version)
            require_option_value "--version" "${2-}"
            VERSION="$2"
            shift 2
            ;;
        --dir)
            require_option_value "--dir" "${2-}"
            INSTALL_DIR="$2"
            shift 2
            ;;
        --uninstall)
            UNINSTALL=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--version VERSION] [--dir INSTALL_DIR] [--uninstall]"
            echo ""
            echo "Options:"
            echo "  --version   VERSION   Install specific version (default: latest)"
            echo "  --dir       DIR       Install directory (default: ~/.local/bin)"
            echo "  --uninstall           Remove limitai binary and PATH entries"
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# --- Uninstall ---

if [ "$UNINSTALL" = true ]; then
    echo "Uninstalling limitai..."

    if [ -f "${INSTALL_DIR}/${BINARY_NAME}" ]; then
        echo "  Stopping background daemon..."
        "${INSTALL_DIR}/${BINARY_NAME}" uninstall 2>/dev/null || true
        rm -f "${INSTALL_DIR}/${BINARY_NAME}"
        echo "  Removed ${INSTALL_DIR}/${BINARY_NAME}"
    else
        echo "  Binary not found at ${INSTALL_DIR}/${BINARY_NAME} (skipped)"
    fi

    # Clean PATH entries from shell profiles
    PATH_BLOCK_BEGIN="# >>> limitai PATH >>>"
    PATH_BLOCK_END="# <<< limitai PATH <<<"
    CLEANED_PROFILES=()

    uninstall_clean_profile() {
        local profile="$1"
        [ -f "$profile" ] || return 0

        local cleaned
        cleaned=$(mktemp)

        awk -v block_begin="$PATH_BLOCK_BEGIN" -v block_end="$PATH_BLOCK_END" '
            BEGIN { in_block = 0; pending = 0 }
            {
                if (in_block) {
                    if ($0 == block_end) { in_block = 0 }
                    next
                }
                if ($0 == block_begin) { in_block = 1; next }
                if (pending) {
                    pending = 0
                    if ($0 ~ /^export PATH=".*:\$PATH"$/) { next }
                    print "# limitai"
                }
                if ($0 == "# limitai") { pending = 1; next }
                print
            }
            END { if (pending) print "# limitai" }
        ' "$profile" > "$cleaned"

        if ! cmp -s "$profile" "$cleaned"; then
            mv "$cleaned" "$profile"
            CLEANED_PROFILES+=("$profile")
        else
            rm -f "$cleaned"
        fi
    }

    for p in "${ZDOTDIR:-$HOME}/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
        uninstall_clean_profile "$p"
    done

    echo ""
    if [ ${#CLEANED_PROFILES[@]} -gt 0 ]; then
        echo "  PATH entries removed from:"
        for p in "${CLEANED_PROFILES[@]}"; do
            echo "    - ${p}"
        done
        echo ""
        echo "  Open a new terminal for changes to take effect."
    else
        echo "  No PATH entries found in shell profiles."
    fi

    echo ""
    echo "limitai has been uninstalled."
    exit 0
fi

# --- Downloader detection ---

DOWNLOADER=""
if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
else
    echo "Error: curl or wget is required" >&2
    exit 1
fi

download() {
    local url="$1" output="$2"
    if [ "$DOWNLOADER" = "curl" ]; then
        if [ -n "$output" ]; then
            curl -fsSL -o "$output" "$url"
        else
            curl -fsSL "$url"
        fi
    else
        if [ -n "$output" ]; then
            wget -q -O "$output" "$url"
        else
            wget -q -O - "$url"
        fi
    fi
}

# --- Platform detection ---

case "$(uname -s)" in
    Darwin) os="macos" ;;
    Linux)  os="linux" ;;
    *)      echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
    x86_64|amd64)   arch="x64" ;;
    arm64|aarch64)   arch="arm64" ;;
    *)               echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

# Detect Rosetta 2 on macOS — prefer native arm64
if [ "$os" = "macos" ] && [ "$arch" = "x64" ]; then
    if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = "1" ]; then
        arch="arm64"
    fi
fi

ASSET_NAME="${BINARY_NAME}-${os}-${arch}"
echo "Detected platform: ${os}-${arch}"

# --- Resolve version ---

if [ -z "$VERSION" ]; then
    echo "Fetching latest version..."
    VERSION=$(download "https://api.github.com/repos/${REPO}/releases/latest" "" \
        | grep '"tag_name"' | head -1 | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    if [ -z "$VERSION" ]; then
        echo "Error: failed to determine latest version" >&2
        exit 1
    fi
fi

echo "Installing ${BINARY_NAME} ${VERSION}..."

# --- Download ---

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET_NAME}"
TMP_FILE=$(mktemp)
trap 'rm -f "$TMP_FILE"' EXIT

if ! download "$DOWNLOAD_URL" "$TMP_FILE"; then
    echo "Error: download failed — ${DOWNLOAD_URL}" >&2
    echo "Check available assets: https://github.com/${REPO}/releases/tag/${VERSION}" >&2
    exit 1
fi

chmod +x "$TMP_FILE"

# --- Install ---

mkdir -p "$INSTALL_DIR"
mv "$TMP_FILE" "${INSTALL_DIR}/${BINARY_NAME}"

# --- PATH injection ---

PATH_ENTRY="export PATH=\"${INSTALL_DIR}:\$PATH\""
PATH_BLOCK_BEGIN="# >>> limitai PATH >>>"
PATH_BLOCK_END="# <<< limitai PATH <<<"
SHELL_PROFILES=()
UPDATED_PROFILES=()

clean_limitai_path_entries() {
    local profile="$1"
    local output="$2"

    awk -v block_begin="$PATH_BLOCK_BEGIN" -v block_end="$PATH_BLOCK_END" '
        BEGIN {
            in_managed_block = 0
            pending_legacy_marker = 0
        }

        {
            if (in_managed_block) {
                if ($0 == block_end) {
                    in_managed_block = 0
                }
                next
            }

            if ($0 == block_begin) {
                in_managed_block = 1
                next
            }

            if (pending_legacy_marker) {
                pending_legacy_marker = 0
                if ($0 ~ /^export PATH=".*:\$PATH"$/) {
                    next
                }
                print "# limitai"
            }

            if ($0 == "# limitai") {
                pending_legacy_marker = 1
                next
            }

            print
        }

        END {
            if (pending_legacy_marker) {
                print "# limitai"
            }
        }
    ' "$profile" > "$output"
}

if [ -n "$ZSH_VERSION" ] || [ -f "${ZDOTDIR:-$HOME}/.zshrc" ]; then
    SHELL_PROFILES+=("${ZDOTDIR:-$HOME}/.zshrc")
fi
if [ -f "$HOME/.bashrc" ]; then
    SHELL_PROFILES+=("$HOME/.bashrc")
fi
if [ "$(uname -s)" = "Darwin" ] && [ -f "$HOME/.bash_profile" ]; then
    SHELL_PROFILES+=("$HOME/.bash_profile")
fi

if [ ${#SHELL_PROFILES[@]} -eq 0 ]; then
    touch "$HOME/.profile"
    SHELL_PROFILES+=("$HOME/.profile")
fi

for profile in "${SHELL_PROFILES[@]}"; do
    [ -f "$profile" ] || touch "$profile"

    original_file=$(mktemp)
    cleaned_file=$(mktemp)
    final_file=$(mktemp)

    cp "$profile" "$original_file"
    clean_limitai_path_entries "$profile" "$cleaned_file"

    if grep -qF "$PATH_ENTRY" "$cleaned_file"; then
        cp "$cleaned_file" "$final_file"
    else
        awk -v block_begin="$PATH_BLOCK_BEGIN" -v block_end="$PATH_BLOCK_END" -v path_entry="$PATH_ENTRY" '
            { print }
            END {
                if (NR > 0 && length($0) > 0) {
                    print ""
                }
                print block_begin
                print path_entry
                print block_end
            }
        ' "$cleaned_file" > "$final_file"
    fi

    if ! cmp -s "$original_file" "$final_file"; then
        mv "$final_file" "$profile"
        UPDATED_PROFILES+=("$profile")
    else
        rm -f "$final_file"
    fi

    rm -f "$original_file" "$cleaned_file"
done

# --- Done ---

echo ""
echo ""
echo "All done!"
echo ""
echo ""
echo "======================================================================================================"
echo ""
echo "  limitai ${VERSION} has been installed to:"
echo ""
echo "    ${INSTALL_DIR}/${BINARY_NAME}"
echo ""

if [ ${#UPDATED_PROFILES[@]} -gt 0 ]; then
    echo "  PATH updated in:"
    for p in "${UPDATED_PROFILES[@]}"; do
        echo "    - ${p}"
    done
    echo ""
    echo "  Open a new terminal, or run:"
    echo ""
    echo "    source ${UPDATED_PROFILES[0]}"
    echo ""
fi

echo "  Commands:"
echo ""
echo "    limitai status        Show current rate limits"
echo "    limitai list          Show discovered accounts"
echo "    limitai daily         Daily utilization history"
echo "    limitai doctor        Diagnose connection issues"
echo "    limitai --help        Show all commands"
echo ""
echo "======================================================================================================"
echo ""

LIMITAI_BIN="${INSTALL_DIR}/${BINARY_NAME}"

if [ ${#UPDATED_PROFILES[@]} -gt 0 ]; then
    export PATH="${INSTALL_DIR}:$PATH"
fi

printf "  Enable background recording? (polls rate limits, stores history) [y/N] "
read -r REPLY </dev/tty 2>/dev/null || REPLY=""

if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
    echo ""
    "$LIMITAI_BIN" install
else
    echo ""
    echo "  Skipped. You can enable it later with: limitai install"
fi

echo ""
