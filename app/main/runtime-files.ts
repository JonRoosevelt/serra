// Files the app reads from disk at run time, relative to `codeRoot` (the folder holding package.json). In the
// checkout that is the repo; in the packaged app (APP-17) it is `Serra.app/Contents/Resources/app`, so
// electron-builder.yml must copy each of these in. `--smoke` fails when one is missing.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const runtimeFiles: readonly string[] = [
  // The bundle, its sandboxed preload and the built renderer.
  'package.json',
  'app/out/main/index.mjs',
  'app/out/preload.cjs',
  'app/out/renderer/index.html',
  // Menubar icons (APP-11), loaded from assets/brand next to app/.
  'assets/brand/serra-status-up.png',
  'assets/brand/serra-status-needs-you.png',
  'assets/brand/serra-status-down.png',
  // Read through `codeRoot` by src/setup.ts and the profile checks.
  'templates/brief.md',
  'templates/manifest.json',
  'templates/knowledge',
  // The knowledge interview's brief (APP-26), read by src/tasks.ts.
  'templates/interview.md',
  'examples/profile.json',
];

/** The runtime files missing under `root`, as relative paths. */
export const missingRuntimeFiles = (root: string): string[] => runtimeFiles.filter((path) => !existsSync(join(root, path)));
