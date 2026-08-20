import Link from 'next/link';
import { all } from '@/lib/db/client';
import { ensureReady } from '@/lib/queries';
import { precisionReport } from '@/lib/precision';
import { feeStatusCoverage, FEE_STATUS_JA, type FeeStatus } from '@/lib/feestatus';
import {
  validationProgress, listingsDue, workSummary,
  LISTING_STATE_JA, OBSERVATION_CSV_TEMPLATE, TRACK_CHECKPOINTS,
  type ListingState,
} from '@/lib/observation';
import { num, pct, yen } from '@/lib/format';
import ObservationImportForm from './ObservationImportForm';
import WorkTimeForm from './WorkTimeForm';

export const dynamic = 'force-dynamic';

/**
 * 実市場検証の進み具合（§14）。
 *
 * ここに出す数字は、すべて「実市場データとして数えられたもの」だけ。
 * 設計用サンプルは1件も混ぜない。混ぜた瞬間にこのページの意味が無くなる。
 */
export default async function ValidationPage() {
  await ensureReady();

  const [progress, due, cov, precision] = await Promise.all([
    validationProgress(100),
    listingsDue(Date.now(), 30),
    feeStatusCoverage(),
    precisionReport(30, true),
  ]);
  const work = await workSummary(100, progress.realListings);

  const mercari = cov.rows.find((r) => r.venue_code === 'MERCARI' && r.side === 'SELL');
  const mercariStatus = String(mercari?.fee_status ?? 'UNKNOWN') as FeeStatus;

  const listings = await all(
    `SELECT listing_key, product_name, product_url, latest_listing_price, first_listing_price,
            latest_state, sold_price_known, actual_sold_price, observation_count,
            identifiable, latest_observed_at
       FROM tracked_listings
      WHERE real_market_data = 1
      ORDER BY updated_at DESC
      LIMIT 100`,
  );

  const sbPrecision = precision.strongBuy.precision;

  return (
    <main>
      <h1>実市場での答え合わせ（REAL MARKET VALIDATION）</h1>
      <p className="lead">
        目的は「100件集めること」ではありません。
        <strong>STRONG BUY だけに絞ったとき、本当に利益が出る割合はいくつか</strong>を測ることです。
        ここに出る数字は、実際の市場の公開画面を見て記録したものだけで作っています。
        設計用のサンプルは1件も含めていません。
      </p>

      <div className="cards">
        <div className="card hi">
          <div className="k">集めた出品</div>
          <div className="v">{num(progress.realListings)} / {num(progress.goal)}</div>
          <div className="sub">
            {progress.realListings === 0
              ? 'まだ1件もありません'
              : `残り ${num(Math.max(0, progress.goal - progress.realListings))}件`}
          </div>
        </div>
        <div className="card">
          <div className="k">メルカリの販売手数料</div>
          <div className="v">{FEE_STATUS_JA[mercariStatus]}</div>
          <div className="sub">
            {mercariStatus === 'VERIFIED'
              ? '公式ページで確認済み（送料は商品ごとに変わるため推定のまま）'
              : 'まだ公式で確認できていません'}
          </div>
        </div>
        <div className="card">
          <div className="k">7日後まで見届けた</div>
          <div className="v">{num(progress.done7d)} 件</div>
        </div>
        <div className="card">
          <div className="k">30日後まで見届けた</div>
          <div className="v">{num(progress.done30d)} 件</div>
        </div>
        <div className="card hi">
          <div className="k">STRONG BUY の的中率</div>
          <div className="v">{sbPrecision === null ? '測定不能' : pct(sbPrecision)}</div>
          <div className="sub">
            {sbPrecision === null
              ? `答え合わせが済んだ実市場データが ${num(precision.realEvaluated)}件`
              : `${num(precision.strongBuy.decidedBuy)}件で集計`}
          </div>
        </div>
      </div>

      <div className="note warn" style={{ marginTop: 14 }}>
        <strong>100件そろっても、それだけでは実際の購入に進みません。</strong>
        <br />
        件数は入口の条件にすぎません。進めるかどうかは
        {' '}<Link href="/readiness">実購入に進めるか</Link>{' '}の14項目で判定します。
        購入・出品・決済・発送の処理は、いまこのシステムに存在しません（設定で止めているのではなく、コードごとありません）。
      </div>

      <h2>集めた出品の内訳</h2>
      <div className="panel small">
        <dl className="kv">
          <dt>商品を特定できるもの（型番・JANあり）</dt>
          <dd>
            {num(progress.identifiable)} 件
            {progress.realListings > 0 && `（${pct(progress.identifiable / progress.realListings)}）`}
          </dd>
          <dt>型番なし・一点物</dt>
          <dd>
            {num(progress.unidentifiable)} 件
            <span className="muted">　ここばかりで100件にすると、他市場と比べられません。</span>
          </dd>
          <dt>積み上がった観測</dt><dd>{num(progress.observations)} 回</dd>
          <dt>売り切れを確認できた</dt><dd>{num(progress.confirmedSold)} 件</dd>
          <dt>　うち いくらで売れたかまで分かった</dt>
          <dd>
            {num(progress.soldPriceKnown)} 件
            <span className="muted">　残りは「不明」のままにしています（出品価格で代用していません）。</span>
          </dd>
          <dt>ページが見当たらない</dt>
          <dd>
            {num(progress.removedUnknown)} 件
            <span className="muted">　売れたかどうかは不明として扱います。</span>
          </dd>
        </dl>
      </div>

      <h2>そろそろ確認する時期のもの</h2>
      <p className="lead small">
        追いかける予定は {TRACK_CHECKPOINTS.map((c) => c.ja).join(' → ')} です。
        この一覧は「予定日を過ぎたのにまだ記録が無いもの」です。
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>商品</th>
              <th>いつの確認</th>
              <th className="num">予定から</th>
              <th>前回の状態</th>
            </tr>
          </thead>
          <tbody>
            {due.length === 0 && (
              <tr><td colSpan={4} className="muted">いま確認が必要なものはありません。</td></tr>
            )}
            {due.map((d) => (
              <tr key={`${d.listingKey}-${d.checkpoint}`}>
                <td className="small">{d.productName ?? d.productUrl}</td>
                <td>{d.checkpointJa}</td>
                <td className="num">{Math.floor(d.overdueHours / 24)}日 遅れ</td>
                <td className="small">{LISTING_STATE_JA[d.latestState as ListingState] ?? d.latestState}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>観測を記録する</h2>
      <p className="lead small">
        必要なのは <strong>確認日時・商品URL</strong> の2つ。
        初めて登録する商品だけ <strong>商品名・価格・状態</strong> も入れてください。
        2回目以降は「販売状況」だけで構いません。
        <strong>分からない項目は空欄のままにしてください。推測で埋めないでください。</strong>
      </p>
      <ObservationImportForm template={OBSERVATION_CSV_TEMPLATE} />

      <h2>いま追いかけている出品</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>商品</th>
              <th className="num">最初の価格</th>
              <th className="num">今の価格</th>
              <th>状態</th>
              <th className="num">成約価格</th>
              <th className="num">観測回数</th>
            </tr>
          </thead>
          <tbody>
            {listings.length === 0 && (
              <tr><td colSpan={6} className="muted">まだ1件も登録されていません。</td></tr>
            )}
            {listings.map((r, i) => (
              <tr key={i}>
                <td className="small">
                  {String(r.product_name ?? '（名称未記入）')}
                  {Number(r.identifiable) !== 1 && <span className="muted">　型番なし</span>}
                </td>
                <td className="num">{yen(r.first_listing_price === null ? null : Number(r.first_listing_price))}</td>
                <td className="num">{yen(r.latest_listing_price === null ? null : Number(r.latest_listing_price))}</td>
                <td className="small">{LISTING_STATE_JA[String(r.latest_state) as ListingState] ?? String(r.latest_state)}</td>
                <td className="num">
                  {Number(r.sold_price_known) === 1
                    ? yen(Number(r.actual_sold_price))
                    : <span className="muted">不明</span>}
                </td>
                <td className="num">{num(Number(r.observation_count))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>人間の作業時間</h2>
      <p className="lead small">
        どの工程を自動化すべきかは、感覚ではなく実測で決めます。
        面倒に感じる工程と、実際に時間を食っている工程は、たいてい違います。
      </p>
      <div className="panel small">
        {!work.measured && <div className="note">{work.note}</div>}
        {work.measured && (
          <>
            <dl className="kv">
              <dt>合計</dt><dd>{Math.round(work.totalSeconds / 60)} 分 / {num(work.totalRows)} 件</dd>
              <dt>1件あたり</dt>
              <dd>{work.secondsPerRow === null ? '不明' : `${Math.round(work.secondsPerRow)} 秒`}</dd>
              <dt>100件そろえるのに残り</dt>
              <dd>
                {work.estimatedHoursTo100 === null
                  ? '不明'
                  : `およそ ${work.estimatedHoursTo100.toFixed(1)} 時間`}
              </dd>
            </dl>
            <table>
              <thead>
                <tr><th>工程</th><th className="num">合計</th><th className="num">1件あたり</th><th className="num">割合</th></tr>
              </thead>
              <tbody>
                {work.byStep.map((s) => (
                  <tr key={s.step}>
                    <td>{s.ja}</td>
                    <td className="num">{Math.round(s.seconds)} 秒</td>
                    <td className="num">{s.secondsPerRow === null ? '—' : `${Math.round(s.secondsPerRow)} 秒`}</td>
                    <td className="num">{pct(s.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="note" style={{ marginTop: 10 }}>{work.note}</div>
          </>
        )}
      </div>
      <WorkTimeForm />

      <h2>手数料の確認状況</h2>
      <div className="panel small">
        <dl className="kv">
          <dt>{FEE_STATUS_JA.VERIFIED}</dt><dd>{num(cov.verified)} 件</dd>
          <dt>{FEE_STATUS_JA.ESTIMATED}</dt><dd>{num(cov.estimated)} 件</dd>
          <dt>{FEE_STATUS_JA.OUTDATED}</dt><dd>{num(cov.outdated)} 件</dd>
          <dt>{FEE_STATUS_JA.UNKNOWN}</dt><dd>{num(cov.unknown)} 件</dd>
          <dt>確認済みの割合</dt>
          <dd>{pct(cov.verifiedRatio)}<span className="muted">　卒業条件は90%以上</span></dd>
        </dl>
        <p className="muted">
          手数料の数字は人間が公式ページを見て登録します。AIが推測で埋めることはありません。
        </p>
      </div>

      <p className="small" style={{ marginTop: 20 }}>
        取得方法について：ここに記録するのは<strong>自分で公開画面を見て書き写したもの</strong>です。
        事業者から提供を受けたデータではありません。自動巡回は行いません。
        件数を増やす前に、公式APIや正式なデータ提供の有無を確認してください。
      </p>
    </main>
  );
}
