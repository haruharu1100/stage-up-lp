import Link from 'next/link';
import { all } from '@/lib/db/client';
import { ensureReady } from '@/lib/queries';
import { precisionReport } from '@/lib/precision';
import { feeStatusCoverage, FEE_STATUS_JA, type FeeStatus } from '@/lib/feestatus';
import {
  validationProgress, listingsDue, workSummary, shippingAccuracy,
  LISTING_STATE_JA, OBSERVATION_CSV_TEMPLATE, TRACK_CHECKPOINTS,
  type ListingState,
} from '@/lib/observation';
import { pilotReport } from '@/lib/pilot';
import { num, pct, yen } from '@/lib/format';
import ObservationImportForm from './ObservationImportForm';
import WorkTimeForm from './WorkTimeForm';
import MatchReviewForm, { type MatchReviewOption } from './MatchReviewForm';
import { MATCH_VERDICT_JA } from '@/lib/listing';

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
  // Phase 3.7。件数だけでなく、どこで落ちているかと、10件テストの合否を出す。
  const pilot = await pilotReport();
  const funnel = pilot.funnel;
  const ship = await shippingAccuracy();

  /*
   * 人が答えを付ける組み合わせの一覧。未確認を先に出す（上から順に片付けられるように）。
   * 確認済みも残しておく。答えを直せるようにするため（見直して直すのは正しい行為）。
   */
  const matchOptions: MatchReviewOption[] = pilot.match.rows.slice(0, 50).map((r) => ({
    listingKey: r.listingKey,
    matchedVenueCode: r.matchedVenueCode,
    label: `${r.productName ?? r.listingKey} ／ ${r.matchedVenueJa}`
      + `${r.matchedName ? `「${r.matchedName}」` : ''}`
      + `${r.verdict === null ? '（未確認）' : `（確認済み：${MATCH_VERDICT_JA[r.verdict]}）`}`,
  }));

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

      <h2>まず{num(pilot.pilotSize)}件の操作性テスト（ここを通るまで100件へ進みません）</h2>
      <p className="lead small">
        いきなり100件入力しません。まず{num(pilot.pilotSize)}件だけ入れて、
        <strong>人間が面倒だと感じた工程</strong>を見つけます。そこが次に自動化すべき場所です。
      </p>
      <div className={`note ${pilot.canProceed ? '' : 'warn'}`}>
        <strong>{pilot.verdictJa}</strong>
        <br />
        {pilot.automateNextJa}
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>確認すること</th>
              <th>いまの状態</th>
              <th>合格の目安</th>
              <th>判定</th>
            </tr>
          </thead>
          <tbody>
            {pilot.checks.map((c) => (
              <tr key={c.code}>
                <td>{c.ja}</td>
                <td className="small">{c.valueJa}</td>
                <td className="small muted">{c.targetJa}</td>
                <td>
                  {c.ok
                    ? <span className="badge buy">満たしている</span>
                    : c.unmeasurable
                      ? <span className="badge skip">まだ測れない</span>
                      : <span className="badge watch">まだ</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pilot.issues.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>見つかった問題（{num(pilot.issues.length)}件）</h3>
          <ul className="small">
            {pilot.issues.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </div>
      )}
      <div className="panel small">
        <dl className="kv">
          <dt>入力にかかった合計時間</dt>
          <dd>
            {pilot.rowsWithSeconds === 0
              ? '未計測（入力秒数の列が空です）'
              : `${num(Math.round(pilot.totalSeconds / 60))}分（${num(pilot.rowsWithSeconds)}件分）`}
          </dd>
          <dt>1件あたりの平均</dt>
          <dd>
            {pilot.avgSecondsPerItem === null
              ? '未計測'
              : `${num(pilot.avgSecondsPerItem)}秒　→ 100件なら約 ${num(Math.round(pilot.avgSecondsPerItem * 100 / 60))}分`}
          </dd>
          <dt>入力できなかった情報</dt>
          <dd>
            {pilot.entered === 0
              ? '—'
              : pilot.missingFields.filter((m) => m.missing > 0).length === 0
                ? '空欄はありません'
                : pilot.missingFields.filter((m) => m.missing > 0)
                  .map((m) => `${m.ja} ${m.missing}件`).join('／')}
          </dd>
          <dt>型番・JAN・状態が取れた割合</dt>
          <dd>
            {pilot.entered === 0
              ? '—（測れません）'
              : pilot.captureRates
                .map((c) => `${c.ja} ${num(c.captured)}/${num(c.total)}件（${c.rate === null ? '測れない' : pct(c.rate)}）`)
                .join('／')}
          </dd>
          <dt>材料が足りず判断できなかった件数</dt>
          <dd>{num(pilot.insufficientDataCount)}件</dd>
          <dt>人の確認が必要な件数</dt>
          <dd>{num(pilot.humanReviewCount)}件（未確認 {num(pilot.match.unreviewed)}件／判断が付かない {num(pilot.match.uncertain)}件）</dd>
        </dl>
      </div>

      {/*
        100件へ進むための安全条件。
        上の7項目（操作性）とは目的が違うので分けてある。
        操作性が良くても、集めたデータが汚れていれば進んではいけない。
      */}
      <h2>100件へ進むための安全条件（操作性とは別の7項目）</h2>
      <p className="lead small">
        入力しやすいかどうかと、<strong>集まったデータを信用してよいかどうか</strong>は別の話です。
        両方そろって初めて100件へ進みます。
      </p>
      <div className={`note ${pilot.gateCanProceed ? '' : 'warn'}`}>
        {pilot.gatePassedCount} / {pilot.gateTotalCount} 項目を満たしています。
        {' '}{pilot.integrity.verdictJa}
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr><th>条件</th><th>いまの状態</th><th>目安</th></tr>
          </thead>
          <tbody>
            {pilot.gateChecks.map((c) => (
              <tr key={c.code}>
                <td>
                  <span className={c.ok ? 'ok' : c.unmeasurable ? 'muted' : 'danger'}>
                    {c.ok ? '○' : c.unmeasurable ? '△' : '×'}
                  </span>{' '}
                  {c.ja}
                </td>
                <td>{c.valueJa}</td>
                <td className="small muted">{c.targetJa}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pilot.integrity.issues.length > 0 && (
        <div className="panel small">
          <h3 style={{ marginTop: 0 }}>データの点検で見つかったもの</h3>
          <p className="muted">
            見つけたものを自動で消したり直したりはしません。何件が壊れていたかが分からなくなり、
            原因にたどり着けなくなるためです。
          </p>
          <ul>
            {pilot.integrity.issues.map((i) => (
              <li key={i.code}>
                <strong className={i.severe ? 'danger' : ''}>
                  {i.severe ? '【重大】' : '【気になる点】'}{i.ja}
                </strong>
                ：{num(i.count)}件。{i.detailJa}
                {i.samples.length > 0 && (
                  <span className="muted">（例：{i.samples.join('／')}）</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ユーザー指示7：Routeにならなかった商品は、必ず理由を分類して数える。 */}
      <h2>Routeにならなかった理由（8分類）</h2>
      <p className="lead small">
        「10件のうち3件しかRouteにならなかった」だけでは、次に何をすればいいか決まりません。
        <strong>なぜ落ちたのか</strong>が分かって初めて、次の一手が一つに決まります。
      </p>
      <div className="note">{pilot.dropout.verdictJa}<br />{pilot.dropout.topReasonJa}</div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>落ちた理由</th>
              <th className="num">件数</th>
              <th className="num">割合</th>
              <th>なぜ落ちるのか</th>
              <th>次にやること</th>
            </tr>
          </thead>
          <tbody>
            {pilot.dropout.byReason.length === 0 ? (
              <tr><td colSpan={5} className="muted">まだ数えられません。</td></tr>
            ) : pilot.dropout.byReason.map((r) => (
              <tr key={r.reason}>
                <td>{r.ja}</td>
                <td className="num">{num(r.count)}</td>
                <td className="num">{pct(r.share)}</td>
                <td className="small muted">{r.whyJa}</td>
                <td className="small">{r.nextJa}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pilot.dropout.byStage.length > 0 && (
        <div className="panel small">
          <dl className="kv">
            {pilot.dropout.byStage.map((s) => (
              <div key={s.stage} style={{ display: 'contents' }}>
                <dt>{s.ja}</dt>
                <dd>{num(s.count)}件（{pct(s.share)}）</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* ユーザー指示11／12：同一商品判定の精度確認。取り違えは重大。 */}
      <h2>同じ商品かどうかの答え合わせ</h2>
      <p className="lead small">
        利益が出る商品を見逃すのは「儲け損ね」で済みますが、
        <strong>違う商品を同じ商品として扱うと、実際にお金を失います</strong>。
        だから、ここだけは取り違え0件を求めます。
      </p>
      <div className={`note ${pilot.match.incorrect > 0 ? 'danger' : ''}`}>
        {pilot.match.verdictJa}
      </div>
      <div className="panel small">
        <dl className="kv">
          <dt>確認すべき組み合わせ</dt>
          <dd>{num(pilot.match.candidates)}件</dd>
          <dt>確認済み</dt>
          <dd>
            {num(pilot.match.reviewed)}件
            （{pilot.match.reviewRate === null ? '測れない' : pct(pilot.match.reviewRate)}）
          </dd>
          <dt>合っていた</dt>
          <dd>{num(pilot.match.correct)}件</dd>
          <dt>取り違え（重大）</dt>
          <dd className={pilot.match.incorrect > 0 ? 'danger' : ''}>{num(pilot.match.incorrect)}件</dd>
          <dt>判断が付かない</dt>
          <dd>{num(pilot.match.uncertain)}件</dd>
          <dt>機械の判定が当たっていた割合</dt>
          <dd>{pilot.match.precision === null ? 'まだ測れません' : pct(pilot.match.precision)}</dd>
        </dl>
      </div>
      <MatchReviewForm options={matchOptions} />
      {pilot.match.rows.filter((r) => r.verdict !== null).length > 0 && (
        <div className="scroll">
          <table>
            <thead>
              <tr><th>出品</th><th>比べた市場</th><th>相手の商品名</th><th>結果</th><th>メモ</th></tr>
            </thead>
            <tbody>
              {pilot.match.rows.filter((r) => r.verdict !== null).map((r) => (
                <tr key={`${r.listingKey}::${r.matchedVenueCode}`}>
                  <td className="small">{r.productName ?? r.listingKey}</td>
                  <td>{r.matchedVenueJa}</td>
                  <td className="small muted">{r.matchedName ?? '（商品マスタ未登録）'}</td>
                  <td className={r.verdict === 'INCORRECT_MATCH' ? 'danger' : ''}>
                    {MATCH_VERDICT_JA[r.verdict ?? ''] ?? '—'}
                  </td>
                  <td className="small muted">{r.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ユーザー指示8／9：次に自動化すると一番効く工程と、1000件換算の削減見込み。 */}
      <h2>次に自動化すると一番効く工程</h2>
      <p className="lead small">
        「面倒だった気がする」で決めると外れます。<strong>実際に測った秒数</strong>で決めます。
        ただし、時間が長い工程＝自動化できる工程ではありません。
        商品を見つける工程と情報を確認する工程は、公式APIか正式なデータ提供が無いかぎり自動化できません
        （無断で自動巡回はしません）。
      </p>
      <div className="note">
        {pilot.automation.verdictJa}
        {pilot.automation.cautionJa && (<><br />{pilot.automation.cautionJa}</>)}
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>工程</th>
              <th className="num">実測</th>
              <th className="num">全体に占める割合</th>
              <th>自動化のしやすさ</th>
              <th className="num">減らせる見込み</th>
            </tr>
          </thead>
          <tbody>
            {pilot.automation.byImpact.length === 0 ? (
              <tr><td colSpan={5} className="muted">工程ごとの秒数がまだ記録されていません。</td></tr>
            ) : pilot.automation.byImpact.map((s) => (
              <tr key={s.step}>
                <td>{s.ja}</td>
                <td className="num">{num(Math.round(s.seconds))}秒</td>
                <td className="num">{pct(s.share)}</td>
                <td className="small">{s.automatableJa}<br /><span className="muted">{s.automatableNote}</span></td>
                <td className="num">{num(Math.round(s.reducibleSeconds))}秒（{pct(s.reducibleShare)}）</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel small">
        <h3 style={{ marginTop: 0 }}>次に自動化すべき工程 TOP3</h3>
        {pilot.automation.top3Ja.length === 0 ? (
          <p className="muted">工程ごとの秒数が無いため、順番を決められません。</p>
        ) : (
          <ol>{pilot.automation.top3Ja.map((t) => <li key={t}>{t}</li>)}</ol>
        )}
        <p><strong>{pilot.automation.roi.ja}</strong></p>
      </div>

      {/* ユーザー指示14：10件が終わったら、この①〜⑧をそのまま報告する。 */}
      <h2>{num(pilot.pilotSize)}件が終わったときの報告（①〜⑧）</h2>
      <div className="panel small">
        <dl className="kv">
          {pilot.report8.map((r) => (
            <div key={r.no} style={{ display: 'contents' }}>
              <dt>{'①②③④⑤⑥⑦⑧'[r.no - 1]} {r.title}</dt>
              <dd>{r.bodyJa}</dd>
            </div>
          ))}
        </dl>
      </div>

      <h2>検証ファネル（「100件」という数字だけを追わないための表）</h2>
      <p className="lead small">
        100件入力しても、他市場と同じ商品だと確かめられなければ利益は計算できません。
        大事なのは件数ではなく<strong>どこで落ちているか</strong>です。
      </p>
      <div className="note">{funnel.verdictJa}<br />{funnel.bottleneckJa}</div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>段階</th>
              <th className="num">件数</th>
              <th className="num">入口からの割合</th>
              <th className="num">前の段からの通過率</th>
              <th className="num">ここで落ちた</th>
              <th>落ちる理由</th>
            </tr>
          </thead>
          <tbody>
            {funnel.stages.map((s) => (
              <tr key={s.code}>
                <td>{s.ja}<div className="small muted">{s.code}</div></td>
                <td className="num">{num(s.count)}</td>
                <td className="num">{s.rateFromTop === null ? '—' : pct(s.rateFromTop)}</td>
                <td className="num">{s.rateFromPrev === null ? '—' : pct(s.rateFromPrev)}</td>
                <td className="num">{s.lost > 0 ? num(s.lost) : '—'}</td>
                <td className="small muted" style={{ whiteSpace: 'normal', maxWidth: 380 }}>{s.lostReasonJa}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        STRONG BUY候補を増やしたいときに、判定を甘くすることはしません。
        手数料の実額を確認する／仕入先を増やす、のどちらかで増やします。
      </p>

      <h2>カテゴリの偏り</h2>
      {funnel.byCategory.length === 0 ? (
        <div className="note">まだ実市場の出品がありません。</div>
      ) : (
        <>
          {funnel.topCategoryShare !== null && funnel.topCategoryShare > 0.6 && (
            <div className="note warn">
              1種類のカテゴリに偏っています。1つのカテゴリだけで良い結果が出ても、
              他のカテゴリで同じ結果になるとは限りません。
            </div>
          )}
          <div className="scroll">
            <table>
              <thead><tr><th>カテゴリ</th><th className="num">件数</th><th className="num">割合</th></tr></thead>
              <tbody>
                {funnel.byCategory.map((c) => (
                  <tr key={c.category}>
                    <td>{c.category}</td>
                    <td className="num">{num(c.count)}</td>
                    <td className="num">{pct(c.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>送料の精度</h2>
      <div className="note">{ship.verdictJa}</div>
      <div className="panel small">
        <dl className="kv">
          <dt>荷物サイズが分かっている</dt><dd>{num(ship.withPackageSize)} / {num(ship.total)} 件</dd>
          <dt>発送方法が分かっている</dt><dd>{num(ship.withShippingMethod)} / {num(ship.total)} 件</dd>
          <dt>送料の負担者が分かっている</dt><dd>{num(ship.withPayer)} / {num(ship.total)} 件</dd>
          <dt>見込み送料が入っている</dt><dd>{num(ship.withEstimate)} / {num(ship.total)} 件</dd>
          <dt>見込みと実額を比べられる</dt>
          <dd>
            {num(ship.comparable)} 件
            {ship.avgAbsGapYen !== null && `　平均のずれ ${yen(ship.avgAbsGapYen)}`}
          </dd>
        </dl>
      </div>
      <p className="small muted">
        送料は利益の中で大きな割合を占めます。分からないものは0円にせず「不明」のままにしています。
      </p>

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
