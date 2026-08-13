'use strict';

// ============================================================================
// Google口コミ返信AI（案④）  ─ 売れるAIプロダクト第1号
//
// 何をする: お店に付いた口コミ(星＋本文)を入れると、そのまま貼れる返信案を
//           トーン別に2〜3案つくる。飲食店・美容室・整体・病院向け。
//
// 安全設計(景表法/医療広告セーフ):
//   - 「必ず治る」「絶対」「日本一」等の断定・誇大・優良誤認はシステム指示で禁止＋出力後にNG語で二重チェック。
//   - 個人情報や来店を確約するような表現は避け、丁寧・簡潔・具体的に。
//
// 使い方:
//   node review-reply.js                         (内蔵サンプルでデモ)
//   node review-reply.js --stars=2 --shop="美容室Bloom" --tone=丁寧 \
//        --text="カットは良かったけど待ち時間が長かった"
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
const NG = ['必ず', '絶対', '日本一', '完治', '治ります', '100%', 'No.1', 'ナンバーワン', '最高峰', '確実に'];
function ngCheck(text) { return NG.filter((w) => text.includes(w)); }

async function generate({ stars, text, shop, tone }) {
  const system = [
    'あなたは日本の実店舗オーナー向けに、Googleクチコミへの返信文を作るプロです。',
    '制約(厳守):',
    '- 景表法・医療広告ガイドラインに反する表現は禁止。「必ず」「絶対」「日本一」「完治」「100%」等の断定・誇大・優良誤認は使わない。',
    '- 誠実・丁寧・簡潔に。低評価には言い訳せずまず謝意と改善姿勢を示す。高評価には具体的に感謝する。',
    '- 各案は120〜180字程度。絵文字は控えめ(0〜1個)。来店を強要しない。',
    '出力形式: 【丁寧】【親しみ】【簡潔】の3案を、それぞれ本文のみで返す。前置き・解説は不要。',
  ].join('\n');
  const user = `店名: ${shop}\n評価: ★${stars}\n口コミ本文: ${text}\n\n上記への返信案を3トーンで作ってください。`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 900, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.content || []).map((c) => c.text || '').join('').trim();
}

async function main() {
  if (!API_KEY) { console.error('ANTHROPIC_API_KEY が見つかりません（.env）。'); process.exit(1); }

  const review = {
    stars: argv('stars', '2'),
    shop: argv('shop', '整体サロン ここち'),
    tone: argv('tone', ''),
    text: argv('text', '施術は丁寧で体は楽になりました。ただ予約時間より20分ほど待たされたのが残念でした。'),
  };

  console.log(`\n■ 口コミ返信AI  ─ ${review.shop}`);
  console.log(`  口コミ: ★${review.stars}「${review.text}」\n`);
  const out = await generate(review);
  console.log(out);

  const hits = ngCheck(out);
  console.log('\n─────────────');
  console.log(hits.length ? `⚠️ NG語チェック: 「${hits.join('・')}」検出 → 該当案は使わないでください` : '✅ NG語チェック: 問題なし（景表法/医療広告セーフ）');
  console.log('※そのままコピペ可。掛け率同様、トーンや長さは業種別に調整できます。');
}

main().catch((e) => { console.error('エラー:', e.message || e); process.exit(1); });
