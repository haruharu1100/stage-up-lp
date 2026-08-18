import fs from 'node:fs';
import path from 'node:path';

let _envLoaded = false;
function loadEnv() {
  if (_envLoaded) return;
  _envLoaded = true;
  const p = path.join(process.cwd(), '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function aiEnabled() {
  loadEnv();
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

async function askClaude(system, user) {
  loadEnv();
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  });
  const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI応答をJSONとして解釈できませんでした');
  return JSON.parse(m[0]);
}

const SYSTEM = `あなたは日本の飲食店のホールを熟知した接客のプロです。
渡されたメニュー一覧・来店状況・すでに注文済みの内容から、次に注文されそうな商品を選びます。

厳守事項:
- 出力は必ず JSON のみ。{"headline":"...","picks":[{"id":数値,"qty":数値,"reason":"20文字以内"}]}
- id は必ず渡されたメニューの id から選ぶ。存在しない id は禁止。
- sold_out=1 の商品は選ばない。
- 既に注文済みの商品は原則もう一度選ばない(ドリンクのおかわりは可)。
- picks は 3〜6件。qty は人数を考慮した現実的な数。
- headline は15文字以内の日本語の見出し。
- 「必ず」「絶対」「最安」など断定・誇大な表現は使わない。健康や効能をうたわない。`;

function ruleBased({ menu, guests, hour, cart, ordered }) {
  const taken = new Set([...(cart || []).map((c) => c.itemId), ...(ordered || []).map((o) => o.item_id)]);
  const avail = menu.filter((m) => !m.sold_out);
  const pick = (fn, n = 1) => avail.filter(fn).filter((m) => !taken.has(m.id)).slice(0, n);

  const isDrink = (m) => m.station === 'drink';
  const picks = [];
  const started = (ordered || []).length > 0;

  if (!started) {
    // 1杯目のドリンクを人数分
    const drinks = avail.filter(isDrink).sort((a, b) => b.popular_count - a.popular_count).slice(0, 2);
    drinks.forEach((d, i) => {
      const qty = i === 0 ? Math.ceil(guests / 2) : Math.floor(guests / 2);
      if (qty > 0) picks.push({ id: d.id, qty, reason: 'まずは乾杯に' });
    });
    pick((m) => !isDrink(m) && m.station !== 'dessert', 3).forEach((m) =>
      picks.push({ id: m.id, qty: 1, reason: '定番の人気メニュー' })
    );
  } else {
    const drinkCount = (ordered || []).filter((o) => o.station === 'drink').reduce((s, o) => s + o.qty, 0);
    if (drinkCount > 0) {
      pick((m) => !isDrink(m) && m.is_recommended, 2).forEach((m) =>
        picks.push({ id: m.id, qty: 1, reason: 'お酒に合う一品' })
      );
    }
    pick((m) => isDrink(m), 1).forEach((m) => picks.push({ id: m.id, qty: 1, reason: '次の一杯に' }));
    pick((m) => m.station === 'dessert', 1).forEach((m) =>
      picks.push({ id: m.id, qty: 1, reason: 'シメの一品に' })
    );
    pick((m) => m.popular_count > 0, 2).forEach((m) =>
      picks.push({ id: m.id, qty: 1, reason: '今日の人気' })
    );
  }

  const headline = !started
    ? `${guests}名様におすすめ`
    : hour >= 21
    ? 'そろそろシメはいかがですか'
    : 'あと一品いかがですか';
  return { headline, picks: picks.slice(0, 6), engine: 'rule' };
}

export async function recommend({ menu, guests, hour, cart, ordered }) {
  const fallback = () => ruleBased({ menu, guests, hour, cart, ordered });
  if (!aiEnabled()) return fallback();

  const compact = menu.map((m) => ({
    id: m.id,
    name: m.name,
    price: m.price,
    cat: m.category_name,
    station: m.station,
    sold_out: m.sold_out ? 1 : 0,
    popular: m.popular_count,
  }));
  const user = JSON.stringify({
    来店人数: guests,
    時刻: `${hour}時`,
    業態: '居酒屋',
    注文済み: (ordered || []).map((o) => `${o.name}×${o.qty}`),
    カート内: (cart || []).map((c) => c.name),
    メニュー: compact,
  });

  try {
    const json = await askClaude(SYSTEM, user);
    const ids = new Set(menu.filter((m) => !m.sold_out).map((m) => m.id));
    const picks = (json.picks || [])
      .filter((p) => ids.has(Number(p.id)))
      .map((p) => ({ id: Number(p.id), qty: Math.max(1, Math.min(10, Number(p.qty) || 1)), reason: String(p.reason || '').slice(0, 20) }))
      .slice(0, 6);
    if (!picks.length) return fallback();
    return { headline: String(json.headline || 'おすすめ').slice(0, 20), picks, engine: 'ai' };
  } catch {
    return fallback();
  }
}

const UPSELL_SYSTEM = `あなたは日本の飲食店の接客のプロです。ある商品をカートに入れたお客様へ、
相性の良い追加の一品を1つだけ提案します。出力はJSONのみ:
{"id":数値,"message":"25文字以内の一言"}
- id は候補リストの中から選ぶこと。
- message は「〜はいかがですか？」のような自然な接客文。断定・誇大表現は禁止。`;

export async function upsell({ item, candidates }) {
  const usable = candidates.filter((c) => !c.sold_out && c.id !== item.id);
  if (!usable.length) return null;

  // 手動設定のペアリングが最優先
  if (item.pair_with) {
    const target = usable.find((c) => String(c.id) === String(item.pair_with) || c.name === item.pair_with);
    if (target) {
      return {
        id: target.id,
        message: item.pair_message || `一緒に${target.name}はいかがですか？`,
        engine: 'rule',
      };
    }
  }

  const fallback = () => {
    const t =
      item.station === 'drink'
        ? usable.find((c) => c.station !== 'drink' && c.is_recommended) || usable.find((c) => c.station !== 'drink')
        : usable.find((c) => c.station === 'drink');
    if (!t) return null;
    return { id: t.id, message: `一緒に${t.name}はいかがですか？`, engine: 'rule' };
  };

  if (!aiEnabled()) return fallback();
  try {
    const json = await askClaude(
      UPSELL_SYSTEM,
      JSON.stringify({
        注文した商品: { id: item.id, name: item.name, station: item.station },
        候補: usable.map((c) => ({ id: c.id, name: c.name, price: c.price, station: c.station })),
      })
    );
    const t = usable.find((c) => c.id === Number(json.id));
    if (!t) return fallback();
    return { id: t.id, message: String(json.message || `一緒に${t.name}はいかがですか？`).slice(0, 40), engine: 'ai' };
  } catch {
    return fallback();
  }
}

const MANAGER_SYSTEM = `あなたは飲食店の経験豊富な店長です。渡された数値だけを根拠に、
オーナー向けに日本語で簡潔に講評します。出力はJSONのみ:
{"summary":"120文字以内の状況説明","actions":["具体的な打ち手","..."]}
- 数値に無い事実を作らない。分からないことは触れない。
- 「必ず儲かる」等の断定・誇大表現は使わない。
- actions は2〜4件、今日明日で実行できる具体策にする。`;

export async function managerComment(stats) {
  if (!aiEnabled()) {
    const a = [];
    if (stats.avgSpend && stats.avgSpend < 3000) a.push('ドリンクの2杯目をすすめる声かけを19〜21時に集中させる');
    if (stats.aiSales > 0) a.push('AIおすすめ経由の売上が出ています。おすすめ枠に利益率の高い商品を混ぜる');
    a.push('売れ筋上位3品を注文画面の最上部に配置する');
    return {
      summary: `本日の売上は${stats.sales.toLocaleString()}円、客数${stats.guests}人、客単価${Math.round(stats.avgSpend).toLocaleString()}円です。`,
      actions: a.slice(0, 3),
      engine: 'rule',
    };
  }
  try {
    return { ...(await askClaude(MANAGER_SYSTEM, JSON.stringify(stats))), engine: 'ai' };
  } catch {
    return { summary: '講評の生成に失敗しました。数値はダッシュボードをご確認ください。', actions: [], engine: 'error' };
  }
}
