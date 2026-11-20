#!/bin/sh
# Removes what the QA run made: the two fake Keychain items and /tmp/serra-qa. Nothing else.
for account in SLACK_BOT_TOKEN SLACK_APP_TOKEN; do
  security delete-generic-password -s dev.serra.qa-bot -a "$account" >/dev/null 2>&1 && echo "removed Keychain item dev.serra.qa-bot / $account"
done
rm -rf /tmp/serra-qa && echo "removed /tmp/serra-qa"
