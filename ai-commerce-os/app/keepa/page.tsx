import { ensureReady } from '@/lib/queries';
import {
  KEEPA_7DAY_NOTE_JA,
  KEEPA_CURRENT_STAGE,
  KEEPA_DATA_CAUTION_JA,
  KEEPA_FORBIDDEN_ACTIONS_JA,
  KEEPA_MAX_ASINS_PER_RUN,
  KEEPA_OPEN_QUESTIONS,
  KEEPA_PRODUCT_URL_NOTE_JA,
  KEEPA_STAGES,
  KEEPA_USE_SCOPE_JA,
} from '@/lib/keepa/policy';
import { KEEPA_TOKEN_DESIGN_NOTE_JA } from '@/lib/keepa/tokens';
import { keepaKeyStatus } from '@/lib/keepa/client';
import { keepaDailyBudgetState, listKeepaProducts, listTokenUsage, tokenMonitor } from '@/lib/keepa/store';
import { SELLABILITY_VERDICT_JA, type SellabilityVerdict } from '@/lib/sellability';

export const dynamic = 'force-dynamic';

/**
 * Keepa取得（Phase 3.10・KEEPA_READ_ONLY）。
 *
 * 【この画面がやること／やらないこと】
 * やること   … いま何件取ったか、枠をどれだけ使ったか、何が UNKNOWN のままかを見せる。
 * やらないこと… ここから取得を実行する**ボタンを置かない**。
 *
 * 【なぜ画面に取得ボタンを置かないか】
 * ボタンにすると連打できてしまう。いまは「1件だけ取って必ず止まる」段階なので、
 * 取得はコマンド（`npm run keepa:one -- --asin=...`）からだけにして、
 * 1回ごとに人が結果を読む形にしてある。5件へ進むかどうかも人が決める。
 */
function n(v: unknown, unit = ''): string {
  if (v === null || v === undefined || v === '') return '不明';
  const x = Number(v);
  return Number.isFinite(x) ? `${x.toLocaleString('ja-JP')}${unit}` : String(v);
}

function day(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return s === '' ? '' : s.slice(0, 16).replace('T', ' ');
}

export default async function KeepaPage() {
  await ensureReady();

  const [key, monitor, budget, products, usage] = await Promise.all([
    Promise.resolve(keepaKeyStatus()),
    tokenMonitor(),
    keepaDailyBudgetState(),
    listKeepaProducts(50),
    listTokenUsage(30),
  ]);

  const stage = KEEPA_STAGES.find((s) => s.code === KEEPA_CURRENT_STAGE);

  return (
    <>
      <h1>Keepa取得（1件だけ・社内の検証用）</h1>
      <p className="lead">
        Keepa から商品の数字を取ってくる仕組みです。
        <strong>1回の実行で取れるのは {KEEPA_MAX_ASINS_PER_RUN} 件だけ</strong>で、
        設定で増やすことはできません（増やすにはプログラムを書き換える必要があります）。
        いまの段階は「{stage?.labelJa ?? KEEPA_CURRENT_STAGE}」です。
      </p>

      <div className="note warn">
        <strong>いまの用途：社内の検証だけ</strong>
        <p>{KEEPA_USE_SCOPE_JA}</p>
      </div>

      {/* ---- 枠の監視（Keepa API Cost Monitor） ------------------- */}
      <h2>枠の使いぐあい</h2>
      <p className="lead">{monitor.headlineJa}</p>

      <div className="cards">
        <div className="card hi">
          <div className="k">1分あたりの補充</div>
          <div className="v">{n(monitor.refillRatePerMin)}</div>
          <div className="sub">貯められる上限は {n(monitor.capacity)}（補充速度×60分）</div>
        </div>
        <div className="card">
          <div className="k">いまの残り</div>
          <div className="v">{n(monitor.tokensLeft)}</div>
          <div className="sub">まだ1回も取っていなければ「不明」です</div>
        </div>
        <div className="card">
          <div className="k">今日つかった量</div>
          <div className="v">{n(monitor.usedToday)}</div>
          <div className="sub">1日の上限 {n(budget.budget)}（超えたらその日は止まります）</div>
        </div>
        <div className="card">
          <div className="k">今月つかった量</div>
          <div className="v">{n(monitor.usedThisMonth)}</div>
          <div className="sub">呼び出し {n(monitor.requestCount)} 回</div>
        </div>
        <div className="card">
          <div className="k">取得した商品</div>
          <div className="v">{n(monitor.productCount)}</div>
          <div className="sub">同じ商品を何度取っても1点と数えます</div>
        </div>
        <div className="card">
          <div className="k">1商品あたりの平均</div>
          <div className="v">{monitor.avgPerProduct === null ? '未測定' : n(monitor.avgPerProduct)}</div>
          <div className="sub">
            {monitor.avgPerProduct === null
              ? 'まだ1件も取っていないので測っていません（0とは書きません）'
              : '今月の使用量 ÷ 取得した商品数'}
          </div>
        </div>
      </div>

      <div className="note">
        <p>{KEEPA_TOKEN_DESIGN_NOTE_JA}</p>
        <p>{monitor.estimatedCostNoteJa}</p>
      </div>

      {/* ---- 取得済みの商品 --------------------------------------- */}
      <h2>取得した商品</h2>
      <div className="note">{KEEPA_DATA_CAUTION_JA}</div>

      {products.length === 0 ? (
        <p className="lead">
          まだ1件も取得していません。
          {key.configured
            ? '取得はコマンドから行います（この画面にボタンは置いていません）。'
            : 'APIキーが未設定です。'}
          <br />
          <code>npm run keepa:one -- --asin=（10桁のASIN）</code>
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ASIN</th>
              <th>商品名</th>
              <th>いまの新品価格</th>
              <th>売れ筋順位</th>
              <th>出品者(新品)</th>
              <th>90日の下落回数</th>
              <th>推定 月間販売数</th>
              <th>売れるか</th>
              <th>取得日時</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={String(p.id)}>
                <td>{String(p.asin)}</td>
                <td>{p.title ? String(p.title) : '不明'}</td>
                <td>{p.current_new_price === null ? '不明' : `${n(p.current_new_price)}円`}</td>
                <td>{n(p.current_sales_rank, '位')}</td>
                <td>{n(p.offer_count_new)}</td>
                <td>{n(p.sales_rank_drops_90)}</td>
                <td>
                  {p.estimated_monthly_sales === null || p.estimated_monthly_sales === undefined
                    ? '不明'
                    : `約${Number(p.estimated_monthly_sales).toFixed(0)}（推定）`}
                </td>
                <td>
                  {p.sellability_verdict
                    ? (SELLABILITY_VERDICT_JA[String(p.sellability_verdict) as SellabilityVerdict]
                      ?? String(p.sellability_verdict))
                    : '判断できない'}
                </td>
                <td>{day(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="lead">
        ここに出している「推定 月間販売数」は、売れ筋順位が下がった回数から計算した推定です。
        実際の販売数ではありません（1回の注文で2個売れても下落は1回のことがあります）。
      </p>

      {/* ---- 枠の使用記録 ----------------------------------------- */}
      <h2>枠の使用記録</h2>
      {usage.length === 0 ? (
        <p className="lead">まだ記録はありません。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>日時</th>
              <th>件数</th>
              <th>見積もり</th>
              <th>実際に使った量</th>
              <th>残り</th>
              <th>補充速度</th>
              <th>結果</th>
            </tr>
          </thead>
          <tbody>
            {usage.map((u) => (
              <tr key={String(u.id)}>
                <td>{day(u.created_at)}</td>
                <td>{n(u.asin_count)}</td>
                <td>{n(u.estimated_tokens)}</td>
                <td>{n(u.tokens_consumed)}</td>
                <td>{n(u.tokens_left)}</td>
                <td>{n(u.refill_rate)}</td>
                <td>{Number(u.ok) === 1 ? '成功' : '失敗（枠だけ記録）'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ---- 分かっていないこと ----------------------------------- */}
      <h2>まだ分かっていないこと</h2>
      <p className="lead">
        この2点が確認できるまで、用途を広げません（外部への提供・再販売・本番の自動運用はしません）。
      </p>
      <ul>
        {KEEPA_OPEN_QUESTIONS.map((q) => (
          <li key={q.code}>
            <strong>{q.code}</strong>：{q.questionJa}（未確認）
          </li>
        ))}
      </ul>

      <h2>この仕組みがやらないこと</h2>
      <ul>
        {KEEPA_FORBIDDEN_ACTIONS_JA.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      <div className="note">
        <p>{KEEPA_PRODUCT_URL_NOTE_JA}</p>
        <p>{KEEPA_7DAY_NOTE_JA}</p>
      </div>

      <h2>APIキー</h2>
      <p className="lead">{key.messageJa}</p>
      <p className="lead">
        このシステムはキーの値を画面にも記録にも保存にも出しません。扱うのは「設定されているかどうか」だけです。
      </p>
    </>
  );
}
