/**
 * 景品マスター。
 *
 * ═══════════════════════════════════════════════
 * ★この画面の役目
 * ═══════════════════════════════════════════════
 *
 *   ガチャに入れる景品を、1か所にまとめておく場所です。
 *   ここに仕入れ値と購入先を入れておくと、
 *   ・還元率が自動で計算できる
 *   ・発送のときに、すぐ仕入れに行ける
 *   の2つが同時に片づきます。
 *
 * ★仕入れ値が入っていない景品を、ガチャに入れられないようにすること。
 *   仕入れ値が空のまま入れると、還元率の計算からその分が抜けます。
 *   計算上は「安全」に見えて、実際には赤字、という状態になります。
 *
 * ★在庫数と、ガチャに割り当てた本数が食い違わないようにすること。
 *   手元に3本しかないのに5本当たる設定にすると、
 *   当たった方にお渡しできません。信用を失うのは一瞬です。
 */

"use client";

import { Badge, Btn, Card, DemoNote, KV, RowCard, Rows, Stat, Table, Td, WhatIsThis } from "../ui";

type Item = {
  id: string;
  name: string;
  /** 仕入れ値（円）。null は未入力 */
  cost: number | null;
  stock: number;
  assigned: number;
  usedIn: string;
};

/** ★すべて架空の景品です */
const ITEMS: Item[] = [
  { id: "p_01", name: "デモ景品A（S賞相当）", cost: 58_000, stock: 2, assigned: 1, usedIn: "腕時計 ハイエンド 3000" },
  { id: "p_02", name: "デモ景品B（A賞相当）", cost: 21_400, stock: 6, assigned: 4, usedIn: "腕時計 ハイエンド 3000" },
  { id: "p_03", name: "デモ景品C（S賞相当）", cost: 27_100, stock: 1, assigned: 1, usedIn: "プレミアムカード 500" },
  { id: "p_04", name: "デモ景品D（A賞相当）", cost: 9_600, stock: 14, assigned: 12, usedIn: "プレミアムカード 500" },
  { id: "p_05", name: "デモ景品E（S賞相当）", cost: 31_000, stock: 1, assigned: 2, usedIn: "スニーカー BOX 1000" },
  { id: "p_06", name: "デモ景品F（B賞相当）", cost: 4_050, stock: 40, assigned: 20, usedIn: "スニーカー BOX 1000" },
  { id: "p_07", name: "デモ景品G（新規登録分）", cost: null, stock: 0, assigned: 0, usedIn: "未使用" },
];

export default function ProductsScreen() {
  const noCost = ITEMS.filter((i) => i.cost === null);
  const short = ITEMS.filter((i) => i.assigned > i.stock);
  const total = ITEMS.reduce((a, i) => a + (i.cost ?? 0) * i.stock, 0);

  return (
    <>
      <WhatIsThis>
        ガチャに入れる景品と、その仕入れ値をまとめておく場所です。
        <strong className="font-bold text-slate">仕入れ値が入っていない景品は、ガチャに入れられません。</strong>
      </WhatIsThis>

      <Card title="いまの状況">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="登録数" value={ITEMS.length} unit="点" />
          <Stat label="在庫の評価額" value={`${total.toLocaleString()}円`} />
          <Stat
            label="仕入れ値が未入力"
            value={noCost.length}
            unit="点"
            tone={noCost.length > 0 ? "warn" : "ok"}
          />
          <Stat
            label="在庫が足りない"
            value={short.length}
            unit="点"
            tone={short.length > 0 ? "danger" : "ok"}
          />
        </div>
      </Card>

      {/* ── 在庫が足りない ── */}
      {short.length > 0 && (
        <Card
          title="在庫より多く当たる設定になっています"
          note="このまま当たると、お渡しできません。"
        >
          <ul className="space-y-3">
            {short.map((i) => (
              <li key={i.id} className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-note font-bold text-slate">{i.name}</p>
                  <Badge tone="danger">在庫不足</Badge>
                </div>
                <p className="mt-2 text-note leading-[1.9] text-danger-ink">
                  手元に <span className="num font-bold">{i.stock}本</span> しかありませんが、
                  <span className="num font-bold"> {i.assigned}本 </span>
                  が当たる設定になっています。
                  <br />
                  先に仕入れるか、当たる本数を減らしてください。
                </p>
                <div className="mt-3">
                  <Btn disabled title="デモでは外部サイトを開きません">
                    仕入れ先を開く
                  </Btn>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── 仕入れ値が未入力 ── */}
      {noCost.length > 0 && (
        <Card title="仕入れ値が入っていない景品" note="この景品は、ガチャに入れられません。">
          <ul className="space-y-3">
            {noCost.map((i) => (
              <li key={i.id} className="rounded-xl border border-warn/35 bg-warn/8 px-4 py-4">
                <p className="text-note font-bold text-slate">{i.name}</p>
                <p className="mt-2 text-note leading-[1.9] text-warn-ink">
                  仕入れ値が空のままです。このまま入れると、還元率の計算からこの分が抜け、
                  数字だけ「安全」に見える状態になります。
                  <br />
                  ★仕組みとして、仕入れ値が空の景品はガチャに割り当てられません。
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── 一覧 ── */}
      <Card title="景品一覧" note="すべて架空の景品です。">
        <Table head={["景品", "仕入れ値", "在庫", "割り当て", "使っているガチャ", "状態"]}>
          {ITEMS.map((i) => (
            <tr key={i.id}>
              <Td className="font-bold text-slate">{i.name}</Td>
              <Td className="num whitespace-nowrap">
                {i.cost === null ? <span className="text-warn-ink">未入力</span> : `${i.cost.toLocaleString()}円`}
              </Td>
              <Td className="num">{i.stock}本</Td>
              <Td className="num">
                <span className={i.assigned > i.stock ? "font-bold text-danger-ink" : ""}>
                  {i.assigned}本
                </span>
              </Td>
              <Td>{i.usedIn}</Td>
              <Td>
                {i.cost === null ? (
                  <Badge tone="warn">使えません</Badge>
                ) : i.assigned > i.stock ? (
                  <Badge tone="danger">在庫不足</Badge>
                ) : (
                  <Badge tone="ok">問題なし</Badge>
                )}
              </Td>
            </tr>
          ))}
        </Table>

        <Rows>
          {ITEMS.map((i) => (
            <RowCard key={i.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-note font-bold text-slate">{i.name}</span>
                {i.cost === null ? (
                  <Badge tone="warn">使えません</Badge>
                ) : i.assigned > i.stock ? (
                  <Badge tone="danger">在庫不足</Badge>
                ) : (
                  <Badge tone="ok">問題なし</Badge>
                )}
              </div>
              <div className="mt-2 border-t border-edge pt-2">
                <KV
                  k="仕入れ値"
                  v={<span className="num">{i.cost === null ? "未入力" : `${i.cost.toLocaleString()}円`}</span>}
                />
                <KV k="在庫" v={<span className="num">{i.stock}本</span>} />
                <KV k="割り当て" v={<span className="num">{i.assigned}本</span>} />
                <KV k="使っているガチャ" v={i.usedIn} />
              </div>
            </RowCard>
          ))}
        </Rows>

        <p className="mt-5 text-note leading-[1.9] text-slate3">
          ★仕入れ値は、相場ウォッチの値で自動的に更新されます。
          手で入れ直す必要はありません。相場が取れていない景品は、その旨が出ます。
        </p>
      </Card>

      <DemoNote>
        ここに出ている景品・価格・在庫は、すべて架空です。
        「仕入れ先を開く」も、デモでは外部サイトにつながりません。
      </DemoNote>
    </>
  );
}
