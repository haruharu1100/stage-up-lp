// Render の Cron Job から呼ばれ、Web本体の巡回APIを1回叩いて終了する。
// （Web本体が永続ディスク＝DBを持つため、HTTP経由で巡回を依頼する構成）
const host = process.env.CRAWL_URL;
if (!host) {
  console.error("CRAWL_URL が未設定です。");
  process.exit(1);
}
const base = host.startsWith("http") ? host : `https://${host}`;

try {
  const res = await fetch(`${base}/api/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const text = await res.text();
  console.log(`[crawl-once] HTTP ${res.status}: ${text}`);
  process.exit(res.ok ? 0 : 1);
} catch (e) {
  console.error("[crawl-once] 失敗:", e.message || String(e));
  process.exit(1);
}
