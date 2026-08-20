import { connectorStatus, fetchLog, observeOnce } from '../lib/connectors/observe';
import { migrate } from '../lib/db/client';

/**
 * 実市場データの観測を1市場ぶんだけ実行する（Phase 3.5・§4 §23）。
 *
 * 使い方：
 *   npm run observe              … どの市場から取れる見込みがあるかを一覧表示するだけ
 *   npm run observe -- --venue=XXX … その1市場だけ観測を試みる
 *
 * 【まとめて全市場を回す機能は作っていない】
 * ユーザー指示「一気に全部つながないでください」に従っている。
 * 1市場ずつ、契約が取れたものだけを、人が明示的に指定して動かす。
 *
 * 【2026-08-20 時点の正直な状態】
 * 公式API・法人API・正式なデータフィードの契約が1件も無いので、
 * --venue を指定しても CONNECTOR_NOT_AVAILABLE が返り、取得件数は0になる。
 * これは不具合ではなく、規約を守った結果である。
 */

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};

async function main() {
  await migrate();

  const venue = arg('venue');

  if (!venue) {
    const st = await connectorStatus();
    console.log('[市場ごとの取得可否]');
    for (const s of st) {
      console.log(
        `  ${s.venueCode.padEnd(12)} ${s.name.padEnd(16)}` +
        ` 相場:${s.marketStats.padEnd(12)} 手数料:${s.fees.padEnd(12)}` +
        ` 自動取得:${s.autoFetchAllowed ? '可' : '不可'} — ${s.note}`,
      );
    }
    const ok = st.filter((s) => s.autoFetchAllowed).length;
    console.log(`\n正規の自動取得ができる市場：${ok} / ${st.length}`);
    if (ok === 0) {
      console.log(
        '※ 契約済みのAPI・データフィードが1件も無いため、自動では1件も取得できません。\n' +
        '   実データを入れる正規の方法は、人が実際の市場画面を見て記録したCSVの取り込みです。\n' +
        '   （取得方法を MANUAL_OBSERVATION として取り込むと、実市場データとして数えられます）',
      );
    }
    console.log('\n1市場だけ試すには： npm run observe -- --venue=市場コード');

    const log = await fetchLog(10);
    if (log.length > 0) {
      console.log('\n[直近の取得ログ]');
      for (const r of log) {
        console.log(`  ${String(r.attempted_at).slice(0, 19)} ${r.venue_code} ${r.operation} → ${r.reason}（${r.item_count}件）`);
      }
    }
    return;
  }

  console.log(`${venue} を1市場だけ観測します（規約上できない場合はここで止まります）…`);
  const r = await observeOnce(venue);
  console.log(`  結果：${r.ok ? '取得できた' : '取得しなかった'}／理由：${r.reason}／件数：${r.itemCount}`);
  console.log(`  ${r.message}`);
  console.log('\n※ この処理は読み取りだけです。購入も出品もしていません。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
