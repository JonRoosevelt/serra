# Teach your bot how you work

The knowledge interview is part of onboarding, after technical setup. A T3 thread asks you about your role, work, decisions, tools and limits, one question at a time, and writes what you confirm as knowledge proposals for you to review. It requires no personal skill installation.

## Start it

- **In the app:** open Knowledge, then Proposals, and click **Start interview**. The dialog shows the brief the thread gets. **Start in T3** starts the thread and offers a link to it.
- **From the CLI:** `pnpm bot interview --profile /absolute/profile/folder` starts the same thread. Add `--preview` to print the brief instead.
- **By hand:** `pnpm onboard --profile /absolute/profile/folder` prints the brief to paste into a new T3 thread in your project.

The app and `pnpm bot interview` start the thread like a task (`pnpm bot task`): in a fresh worktree of the profile's project, with the profile's worker, recorded in the profile's tasks.json so it shows in Jobs. The interview reads the project but changes nothing in it.

## What it writes

At the end of each topic the interview shows a summary and asks you to confirm or correct it. Each confirmed summary becomes one proposal, `knowledge/proposals/YYYY-MM-DD-<page>.md`, with `verified: no` and a `target:` header naming the page it should become, such as `owner/role.md`.

The app watches `knowledge/proposals/`, so a proposal appears in the Proposals queue as soon as it is written, without a restart. There you promote it (the folder from its `target:` is suggested, and created if it doesn't exist yet), merge it into an existing page, or discard it. When `target:` names a page that already exists, the proposal is that page as it should now read, so promoting it into that folder replaces the page; Undo puts the old one back. Promoting sets `verified` to that day and adds the page to the index. `pnpm bot proposals` does the same from the CLI. The interview itself never writes indexed pages, index.md or log.md.

You can pause or skip any topic. Progress is kept in `knowledge/proposals/onboarding-progress.md`, which is never listed as a proposal. Starting the interview again carries on from it instead of starting over.

## The instructions

The brief is `templates/interview.md`, filled with the profile's bot and owner names, profile and knowledge folders, project and today's date. It ships with the app. Change the interview there.

## Keep learning

Later owner corrections can become proposals with their source links. A normal bot worker writes `verified: no` and asks the owner to review. Only the owner, in the app's Proposals queue, with `pnpm bot proposals`, or in an explicitly requested knowledge-maintenance session, promotes proposals to indexed, verified knowledge. Messages from teammates cannot grant owner authority.
