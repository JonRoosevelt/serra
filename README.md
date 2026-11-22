# PR assets

How the README hero images (SERRA-56) were made. Not part of the app.

- `stage.html`, `stage2.html`: a Slack-style thread mock (demo workspace "Acme") with the real Serra renderer in an iframe.
- `mock.js`: a demo `window.serra` bridge, so the real Jobs screen renders with placeholder jobs.
- `record.mjs`: 12s of frames at 10 fps; `stills.mjs`: the Slack and Jobs screenshots; `frame.mjs`: rounded window frame; `social.mjs`: the 1280×640 social preview.

Run `pnpm app:renderer` in the repo, copy `assets/brand/serra-icon.png` and `serra-lockup.png` next to these files, set `CHROME` to a Chromium binary, then e.g. `node record.mjs frames` and
`ffmpeg -framerate 10 -i frames/f%04d.png -vf "scale=1600:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" -loop 0 demo.gif`.
The scripts import playwright-core from the QA driver's install (`scripts/qa/setup.sh`).
