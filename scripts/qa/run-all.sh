#!/bin/sh
# Runs every scripted QA case against the built app (corepack pnpm app:build first) with a fresh throwaway profile.
# Output goes to /tmp/serra-qa/logs, screenshots to /tmp/serra-qa/shots. Needs setup.sh once.
# 03 stores two fake tokens in the login Keychain (service dev.serra.qa-bot); cleanup.sh removes them.
set -u
QA=/tmp/serra-qa
HERE=$(cd "$(dirname "$0")" && pwd)
rm -rf "$QA/profile" "$QA/ud" "$QA/ud-wizard" "$QA/ud-pkg" "$QA/logs" "$QA/t3-calls.jsonl"
mkdir -p "$QA/logs"
step() {
  name=$1
  if node "$HERE/$name.mjs" > "$QA/logs/$name.log" 2>&1; then echo "ran     $name"; else echo "ERROR   $name (see $QA/logs/$name.log)"; fi
}
for name in 01-first-run 02-wizard-profile 03-wizard-tokens 04-secrets-check 05-wizard-owner-install; do step "$name"; done
node "$HERE/seed.mjs" "$QA/profile" >/dev/null
for name in 10-tour 11-jobs 12-jobs-actions-proposals; do step "$name"; done
node "$HERE/seed.mjs" "$QA/profile" >/dev/null
for name in 13-proposal-replaces-target 14-pages-brief 15-settings 16-live-status-tray-notifications 17-new-task-interview-palette \
  18-palette-screen-actions 19-updates-diagnostics 20-copy-report 21-prepare-via-corepack 22-narrow-layout 23-dark 24-extras; do step "$name"; done
if [ -x "$HERE/../../release/mac-arm64/Serra.app/Contents/MacOS/Serra" ]; then
  QA_EXE="$HERE/../../release/mac-arm64/Serra.app/Contents/MacOS/Serra" step 30-packaged
else echo "skipped 30-packaged (run pnpm app:package first)"; fi
