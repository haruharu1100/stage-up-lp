import { migrate } from '../lib/db/client';
import { ensureReady } from '../lib/queries';
import { pilotReport } from '../lib/pilot';

/**
 * まず10件の操作性テスト（PILOT）の結果を、そのまま報告の形で出す。
 *
 *   npm run pilot
 *
 * ユーザー指示14の①〜⑧をこの順番で出す。
 * 数字を良く見せる加工はしない。測れていないものは「測れない」と出す。
 * 0件を「100%」と書かない（CLAUDE.md ルール35）。
 */

const W = 78;
const hr = (c = '=') => console.log(c.repeat(W));

/** 長い日本語を、端末で読める幅に折り返す。全角を2文字ぶんとして数える。 */
function wrap(text: string, indent = '   ', width = W - 4): string[] {
  const out: string[] = [];
  let line = '';
  let w = 0;
  for (const ch of text) {
    const cw = ch.charCodeAt(0) < 128 ? 1 : 2;
    if (w + cw > width) { out.push(indent + line); line = ''; w = 0; }
    line += ch; w += cw;
  }
  if (line !== '') out.push(indent + line);
  return out;
}

function mark(ok: boolean, unmeasurable: boolean): string {
  return ok ? '○' : unmeasurable ? '△' : '×';
}

/** 全角を2文字ぶんとして数えて、表の列をそろえる。padEnd だけだとずれる。 */
function pad(text: string, width: number): string {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) < 128 ? 1 : 2;
  return text + ' '.repeat(Math.max(1, width - w));
}

async function main() {
  await migrate();
  await ensureReady();
  const p = await pilotReport();

  hr();
  console.log(`【まず${p.pilotSize}件の操作性テスト（PILOT）の結果】`);
  hr();
  console.log(`\n入力できた件数：${p.entered} / ${p.pilotSize}件`);

  // ---------------------------------------------------- ①〜⑧
  for (const r of p.report8) {
    console.log(`\n${'①②③④⑤⑥⑦⑧'[r.no - 1]} ${r.title}`);
    for (const l of wrap(r.bodyJa)) console.log(l);
  }

  // ---------------------------------------------------- 脱落理由の内訳
  console.log('\n' + '-'.repeat(W));
  console.log('Routeにならなかった理由（8分類）');
  console.log('-'.repeat(W));
  if (p.dropout.byReason.length === 0) {
    console.log('   まだ数えられません（実市場の出品が無いか、落ちた出品がありません）。');
  } else {
    for (const r of p.dropout.byReason) {
      console.log(`   ${pad(r.ja, 26)} ${String(r.count).padStart(3)}件（${Math.round(r.share * 100)}%）`);
      for (const l of wrap(`→ ${r.nextJa}`, '      ')) console.log(l);
    }
    console.log('   段階ごと：' + p.dropout.byStage.map((s) => `${s.ja}${s.count}件`).join('／'));
  }

  // ---------------------------------------------------- 工程ごとの時間
  console.log('\n' + '-'.repeat(W));
  console.log('工程ごとの作業時間（実測）と、自動化の効き目');
  console.log('-'.repeat(W));
  if (!p.automation.measured) {
    console.log('   まだ記録がありません。');
    // 記入見本の秒数を除外したときは、その事実も必ず出す（黙って引き算しない）。
    if (p.automation.excludedSeconds > 0) {
      for (const l of wrap(p.automation.verdictJa)) console.log(l);
    }
  } else {
    console.log('   [かかっている時間の順]');
    for (const s of p.automation.byTime) {
      console.log(
        `   ${pad(s.ja, 16)} ${String(Math.round(s.seconds / 60)).padStart(4)}分`
        + `（${String(Math.round(s.share * 100)).padStart(3)}%） ${s.automatableJa}`,
      );
    }
    console.log('\n   [自動化して効く順（＝次に作るものの順番）]');
    for (const s of p.automation.byImpact) {
      console.log(
        `   ${pad(s.ja, 16)} 減らせる見込み ${String(Math.round(s.reducibleSeconds / 60)).padStart(4)}分`
        + `（${String(Math.round(s.reducibleShare * 100)).padStart(3)}%）`,
      );
    }
    console.log('');
    for (const l of wrap(p.automation.roi.ja)) console.log(l);
  }

  // ---------------------------------------------------- 合格判定
  console.log('\n' + '-'.repeat(W));
  console.log('操作性の7項目');
  console.log('-'.repeat(W));
  for (const c of p.checks) {
    console.log(`   ${mark(c.ok, c.unmeasurable)} ${pad(c.ja, 48)} ${c.valueJa}（目安 ${c.targetJa}）`);
  }
  console.log(`   合格：${p.passedCount} / ${p.totalCount} 項目`);

  console.log('\n' + '-'.repeat(W));
  console.log('100件へ進むための安全条件（7項目）');
  console.log('-'.repeat(W));
  for (const c of p.gateChecks) {
    console.log(`   ${mark(c.ok, c.unmeasurable)} ${pad(c.ja, 48)} ${c.valueJa}`);
    for (const l of wrap(`目安：${c.targetJa}`, '      ')) console.log(l);
  }
  console.log(`   合格：${p.gatePassedCount} / ${p.gateTotalCount} 項目`);

  hr();
  console.log(p.canProceed ? '結論：100件へ進んで構いません。' : '結論：まだ100件へ進みません。');
  for (const l of wrap(p.verdictJa)) console.log(l);
  hr();
}

main().catch((e) => { console.error(e); process.exit(1); });
