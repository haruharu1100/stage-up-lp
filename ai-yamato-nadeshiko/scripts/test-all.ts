import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

// scripts/test-*.ts を全部走らせる。テストを増やしたらここへ足す作業は要らない
const here = import.meta.dirname;
const files = readdirSync(here)
  .filter((f) => f.startsWith("test-") && f.endsWith(".ts") && f !== "test-all.ts")
  .sort();

if (files.length === 0) {
  console.error("テストが1本もありません。");
  process.exit(1);
}

const failed: string[] = [];

for (const f of files) {
  console.log(`\n${"=".repeat(60)}\n▶ ${f}\n${"=".repeat(60)}`);
  const r = spawnSync("npx", ["tsx", resolve(here, f)], {
    stdio: "inherit",
    cwd: resolve(here, ".."),
  });
  if (r.status !== 0) failed.push(f);
}

console.log(`\n${"=".repeat(60)}`);
if (failed.length === 0) {
  console.log(`✅ ${files.length}本すべて合格`);
} else {
  console.log(`❌ ${failed.length}/${files.length}本が不合格: ${failed.join(", ")}`);
  process.exit(1);
}
