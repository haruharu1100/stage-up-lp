import Link from 'next/link';
import { all } from '@/lib/db/client';
import { ensureReady } from '@/lib/queries';
import { marketDataByVenue } from '@/lib/routequeries';
import { MARKET_CSV_TEMPLATE } from '@/lib/marketdata';
import { PRICE_BASIS_JA } from '@/lib/route';
import type { Venue } from '@/lib/venues';
import { num, pct } from '@/lib/format';
import MarketImportForm from './MarketImportForm';

export const dynamic = 'force-dynamic';

export default async function MarketPage() {
  await ensureReady();
  const [venuesRaw, coverage] = await Promise.all([
    all('SELECT * FROM venues ORDER BY code'),
    marketDataByVenue(),
  ]);
  const venues = venuesRaw as unknown as Venue[];
  const nameOf = (code: string) => venues.find((v) => v.code === code)?.name ?? code;

  const total = coverage.reduce((s, r) => s + Number(r.n), 0);
  const soldBased = coverage.reduce((s, r) => s + Number(r.sold_based), 0);

  return (
    <main>
      <h1>市場ごとの相場</h1>
      <p className="lead">
        「メルカリではいくら、eBayではいくら」を市場ごとに持ちます。1つの相場を全市場に当てはめると、
        市場を比べること自体ができないためです。ここに無い市場は「参考相場を当てはめた仮定値」として扱い、
        信頼度を下げて画面にもそう表示します。数字を作りません。
      </p>

      <div className="cards">
        <div className="card">
          <div className="k">登録件数</div>
          <div className="v">{num(total)}</div>
        </div>
        <div className="card hi">
          <div className="k">成約価格に基づくもの</div>
          <div className="v">{num(soldBased)}</div>
          <div className="sub">全体の {pct(total > 0 ? soldBased / total : null)}</div>
        </div>
        <div className="card">
          <div className="k">出品価格どまり</div>
          <div className="v">{num(total - soldBased)}</div>
          <div className="sub">売れた証拠ではない</div>
        </div>
      </div>

      <div className="note" style={{ marginTop: 14 }}>
        取り込む値は、できるだけ<strong>成約価格（実際に売れた値段）</strong>にしてください。
        出品価格は「その値段で売れた証拠」ではないため、システムは信頼度を下げて扱います。
        取得手段は公式API・正式なデータ提供・CSVなど、規約上認められた方法に限ってください。
        無断の自動収集はこのシステムでは行いません。
      </div>

      <h2>いま登録されている相場</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>市場</th>
              <th>区分</th>
              <th className="num">件数</th>
              <th className="num">成約ベース</th>
              <th>最終取得日</th>
            </tr>
          </thead>
          <tbody>
            {coverage.length === 0 && (
              <tr><td colSpan={5} className="muted">まだ1件も登録されていません。</td></tr>
            )}
            {coverage.map((r, i) => (
              <tr key={i}>
                <td>{nameOf(String(r.venue_code))}</td>
                <td>{r.side === 'BUY' ? '買う（仕入相場）' : '売る（販売相場）'}</td>
                <td className="num">{num(Number(r.n))}</td>
                <td className="num">{num(Number(r.sold_based))}</td>
                <td className="small muted">{String(r.latest ?? '').slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>相場を取り込む</h2>
      <p className="lead small">
        必要なのは「市場・区分（売る／買う）・商品を特定できる情報（JAN、またはブランドと型番）・価格」です。
        商品を推測で結びつけないため、JANもブランド＋型番も無い行は取り込みません。
      </p>
      <MarketImportForm template={MARKET_CSV_TEMPLATE} />

      <h2>価格の種類</h2>
      <div className="panel small">
        <dl className="kv">
          <dt>成約（SOLD_MEDIAN）</dt><dd>{PRICE_BASIS_JA.SOLD_MEDIAN}。一番信頼できます。</dd>
          <dt>出品（ASK_MEDIAN）</dt><dd>{PRICE_BASIS_JA.ASK_MEDIAN}。売れた証拠ではないため信頼度を下げます。</dd>
          <dt>買取・入札（BID）</dt><dd>{PRICE_BASIS_JA.BID}。</dd>
          <dt>未登録の市場</dt><dd>{PRICE_BASIS_JA.REFERENCE_FALLBACK}として計算し、信頼度を大きく下げます。</dd>
        </dl>
      </div>

      <p className="small" style={{ marginTop: 20 }}>
        取り込むと <Link href="/routes">Route</Link> と <Link href="/matrix">市場マトリクス</Link> が自動で作りなおされます。
      </p>
    </main>
  );
}
