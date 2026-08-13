// 指定した env ファイルを読み込んで Next.js を起動する号機ランチャー。
// 使い方: node scripts/run-instance.mjs .env.sneaker 3003 [dev|start]
import fs from "fs";
import { spawn } from "child_process";

const envFile = process.argv[2] || ".env";
const port = process.argv[3] || "3000";
const mode = process.argv[4] || "dev";

for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
process.env.PORT = port;

const child = spawn("npx", ["next", mode, "-p", port], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
