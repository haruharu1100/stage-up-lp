import Link from 'next/link';
import { all } from '@/lib/db/client';
import { ensureReady } from '@/lib/queries';
import { marketMatrix } from '@/lib/routequeries';
import { BLOCKED_REASON_JA, type Venue } from '@/lib/venues';
import { num, pct, yen } from '@/lib/format';

export const dynamic = 'force-dynamic';

function cellClass(roi: number | null): string {
  if (roi === null) return '';
  if (roi >= 0.4) return 'pos';
  if (roi <= 0) return 'neg';
  return '';
}

export default async function MatrixPage() {
  await ensureReady();
  const venues = (await all('SELECT * FROM venues ORDER BY code')) as unknown as Venue[];
  const { cells, blocked } = await marketMatrix();

  const buyVenues = venues.filter((v) => v.can_buy === 1);
  const sellVenues = venues.filter((v) => v.can_sell === 1);

  const key = (b: string, s: string) => `${b}>${s}`;
  const cellMap = new Map<string, Record<string, unknown>>();
  for (const c of cells) cellMap.set(key(String(c.buy_venue_code), String(c.sell_venue_code)), c);
  const blockedMap = new Map<string, { reason: string; n: number }>();
  for (const b of blocked) {
    blockedMap.set(key(String(b.buy_venue_code), String(b.sell_venue_code)), {
      reason: String(b.blocked_reason), n: Number(b.n),
    });
  }

  const hasAny = cells.length > 0;

  return (
    <main>
      <h1>市場マトリクス（どこで買って、どこで売るか）</h1>
      <p className="lead">
        縦が仕入先、横が販売先です。数字は<strong>手数料・送料・返品見込みまで全部引いたあと</strong>の期待ROIの平均です。
        同じ市場同士（自分で買って自分で売る）は最初から対象外にしています。
      </p>

      {!hasAny && (
        <div className="note">
          まだRouteがありません。<Link href="/import">CSV取込</Link> で商品を入れ、
          <Link href="/market"> 市場ごとの相場</Link> を登録してください。
        </div>
      )}

      {hasAny && (
        <>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>仕入 ↓ ／ 販売 →</th>
                  {sellVenues.map((s) => (
                    <th key={s.code} className="num">
                      {s.name}
                      {s.terms_status === 'BLOCKED' && <div className="small" style={{ color: '#ef9b9b' }}>停止中</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {buyVenues.map((b) => (
                  <tr key={b.code}>
                    <th style={{ textAlign: 'left' }}>{b.name}</th>
                    {sellVenues.map((s) => {
                      if (b.code === s.code) return <td key={s.code} className="num muted">—</td>;
                      const c = cellMap.get(key(b.code, s.code));
                      const bl = blockedMap.get(key(b.code, s.code));
                      if (!c) {
                        return (
                          <td key={s.code} className="num muted small">
                            {bl ? BLOCKED_REASON_JA[bl.reason] ?? bl.reason : 'データなし'}
                          </td>
                        );
                      }
                      const ok = Number(c.ok_count ?? 0);
                      const roi = c.avg_roi === null ? null : Number(c.avg_roi);
                      if (ok === 0) {
                        return (
                          <td key={s.code} className="num muted small">
                            {bl ? BLOCKED_REASON_JA[bl.reason] ?? bl.reason : `成立0件 / ${num(Number(c.route_count))}件計算`}
                          </td>
                        );
                      }
                      return (
                        <td key={s.code} className="num">
                          <strong className={cellClass(roi)}>{pct(roi)}</strong>
                          <div className="small muted">
                            {num(ok)}件 ／ 平均{yen(Number(c.avg_net_profit ?? 0))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>読み方</h2>
          <div className="panel small">
            <ul className="reasons">
              <li>「成立0件」は、計算はしたが利益・売却見込みの基準に届かなかった組み合わせです。</li>
              <li>赤字の組み合わせも消さずに計算しています。あとで手数料や相場が変われば成立するためです。</li>
              <li>
                「停止中」の市場は、市場としては売る機能があるものの、いまこちらに出品する許可がありません。
                期待利益は計算しますが、実行はできません（<Link href="/routes">取り逃し一覧</Link>）。
              </li>
              <li>平均ROIは、その組み合わせで成立したRouteの平均です。件数が少ないセルは参考程度に見てください。</li>
            </ul>
          </div>
        </>
      )}
    </main>
  );
}
