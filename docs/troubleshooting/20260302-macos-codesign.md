# macOS Code Signing for Bun Compiled Binaries

**Date**: 2026-03-02
**Scope**: Deployment

## Symptom

```
$ limitai
[1]    71058 killed     limitai
```

Binary exits immediately with signal 9 (SIGKILL) / exit code 137.

## Root Cause

macOS enforces code signature verification on Mach-O executables. `bun build --compile` produces an unsigned binary.

## Fix

Ad-hoc sign the binary after compilation:

```bash
# Build
bun build src/cli.ts --compile --outfile dist/limitai

# Sign (must be done on final destination or with -f to replace)
codesign -f -s - dist/limitai

# Deploy
cp dist/limitai ~/.local/bin/limitai
codesign -f -s - ~/.local/bin/limitai  # re-sign after copy if needed
```

## Important Notes

- `codesign -s -` = ad-hoc signature (no Apple Developer identity needed)
- `-f` flag = force replace existing signature
- `cp` may strip extended attributes; always re-sign at the final path
- This affects all `bun build --compile` outputs on macOS, not just limitai
- The LaunchAgent daemon also uses this binary, so restart after deploy:
  ```bash
  launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.limitai.watcher.plist
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.limitai.watcher.plist
  ```
