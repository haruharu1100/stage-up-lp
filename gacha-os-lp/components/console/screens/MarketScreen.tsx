/**
 * 相場ウォッチ。
 *
 * ═══════════════════════════════════════════════
 * ★この画面の役目
 * ═══════════════════════════════════════════════
 *
 *   ガチャの赤字は、たいてい「景品の値上がり」から始まります。
 *   作ったときは3万円だったカードが5万円になれば、
 *   ガチャの中身を1つも変えていなくても、還元率は勝手に上がります。
 *
 *   ここは、その値上がりに先に気づくための画面です。
 *
 * ★取れていない値を「変わっていない」と表示しないこと。
 *   相場の取得は、相手先の都合で止まります。
 *   止まっているのに前の値を出し続けると、
 *   「変わっていないから大丈夫」と読まれます。これがいちばん危険です。
 *   だから、いつ取れた値かを必ず併記し、古いものは古いと出します。
 */

"use client";

import { Badge, Card, DemoNote, KV, NotConnected, RowCard, Rows, Stat, Table, Td, WhatIsThis } from "../ui";
/* ★一覧をここに書き戻さないこと。
     ダッシュボードも同じ一覧を見ています。
     ここに別の一覧を置くと、2つの画面が違うことを言い始めます。 */
import {
  MARKET_ROWS as ROWS,
  marketRate as rate,
  marketSummary,
} from "@/lib/console/market";

export default function MarketScreen() {
  const m = marketSummary(ROWS);
  const up = m.spiked;
  const stale = m.stale;
  const affected = m.affected;

  return (
    <>
      {/* ★ここを下へ動かさないこと。数字より先に言わないと、意味がありません */}
      <NotConnected what="相場の取り込み（相場元のサービスに未接続）">
        実際にお使いいただくときは、ご指定の相場元から1時間ごとに自動で取り込みます。
        いまは、その取り込みが つながっていない状態です。
      </NotConnected>

      <WhatIsThis>
        景品の仕入れ値が、作ったときからどれだけ動いたかを見ます。
        <strong className="font-bold text-slate">値上がりは、ガチャを1つも変えなくても還元率を押し上げます。</strong>
      </WhatIsThis>

      <Card title="いまの状況" note="相場は1時間ごとに取り直しています。">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="見張っている景品" value={ROWS.length} unit="点" />
          <Stat label="10%以上の値上がり" value={up.length} unit="点" tone={up.length > 0 ? "danger" : "ok"} />
          <Stat
            label="相場が取れていない"
            value={stale.length}
            unit="点"
            tone={stale.length > 0 ? "warn" : "ok"}
            sub="古い値のままです"
          />
          <Stat label="影響を受けるガチャ" value={affected.size} unit="本" tone={affected.size > 0 ? "danger" : "ok"} />
        </div>
      </Card>

      {/* ── 値上がり ── */}
      {up.length > 0 && (
        <Card title="値上がりしている景品" note="この景品を使っているガチャは、還元率が上がっています。">
          <ul className="space-y-3">
            {up.map((r) => (
              <li key={r.name} className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-note font-bold text-slate">{r.name}</p>
                  <Badge tone="danger">
                    {rate(r) > 0 ? "+" : ""}
                    {rate(r).toFixed(1)}%
                  </Badge>
                </div>
                <div className="mt-2 border-t border-danger/25 pt-2">
                  <KV k="作ったときの値" v={<span className="num">{r.base.toLocaleString()}円</span>} />
                  <KV
                    k="いまの値"
                    v={<span className="num font-bold text-danger-ink">{r.now.toLocaleString()}円</span>}
                  />
                  <KV k="使っているガチャ" v={r.usedIn} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── 取れていないもの ── */}
      {stale.length > 0 && (
        <Card title="相場が取れていない景品" note="古い値のまま計算しています。">
          <ul className="space-y-3">
            {stale.map((r) => (
              <li key={r.name} className="rounded-xl border border-warn/35 bg-warn/8 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-note font-bold text-slate">{r.name}</p>
                  <Badge tone="warn">分かりません</Badge>
                </div>
                <p className="mt-2 text-note leading-[1.9] text-warn-ink">
                  相場の取得が止まっています。表示している
                  <span className="num font-bold"> {r.now.toLocaleString()}円 </span>
                  は、前回取れたときの値です。
                  <br />
                  ★「変わっていない」ではありません。「分からない」です。
                  この景品を含むガチャの還元率は、実際にはこれより悪い可能性があります。
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── 一覧 ── */}
      <Card title="見張っている景品" note="すべて架空の景品です。">
        <Table head={["景品", "作ったときの値", "いまの値", "変化", "取得時刻", "使っているガチャ"]}>
          {ROWS.map((r) => {
            const d = rate(r);
            return (
              <tr key={r.name}>
                <Td className="font-bold text-slate">{r.name}</Td>
                <Td className="num whitespace-nowrap">{r.base.toLocaleString()}円</Td>
                <Td className="num whitespace-nowrap">{r.now.toLocaleString()}円</Td>
                <Td className="num">
                  {r.at === null ? (
                    <span className="text-warn-ink">-</span>
                  ) : (
                    <span
                      className={
                        d >= 10 ? "font-bold text-danger-ink" : d >= 3 ? "font-bold text-warn-ink" : "text-slate2"
                      }
                    >
                      {d > 0 ? "+" : ""}
                      {d.toFixed(1)}%
                    </span>
                  )}
                </Td>
                <Td className="num whitespace-nowrap">
                  {r.at ?? <span className="text-warn-ink">取れていません</span>}
                </Td>
                <Td>{r.usedIn}</Td>
              </tr>
            );
          })}
        </Table>

        <Rows>
          {ROWS.map((r) => {
            const d = rate(r);
            return (
              <RowCard key={r.name}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-note font-bold text-slate">{r.name}</span>
                  {r.at === null ? (
                    <Badge tone="warn">分かりません</Badge>
                  ) : (
                    <Badge tone={d >= 10 ? "danger" : d >= 3 ? "warn" : "neutral"}>
                      {d > 0 ? "+" : ""}
                      {d.toFixed(1)}%
                    </Badge>
                  )}
                </div>
                <div className="mt-2 border-t border-edge pt-2">
                  <KV k="作ったときの値" v={<span className="num">{r.base.toLocaleString()}円</span>} />
                  <KV k="いまの値" v={<span className="num">{r.now.toLocaleString()}円</span>} />
                  <KV k="取得時刻" v={<span className="num">{r.at ?? "取れていません"}</span>} />
                  <KV k="使っているガチャ" v={r.usedIn} />
                </div>
              </RowCard>
            );
          })}
        </Rows>
      </Card>

      <DemoNote>
        ここに出ている景品と価格は、すべて架空です。実在の商品の相場ではありません。
        実際にお使いいただく管理画面では、ご指定の相場元から自動で取り込みます。
      </DemoNote>
    </>
  );
}
