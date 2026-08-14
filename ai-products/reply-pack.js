'use strict';

// ============================================================================
// AI返信パック  ─ 3機能を1本にまとめた本体（BtoB商品 /ai-reply-pack の中身）
//
// 何をする: 「口コミ」「問い合わせメール」「クレーム一次対応」の返信文を、
//           そのまま貼れる下書きとしてトーン別に生成する。
//           飲食・美容・整体・クリニック・工務店向け。
//
// 安全設計(景表法/医療広告セーフ):
//   - 「必ず」「絶対」「日本一」「完治」等の断定・誇大・優良誤認はシステム指示で禁止＋出力後にNG語で二重チェック。
//   - 効果・効能の断定や来店確約はしない。丁寧・簡潔・具体的に。最後は人が確認して送信する前提。
//
// 使い方:
//   node reply-pack.js                                   (口コミのデモ)
//   node reply-pack.js --type=review   --stars=2 --shop="美容室Bloom" --text="..."
//   node reply-pack.js --type=inquiry  --shop="工務店ABC" --text="外壁塗装の見積もりが欲しい"
//   node reply-pack.js --type=complaint --shop="整体ここち" --text="予約時間より30分待たされた"
// ============================================================================

const fs = require('fs');
const path = require('path');

// ── APIキーは既存プロジェクトの .env から拝借（値はコードに書かない）
function envVal(file, key) {
  try {
    for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
      const i = l.indexOf('=');
      if (i > 0 && l.slice(0, i).trim() === key) return l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return null;
}
const ROOT = path.join(__dirname, '..');
const API_KEY = process.env.ANTHROPIC_API_KEY
  || envVal(path.join(ROOT, 'gorogoro-growth', '.env'), 'ANTHROPIC_API_KEY')
  || envVal(path.join(ROOT, 'automation', '.env'), 'ANTHROPIC_API_KEY');
const MODEL = 'claude-sonnet-4-6';

function argv(key, def) {
  const p = process.argv.find((a) => a.startsWith(`--${key}=`));
  return p ? p.slice(key.length + 3) : def;
}

// 出力の最終ガード（AIが万一やらかしても事業者を守る）
const NG = ['必ず', '絶対', '日本一', '完治', '治ります', '100%', 'No.1', 'ナンバーワン', '最高峰', '確実に', '確実'];
function ngCheck(text) { return NG.filter((w) => text.includes(w)); }

// 共通の制約（全機能で厳守）
const COMMON_RULES = [
  '制約(厳守):',
  '- 景表法・医療広告ガイドラインに反する表現は禁止。「必ず」「絶対」「日本一」「完治」「100%」「確実」等の断定・誇大・優良誤認は使わない。',
  '- 効果・効能や結果を保証しない。医療・施術・美容は断定を避ける。来店や契約を強要しない。',
  '- 誠実・丁寧・簡潔に。日本語のみ。前置き・解説は書かず、返信本文だけを返す。',
].join('\n');

// 機能別の設定
const TYPES = {
  review: {
    label: 'Google口コミ返信',
    system: [
      'あなたは日本の実店舗オーナー向けに、Googleクチコミへの返信文を作るプロです。',
      COMMON_RULES,
      '- 低評価には言い訳せずまず謝意と改善姿勢を示す。高評価には具体的に感謝する。',
      '- 各案は120〜180字程度。絵文字は控えめ(0〜1個)。',
      '出力形式: 【丁寧】【親しみ】【簡潔】の3案を、それぞれ本文のみで返す。',
    ].join('\n'),
    user: ({ shop, stars, text }) => `店名: ${shop}\n評価: ★${stars}\n口コミ本文: ${text}\n\n上記への返信案を3トーンで作ってください。`,
  },
  inquiry: {
    label: '問い合わせメール返信',
    system: [
      'あなたは日本の実店舗・工務店向けに、問い合わせメールへの返信文を作るプロです。',
      COMMON_RULES,
      '- 相手の要望の要点をくみ取り、次の一歩(見積・来店・現地調査・予約)へ自然につなぐ。ただし強要しない。',
      '- 料金は通常価格の考え方で扱い、根拠のない割引や二重価格・煽りは書かない。不明点は「確認のうえご案内します」と誠実に。',
      '- 各案はメール本文として自然な長さ(150〜250字程度)。',
      '出力形式: 【丁寧】【親しみ】【簡潔】の3案を、それぞれ本文のみで返す。',
    ].join('\n'),
    user: ({ shop, text }) => `店名/会社名: ${shop}\n受け取った問い合わせ: ${text}\n\n上記への返信案を3トーンで作ってください。`,
  },
  complaint: {
    label: 'クレーム一次対応',
    system: [
      'あなたは日本の実店舗向けに、クレームへの「一次対応(最初の返答)」の文面を作るプロです。',
      COMMON_RULES,
      '- 相手の感情を逆なでしない。まず不快な思いをさせたことへのお詫びと傾聴の姿勢を示す。',
      '- 事実確認と改善の姿勢を伝えるが、責任の全面的な断定や過度な補償の約束はしない。担当者が確認して送る前提の下書きにする。',
      '- 各案は落ち着いた一次返答として自然な長さ(150〜250字程度)。',
      '出力形式: 【丁寧・低姿勢】【冷静・事実確認】【簡潔】の3案を、それぞれ本文のみで返す。',
    ].join('\n'),
    user: ({ shop, text }) => `店名: ${shop}\n受け取ったクレーム内容: ${text}\n\n上記への一次対応の返信案を3トーンで作ってください。`,
  },
};

async function generate(type, ctx) {
  const t = TYPES[type];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1000, system: t.system, messages: [{ role: 'user', content: t.user(ctx) }] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.content || []).map((c) => c.text || '').join('').trim();
}

// 機能別のデモ用サンプル
const DEMO = {
  review: { shop: '整体サロン ここち', stars: '2', text: '施術は丁寧で体は楽になりました。ただ予約時間より20分ほど待たされたのが残念でした。' },
  inquiry: { shop: '工務店ABC', stars: '', text: '築25年の戸建てです。外壁の塗り替えを検討中で、概算の費用と工期を知りたいです。現地調査は可能ですか？' },
  complaint: { shop: '美容室Bloom', stars: '', text: '予約したのに30分以上待たされ、カラーの仕上がりも希望と違いました。とても残念です。' },
};

async function main() {
  if (!API_KEY) { console.error('ANTHROPIC_API_KEY が見つかりません（.env）。'); process.exit(1); }

  const type = argv('type', 'review');
  if (!TYPES[type]) { console.error(`--type は review / inquiry / complaint のいずれか。指定値: ${type}`); process.exit(1); }

  const ctx = {
    shop: argv('shop', DEMO[type].shop),
    stars: argv('stars', DEMO[type].stars),
    text: argv('text', DEMO[type].text),
  };

  console.log(`\n■ ${TYPES[type].label}  ─ ${ctx.shop}`);
  console.log(`  入力: ${ctx.stars ? `★${ctx.stars} ` : ''}「${ctx.text}」\n`);
  const out = await generate(type, ctx);
  console.log(out);

  const hits = ngCheck(out);
  console.log('\n─────────────');
  console.log(hits.length ? `⚠️ NG語チェック: 「${hits.join('・')}」検出 → 該当案は使わないでください` : '✅ NG語チェック: 問題なし（景表法/医療広告セーフ）');
  console.log('※そのままコピペ可。最後は必ず担当者が確認してから送信してください。');
}

main().catch((e) => { console.error('エラー:', e.message || e); process.exit(1); });
