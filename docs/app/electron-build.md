# Electron build: running the bot's TypeScript in the app

Why the Electron app is bundled, and how the bundle keeps the bot's TypeScript modules working.

## Outcome

**Electron runs the bot's TypeScript.** Electron 45.4.1 ships Node 24.22.3 with type stripping on (`process.features.typescript === 'strip'`). An unbundled Electron main process imported `src/config.ts` and `src/doctor.ts` directly with no error or warning.

**The app is still bundled, with plain esbuild.** `app/main/index.ts` and the `src/` modules it imports are compiled into one ESM file, `app/out/main/index.mjs`. npm packages (`electron`, `@slack/bolt`) stay external and load from `node_modules`. The daemon and CLI are not affected: `pnpm start` and every `pnpm <script>` still run `src/*.ts` directly with Node.

## Why bundle when Electron could run `.ts` directly

- **Packaging.** Node refuses to strip types for files under `node_modules`, and type stripping inside Electron's `asar` archive is untested. A packaged app (APP-17) should ship plain JavaScript rather than depend on either.
- **Electron version independence.** Type stripping became stable in Node 22.18/24 and is on in Electron 45. Bundling keeps the app working if a future Electron turns it off or changes it, and lets us upgrade Electron without testing that again.
- **The preload has to be one file.** A sandboxed preload (APP-9) can't import other modules, so it needs a bundler anyway. Using the same tool for main and preload keeps one build setup.
- **Cost is small.** One build script, about 9 ms per build, and the type check stays with `tsc`.

## Why esbuild and not electron-vite

- **One small dependency and a short script** (`app/build.ts`, run by Node itself). electron-vite adds Vite, its own config format and a fixed folder layout (`src/main`, `src/preload`, `src/renderer`) that doesn't match the spike's `app/main` + `src/` services.
- **The main process needs no dev server or hot reload.** Vite's value is in the renderer. APP-10 can use plain Vite for `app/renderer/` and keep esbuild for main and preload.
- **Easy to change later.** If APP-10 wants electron-vite after all, the only thing to carry over is the `import.meta.url` plugin below.

## Build setup

| Piece | What it does |
|---|---|
| `app/build.ts` | esbuild: `app/main/index.ts` → `app/out/main/index.mjs`, ESM, `platform: node`, `target: node24`, `packages: external`, linked source map |
| `app/tsconfig.json` | Extends the root config and checks `app/` together with `src/` |
| `package.json` `main` | `app/out/main/index.mjs`, so `electron .` starts the bundle |
| `pnpm app:build` | Builds the bundle. `app/out/` is git-ignored (`out/`) |
| `pnpm app:dev` | Builds, then opens an empty window and logs the proof results. Add `-- --smoke` to quit after logging |
| `pnpm check` | Now `tsc -p . && tsc -p app` |
| `pnpm.onlyBuiltDependencies` | Allows the `electron` and `esbuild` install scripts (pnpm 10 blocks them by default) |

## Things the bundle has to handle

- **`import.meta.url` per module.** In one bundle every module would see the bundle's URL. That breaks `codeRoot` in `src/config.ts` (it would point at `app/out/`, so `examples/` and `templates/` aren't found) and could set off the `import.meta.url === argv[1]` CLI guards in `doctor.ts`, `setup.ts` and others. A small esbuild plugin in `app/build.ts` rewrites `import.meta.url` in each `.ts` file to `new URL('<path from bundle to source>', import.meta.url).href`, so each module keeps its unbundled meaning. In the packaged app (APP-17), `codeRoot` will point inside the app bundle, so `templates/` and `examples/` must be shipped next to it at the same relative path.
- **ESM output.** `src/` uses top-level `await` (for example in the `doctor.ts` CLI guard), so the bundle must be ESM. Electron 45 loads an ESM main process.
- **Never `await app.whenReady()` at top level.** Electron emits `ready` only after the ESM entry module finishes evaluating, so a top-level await of it hangs with no output. Use `app.whenReady().then(...)`.

## Notes for later tickets

- **`process.execPath` is the Electron binary in the app.** `deploy.ts` uses it in `servicePlist` and `prepareRelease` to write the launchd plist and the `*.sh` helpers. Calling those from the app as they are would make launchd run the daemon with Electron. Before the app prepares or activates a release (APP-18/APP-19), pass the Node path explicitly (`servicePlist` already takes a `node` option; `prepareRelease` needs one added). The read-only `launchd` driver calls (`loaded`, `stop`, `start`, `ready`) don't use it and are safe.
- **`diagnose()`'s Node check reports Electron's Node** when called from the app, not the Node the daemon runs on. The Diagnostics screen (APP-22) passes `diagnose()` a `nodeBinary` from `findNode` (the release's `node` field, then `PATH`), so its Node check runs the bot's real Node; Electron's own versions show on a separate, labelled line.
- The proof window uses `contextIsolation`, `sandbox` and no `nodeIntegration`. APP-9 keeps those and adds the preload.

## How it was verified

On macOS with Electron 45.4.1:

1. Unbundled: a throwaway Electron main imported `src/config.ts` and `src/doctor.ts` and got their exports, without errors.
2. `pnpm app:build` produced `app/out/main/index.mjs` (26 KB).
3. `electron . --smoke` opened the window and logged: the runtime (Electron 45.4.1, Node 24.22.3, `codeRoot` = repo root), `validateProfile(examples/profile.json)`, `diagnose(config, { offline: true })` on a temporary copy of the example profile with fixture tokens, and `launchd.loaded()` for the example label (`false`). The example profile's placeholder paths fail the git and knowledge checks, as expected. No type-stripping error, exit code 0.
4. `pnpm check` (root and `app/`) and `pnpm test` (140 tests) pass. `pnpm start` still runs `src/index.ts` with Node, unbundled.

## Renderer (APP-10)

- **Plain Vite for `app/renderer/`**, as planned above: React, Tailwind (`@tailwindcss/vite`) and react-router, built to `app/out/renderer/` with relative asset URLs so main loads it from a `file:` URL. JSX goes through Vite's own Oxc transform, so there is no `@vitejs/plugin-react` (and no Fast Refresh; a save reloads the page).
- `pnpm app:build` runs esbuild for main and preload, then `vite build`. `pnpm app:renderer` serves the renderer with reload; start Electron with `SERRA_RENDERER_URL=http://localhost:5173` to use it.
- The renderer is type-checked on its own (`tsc -p app/renderer`, DOM and JSX), and `app/tsconfig.json` leaves it out. Renderer logic that tests cover lives in `*.logic.ts` and `routes.ts`, which import types only, so `node --test` can load them.
- React, the router and lucide are dev dependencies: Vite bundles them, so the packaged app doesn't need them in `node_modules`.
- `electron . --smoke` also checks that the renderer mounted, the header reads "Serra · stopped", and every sidebar item opens its own screen.

## Packaging (APP-17)

- **electron-builder** with [`electron-builder.yml`](../../electron-builder.yml), run by `pnpm app:package`, makes `release/Serra-<version>-arm64.dmg`. `release/` is git-ignored. Install steps are in [install.md](install.md).
- **No asar archive.** `codeRoot` resolves to `Contents/Resources/app/`, and `src/setup.ts` copies `templates/knowledge` with `cpSync`, which asar doesn't support. The app folder is about 17 MB, mostly `@slack/bolt`.
- **Files shipped next to the bundle**: `templates/`, `examples/` and the menubar icons in `assets/brand/`, at the same relative paths as in the checkout. `app/main/runtime-files.ts` lists them; a test checks the builder config covers them and `--smoke` checks the built app has them.
- **The daemon's code ships beside the app folder**, in `Contents/Resources/release-source/` (`extraResources`), staged by `pnpm app:build` in `app/out/release-source/`. Prepare copies a release from it (`releaseSourceRoot` in `src/deploy.ts`) and installs its dependencies with the pnpm or Corepack next to the Node it found, run from the release so Corepack reads the pinned pnpm version.
- **Ad-hoc signature only** (`identity: "-"`): no certificate, but a sealed bundle, so Gatekeeper offers Open Anyway instead of calling a downloaded copy damaged.
- **Arguments start at `argv[1]` in the packaged app**, not `argv[2]` as with `electron .`, so `--profile` is read from the right place in each.
- **Opened from Finder there is no `--profile` or `BOT_PROFILE`**: the app remembers the profile it started with and otherwise uses the only one under `~/.local/share/serra/` (`app/main/profile-location.ts`).
- **Finder gives a short `PATH`**; the packaged app adds the Homebrew folders and `~/.local/bin` (`app/main/tool-path.ts`).
