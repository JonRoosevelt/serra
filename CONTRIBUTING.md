# Contributing to Serra

Thanks for trying Serra. It is an alpha, so bug reports from real installs are the most useful thing you can send.

## Reporting a problem

Open an issue with the **Bug report** template. Include the output of `pnpm run doctor --profile …` and the relevant lines of `logs/bot.log`. Before pasting, remove tokens, Slack IDs, names, repository paths and anything from your knowledge pages you don't want public. Never paste the contents of `.env` or `secrets.json`.

Security problems go to [SECURITY.md](SECURITY.md), not to a public issue.

## Development setup

You need the [requirements](README.md#requirements) from the README, except that tests don't need Slack, T3 Code or a GitHub login.

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm check   # TypeScript for the daemon, the app main process and the renderer
pnpm test    # node --test tests/*.test.ts
```

To try a change against a real bot, use a separate Slack app and profile from the one you rely on, run it in the foreground with `pnpm start --profile …`, and keep your service on its prepared release.

## Layout

| Path | What |
|---|---|
| `src/` | The daemon and CLI (`index.ts` starts the bot, `manage.ts` is `pnpm bot`, `setup.ts`, `doctor.ts`) |
| `app/` | The Electron app: `main/` (bridge to `src/`), `preload.ts`, `renderer/` (React) |
| `templates/` | What a new profile is seeded with: brief, interview, starter knowledge, Slack manifest |
| `tests/` | `node --test` suites; they use temporary profiles, a fake `t3` and a simulated launchd driver |
| `scripts/qa/` | Optional Playwright driver for the app, against a throwaway profile in `/tmp/serra-qa` |
| `docs/` | Configuration, knowledge interview and app notes |

## Pull requests

- Keep each PR to one change, with tests for new behaviour. `pnpm check` and `pnpm test` must pass.
- Node runs the TypeScript directly with type stripping, so use only erasable syntax (no enums, namespaces or parameter properties) and include the `.ts` extension in imports.
- Never commit real tokens, Slack IDs, names, local paths or screenshots of a real workspace. Use the placeholders already in the tests (`U0123456789`, `xoxb-1111-2222-fixturevalue`, `/Users/you/…`, `acme/project`).
- Templates under `templates/` must stay generic: no one's personal knowledge or workflow.
- Update the README or `docs/` when behaviour a user sees changes, and add a line to `CHANGELOG.md`.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
