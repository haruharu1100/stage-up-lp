'use strict';

/**
 * AI返信パック  ─ サーバーレスAPI（/api/reply）
 *
 * 何をする: ブラウザから受け取った本文をもとに、
 *   「Google口コミ」「問い合わせメール」「クレーム一次対応」の
 *   返信文をトーン別に生成して返す。
 *
 * 安全設計(景表法/医療広告セーフ):
 *   - システム指示で断定・誇大・優良誤認を禁止 ＋ 出力後にNG語で二重チェック。
 *   - APIキーはコードに書かない（環境変数 or ローカルの .env から読む）。
 *     キーの値はレスポンス・ログに一切出さない。
 *
 * 受け取り: POST JSON { type, shop, stars, text }
 *   type: 'review' | 'inquiry' | 'complaint'
 * 返す:   { ok:true, output:"<生成本文>", ngHits:[...] }
 *         失敗時 { ok:false, error:"..." }
 *
 * ※ システムプロンプト・NG配列・ngCheck は ai-products/reply-pack.js から流用（同一文言）。
 */

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
  // 業種・希望トーンが指定されていれば、お店らしい文体に寄せるヒントを先頭に足す（3案の形式は維持）
  let content = t.user(ctx);
  const extra = [];
  if (ctx.genre) extra.push(`業種: ${ctx.genre}（この業種の言葉づかい・お客様層に合わせる。医療・美容・健康は効果の断定を避ける）`);
  if (ctx.tone) extra.push(`希望する雰囲気: ${ctx.tone}（この雰囲気に寄せつつ、指定の3案フォーマットは必ず維持する）`);
  if (extra.length) content = extra.join('\n') + '\n' + content;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1000, system: t.system, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) {
    // ステータスのみ伝え、本文やキーは露出させない
    throw new Error(`API_${res.status}`);
  }
  const j = await res.json();
  return (j.content || []).map((c) => c.text || '').join('').trim();
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.status(405).send(JSON.stringify({ ok: false, error: 'POSTのみ対応しています。' }));
    return;
  }

  // ボディを受け取る（既にパース済み or 文字列/ストリームの両対応）
  let body = req.body;
  try {
    if (body == null) {
      const raw = await new Promise((resolve, reject) => {
        let d = '';
        req.on('data', (c) => { d += c; });
        req.on('end', () => resolve(d));
        req.on('error', reject);
      });
      body = raw ? JSON.parse(raw) : {};
    } else if (typeof body === 'string') {
      body = body ? JSON.parse(body) : {};
    }
  } catch {
    res.status(400).send(JSON.stringify({ ok: false, error: 'リクエストの形式が正しくありません。' }));
    return;
  }

  const { type, shop, stars, genre, tone } = body || {};
  let text = body && body.text;

  // ── バリデーション
  if (!TYPES[type]) {
    res.status(400).send(JSON.stringify({ ok: false, error: 'type は review / inquiry / complaint のいずれかを指定してください。' }));
    return;
  }
  if (typeof text !== 'string' || text.trim() === '') {
    res.status(400).send(JSON.stringify({ ok: false, error: '本文を入力してください。' }));
    return;
  }
  // 4000文字を超えたら切り詰め
  text = text.slice(0, 4000);

  if (!API_KEY) {
    // キーの値は絶対に出さない。設定が必要な旨だけ伝える
    res.status(500).send(JSON.stringify({ ok: false, error: 'サーバー側でAPIキー(ANTHROPIC_API_KEY)が設定されていません。管理者にご連絡ください。' }));
    return;
  }

  const clean = (v) => (typeof v === 'string' && v.trim()) ? v.trim().slice(0, 40) : '';
  const ctx = {
    shop: (typeof shop === 'string' && shop.trim()) ? shop.trim().slice(0, 60) : 'お店',
    stars: (stars == null) ? '' : String(stars),
    text: text.trim(),
    genre: clean(genre),
    tone: clean(tone),
  };

  try {
    const output = await generate(type, ctx);
    const ngHits = ngCheck(output);
    res.status(200).send(JSON.stringify({ ok: true, output, ngHits }));
  } catch (e) {
    const msg = (e && e.message) || '';
    const status = /^API_(\d+)$/.test(msg) ? Number(msg.split('_')[1]) : 502;
    res.status(status >= 400 && status < 600 ? status : 502)
      .send(JSON.stringify({ ok: false, error: '返信案の生成に失敗しました。時間をおいて再度お試しください。' }));
  }
};
