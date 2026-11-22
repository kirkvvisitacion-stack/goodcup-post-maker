# Good Cup Post Maker

Put words on photos for an Instagram carousel (1080x1350) and Story (1080x1920) in the Good Cup look, in the browser.

Live: https://kirkvvisitacion-stack.github.io/goodcup-post-maker/

- Everything runs in the visitor's browser. Photos and fonts never leave it; only the files they download do.
- The Good Sans font files are licensed, so they are not in this repository. Each person loads them once from the Good Cup NAS (or uses the copy installed on their computer); the page keeps them in that browser only.
- The preview and the downloaded PNGs come from the same drawing routine (`js/render.js`).

Files: `index.html` (page), `js/app.js` (page logic), `js/render.js` (drawing), `js/fonts.js` (font loading), `js/calm.js` (calm-spot check, a port of placement_check.py), `js/lint.js` (caption lint), `js/zip.js` (zip in and out), `assets/` (Good Cup lockup and cup mark).
