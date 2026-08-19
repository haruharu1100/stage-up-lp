import Link from 'next/link';
import { all } from '@/lib/db/client';
import { ensureReady } from '@/lib/queries';
import { capitalPlan } from '@/lib/routequeries';
import { getThresholds } from '@/lib/settings';
import type { Venue } from '@/lib/venues';
import { num, pct, yen } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PRESETS = [300000, 500000, 1000000, 3000000];

export default async function CapitalPage({ searchParams }: { searchParams: { budget?: string } }) {
  await ensureReady();
  const t = await getThresholds();
  const raw = Number(searchParams.budget ?? 1000000);
  const budget = Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), 100000000) : 1000000;

  const [venuesRaw, plan] = await Promise.all([
    all('SELECT * FROM venues ORDER BY code'),
    capitalPlan(budget, t.capitalMaxPerBrandRatio, t.capitalMaxPerVenueRatio),
  ]);
  const venues = venuesRaw as unknown as Venue[];
  const nameOf = (code: string) => venues.find((v) => v.code === code)?.name ?? code;

  const rest = budget - plan.usedCapital;

  return (
    <main>
      <h1>今日この予算を使うなら</h1>
      <p className="lead">
        いま成立しているRouteの中から、30日あたりの期待リターンが高い順に選びます。市場をまたいで配分します。
        <strong>これは提案です。システムが自動で買うことはありません</strong>（購入する処理そのものが存在しません）。
      </p>

      <form className="filters" method="get">
        <label htmlFor="budget" className="muted small">予算（円）</label>
        <input id="budget" name="budget" type="number" min={10000} step={10000} defaultValue={budget} />
        <button type="submit">計算する</button>
        {PRESETS.map((p) => (
          <Link key={p} href={`/capital?budget=${p}`} className="small">{(p / 10000).toLocaleString()}万円</Link>
        ))}
      </form>

      <div className="cards">
        <div className="card">
          <div className="k">予算</div>
          <div className="v sm">{yen(budget)}</div>
        </div>
        <div className="card">
          <div className="k">使う金額</div>
          <div className="v sm">{yen(plan.usedCapital)}</div>
          <div className="sub">残り {yen(rest)}</div>
        </div>
        <div className="card">
          <div className="k">買う商品数</div>
          <div className="v">{num(plan.picked.length)}</div>
          <div className="sub">一点物が多いので1商品1個</div>
        </div>
        <div className="card hi">
          <div className="k">予想純利益の合計</div>
          <div className="v sm">{yen(plan.expectedProfit)}</div>
          <div className="sub">全部売れた場合の机上の値</div>
        </div>
        <div className="card">
          <div className="k">予想ROI</div>
          <div className="v sm">{pct(plan.expectedRoi)}</div>
        </div>
      </div>

      {plan.picked.length === 0 && (
        <div className="note" style={{ marginTop: 14 }}>
          いま買うべきと言えるRouteがありません。
          <Link href="/import">CSV取込</Link> で商品を増やすか、<Link href="/market">市場ごとの相場</Link> を登録してください。
          判定を甘くして件数を増やすことはしません。
        </div>
      )}

      <div className="note" style={{ marginTop: 14 }}>
        偏りを防ぐため、1ブランドに予算の {pct(t.capitalMaxPerBrandRatio, 0)} まで、
        1つの販売先に予算の {pct(t.capitalMaxPerVenueRatio, 0)} までしか配分しません。
        この上限で外したものが、ブランド偏りで {num(plan.skippedByBrand)} 件、販売先偏りで {num(plan.skippedByVenue)} 件、
        予算オーバーで {num(plan.skippedByBudget)} 件あります。
      </div>

      <h2>仕入先ごとの配分</h2>
      <div className="cards">
        {Object.entries(plan.byBuyVenue).sort((a, b) => b[1] - a[1]).map(([code, v]) => (
          <div className="card" key={code}>
            <div className="k">{nameOf(code)} で買う</div>
            <div className="v sm">{yen(v)}</div>
            <div className="sub">予算の {pct(budget > 0 ? v / budget : null)}</div>
          </div>
        ))}
        {Object.keys(plan.byBuyVenue).length === 0 && <p className="muted small">配分なし。</p>}
      </div>

      <h2>販売先ごとの配分</h2>
      <div className="cards">
        {Object.entries(plan.bySellVenue).sort((a, b) => b[1] - a[1]).map(([code, v]) => (
          <div className="card" key={code}>
            <div className="k">{nameOf(code)} で売る</div>
            <div className="v sm">{yen(v)}</div>
            <div className="sub">予算の {pct(budget > 0 ? v / budget : null)}</div>
          </div>
        ))}
        {Object.keys(plan.bySellVenue).length === 0 && <p className="muted small">配分なし。</p>}
      </div>

      <h2>買う順番</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>商品</th>
              <th>買う</th>
              <th>売る</th>
              <th className="num">仕入総額</th>
              <th className="num">予想純利益</th>
              <th className="num">ROI</th>
              <th className="num">30日リターン</th>
              <th className="num">売却日数</th>
              <th className="num">累計</th>
            </tr>
          </thead>
          <tbody>
            {plan.picked.map((p, i) => {
              const r = p.route as Record<string, unknown>;
              const cum = plan.picked.slice(0, i + 1).reduce((s, x) => s + x.spend, 0);
              return (
                <tr key={String(r.id)}>
                  <td className="num">{i + 1}</td>
                  <td>
                    <Link href={`/products/${r.supplier_product_id}`}>{String(r.name ?? '')}</Link>
                    <div className="small muted">{String(r.brand ?? '')}</div>
                  </td>
                  <td>{nameOf(String(r.buy_venue_code))}</td>
                  <td>{nameOf(String(r.sell_venue_code))}</td>
                  <td className="num">{yen(p.spend)}</td>
                  <td className="num pos">{yen(p.expectedProfit)}</td>
                  <td className="num">{pct(r.expected_roi === null ? null : Number(r.expected_roi))}</td>
                  <td className="num">{pct(Number(r.expected_30d_return))}</td>
                  <td className="num">{num(Number(r.expected_days_to_sell))}日</td>
                  <td className="num muted">{yen(cum)}</td>
                </tr>
              );
            })}
            {plan.picked.length === 0 && <tr><td colSpan={10} className="muted">該当なし。</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="panel small" style={{ marginTop: 14 }}>
        <strong>30日リターンの見方。</strong>{' '}
        「利益率 × 30日で何回転できるか × 30日で売れる確率」です。売れる確率を掛けているので、
        高く売れるが売れにくい商品は自動的に順位が下がります。年率換算も持っていますが、実態より大きく見えるため画面では使いません。
      </div>
    </main>
  );
}
