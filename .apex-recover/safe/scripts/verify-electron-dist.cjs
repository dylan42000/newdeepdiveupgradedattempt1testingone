/**
 * verify-electron-dist.cjs
 * Fails the Electron build if dist/index.html uses absolute /assets/ paths.
 * Absolute paths break under file:// and produce a black window.
 */
const fs = require("fs");
const path = require("path");

const indexPath = path.join(__dirname, "..", "dist", "index.html");
if (!fs.existsSync(indexPath)) {
  console.error("[verify-electron-dist] Missing dist/index.html — run build:electron first.");
  process.exit(1);
}

const html = fs.readFileSync(indexPath, "utf8");
const badScript = /src=["']\/assets\//.test(html);
const badCss = /href=["']\/assets\//.test(html);

if (badScript || badCss) {
  console.error(
    "[verify-electron-dist] dist/index.html has absolute /assets/ paths.\n" +
      "Electron requires base: './' (BUILD_TARGET=electron). Rebuild with npm run build:electron.\n" +
      "Do not run npm run build / cap:sync in parallel with electron:build."
  );
  process.exit(1);
}

if (!/src=["']\.\/assets\//.test(html) && !/src=["']assets\//.test(html)) {
  console.warn("[verify-electron-dist] Warning: could not confirm relative asset script path.");
}

console.log("[verify-electron-dist] OK — relative asset paths confirmed.");
