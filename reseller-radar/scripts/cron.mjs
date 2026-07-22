import cron from "node-cron";
import { getSetting } from "../lib/db.js";
import { runAllTasks } from "../lib/crawler.js";

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

const hour = parseInt(getSetting("cron_hour") || "8", 10);
const expr = `0 ${hour} * * *`;

log(`Reseller Radar cron 起動。毎日 ${hour} 時に全タスクを巡回します（${expr}）。`);

cron.schedule(
  expr,
  async () => {
    log("自動巡回を開始します…");
    try {
      const summary = await runAllTasks();
      log("巡回完了:", JSON.stringify(summary));
    } catch (e) {
      log("巡回エラー:", e.message || String(e));
    }
  },
  { timezone: "Asia/Tokyo" }
);

// プロセスを常駐させる
process.stdin.resume();
