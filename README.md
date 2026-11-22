# Serra eval results

Raw results of the knowledge evals (see evals/README.md on main), moved out of main's working tree in SERRA-60.
They stay in main's history before that change; this branch is where new results go. Copied from main at 9ffafb0.
On main, `pnpm evals:fetch` extracts this folder into evals/results/ (git-ignored), and `node evals/summarize.ts`
rebuilds evals/RESULTS.md from it. Add new results with a commit here.
