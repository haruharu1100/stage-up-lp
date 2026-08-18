import { NextResponse } from 'next/server';
import { nowIso, withTx } from '../../../../lib/db.js';
import { newPublicId } from '../../../../lib/tenant-db.js';
import { requireAuth, requireRole, requireFeature, apiFail, ApiError } from '../../../../lib/auth.js';
import { logAudit } from '../../../../lib/audit.js';
import { ensureCalendar, backfillWeatherRange } from '../../../../lib/learn.js';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['owner', 'admin', 'manager'];

/**
 * 前のレジや手書きの台帳に残っている過去の売上を、あとから取り込む。
 *
 * 導入した日から数字が0では、去年の同じ日と比べることが何年もできない。
 * 過去を入れておけば、初日から「去年の今ごろ」が見られる。
 *
 * 大事にしていること：
 * ・取り込んだ日は source='import' として印を付け、レジが自分で作った日（live）と必ず見分けられるようにする
 * ・すでにレジの記録がある日は、絶対に上書きしない（本物の記録を、取り込みで壊さない）
 * ・いきなり書き込まず、必ず「こう読み取りました」を見せてから確定する
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 取り込める列。key は daily_facts の列名に対応する */
const FIELDS = [
  { key: 'date', label: '日付', required: true, words: ['日付', '営業日', '年月日', '日にち', 'date', 'day'] },
  { key: 'sales', label: '売上', required: true, words: ['売上', '売り上げ', '売上高', '税込', '合計', '総売上', 'sales', 'total'] },
  { key: 'guests', label: '客数', required: false, words: ['客数', '来客', '人数', '来店', 'guest', 'customer', 'pax'] },
  { key: 'checks', label: '会計数（組数）', required: false, words: ['会計', '伝票', '組数', '組', 'check', 'bill', 'order'] },
  { key: 'cost', label: '原価', required: false, words: ['原価', '仕入', 'cost'] },
  { key: 'note', label: 'メモ', required: false, words: ['メモ', '備考', '出来事', 'note', 'memo'] },
];

/**
 * 表を1行ずつに分ける。
 * Excelからそのままコピーすると区切りはタブ、CSVで保存するとカンマになる。
 * 「1,200円」のようにカンマ入りの数字は " " で囲まれて来るので、囲みの中の区切りは無視する。
 */
function parseTable(text) {
  const body = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const head = body.split('\n').slice(0, 20);
  const tabs = head.reduce((s, l) => s + (l.split('\t').length - 1), 0);
  const commas = head.reduce((s, l) => s + (l.split(',').length - 1), 0);
  const sep = tabs > commas ? '\t' : ',';

  const rows = [];
  let cell = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === sep) { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  row.push(cell);
  rows.push(row);

  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''));
}

/** 「2024/4/1」「2024年4月1日」「2024-04-01」などを、どれも 2024-04-01 の形にそろえる */
function toDate(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const m = s.match(/(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/);
  if (!m) return '';
  const [, y, mo, d] = m;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!DATE_RE.test(iso)) return '';
  // 2月30日のような、実際には無い日をはじく
  const back = new Date(`${iso}T00:00:00Z`);
  return back.toISOString().slice(0, 10) === iso ? iso : '';
}

/** 「¥1,200」「1,200円」「1200 」などから数字だけを取り出す */
function toNum(v) {
  const s = String(v ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const cleaned = s.replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 見出しの言葉から、どの列が何かを当てる。外していれば画面で直せる */
function guessMapping(header) {
  const map = {};
  const used = new Set();
  for (const f of FIELDS) {
    for (let i = 0; i < header.length; i += 1) {
      if (used.has(i)) continue;
      const h = String(header[i] || '').toLowerCase();
      if (!h) continue;
      if (f.words.some((w) => h.includes(w.toLowerCase()))) {
        map[f.key] = i;
        used.add(i);
        break;
      }
    }
  }
  return map;
}

/** 見出し行かどうか。1列目が日付として読めるなら、それは見出しではなくデータ */
function looksLikeHeader(row) {
  return !row.some((c) => toDate(c));
}

/** 読み取り結果を作る。preview と commit で同じ関数を通し、見せた通りに入るようにする */
function readRows(table, mapping) {
  const hasHeader = table.length > 0 && looksLikeHeader(table[0]);
  const body = hasHeader ? table.slice(1) : table;
  const pick = (r, key) => (mapping[key] === undefined || mapping[key] === null ? '' : r[mapping[key]]);

  const ok = [];
  const ng = [];
  const seen = new Set();

  for (let i = 0; i < body.length; i += 1) {
    const r = body[i];
    const lineNo = i + (hasHeader ? 2 : 1);
    const date = toDate(pick(r, 'date'));
    if (!date) { ng.push({ line: lineNo, reason: '日付として読めませんでした', raw: (r[mapping.date] ?? r[0] ?? '').slice(0, 40) }); continue; }

    const sales = toNum(pick(r, 'sales'));
    if (sales === null) { ng.push({ line: lineNo, reason: '売上の数字が読めませんでした', raw: date }); continue; }
    if (sales < 0) { ng.push({ line: lineNo, reason: '売上がマイナスになっています', raw: date }); continue; }

    if (seen.has(date)) { ng.push({ line: lineNo, reason: '同じ日付が2回出てきました', raw: date }); continue; }
    seen.add(date);

    const guests = Math.max(0, Math.round(toNum(pick(r, 'guests')) || 0));
    const checks = Math.max(0, Math.round(toNum(pick(r, 'checks')) || 0));
    const cost = Math.max(0, Math.round(toNum(pick(r, 'cost')) || 0));

    ok.push({
      date,
      sales: Math.round(sales),
      guests,
      checks,
      cost,
      note: String(pick(r, 'note') || '').slice(0, 200),
    });
  }

  ok.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { hasHeader, ok, ng };
}

export async function POST(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const b = await req.json();
    const action = String(b.action || 'preview');

    const text = String(b.text || '');
    if (!text.trim()) throw new ApiError('BAD_REQUEST', '中身が空でした。ファイルを選び直すか、表を貼り付けてください');
    if (text.length > 3_000_000) throw new ApiError('BAD_REQUEST', 'ファイルが大きすぎます。年ごとに分けて取り込んでください');

    const table = parseTable(text);
    if (!table.length) throw new ApiError('BAD_REQUEST', '表として読み取れませんでした');
    if (table.length > 2000) throw new ApiError('BAD_REQUEST', '一度に取り込めるのは2000行までです。年ごとに分けてください');

    const header = looksLikeHeader(table[0]) ? table[0] : table[0].map((_, i) => `${i + 1}列目`);
    const mapping = b.mapping && typeof b.mapping === 'object' && Object.keys(b.mapping).length
      ? b.mapping
      : guessMapping(table[0]);

    const { ok, ng } = readRows(table, mapping);

    // ── 下見（まだ何も書き込まない） ───────────────
    if (action === 'preview') {
      const dates = ok.map((r) => r.date);
      const clash = dates.length
        ? await ctx.query(
            `SELECT business_date, source FROM daily_facts
              WHERE SCOPE() AND business_date >= ? AND business_date <= ?`,
            [dates[0], dates[dates.length - 1]]
          )
        : [];
      const live = new Set(clash.filter((r) => r.source !== 'import').map((r) => r.business_date));
      const already = new Set(clash.filter((r) => r.source === 'import').map((r) => r.business_date));

      return NextResponse.json({
        ok: true,
        fields: FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required })),
        header,
        mapping,
        rows: ok.slice(0, 15),
        counts: {
          ok: ok.length,
          ng: ng.length,
          skipLive: ok.filter((r) => live.has(r.date)).length,
          overwriteImport: ok.filter((r) => already.has(r.date)).length,
        },
        from: ok[0]?.date || '',
        to: ok[ok.length - 1]?.date || '',
        errors: ng.slice(0, 20),
      });
    }

    if (action !== 'commit') throw new ApiError('BAD_REQUEST', '不明な操作です');
    if (!ok.length) throw new ApiError('BAD_REQUEST', '取り込める行が1つもありませんでした');

    // ── 確定（ここで初めて書き込む） ────────────────
    // レジが自分で作った日は本物の記録なので、取り込みでは触らない
    const existing = await ctx.query(
      `SELECT business_date, source FROM daily_facts
        WHERE SCOPE() AND business_date >= ? AND business_date <= ?`,
      [ok[0].date, ok[ok.length - 1].date]
    );
    const live = new Set(existing.filter((r) => r.source !== 'import').map((r) => r.business_date));
    const target = ok.filter((r) => !live.has(r.date));
    const skipped = ok.length - target.length;

    const ts = nowIso();
    const batchId = await ctx.insert('import_batches', {
      public_id: newPublicId('im'),
      filename: String(b.filename || '').slice(0, 200),
      kind: 'daily',
      rows_ok: target.length,
      rows_ng: ng.length + skipped,
      date_from: target[0]?.date || '',
      date_to: target[target.length - 1]?.date || '',
      mapping_json: JSON.stringify(mapping),
      note: String(b.note || '').slice(0, 300),
      staff_name: ctx.staffName || '',
      created_at: ts,
    });

    for (const r of target) {
      await withTx(async (tx) => {
        const t = ctx.bind(tx);
        await t.run(`DELETE FROM daily_facts WHERE SCOPE() AND business_date = ?`, [r.date]);
        await t.insert('daily_facts', {
          business_date: r.date,
          source: 'import',
          import_batch_id: batchId,
          sales: r.sales,
          checks_count: r.checks,
          guests: r.guests,
          orders_count: 0,
          items_qty: 0,
          discount: 0,
          seat_charge: 0,
          service_charge: 0,
          void_count: 0,
          void_total: 0,
          cost_total: r.cost,
          gross_profit: r.sales - r.cost,
          ai_sales: 0,
          avg_spend: r.guests ? Math.round(r.sales / r.guests) : 0,
          avg_check: r.checks ? Math.round(r.sales / r.checks) : 0,
          turnover: 0,
          seats: 0,
          avg_serve_min: 0,
          labor_cost: 0,
          staff_count: 0,
          waste_amount: 0,
          closed: 1,
          computed_at: ts,
        });
        // メモが入っていたら、その日の出来事としても残す（あとで理由をたどれるように）
        if (r.note) {
          await t.insert('day_events', {
            business_date: r.date,
            end_date: '',
            kind: 'other',
            title: r.note.slice(0, 120),
            detail: '過去データの取り込みに入っていたメモです',
            impact: 'unknown',
            staff_name: ctx.staffName || '',
            created_at: ts,
          });
        }
      });
    }

    // 曜日・祝日・連休を、取り込んだ期間ぶん用意する（比べるときの手がかりになる）
    if (target.length) await ensureCalendar(ctx, target[0].date, target[target.length - 1].date);

    // 取り込んだ期間の天気を、あとから取り寄せる。
    // 何年も前のぶんを入れた場合も、その期間ぶんをここで埋める（毎晩の処理は直近しか見ないため）
    let weather = 0;
    if (target.length) {
      try {
        const w = await backfillWeatherRange(ctx, target[0].date, target[target.length - 1].date);
        weather = w.saved || 0;
      } catch {
        // 天気が取れなくても、売上そのものは取り込めている
      }
    }

    await logAudit(ctx, {
      action: 'history.import', targetType: 'import_batch', targetId: batchId,
      after: {
        ファイル: String(b.filename || '').slice(0, 200),
        期間: `${target[0]?.date || ''}〜${target[target.length - 1]?.date || ''}`,
        取り込んだ日数: target.length,
        読めなかった行: ng.length,
        レジの記録があるため見送った日: skipped,
      },
    });

    return NextResponse.json({
      ok: true,
      saved: target.length,
      skipped,
      failed: ng.length,
      weather,
      from: target[0]?.date || '',
      to: target[target.length - 1]?.date || '',
    });
  } catch (e) {
    return apiFail(e);
  }
}

/** これまでの取り込み履歴。いつ何を入れたかが分かるようにしておく */
export async function GET() {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const rows = await ctx.query(
      `SELECT id, public_id, filename, rows_ok, rows_ng, date_from, date_to, note, staff_name, created_at
         FROM import_batches WHERE SCOPE() ORDER BY id DESC LIMIT 50`
    );
    return NextResponse.json({
      ok: true,
      batches: rows.map((r) => ({
        id: Number(r.id), filename: r.filename, rowsOk: Number(r.rows_ok), rowsNg: Number(r.rows_ng),
        from: r.date_from, to: r.date_to, note: r.note, by: r.staff_name, at: r.created_at,
      })),
    });
  } catch (e) {
    return apiFail(e);
  }
}
