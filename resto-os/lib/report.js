/**
 * 朝と閉店後の「読むだけで分かる報告」を作る場所。
 *
 * ねらいは1つだけ。**店長に画面を開かせないこと。**
 * 数字を見るために毎日ログインしてもらう作りだと、忙しい日ほど見なくなる。
 * だから、その日に必要なことだけを短い文章にして、LINEに送る。
 *
 * 守っている決まりごと:
 *  1. 事実と見込みを、文章の中でもはっきり分ける（「実績」と「見込み」の見出しを必ず付ける）。
 *  2. 見込みには必ず範囲を書く。ひとつの数字だけを言い切らない。
 *  3. 原因だとは言わない。「雨だから減った」ではなく「雨の日と近い動きでした」と書く。
 *  4. 予測が外れた日も、そのまま書く。都合の悪い日を黙らない。
 *  5. 送れなくても記録は消さない。あとから画面で読めるし、送り直せる。
 *  6. 原価・粗利は初期状態では入れない（LINEは誰の目に入るか分からないため。設定で出せる）。
 */

import { nowIso, withTx } from './db.js';
import { addDays } from './learn.js';
import { predictDay, todayPlan, accuracy } from './forecast.js';

export const REPORT_KINDS = ['morning', 'night'];

export const KIND_LABEL = {
  morning: '朝のレポート',
  night: '閉店後のレポート',
};

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

function todayJst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 「8月19日(火)」の形にする。年は同じ年なら省く（毎日読むものなので短いほうがよい） */
function dateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const thisYear = Number(todayJst().slice(0, 4));
  const head = y === thisYear ? '' : `${y}年`;
  return `${head}${m}月${d}日(${dow})`;
}

const yen = (v) => `${Math.round(Number(v) || 0).toLocaleString('ja-JP')}円`;
const nin = (v) => `${Math.round(Number(v) || 0).toLocaleString('ja-JP')}人`;

/** 増減を「+12%」「-8%」の形に。0割りは黙って空にする */
function diffPct(now, before) {
  if (!before || !Number.isFinite(before) || !Number.isFinite(now)) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

function signed(p) {
  if (p === null) return '';
  return `${p > 0 ? '+' : ''}${p}%`;
}

// ===== 設定（店ごと） =====

const DEFAULTS = {
  report_morning: '1',   // 朝のレポートを作る
  report_night: '1',     // 閉店後のレポートを作る
  report_night_send: '0',// 閉店後のぶんをその場でLINEに送る（初期は送らない。深夜になるため）
  report_profit: '0',    // 原価・粗利を文章に入れる
  report_line_to: '',    // LINEの宛先（ユーザーID or グループID）
};

export async function getReportSettings(ctx) {
  const rows = await ctx.query(`SELECT key, value FROM settings WHERE SCOPE() AND key LIKE 'report_%'`);
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = String(r.value ?? '');
  return out;
}

export async function saveReportSettings(ctx, patch) {
  const keys = Object.keys(DEFAULTS);
  const entries = Object.entries(patch).filter(([k]) => keys.includes(k));
  if (!entries.length) return { ok: true, saved: 0 };
  await withTx(async (tx) => {
    const c = ctx.bind(tx);
    for (const [k, v] of entries) {
      await c.run(`DELETE FROM settings WHERE SCOPE() AND key = ?`, [k]);
      await c.insert('settings', { key: k, value: String(v ?? '') });
    }
  });
  return { ok: true, saved: entries.length };
}

// ===== 材料あつめ =====

/** その営業日の確定した事実。無ければ null（休業日・まだ締めていない日） */
async function dayFacts(ctx, date) {
  const f = await ctx.first(
    `SELECT * FROM daily_facts WHERE SCOPE() AND business_date = ?`, [date]
  );
  if (!f) return null;
  return {
    date,
    sales: Number(f.sales || 0),
    guests: Number(f.guests || 0),
    checks: Number(f.checks_count || 0),
    avgSpend: Number(f.avg_spend || 0),
    grossProfit: Number(f.gross_profit || 0),
    costTotal: Number(f.cost_total || 0),
    discount: Number(f.discount || 0),
    voidCount: Number(f.void_count || 0),
    voidTotal: Number(f.void_total || 0),
    avgServeMin: Number(f.avg_serve_min || 0),
    closed: Number(f.closed || 0) === 1,
    source: f.source || 'live',
  };
}

/** 同じ曜日のふだん（直近8週）。「良かった／悪かった」を言うための比べ相手 */
async function dowNormal(ctx, date) {
  const rows = await ctx.query(
    `SELECT sales, guests FROM daily_facts
      WHERE SCOPE() AND business_date < ? AND business_date >= ? AND sales > 0
        AND CAST(strftime('%w', business_date) AS INTEGER) = CAST(strftime('%w', ?) AS INTEGER)
      ORDER BY business_date DESC LIMIT 8`,
    [date, addDays(date, -70), date]
  );
  if (rows.length < 3) return null;
  const pick = (k) => {
    const a = rows.map((r) => Number(r[k] || 0)).sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  return { sales: pick('sales'), guests: pick('guests'), n: rows.length };
}

/** その日の予測と実績の答え合わせ（採点済みのものだけ。まだなら null） */
async function scoreOf(ctx, date) {
  const rows = await ctx.query(
    `SELECT metric, predicted, actual, error_pct, cause_json FROM forecast_results
      WHERE SCOPE() AND target_date = ?`, [date]
  );
  if (!rows.length) return null;
  const out = {};
  for (const r of rows) {
    let inRange = null;
    try { inRange = JSON.parse(r.cause_json || '{}').inRange ?? null; } catch { /* 壊れていたら不明のまま */ }
    out[r.metric] = {
      predicted: Number(r.predicted),
      actual: Number(r.actual),
      errorPct: Math.round(Number(r.error_pct) * 10) / 10,
      inRange,
    };
  }
  return out;
}

/** その日よく出た商品。上位だけ */
async function topItems(ctx, date, limit = 3) {
  return ctx.query(
    `SELECT name, qty, sales FROM daily_item_facts
      WHERE SCOPE() AND business_date = ? ORDER BY qty DESC, sales DESC LIMIT ?`,
    [date, limit]
  );
}

/** その日いちばん忙しかった時間帯 */
async function peakHour(ctx, date) {
  const r = await ctx.first(
    `SELECT hour, sales, orders_count FROM daily_hour_facts
      WHERE SCOPE() AND business_date = ? ORDER BY sales DESC LIMIT 1`, [date]
  );
  if (!r) return null;
  return { hour: Number(r.hour), sales: Number(r.sales || 0), orders: Number(r.orders_count || 0) };
}

/** その日にあった出来事（貸切・近所のイベントなど） */
async function eventsOf(ctx, date) {
  const rows = await ctx.query(
    `SELECT title, kind FROM day_events WHERE SCOPE() AND business_date = ?`, [date]
  );
  return rows.map((r) => r.title);
}

// ===== 文章を組み立てる =====

/**
 * 「実績」のかたまり。ここに書くのは、実際に起きたことだけ。
 */
function factLines(f, normal, sc, { profit = false } = {}) {
  const lines = [];
  lines.push(`売上 ${yen(f.sales)}／客数 ${nin(f.guests)}／客単価 ${yen(f.avgSpend)}`);

  if (normal) {
    const dp = diffPct(f.sales, normal.sales);
    if (dp !== null) {
      const word = dp >= 5 ? '多め' : dp <= -5 ? '少なめ' : 'ほぼ同じ';
      lines.push(`いつもの同じ曜日（直近${normal.n}回の真ん中 ${yen(normal.sales)}）と比べて ${signed(dp)}＝${word}でした`);
    }
  }
  if (profit && f.grossProfit) {
    const rate = f.sales ? Math.round((f.grossProfit / f.sales) * 1000) / 10 : 0;
    lines.push(`粗利 ${yen(f.grossProfit)}（売上の${rate}%）`);
  }
  if (f.voidCount) {
    lines.push(`取消 ${f.voidCount}件（${yen(f.voidTotal)}）`);
  }

  if (sc?.sales) {
    // 当たっても外れても、同じ書き方でそのまま出す
    const s = sc.sales;
    const hit = s.inRange === true ? '見込みの範囲に収まりました'
      : s.inRange === false ? '見込みの範囲から外れました'
        : '';
    lines.push(`前日に出していた見込みは ${yen(s.predicted)}。差は ${s.errorPct}%${hit ? `／${hit}` : ''}`);
  }
  return lines;
}

/**
 * 「見込み」のかたまり。ここに書くのは推測だけ。必ず範囲を添える。
 */
function forecastLines(p) {
  if (!p?.ok) {
    return [p?.message || 'まだ記録が足りないため、見込みは出していません。'];
  }
  const lines = [];
  const s = p.metrics ? p.metrics.sales : p.sales;
  const g = p.metrics ? p.metrics.guests : p.guests;
  if (s?.ok) {
    lines.push(`売上 ${yen(s.low)}〜${yen(s.high)} くらい（真ん中を取ると ${yen(s.value)}）`);
  }
  if (g?.ok) {
    lines.push(`客数 ${nin(g.low)}〜${nin(g.high)} くらい`);
  }
  if (s?.ok) {
    lines.push(`根拠の強さ ${s.confidencePct}／100（的中率ではありません）`);
  }
  return lines;
}

/** その日らしさ（天気・祝日・企画）を1行にまとめる */
function contextLine(c) {
  if (!c) return '';
  const parts = [];
  if (c.dayLabel) parts.push(c.dayLabel);
  else if (c.dowName) parts.push(`${c.dowName}曜日`);
  if (c.weatherText) parts.push(`${c.weatherText}${c.weatherFrom ? `（${c.weatherFrom}）` : ''}`);
  if (c.tempMax !== null && c.tempMax !== undefined) parts.push(`最高${Math.round(c.tempMax)}℃`);
  const camps = (c.campaigns || []).map((x) => (typeof x === 'string' ? x : x.name));
  if (camps.length) parts.push(`企画：${camps.join('、')}`);
  return parts.join('／');
}

// ===== レポート本体 =====

/**
 * 閉店後のレポート。対象は「いま終わった営業日」。
 * その日どうだったか → 予測は当たっていたか → 明日はどうなりそうか、の順。
 */
async function buildNight(ctx, date) {
  const storeName = ctx.store?.name || '';
  const f = await dayFacts(ctx, date);
  const settings = await getReportSettings(ctx);
  const profit = settings.report_profit === '1';

  const title = `${storeName} ${dateLabel(date)}の営業おつかれさまでした`;
  const L = [];
  L.push(`【${KIND_LABEL.night}】${dateLabel(date)}`);
  if (storeName) L.push(storeName);
  L.push('');

  if (!f || f.sales <= 0) {
    L.push('■ 実績');
    L.push('この日の売上の記録がありません（休業日、または締めがまだのようです）。');
    L.push('');
  } else {
    const [normal, sc, items, peak, evs] = await Promise.all([
      dowNormal(ctx, date), scoreOf(ctx, date), topItems(ctx, date), peakHour(ctx, date), eventsOf(ctx, date),
    ]);
    L.push('■ 実績（実際に起きたこと）');
    for (const line of factLines(f, normal, sc, { profit })) L.push(`・${line}`);
    if (peak) L.push(`・いちばん忙しかったのは ${peak.hour}時台（${yen(peak.sales)}）`);
    if (items.length) L.push(`・よく出たもの：${items.map((i) => `${i.name} ${i.qty}`).join('／')}`);
    if (evs.length) L.push(`・この日の出来事：${evs.join('、')}`);
    L.push('');
  }

  // 明日ぶんの見込み
  const next = addDays(date, 1);
  const p = await predictDay(ctx, next);
  L.push(`■ 見込み（${dateLabel(next)}・AIの推測です）`);
  const cl = contextLine(p?.context);
  if (cl) L.push(`・${cl}`);
  for (const line of forecastLines(p)) L.push(`・${line}`);
  L.push('');
  L.push('※ 見込みは過去の記録から出した目安です。原因を決めつけるものではありません。');

  return {
    kind: 'night', date, title, body: L.join('\n'),
    data: { facts: f, next, forecast: p?.ok ? { sales: p.metrics.sales, guests: p.metrics.guests, context: p.context } : null },
  };
}

/**
 * 朝のレポート。対象は「これから始まる今日」。
 * 昨日どうだったか → 今日はどうなりそうか → 今日の注意点、の順。
 *
 * 閉店後のぶんを深夜に送らない設定でも、ここに昨日の結果が入るので取りこぼさない。
 */
async function buildMorning(ctx, date) {
  const storeName = ctx.store?.name || '';
  const y = addDays(date, -1);
  const settings = await getReportSettings(ctx);
  const profit = settings.report_profit === '1';

  const title = `${storeName} ${dateLabel(date)}の朝の見立て`;
  const L = [];
  L.push(`【${KIND_LABEL.morning}】${dateLabel(date)}`);
  if (storeName) L.push(storeName);
  L.push('');

  // 昨日のふりかえり
  const yf = await dayFacts(ctx, y);
  L.push(`■ きのう（${dateLabel(y)}）の実績`);
  if (!yf || yf.sales <= 0) {
    L.push('・売上の記録がありません（休業日、または締めがまだのようです）');
  } else {
    const [normal, sc] = await Promise.all([dowNormal(ctx, y), scoreOf(ctx, y)]);
    for (const line of factLines(yf, normal, sc, { profit })) L.push(`・${line}`);
  }
  L.push('');

  // 今日の見込み
  const plan = await todayPlan(ctx, date);
  L.push('■ きょうの見込み（AIの推測です）');
  const cl = contextLine(plan?.ok ? plan.context : null);
  if (cl) L.push(`・${cl}`);
  for (const line of forecastLines(plan)) L.push(`・${line}`);
  if (plan?.ok && plan.fixed?.sales) {
    L.push(`・この見込みは前日までに確定済みです（あとから書き換えていません）`);
  }
  L.push('');

  // 今日気をつけること
  if (plan?.ok && plan.notes?.length) {
    L.push('■ きょう気をつけること');
    for (const n of plan.notes) L.push(`・${n.text}`);
    L.push('');
  }

  // 当たり具合（正直さの担保。悪い数字も隠さず出す）
  const acc = await accuracy(ctx, { days: 60, metric: 'sales' });
  if (acc?.days >= 10) {
    L.push('■ これまでの当たり具合（直近60日）');
    L.push(`・${acc.days}日ぶんを採点。誤差の真ん中は ${acc.medErrorPct}%／示した範囲に収まったのは ${acc.inRangePct}%`);
    L.push('');
  }

  L.push('※ 見込みは過去の記録から出した目安です。最後に決めるのは、お店を知っている人です。');

  return {
    kind: 'morning', date, title, body: L.join('\n'),
    data: {
      yesterday: yf,
      plan: plan?.ok ? { sales: plan.sales, guests: plan.guests, context: plan.context, notes: plan.notes } : null,
      accuracy: acc?.days >= 10 ? { days: acc.days, medErrorPct: acc.medErrorPct, inRangePct: acc.inRangePct } : null,
    },
  };
}

export async function buildReport(ctx, { kind, date }) {
  if (!REPORT_KINDS.includes(kind)) throw new Error('不明なレポートです');
  const d = String(date || todayJst()).slice(0, 10);
  return kind === 'morning' ? buildMorning(ctx, d) : buildNight(ctx, d);
}

// ===== 配信 =====

/**
 * LINEに送る。
 *
 * 合言葉（LINE_CHANNEL_TOKEN）は環境変数から取り、DBには置かない。
 * 宛先だけを店ごとの設定に持つ。どちらか欠けていれば「送らない」で静かに終わる
 * （鍵が無いだけでレポート作成そのものが止まらないようにするため）。
 */
/**
 * LINEから返ってきた断り文句を、店の人が読んで動ける日本語に置き換える。
 * 英語のエラーをそのまま出すと「何をすればいいか」が分からず、問い合わせが増えるため。
 */
function lineErrorText(status, raw) {
  const tail = String(raw || '').slice(0, 100);
  if (status === 401) return 'LINEの鍵が正しくありません。設定し直してください。';
  if (status === 403) return 'このLINEアカウントからは送れない設定になっています。LINE側の契約内容をご確認ください。';
  if (status === 400) return '宛先IDが正しくないようです。友だち登録した人のIDかご確認ください。';
  if (status === 429) return 'LINEの当月の送信上限に達しました。翌月まで、レポートはこの画面でご覧ください。';
  return `LINEに送れませんでした（${status}）。${tail}`;
}

async function pushLine(to, text) {
  const token = process.env.LINE_CHANNEL_TOKEN || '';
  if (!token) return { sent: false, via: 'none', error: 'LINEの鍵が未設定です' };
  if (!to) return { sent: false, via: 'none', error: 'LINEの宛先が未設定です' };

  // LINEは1通5000字まで。長い場合は切って、続きは画面で読んでもらう
  const body = text.length > 4800 ? `${text.slice(0, 4800)}\n…（続きは管理画面でご覧ください）` : text;
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [{ type: 'text', text: body }] }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { sent: false, via: 'line', error: lineErrorText(res.status, t) };
    }
    return { sent: true, via: 'line', error: '' };
  } catch (e) {
    return { sent: false, via: 'line', error: String(e?.message || e).slice(0, 160) };
  }
}

/**
 * レポートを保存する。同じ日・同じ種類は1件だけ（何度動かしても増えない）。
 * 送信に失敗しても保存はする。画面で読めるし、あとから送り直せる。
 */
async function storeReport(ctx, report, delivery) {
  await withTx(async (tx) => {
    const c = ctx.bind(tx);
    await c.run(`DELETE FROM daily_reports WHERE SCOPE() AND business_date = ? AND kind = ?`, [report.date, report.kind]);
    await c.insert('daily_reports', {
      business_date: report.date,
      kind: report.kind,
      title: report.title,
      body: report.body,
      data_json: JSON.stringify(report.data || {}),
      delivered: delivery.sent ? 1 : 0,
      delivery: delivery.via,
      delivery_error: delivery.error || '',
      delivered_at: delivery.sent ? nowIso() : '',
      created_at: nowIso(),
    });
  });
}

/**
 * 作る → 保存する → （設定があれば）送る。
 * 自動処理からも、画面の「今すぐ作る」からも、同じここを通る。
 */
export async function runReport(ctx, { kind, date = null, send = true } = {}) {
  const settings = await getReportSettings(ctx);
  if (kind === 'morning' && settings.report_morning !== '1') return { ok: false, skipped: '朝のレポートは停止中です' };
  if (kind === 'night' && settings.report_night !== '1') return { ok: false, skipped: '閉店後のレポートは停止中です' };

  const report = await buildReport(ctx, { kind, date });
  const nightHold = kind === 'night' && settings.report_night_send !== '1';
  const wantSend = send && !nightHold;
  const delivery = wantSend
    ? await pushLine(settings.report_line_to, report.body)
    : {
      sent: false,
      via: 'none',
      error: nightHold
        ? '深夜に通知が鳴らないよう、この時間は送らず保存だけしています（内容は翌朝のレポートにも入ります）'
        : '送らない指定で作りました',
    };

  await storeReport(ctx, report, delivery);
  return { ok: true, kind, date: report.date, delivered: delivery.sent, error: delivery.error || '' };
}

/** 保存済みのレポートを、もう一度だけ送る（作り直さない＝内容は当時のまま） */
export async function resendReport(ctx, id) {
  const row = await ctx.first(`SELECT * FROM daily_reports WHERE SCOPE() AND id = ?`, [Number(id)]);
  if (!row) return { ok: false, error: 'そのレポートは見つかりません' };
  const settings = await getReportSettings(ctx);
  const delivery = await pushLine(settings.report_line_to, row.body);
  await ctx.run(
    `UPDATE daily_reports SET delivered = ?, delivery = ?, delivery_error = ?, delivered_at = ?
      WHERE SCOPE() AND id = ?`,
    [delivery.sent ? 1 : 0, delivery.via, delivery.error || '', delivery.sent ? nowIso() : '', Number(id)]
  );
  return { ok: delivery.sent, error: delivery.error || '' };
}

/** 宛先が正しいか、その場で1通送って確かめる */
export async function testDelivery(ctx) {
  const settings = await getReportSettings(ctx);
  const text = `【テスト送信】${ctx.store?.name || ''}\nこのメッセージが届いていれば、朝と閉店後のレポートも同じ宛先に届きます。`;
  const r = await pushLine(settings.report_line_to, text);
  return { ok: r.sent, error: r.error || '' };
}

/** 画面に出す一覧 */
export async function listReports(ctx, { limit = 30 } = {}) {
  const rows = await ctx.query(
    `SELECT id, business_date, kind, title, body, delivered, delivery, delivery_error, delivered_at, created_at
       FROM daily_reports WHERE SCOPE() ORDER BY business_date DESC, kind LIMIT ?`,
    [Math.max(1, Math.min(90, Number(limit) || 30))]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    date: r.business_date,
    kind: r.kind,
    kindLabel: KIND_LABEL[r.kind] || r.kind,
    title: r.title,
    body: r.body,
    delivered: Number(r.delivered) === 1,
    delivery: r.delivery,
    error: r.delivery_error || '',
    deliveredAt: r.delivered_at || '',
    createdAt: r.created_at,
  }));
}
