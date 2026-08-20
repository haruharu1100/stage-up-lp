import { NextResponse } from 'next/server';
import { all, one, businessDate, initDb } from '../../../lib/db.js';
import { createCtx } from '../../../lib/tenant-db.js';
import { ensureCalendar, saveForecast, saveActual, backfillWeather, rebuildDay, addDays } from '../../../lib/learn.js';
import { saveForecasts, scoreDay } from '../../../lib/forecast.js';
import { saveDetailForecasts } from '../../../lib/forecast-detail.js';
import { runReport } from '../../../lib/report.js';
import { detectStockouts } from '../../../lib/prep.js';
import { consumeDay } from '../../../lib/inventory.js';
import { hasFeature } from '../../../lib/plans.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 決まった時刻にひとりでに動く処理のまとめ口。
 *
 * 店ごとにログインする人がいない処理なので、ここだけは全店をまわる。
 * そのかわり合言葉（CRON_SECRET）が合わないと1行も動かない。
 * 店ごとの読み書きは、いつもどおり店舗を限定した入口を通すので、
 * 「別の店の数字が混ざる」ことは仕組み上起こらない。
 *
 * どの仕事も、同じ日に何度動いても結果が変わらない作りにしている
 * （二重に数えない・上書きするだけ）。途中で失敗した店があっても、
 * そこで止めずに次の店へ進む。1店の通信エラーで全店の記録が欠けては困るため。
 */

const JOBS = ['weather', 'live', 'nightly', 'calendar', 'report'];

/**
 * いま、その店の営業時間の中かどうか（日本時間で見る）。
 *
 * 営業中だけ天気を取り直したいので使う。閉まっている時間まで毎時取りに行っても
 * 使い道がないうえ、取り寄せ先に無駄な負担をかけるだけなので、開いている店だけにする。
 * 24時をまたぐ店（17:00〜26:00 のような書き方）にも合わせてある。
 */
function isOpenNow(store) {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const nowMin = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  const toMin = (s, fallback) => {
    const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return fallback;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const open = toMin(store?.open_time, 17 * 60);
  let close = toMin(store?.close_time, 24 * 60);
  if (close <= open) close += 24 * 60; // 深夜まで営業している店
  // 開店1時間前から見る。開ける前の判断（仕込み・人手）にも使うため。
  const from = open - 60;
  return (nowMin >= from && nowMin <= close) || (nowMin + 24 * 60 >= from && nowMin + 24 * 60 <= close);
}

function authorized(req) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  const auth = req.headers.get('authorization') || '';
  if (auth === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get('key') === secret;
}

async function eachStore(fn) {
  await initDb();
  const stores = await all(`SELECT * FROM stores WHERE status = 'active'`);
  const out = [];
  for (const store of stores) {
    try {
      const tenant = await one('SELECT * FROM tenants WHERE id = ?', [Number(store.tenant_id)]);
      if (!tenant || tenant.status === 'canceled') continue;
      const ctx = createCtx({
        tenantId: Number(store.tenant_id),
        storeId: Number(store.id),
        role: 'system',
        staffName: '自動処理',
        plan: tenant.plan,
        tenant,
        store,
      });
      out.push({ store: store.name, ...(await fn(ctx, store)) });
    } catch (e) {
      out.push({ store: store.name, error: String(e?.message || e).slice(0, 200) });
    }
  }
  return out;
}

async function runJob(job, slot) {
  if (job === 'report') {
    // 朝のレポート。読む人が起きている時間に、昨日の結果と今日の見込みをまとめて送る。
    // 深夜に通知が飛ぶのを避けるため、閉店後のぶんもここで拾えるようにしてある。
    return eachStore(async (ctx) => {
      const kind = slot === 'night' ? 'night' : 'morning';
      const date = kind === 'night' ? addDays(businessDate(), -1) : businessDate();
      const r = await runReport(ctx, { kind, date });
      return { report: kind, date, ok: r.ok, delivered: Boolean(r.delivered), note: r.skipped || r.error || '' };
    });
  }

  if (job === 'calendar') {
    // 先の予定ぶんの暦を先に用意しておく（売上が無い未来の日も予測の材料になる）
    return eachStore(async (ctx) => {
      const from = businessDate();
      const added = await ensureCalendar(ctx, addDays(from, -370), addDays(from, 120));
      return { calendar: added };
    });
  }

  if (job === 'weather') {
    // 予報を取り直す。朝・昼・夕で別々に残すので、あとから「予報がどう変わったか」も追える。
    return eachStore(async (ctx) => {
      const f = await saveForecast(ctx, { slot: slot || 'am6', days: 7 });
      if (!f.ok) return { weather: '位置が未設定のため見送り' };
      // 昨日ぶんの実測値も、この時点で分かる範囲で押さえておく
      const y = addDays(businessDate(), -1);
      const a = await saveActual(ctx, y, y, { confirmed: 1 });
      // 天気の予報が変わったぶん、明日から先の見込みも取り直す（今日と過去には触れない）
      const fc = await saveForecasts(ctx, { days: 8 });
      return { forecast: f.saved, actual: a.saved ?? 0, forecasts: fc.saved ?? 0 };
    });
  }

  // live：営業中に1時間ごと。いまの空模様と、今日ぶんの最新の予報を取り直す。
  //
  // ★ここで入る今日の天気は「まだ確定していない値（confirmed=0）」。
  //   夜の処理で改めて取り直して確定させる。営業中の暫定値を、
  //   そのまま「その日の記録」にしてしまうと、19時に雨が降った日を
  //   「晴れの日」として覚えたままになるため。
  if (job === 'live') {
    return eachStore(async (ctx, store) => {
      if (!isOpenNow(store)) return { live: '営業時間外のため見送り' };
      const today = businessDate();
      const f = await saveForecast(ctx, { slot: 'live', days: 2 });
      if (!f.ok) return { live: '位置が未設定のため見送り' };
      const a = await saveActual(ctx, today, today, { confirmed: 0, overwrite: true });
      return { live: '更新', date: today, forecast: f.saved, actual: a.saved ?? 0 };
    });
  }

  // nightly：昨日を「お店の記憶」として確定させる
  return eachStore(async (ctx) => {
    const y = addDays(businessDate(), -1);
    const r = await rebuildDay(ctx, y);
    const a = await saveActual(ctx, y, y, { confirmed: 1, overwrite: true });
    await ensureCalendar(ctx, y, addDays(businessDate(), 60));
    // 天気が抜けている過去の日も、毎晩すこしずつ埋めていく
    // （導入前の営業日や、あとから取り込んだ過去の売上ぶん）
    const b = await backfillWeather(ctx, { days: 400, cap: 60 });

    // 売れた数ぶんの材料を在庫から引く。これをしないと在庫は入荷でしか動かず、いつまでも減らない。
    // レシピが未登録の店では何もしない（勝手な数字を作らない）。
    //
    // ★採点より先にやる。ここで入る「使った量」が、在庫需要の予測に対する実績になるため。
    let used = 0;
    const hasInv = hasFeature(ctx.plan, 'inventory');
    if (hasInv) {
      const cu = await consumeDay(ctx, y);
      used = cu.lines || 0;
    }

    // 昨日ぶんの「予測 対 実際」を採点する。
    // 実際の数字が確定したあとに採点するので、あとから都合よく直すことはできない。
    const sc = await scoreDay(ctx, y);
    // 明日から先の予測を作り直す。今日と過去には触れない（当たり外れの記録を守るため）
    const fc = await saveForecasts(ctx, { days: 10 });
    // 内訳（時間帯・人手・商品・材料）ぶんも作る。ここは3日先までで足りる。
    let detail = 0;
    if (hasFeature(ctx.plan, 'history')) {
      const df = await saveDetailForecasts(ctx, { days: 3, hasInventory: hasInv });
      detail = df.saved || 0;
    }

    // 「売り逃していないか」を数え直す。ここで出るのは推測であって、売上の数字とは混ぜない。
    let missed = 0;
    if (hasFeature(ctx.plan, 'history')) {
      const so = await detectStockouts(ctx, y);
      missed = so.saved || 0;
    }

    // 閉店後のレポートを作って残す。
    // ここが動くのは深夜なので、送るかどうかは店ごとの設定に従う（初期は保存のみ）。
    // 送らない設定でも、この内容は翌朝のレポートに「きのうの実績」として必ず入る。
    const rep = await runReport(ctx, { kind: 'night', date: y });

    return {
      date: y, rebuilt: Boolean(r?.ok), sales: r?.sales ?? null,
      weather: a.saved ?? 0, weatherBackfill: b.saved ?? 0,
      scored: sc.scored ?? 0, forecasts: fc.saved ?? 0, detailForecasts: detail,
      stockUsed: used, missedItems: missed,
      report: rep.ok ? (rep.delivered ? '作成・送信' : '作成のみ') : (rep.skipped || '見送り'),
    };
  });
}

export async function GET(req) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: '実行できません' }, { status: 401 });
  }
  const sp = new URL(req.url).searchParams;
  const job = String(sp.get('job') || 'nightly');
  if (!JOBS.includes(job)) {
    return NextResponse.json({ ok: false, error: '不明な処理です' }, { status: 400 });
  }
  const started = Date.now();
  const result = await runJob(job, sp.get('slot'));
  return NextResponse.json({ ok: true, job, ms: Date.now() - started, result });
}

export async function POST(req) {
  return GET(req);
}
