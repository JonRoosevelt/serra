#!/bin/sh
# Prepares /tmp/serra-qa for the QA driver: playwright-core, the fake t3, and a clone of this repository as the
# bot's project. Touches nothing outside /tmp/serra-qa. Run from anywhere.
set -eu
QA=/tmp/serra-qa
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
mkdir -p "$QA/bin" "$QA/shots" "$QA/pw"
[ -d "$QA/pw/node_modules/playwright-core" ] || (cd "$QA/pw" && npm init -y >/dev/null && npm i --silent playwright-core@1.56.1)
cp "$HERE/fake-t3.cjs" "$QA/bin/t3" && chmod +x "$QA/bin/t3"
if [ ! -d "$QA/project" ]; then
  git clone -q "$REPO" "$QA/project"
  git -C "$QA/project" remote set-url origin "$(git -C "$REPO" remote get-url origin)"
  git -C "$QA/project" fetch -q origin && git -C "$QA/project" remote set-head origin -a >/dev/null
fi
echo "QA folder ready: $QA"
