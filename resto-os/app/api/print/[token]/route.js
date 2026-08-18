import { NextResponse } from 'next/server';
import iconv from 'iconv-lite';
import { nowIso } from '../../../../lib/db.js';
import { resolvePrinterToken } from '../../../../lib/print.js';

export const dynamic = 'force-dynamic';

/**
 * プリンターが直接たたく窓口（Star CloudPRNT）。
 *
 * 店のプリンターの設定画面に、この1本のURLを入れるだけで使えるようにしてある。
 *   https://（このサービス）/api/print/（プリンターごとの合言葉）
 *
 * プリンターの側から数秒おきに「印刷するものある？」と聞きに来る仕組みなので、
 * 店のルーターをいじる必要も、レジ用パソコンに常駐ソフトを入れる必要もない。
 *
 * ここはログイン画面を通らない（プリンターはログインできない）。
 * かわりに、URLに埋めた合言葉だけがその店の印刷物にたどり着ける唯一の鍵になる。
 * 合言葉が違えば、どの店の伝票も1枚も出せない。
 *
 * やり取りは3回に分かれる：
 *   POST   … 「印刷するものある？」（同時にプリンターの調子も報告してくる）
 *   GET    … 「じゃあ中身をちょうだい」（何度聞かれても同じ物を返す）
 *   DELETE … 「出せた（または出せなかった）」の報告 → ここで初めて印刷待ちから外す
 *
 * 大事なのは、DELETE が来るまで印刷待ちを消さないこと。
 * 紙切れ・電源断・LAN断のどれが起きても、直したあとに同じ伝票がちゃんと出る。
 */

const MAX_TRIES = 5;

function fail(status, message) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function auth(params) {
  return resolvePrinterToken(params?.token);
}

/** 印刷待ちの先頭（古い順）。1台のプリンターは1枚ずつしか受け取れない */
async function nextJob(ctx, printerId) {
  return ctx.first(
    `SELECT * FROM print_jobs WHERE SCOPE() AND printer_id = ? AND status = 'queued' ORDER BY id LIMIT 1`,
    [printerId]
  );
}

/**
 * ① プリンターからの定期連絡。「印刷するものある？」
 * ついでに、そのプリンターが生きているか・紙があるかもここで受け取って記録する。
 * （管理画面の「最終応答」「状態」はこれを見ている）
 */
export async function POST(req, { params }) {
  const found = await auth(params);
  if (!found) return fail(404, 'プリンターが見つかりません');
  const { printer, ctx } = found;

  let body = {};
  try { body = await req.json(); } catch { body = {}; }

  const status = String(body.statusCode || body.status || '').slice(0, 200);
  try {
    await ctx.run('UPDATE printers SET last_seen_at = ?, last_status = ? WHERE SCOPE() AND id = ?', [
      nowIso(), status, Number(printer.id),
    ]);
  } catch (e) {
    // 状態の記録に失敗しても、印刷そのものは続けさせる
    console.error('[print] プリンターの状態を記録できませんでした', e?.message || e);
  }

  // 前の1枚を印刷している最中は、次を渡さない（重ねて渡すと順番が入れ替わる）
  if (body.printingInProgress === true) {
    return NextResponse.json({ jobReady: false });
  }

  const job = await nextJob(ctx, Number(printer.id));
  if (!job) return NextResponse.json({ jobReady: false });

  return NextResponse.json({
    jobReady: true,
    mediaTypes: ['text/plain'],
    jobToken: String(job.id),
    deleteMethod: 'DELETE',
  });
}

/**
 * ② 中身を渡す。
 * 何度聞かれても同じ物を返す（通信が途切れて聞き直されても、伝票が化けないように）。
 *
 * 文字コードは店ごとに切り替えられるようにしてある。
 * プリンターの機種・設定によって、そのまま読める側が違うため。
 * 管理画面の「テスト印刷」で1枚出して、文字化けしていたら切り替えれば直る。
 */
export async function GET(req, { params }) {
  const found = await auth(params);
  if (!found) return fail(404, 'プリンターが見つかりません');
  const { printer, ctx } = found;

  const q = req.nextUrl.searchParams;
  const jobToken = q.get('token') || '';
  const job = jobToken
    ? await ctx.first('SELECT * FROM print_jobs WHERE SCOPE() AND id = ? AND printer_id = ?', [
        Number(jobToken), Number(printer.id),
      ])
    : await nextJob(ctx, Number(printer.id));

  if (!job || job.status !== 'queued') {
    return new Response('', { status: 404 });
  }

  // 同じ1枚を何度も取りに来続ける＝そのデータでプリンターが止まっている可能性がある。
  // 延々と繰り返して後ろの伝票まで出なくなるのを防ぐため、一定回数で見送る。
  const tries = Number(job.tries || 0) + 1;
  if (tries > MAX_TRIES) {
    await ctx.run(
      `UPDATE print_jobs SET status = 'failed', tries = ?, error = ? WHERE SCOPE() AND id = ?`,
      [tries, '同じ伝票を繰り返し送信したため中止しました', Number(job.id)]
    );
    return new Response('', { status: 404 });
  }
  await ctx.run('UPDATE print_jobs SET tries = ? WHERE SCOPE() AND id = ?', [tries, Number(job.id)]);

  // 末尾に余白を入れておくと、切った紙の下に文字が隠れない
  const text = `${job.body}\n\n\n`;
  const enc = String(printer.encoding || 'utf8') === 'sjis' ? 'Shift_JIS' : 'utf8';
  const buf = enc === 'utf8' ? Buffer.from(text, 'utf8') : iconv.encode(text, 'Shift_JIS');

  const headers = {
    // 付帯情報を付けると古いファームウェアが受け取れないため、種類だけを素で返す
    'Content-Type': 'text/plain',
    'Content-Length': String(buf.length),
    'Cache-Control': 'no-store',
    'X-Star-Cut': 'full feed=true',
  };
  // 会計用：印刷と同時にレジの引き出しを開ける
  if (job.kind === 'receipt' && Number(printer.drawer) === 1) headers['X-Star-CashDrawer'] = 'start';
  // 厨房用：出てきたことに気づけるようにブザーを鳴らす
  if (Number(printer.buzzer) === 1) headers['X-Star-Buzzerstartpattern'] = '1';

  return new Response(buf, { status: 200, headers });
}

/**
 * ③ 「出せた／出せなかった」の報告。ここで初めて印刷待ちから外す。
 * 失敗の報告なら、待ちに残したまま理由を記録する（直したあとに再送できる）。
 */
export async function DELETE(req, { params }) {
  const found = await auth(params);
  if (!found) return fail(404, 'プリンターが見つかりません');
  const { printer, ctx } = found;

  const q = req.nextUrl.searchParams;
  const jobToken = q.get('token') || '';
  const code = String(q.get('code') || '').trim();
  if (!jobToken) return NextResponse.json({ ok: true });

  const ok = /^200/.test(code) || code === '';
  if (ok) {
    await ctx.run(
      `UPDATE print_jobs SET status = 'done', printed_at = ?, error = '' WHERE SCOPE() AND id = ? AND printer_id = ?`,
      [nowIso(), Number(jobToken), Number(printer.id)]
    );
  } else {
    // 待ちには残す。紙を入れ直せば、そのまま同じ伝票が出てくる。
    await ctx.run(
      `UPDATE print_jobs SET error = ? WHERE SCOPE() AND id = ? AND printer_id = ?`,
      [code.slice(0, 200), Number(jobToken), Number(printer.id)]
    );
  }
  return NextResponse.json({ ok: true });
}
