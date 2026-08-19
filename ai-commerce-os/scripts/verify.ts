import { accuracyOverall, rebuildAccuracy, routeWinRates } from '../lib/accuracy';
import { migrate } from '../lib/db/client';
import { opportunitySummary } from '../lib/opportunity';
import { runVerification } from '../lib/verify';

/**
 * 答え合わせを実行する（Phase 3）。
 *
 * 期限（7日 / 30日 / 90日）が来たSHADOWだけを対象に、
 * その後の実際の相場で「本当に売れる値段だったのか」を確かめ、
 * 予測の外れ幅とRouteごとの勝率を作り直す。
 *
 * 【--now で日付を進められる理由】
 * 7日後・30日後を実際に待たないと1件も検証できないのでは、作った仕組みが正しいか確かめられない。
 * 検証用に「今を何日後とみなすか」だけ差し替えられるようにしてある。
 * 本番の運用では引数なしで動かす。
 */

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};

const pct = (v: unknown) => (v === null || v === undefined ? '—' : `${(Number(v) * 100).toFixed(1)}%`);
const yen = (v: unknown) => (v === null || v === undefined ? '—' : `${Math.round(Number(v)).toLocaleString()}円`);

async function main() {
  await migrate();

  const days = Number(arg('days') ?? 0);
  const now = arg('now') ?? (days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : undefined);
  if (now) console.log(`※ 「今」を ${now.slice(0, 10)} とみなして答え合わせします（検証用）`);

  const v = await runVerification({ now });
  console.log(
    `答え合わせ：期限到来${v.due}件 判定${v.evaluated}件` +
    ` → 売れた${v.sold} 売れなかった${v.notSold} 判定保留${v.unconfirmed}` +
    (v.skippedNoFeeVersion > 0 ? ` ／ 手数料が当時と変わっていて再計算しなかった${v.skippedNoFeeVersion}件` : ''),
  );

  const a = await rebuildAccuracy();
  console.log(`予測精度の集計：${a.rows}区分（うち点数を補正したもの ${a.adjusted}区分）`);

  const overall = await accuracyOverall();
  if (overall.length > 0) {
    console.log('\n[全体の予測精度]');
    for (const r of overall) {
      console.log(
        `  ${r.horizon_days}日後：判定済${r.decided_count}件（保留${r.unconfirmed_count}件）` +
        ` 的中率${pct(r.hit_rate)} 販売価格の平均ズレ${yen(r.avg_sell_price_error)}` +
        ` 利益の平均ズレ${yen(r.avg_net_profit_error)} ROIの平均ズレ${pct(r.avg_roi_error)}`,
      );
    }
  }

  const routes = await routeWinRates(30);
  if (routes.length > 0) {
    console.log('\n[市場の組み合わせごとの勝率（30日）]');
    for (const r of routes.slice(0, 10)) {
      console.log(
        `  ${String(r.route).padEnd(22)} SHADOW${String(r.sample_count).padStart(4)}件` +
        ` 成功${String(r.sold_count).padStart(4)} 失敗${String(r.not_sold_count).padStart(4)}` +
        ` 判定保留${String(r.unconfirmed_count).padStart(4)}` +
        ` 平均実績ROI ${pct(r.avg_actual_roi)} 補正${Number(r.score_adjustment) >= 0 ? '+' : ''}${r.score_adjustment}点`,
      );
    }
  }

  const o = await opportunitySummary();
  if (o) {
    console.log(
      `\n[利益機会の寿命] 追跡${o.total}件 生存${o.alive}件 消滅${o.expired}件` +
      ` 平均寿命${o.avg_lifetime_hours === null ? '—' : `${Number(o.avg_lifetime_hours).toFixed(1)}時間`}`,
    );
  }

  console.log('\n※ ここまでは記録と集計だけです。商品の購入も出品もしていません。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
