#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_ROOT}"
}
trap cleanup EXIT

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

assert_file_contains() {
  local file_path="$1"
  local expected="$2"
  local content
  content="$(<"${file_path}")"
  [[ "${content}" == *"${expected}"* ]] || fail "Expected '${expected}' in ${file_path}"
}

assert_log_contains() {
  local expected="$1"
  local content
  content="$(<"${LIMITAI_SYSTEMCTL_LOG}")"
  [[ "${content}" == *"${expected}"* ]] || fail "Expected '${expected}' in systemctl log"
}

setup_fake_systemctl() {
  local fake_bin="${TMP_ROOT}/fake-bin"
  mkdir -p "${fake_bin}"

  cat > "${fake_bin}/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "${LIMITAI_SYSTEMCTL_LOG:?LIMITAI_SYSTEMCTL_LOG is required}"

if [[ -n "${LIMITAI_SYSTEMCTL_FAIL_PATTERN:-}" ]] && [[ "$*" == *"${LIMITAI_SYSTEMCTL_FAIL_PATTERN}"* ]]; then
  echo "simulated systemctl failure for: $*" >&2
  exit 17
fi
EOF

  chmod +x "${fake_bin}/systemctl"
  export PATH="${fake_bin}:${PATH}"
}

run_success_case() {
  echo "[INFO] Running Linux install/uninstall success case"

  export HOME="${TMP_ROOT}/home-success"
  export LIMITAI_SYSTEMCTL_LOG="${TMP_ROOT}/systemctl-success.log"
  unset LIMITAI_SYSTEMCTL_FAIL_PATTERN || true
  mkdir -p "${HOME}"
  : > "${LIMITAI_SYSTEMCTL_LOG}"

  bun run src/cli.ts install

  local service_path="${HOME}/.config/systemd/user/limitai.service"
  local timer_path="${HOME}/.config/systemd/user/limitai.timer"

  [[ -f "${service_path}" ]] || fail "Service file not created: ${service_path}"
  [[ ! -f "${timer_path}" ]] || fail "Legacy timer file should not exist: ${timer_path}"

  assert_file_contains "${service_path}" "watch --daemon"
  assert_log_contains "--user daemon-reload"
  assert_log_contains "--user enable --now limitai.service"

  bun run src/cli.ts uninstall

  [[ ! -f "${service_path}" ]] || fail "Service file should be removed by uninstall"
  assert_log_contains "--user disable --now limitai.service"

  echo "[PASS] Success case passed"
}

run_failure_case() {
  echo "[INFO] Running Linux install failure propagation case"

  export HOME="${TMP_ROOT}/home-failure"
  export LIMITAI_SYSTEMCTL_LOG="${TMP_ROOT}/systemctl-failure.log"
  export LIMITAI_SYSTEMCTL_FAIL_PATTERN="enable --now limitai.service"
  mkdir -p "${HOME}"
  : > "${LIMITAI_SYSTEMCTL_LOG}"

  set +e
  local output
  output="$(bun run src/cli.ts install 2>&1)"
  local status=$?
  set -e

  [[ ${status} -ne 0 ]] || fail "Install should fail when systemctl enable fails"
  [[ "${output}" == *"Install failed:"* ]] || fail "Install failure message was not reported"

  local service_path="${HOME}/.config/systemd/user/limitai.service"
  [[ -f "${service_path}" ]] || fail "Service file should still be generated before enable failure"

  unset LIMITAI_SYSTEMCTL_FAIL_PATTERN
  bun run src/cli.ts uninstall >/dev/null 2>&1 || true

  echo "[PASS] Failure case passed"
}

cd "${REPO_ROOT}"
setup_fake_systemctl
run_success_case
run_failure_case

echo "[PASS] Linux systemd smoke tests completed"
