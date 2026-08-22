/**
 * お客様画面の確認（CUSTOMER PREVIEW）。
 *
 * ═══════════════════════════════════════════════
 * ★この画面の役目
 * ═══════════════════════════════════════════════
 *
 *   公開ボタンを押す前に、お客様の目で同じ画面を見るための場所です。
 *
 *   管理画面から見えているものと、お客様に見えているものは違います。
 *   管理画面には設計還元率も粗利も出ていますが、お客様には出ません。
 *   「管理画面では問題なさそうに見えたが、
 *     お客様の画面では賞の内容がまったく分からなかった」
 *   は、公開してから気づくと取り返しがつきません。
 *
 * ★スマホで先に見ること。
 *   オンラインガチャは、ほとんどがスマホから引かれます。
 *   PCで整えてからスマホを見ると、たいてい入りません。
 *
 * ═══════════════════════════════════════════════
 * ★ここで実際に引けるようにしてある理由
 * ═══════════════════════════════════════════════
 *
 *   「引ける」ことより、「引いたら何が動くか」を見ていただくためです。
 *
 *   1回引くと、残り口数・売上・粗利・実還元率・お客様の残高が動き、
 *   当たれば発送依頼が1件増えます。
 *   その全部を、他の画面を回って確かめられます。
 *
 *   ★当選結果は、この画面では決めていません。
 *     運営側（lib/console/state.ts の reducer）で決めて、
 *     この画面は決まった結果を見せているだけです。
 *     お客様の端末で結果を決める作りにすると、書き換えられます。
 */

"use client";

import { useState } from "react";
import type { ConsoleState, ConsoleAction } from "@/lib/console/state";
import { PREVIEW_USER_ID } from "@/lib/console/state";
import { poolOf } from "@/lib/console/draw";
import type { MenuKey } from "../menu";
import { Badge, Btn, Card, DemoNote, KV, Table, Td, WhatIsThis } from "../ui";

type Mode = "sp" | "pc";

export default function PreviewScreen({
  s,
  dispatch,
  onNav,
}: {
  s: ConsoleState;
  dispatch: React.Dispatch<ConsoleAction>;
  onNav: (k: MenuKey) => void;
}) {
  const [mode, setMode] = useState<Mode>("sp");
  const [gachaId, setGachaId] = useState<string>(
    s.gachas.find((g) => g.status === "PUBLISHED")?.id ?? s.gachas[0].id,
  );
  /* 二重送信を実演するために、直前に使った鍵を覚えておく */
  const [lastKey, setLastKey] = useState<string | null>(null);

  const g = s.gachas.find((x) => x.id === gachaId) ?? s.gachas[0];
  const me = s.users.find((u) => u.id === PREVIEW_USER_ID)!;
  const myDraws = s.draws.filter((d) => d.gachaId === g.id);
  const last = s.draws[s.draws.length - 1] ?? null;

  const draw = () => {
    const key = `${g.id}-${s.draws.length + 1}-${Date.now()}`;
    setLastKey(key);
    dispatch({ type: "DRAW", gachaId: g.id, key });
  };

  const drawAgainSameKey = () => {
    if (!lastKey) return;
    dispatch({ type: "DRAW", gachaId: g.id, key: lastKey });
  };

  return (
    <>
      <WhatIsThis>
        公開ボタンを押す前に、お客様の目で同じ画面を見ます。
        <strong className="font-bold text-slate">スマホから先に見てください。</strong>
        オンラインガチャは、ほとんどがスマホから引かれます。
      </WhatIsThis>

      {/* ── 切り替え ── */}
      <Card
        title="どのガチャを、どの画面幅で見るか"
        note="切り替えても、お客様に見えているものは変わりません。"
        right={
          <div className="flex gap-2">
            <Btn kind={mode === "sp" ? "primary" : "normal"} onClick={() => setMode("sp")}>
              スマホ
            </Btn>
            <Btn kind={mode === "pc" ? "primary" : "normal"} onClick={() => setMode("pc")}>
              パソコン
            </Btn>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={gachaId}
            onChange={(e) => setGachaId(e.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-edge bg-white px-4 py-3 text-note text-slate"
          >
            {s.gachas.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
                {x.status === "PUBLISHED" ? "" : "（お客様には出ていません）"}
              </option>
            ))}
          </select>
        </div>

        {g.status !== "PUBLISHED" && (
          <p className="mt-4 rounded-xl border border-warn/35 bg-warn/8 px-4 py-3 text-note leading-[1.9] text-warn-ink">
            このガチャは、いまお客様の画面には出ていません。
            下に出しているのは「公開したら、こう見える」という下見です。実際には引けません。
          </p>
        )}
      </Card>

      {/* ── お客様の画面 ── */}
      <Card
        title={mode === "sp" ? "お客様の画面（スマホ／幅390px）" : "お客様の画面（パソコン）"}
        note="管理画面の数字（設計還元率・粗利・仕入れ値）は、お客様には出しません。"
      >
        <div className="rounded-2xl bg-mist p-4 sm:p-6">
          <div
            className="mx-auto overflow-hidden rounded-2xl border border-edge2 bg-white shadow-lift"
            style={{ maxWidth: mode === "sp" ? 390 : "100%" }}
          >
            <CustomerSite
              title={g.title}
              price={g.price}
              left={g.left}
              total={g.total}
              designedRtp={g.designedRtp}
              balance={me.points}
              live={g.status === "PUBLISHED" && g.left > 0}
              onDraw={draw}
            />
          </div>
        </div>

        <p className="mt-5 text-note leading-[1.9] text-slate3">
          ★お客様に出しているのは、料金・残り口数・賞の内容・当たる本数だけです。
          設計還元率・粗利・仕入れ値は出していません。
          出すと、当たりやすい・当たりにくいを狙って引かれ、赤字になります。
        </p>
      </Card>

      {/* ── 引いた結果 ── */}
      {last && (
        <Card title="いま引いた結果" note="この結果は、お客様の端末ではなく運営側で決めています。">
          <div
            className={
              last.grade === "-"
                ? "rounded-xl border border-edge bg-mist px-4 py-4"
                : "rounded-xl border border-blue/30 bg-blue-pale px-4 py-4"
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-h3 font-bold text-slate">
                {last.grade === "-" ? "はずれ" : `${last.grade}賞`}
              </p>
              <Badge tone={last.grade === "-" ? "neutral" : "blue"}>{last.prizeName}</Badge>
            </div>
            <div className="mt-3 border-t border-edge pt-3">
              <KV k="引いたガチャ" v={last.gachaTitle} />
              <KV k="お客様の残高" v={<span className="num">{last.balanceBefore.toLocaleString()}pt → {last.balanceAfter.toLocaleString()}pt</span>} />
              <KV k="残り口数" v={<span className="num">{last.leftBefore.toLocaleString()} → {last.leftAfter.toLocaleString()}</span>} />
              <KV k="景品の価値" v={<span className="num">{last.prizeValue.toLocaleString()}円</span>} />
              <KV k="抽選ID" v={<span className="num">{last.id}</span>} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Btn onClick={() => onNav("gacha")}>残り口数を見る</Btn>
            <Btn onClick={() => onNav("rtp")}>実還元率を見る</Btn>
            <Btn onClick={() => onNav("shipping")}>発送依頼を見る</Btn>
            <Btn onClick={() => onNav("customers")}>お客様の残高を見る</Btn>
          </div>
        </Card>
      )}

      {/* ── 二重送信 ── */}
      <Card
        title="同じ依頼が2回届いたら"
        note="連打・通信のやり直し・戻るボタンで、実際に起きます。"
      >
        <p className="text-note leading-[1.9] text-slate2">
          ボタンを押せなくするだけでは防げません。押せなくなる前に、もう2回目が届いているからです。
          <br />
          このデモでは、1回の抽選ごとに鍵を1つ持たせ、
          <strong className="font-bold text-slate">同じ鍵の依頼は1回しか成立しないようにしています。</strong>
          下のボタンで、直前と同じ鍵をもう一度送れます。ポイントは減りません。
        </p>
        <div className="mt-4">
          <Btn
            kind="normal"
            disabled={!lastKey}
            title={lastKey ? undefined : "先に1回引いてください"}
            onClick={drawAgainSameKey}
          >
            さっきと同じ依頼をもう一度送る
          </Btn>
        </div>
      </Card>

      {/* ── 抽選ログ ── */}
      {myDraws.length > 0 && (
        <Card
          title="このガチャの抽選記録"
          note="問い合わせが来たとき、この1行で答えられるようにしてあります。"
        >
          <Table head={["抽選ID", "何回目", "等級", "料金", "残高", "残り口数", "種"]}>
            {[...myDraws].reverse().map((d) => (
              <tr key={d.id}>
                <Td className="num">{d.id}</Td>
                <Td className="num">{d.nth}</Td>
                <Td className="font-bold text-slate">{d.grade === "-" ? "はずれ" : `${d.grade}賞`}</Td>
                <Td className="num whitespace-nowrap">{d.price.toLocaleString()}pt</Td>
                <Td className="num whitespace-nowrap">
                  {d.balanceBefore.toLocaleString()} → {d.balanceAfter.toLocaleString()}
                </Td>
                <Td className="num whitespace-nowrap">
                  {d.leftBefore.toLocaleString()} → {d.leftAfter.toLocaleString()}
                </Td>
                <Td className="num">{d.seed}</Td>
              </tr>
            ))}
          </Table>
          <p className="mt-5 text-note leading-[1.9] text-slate3">
            ★同じ種で同じ回数なら、必ず同じ結果になります。
            後から「本当にこの結果だったのか」を確かめられるようにするためです。
            <br />
            ★本番の乱数は、これとは別のもの（暗号学的に安全な乱数）を使います。
            ここで使っているのは、再現できることを見ていただくための簡易なものです。
          </p>
        </Card>
      )}

      <DemoNote>
        ここで引いても、本物の決済は動きません。お客様へのメール・SMSも送りません。
        ポイントも景品も、このブラウザの中だけの架空のものです。
      </DemoNote>
    </>
  );
}

/* ══════════════════════════════════════════════
   お客様に見えている画面
   ══════════════════════════════════════════════ */

function CustomerSite({
  title,
  price,
  left,
  total,
  designedRtp,
  balance,
  live,
  onDraw,
}: {
  title: string;
  price: number;
  left: number;
  total: number;
  designedRtp: number;
  balance: number;
  live: boolean;
  onDraw: () => void;
}) {
  const pool = poolOf(title, price, total, designedRtp);
  const soldPct = Math.round(((total - left) / total) * 100);

  return (
    <div className="text-slate">
      {/* お店のヘッダー */}
      <div className="flex items-center justify-between bg-navy px-4 py-3">
        <span className="text-label font-bold tracking-wide text-white">DEMO SHOP</span>
        <span className="num text-label text-white/80">{balance.toLocaleString()}pt</span>
      </div>

      <div className="px-4 py-5">
        <h2 className="text-h3 font-bold leading-[1.5] text-slate">{title}</h2>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="num text-[1.75rem] font-bold text-blue-ink">{price.toLocaleString()}</span>
          <span className="text-note text-slate2">pt / 1回</span>
        </div>

        {/* 残り */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-note text-slate2">残り</span>
            <span className="num text-note font-bold text-slate">
              {left.toLocaleString()} / {total.toLocaleString()}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-mist">
            <div className="h-full rounded-full bg-blue" style={{ width: `${soldPct}%` }} />
          </div>
          <p className="mt-2 text-label text-slate3">{soldPct}% が売れました</p>
        </div>

        {/* 賞の内容 */}
        <div className="mt-5 rounded-xl border border-edge">
          <p className="border-b border-edge px-3 py-2 text-label font-bold text-slate2">賞の内容</p>
          <ul>
            {pool.map((p) => (
              <li
                key={p.grade}
                className="flex items-center justify-between gap-3 border-b border-edge px-3 py-2 last:border-b-0"
              >
                <span className="text-note font-bold text-slate">{p.grade}賞</span>
                <span className="num text-note text-slate2">
                  {p.count.toLocaleString()}本
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* 引く */}
        <div className="mt-5">
          <Btn
            kind="primary"
            full
            disabled={!live}
            title={live ? undefined : "いまは引けません"}
            onClick={onDraw}
          >
            {live ? `${price.toLocaleString()}pt で引く` : "いまは引けません"}
          </Btn>
        </div>

        <p className="mt-4 text-label leading-[1.9] text-slate3">
          ・当たった景品は、現物のお届けかポイントのどちらかをお選びいただけます。
          <br />
          ・当選内容と残り本数は、上のとおりです。
        </p>
      </div>
    </div>
  );
}
