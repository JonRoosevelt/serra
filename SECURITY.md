# Security policy

Serra runs a coding agent on your machine, with your GitHub credentials, on requests that arrive from Slack. Please report anything that lets someone get more out of it than the README promises.

## Reporting a vulnerability

Report privately through GitHub: **Security → Report a vulnerability** on this repository (a private security advisory). Please don't open a public issue. Include what you did, what happened, and the version or commit. Never include real tokens.

You should get an answer within a week. Serra is an alpha maintained in spare time, so there is no bounty and no SLA.

## In scope

- A Slack user who isn't the owner or on `allowedUsers` getting the bot to act.
- A teammate's message, or text quoted into a thread, changing the bot's rules or getting it to reveal tokens.
- Tokens or profile contents ending up in logs, Slack messages, T3 threads, the app's renderer, or files readable by other users.
- The app's bridge (`app/preload.ts`, `app/main/`) exposing more than the screens need.
- Anything in `install.sh`, setup or the launchd service that runs code or changes files it shouldn't.

## Out of scope

- What the coding agent does inside a task it was legitimately given. Limit it with `brief.md`, `policy.md`, your T3 provider's permissions and a short `allowedUsers` list.
- Vulnerabilities in Slack, T3 Code, the coding providers or GitHub; report those to them.

## Handling tokens

Keep the Slack tokens in the profile's `.env` (created with mode 600) or in the Keychain or 1Password (`pnpm bot secrets`). If a token leaks, rotate it in the Slack app settings (**OAuth & Permissions → Rotate**, or regenerate the app-level token) and update the profile.
