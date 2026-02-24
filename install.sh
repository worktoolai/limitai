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
    CLEANED_PROFILES=()
    for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
        [ -f "$rc" ] || continue
        if grep -qF "$INSTALL_DIR" "$rc"; then
            sed -i.bak "\\|${INSTALL_DIR}|d" "$rc"
            rm -f "${rc}.bak"
            CLEANED_PROFILES+=("$rc")
        fi
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

# --- Clean up legacy install path ---

LEGACY_BIN="$HOME/.worktoolai/bin/${BINARY_NAME}"
if [ -f "$LEGACY_BIN" ]; then
    rm -f "$LEGACY_BIN"
    echo "Removed legacy binary: ${LEGACY_BIN}"
fi

# --- Install ---

mkdir -p "$INSTALL_DIR"
mv "$TMP_FILE" "${INSTALL_DIR}/${BINARY_NAME}"

# --- PATH injection ---

PATH_LINE="export PATH=\"${INSTALL_DIR}:\$PATH\""
UPDATED_PROFILES=()

case ":$PATH:" in
    *":${INSTALL_DIR}:"*)
        ;;
    *)
        for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
            if [ -f "$rc" ]; then
                if ! grep -qF "$INSTALL_DIR" "$rc"; then
                    echo "" >> "$rc"
                    echo "$PATH_LINE" >> "$rc"
                    UPDATED_PROFILES+=("$rc")
                fi
            fi
        done
        ;;
esac

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

DAEMON_INSTALLED=false
if [ "$(uname -s)" = "Darwin" ] && [ -f "$HOME/Library/LaunchAgents/com.limitai.watcher.plist" ]; then
    DAEMON_INSTALLED=true
elif [ "$(uname -s)" = "Linux" ] && [ -f "$HOME/.config/systemd/user/limitai.service" ]; then
    DAEMON_INSTALLED=true
fi

if [ "$DAEMON_INSTALLED" = true ]; then
    echo "  Background daemon detected — reinstalling to pick up new binary..."
    echo ""
    "$LIMITAI_BIN" install
else
    printf "  Enable background recording? (polls rate limits, stores history) [y/N] "
    read -r REPLY </dev/tty 2>/dev/null || REPLY=""

    if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
        echo ""
        "$LIMITAI_BIN" install
    else
        echo ""
        echo "  Skipped. You can enable it later with: limitai install"
    fi
fi

echo ""
