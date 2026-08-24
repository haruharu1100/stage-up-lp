/**
 * 健康診断。「今なにが本物で動いて、なにが足りないか」を日本語で出す。
 */
import fs from 'node:fs';
import path from 'node:path';

const FALLBACK_ENV_FILES = [
  '/Volumes/ORICO/保存用/hp用/hp-auto-system/gorogoro-growth/.env',
  '/Volumes/ORICO/保存用/hp用/hp-auto-system/lp-ai-orchestrator/.env',
  '/Volumes/ORICO/保存用/hp用/hp-auto-system/fanza-affiliate/.env',
  '/Volumes/ORICO/保存用/hp用/hp-auto-system/aura/.env',
  '/Volumes/ORICO/保存用/hp用/hp-auto-system/automation/.env',
];
const BORROWABLE = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'KEEPA_API_KEY', 'FAL_KEY'];

function loadEnvFile(file) {
  const out = {};
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const key = line.slice(0, line.indexOf('=')).trim();
    const value = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
    if (value) out[key] = value;
  }
  return out;
}

const local = loadEnvFile(path.join(process.cwd(), '.env'));
const borrowed = {};
for (const f of FALLBACK_ENV_FILES) {
  const e = loadEnvFile(f);
  for (const k of BORROWABLE) if (e[k] && !borrowed[k]) borrowed[k] = f;
}

function has(name) {
  if (process.env[name]) return 'この端末の環境変数';
  if (local[name]) return '.env';
  if (BORROWABLE.includes(name) && borrowed[name]) return `借用：${path.basename(path.dirname(borrowed[name]))}/.env`;
  return null;
}

const rows = [
  ['文章を書くAI（Claude）', 'ANTHROPIC_API_KEY', '無くてもOpenAIかサンプルで動く'],
  ['文章を書くAI（OpenAI）', 'OPENAI_API_KEY', '画像生成にも必要'],
  ['Amazon市場データ（Keepa）', 'KEEPA_API_KEY', '無い場合はCSVかサンプル'],
  ['紹介動画の生成（fal）', 'FAL_KEY', '無い場合は絵コンテまで'],
  ['Amazon出品：クライアントID', 'SPAPI_CLIENT_ID', '出品するなら必須'],
  ['Amazon出品：シークレット', 'SPAPI_CLIENT_SECRET', '出品するなら必須'],
  ['Amazon出品：リフレッシュトークン', 'SPAPI_REFRESH_TOKEN', '出品するなら必須'],
  ['Amazon出品：出品者ID', 'SPAPI_SELLER_ID', '出品するなら必須'],
];

console.log('=== Amazon AI Seller Factory 健康診断 ===\n');
for (const [label, key, note] of rows) {
  const where = has(key);
  console.log(`${where ? '[OK]  ' : '[未]  '}${label}  ${where ? `(${where})` : `— ${note}`}`);
}

const autoPublish = (process.env.AMAZON_AUTO_PUBLISH || local.AMAZON_AUTO_PUBLISH || 'false').toLowerCase();
console.log(
  `\n本番出品スイッチ：${autoPublish === 'true' ? 'ON（Amazonへ送信されます）' : 'OFF（送信しません／既定）'}`,
);

const dbPath = path.resolve(process.cwd(), (process.env.DATABASE_URL || 'file:./data/factory.db').replace(/^file:/, ''));
console.log(`データベース：${fs.existsSync(dbPath) ? `あり ${dbPath}` : 'まだありません（初回実行時に自動で作られます）'}`);

const csv = path.join(process.cwd(), 'data/candidates.csv');
console.log(`商品候補CSV：${fs.existsSync(csv) ? 'あり（こちらを優先して読みます）' : 'なし（サンプル商品で動きます）'}`);

// ---- ① リサーチツール ------------------------------------------------
console.log('\n--- ① リサーチツール（仕入候補を勝手に探す）---');

const supplierCsv = path.join(process.cwd(), 'data/supplier_listings.csv');
console.log(
  `仕入先CSV：${
    fs.existsSync(supplierCsv)
      ? 'あり（本データとして読み込みます）'
      : 'なし（サンプル仕入先で動きます／見本 samples/supplier_listings.csv を data/supplier_listings.csv に置くと即・本データ）'
  }`,
);

const supplierApis = [
  ['Alibaba.com', 'ALIBABA'],
  ['1688', 'ALI1688'],
  ['AliExpress', 'ALIEXPRESS'],
];
for (const [label, prefix] of supplierApis) {
  const ok = has(`${prefix}_APP_KEY`) && has(`${prefix}_APP_SECRET`) && has(`${prefix}_API_ENDPOINT`);
  console.log(`${ok ? '[OK]  ' : '[未]  '}仕入先API：${label}${ok ? '' : ' — 正式APIの鍵が3つ揃うと本データになります'}`);
}

console.log(
  `${has('KEEPA_API_KEY') ? '[OK]  ' : '[未]  '}Amazon照合（Keepa）${
    has('KEEPA_API_KEY') ? '' : ' — 無い間はサンプル市場（実在の商品ではありません）'
  }`,
);
console.log(
  `${has('OPENAI_API_KEY') ? '[OK]  ' : '[未]  '}画像の最終確認AI／意味の近さAI${
    has('OPENAI_API_KEY') ? '（判定が割れた候補だけに使います）' : ' — 無い場合は「分からない」と返し、推測で同一とは言いません'
  }`,
);

const notifyKey = has('LINE_NOTIFY_TOKEN') ? 'LINE' : has('SLACK_WEBHOOK_URL') ? 'Slack' : null;
console.log(`通知：${notifyKey ? `${notifyKey}へ送ります` : '画面に出すだけ（LINE/Slackの鍵を入れると外へ届きます）'}`);

const autoPurchase = (process.env.AUTO_PURCHASE || local.AUTO_PURCHASE || 'false').toLowerCase();
const autoApprove = (process.env.RESEARCH_AUTO_APPROVE || local.RESEARCH_AUTO_APPROVE || 'false').toLowerCase();
console.log(
  `自動発注：${autoPurchase === 'true' ? '★ON（危険。リサーチは実行を拒否します）' : 'OFF（既定。仕入れは必ず人が承認）'}`,
);
console.log(`AIによる自動承認：${autoApprove === 'true' ? '★ON（推奨しません）' : 'OFF（既定）'}`);
