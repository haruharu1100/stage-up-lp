// Keepa APIキーが設定に保存されているかだけを確認する（値は絶対に表示しない）。
import { getSetting } from "../lib/db.js";
const v = (await getSetting("keepa_key")) || "";
const s = String(v).trim();
console.log(s.length > 0 ? `PRESENT (length=${s.length})` : "MISSING");
process.exit(0);
