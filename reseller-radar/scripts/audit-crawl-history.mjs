import { all, get } from "../lib/db.js";
async function safe(fn){ try { return await fn(); } catch(e){ return {__err:e.message}; } }

// 1) findings 総数と日別件数
const total = await safe(()=>get("SELECT COUNT(*) c FROM findings"));
console.log("findings 総数:", total && total.c);
const byday = await safe(()=>all("SELECT substr(found_at,1,10) d, COUNT(*) c FROM findings GROUP BY d ORDER BY d DESC LIMIT 30"));
console.log("=== findings 日別 (直近30日分) ===");
if (Array.isArray(byday)) for (const r of byday) console.log(`${r.d}  ${r.c}件`);
else console.log(byday);

// 2) crawl_jobs 履歴（いつ・どれだけ動いたか）
const jobs = await safe(()=>all("SELECT substr(created_at,1,10) d, COUNT(*) c, SUM(extracted) ex, SUM(matched) ma, status FROM crawl_jobs GROUP BY d, status ORDER BY d DESC LIMIT 30"));
console.log("=== crawl_jobs 日別 ===");
if (Array.isArray(jobs)) for (const r of jobs) console.log(`${r.d}  回数${r.c} 抽出${r.ex} 照合${r.ma} status=${r.status}`);
else console.log(jobs);

// 3) tasks の last_run 一覧
const tasks = await safe(()=>all("SELECT id, name, last_run FROM tasks WHERE enabled=1 ORDER BY last_run DESC"));
console.log("=== tasks last_run ===");
if (Array.isArray(tasks)) for (const t of tasks) console.log(`#${t.id} ${t.name}  last_run=${t.last_run}`);
process.exit(0);
