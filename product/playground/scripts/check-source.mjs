import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const requiredFiles = ["src/index.html", "src/app.js", "src/styles.css"];
for (const file of requiredFiles) {
  if (!existsSync(path.join(root, file))) {
    console.error(`Missing ${file}`);
    process.exit(1);
  }
}

const syntax = spawnSync(process.execPath, ["--check", "src/app.js"], {
  cwd: root,
  encoding: "utf8",
});
if (syntax.status !== 0) {
  process.stderr.write(syntax.stderr);
  process.exit(syntax.status ?? 1);
}
