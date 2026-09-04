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
 * ★2026-09-04 に直したこと（下見になっていなかった）
 * ═══════════════════════════════════════════════
 *
 *   この画面は、本物のガチャを1本も見ていませんでした。
 *
 *   ・選べるガチャが、見本データの5本で固定されていました。
 *     新しく作って公開したガチャは、いつまでも出てきませんでした。
 *   ・賞の内容は poolOf() という計算式で、その場で作っていました。
 *     つまり「S賞 1本」と出ていても、実際の在庫とは無関係でした。
 *
 *   下見の画面が、本物と違うものを見せていたら、下見の意味がありません。
 *   いまは、保存されている本物のガチャと、本物の在庫だけを出します。
 *
 *   ★ここに見本データを混ぜないこと。
 *     「見やすくするため」に足した1行が、そのまま公開判断の根拠になります。
 *
 * ═══════════════════════════════════════════════
 * ★ここで引けなくしてある理由
 * ═══════════════════════════════════════════════
 *
 *   抽選の入口（/api/console/draw）は、お客様のログインでしか通りません。
 *   管理者のログインでは、わざと通らないようにしてあります。
 *   ここに「引く」ボタンを置いて動くように見せると、
 *   本当は誰も引いていないのに、引けたことになってしまいます。
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  EMPTY_FILTER,
  useGachaDetail,
  useGachaList,
  type GachaDetail,
} from "@/lib/console/liveGachas";
import type { MenuKey } from "../menu";
import { Btn, Card, DemoNote, Empty, ErrorBox, Skeleton, WhatIsThis } from "../ui";

type Mode = "sp" | "pc";

export default function PreviewScreen({ onNav }: { onNav: (k: MenuKey) => void }) {
  const [mode, setMode] = useState<Mode>("sp");
  const [gachaId, setGachaId] = useState<string | null>(null);

  const { state, reload } = useGachaList(EMPTY_FILTER);
  const rows = state.phase === "ok" ? state.data.gachas : [];

  /* 最初に開いたときは、公開中のものを選んでおく。
     ★1本も無いときに「見本の1本」を入れないこと。無いことが分かるようにします。 */
  useEffect(() => {
    if (gachaId !== null || rows.length === 0) return;
    setGachaId((rows.find((g) => g.status === "PUBLISHED") ?? rows[0]).id);
  }, [rows, gachaId]);

  /* 選んでいたガチャが消えたら、選び直す */
  useEffect(() => {
    if (gachaId === null || rows.length === 0) return;
    if (!rows.some((g) => g.id === gachaId)) setGachaId(rows[0].id);
  }, [rows, gachaId]);

  const detail = useGachaDetail(gachaId);
  const g = detail.state.phase === "ok" ? detail.state.gacha : null;

  return (
    <>
      <WhatIsThis>
        公開ボタンを押す前に、お客様の目で同じ画面を見ます。
        <strong className="font-bold text-slate">スマホから先に見てください。</strong>
        オンラインガチャは、ほとんどがスマホから引かれます。
        ここに出ているのは、保存されている本物のガチャと本物の在庫です。
      </WhatIsThis>

      {state.phase === "loading" && (
        <Card title="お客様の画面">
          <Skeleton rows={4} label="ガチャを読み込んでいます" />
        </Card>
      )}

      {state.phase === "ng" && (
        <ErrorBox what={state.why} code={state.code} onRetry={reload} />
      )}

      {state.phase === "ok" && rows.length === 0 && (
        <Card title="お客様の画面">
          <Empty why="まだガチャが1本もありません。AIガチャ作成で下書きを登録し、ガチャ管理で検証してから公開すると、ここに出ます。" />
          <div className="mt-4 flex flex-wrap gap-2">
            <Btn onClick={() => onNav("builder")}>AIガチャ作成へ</Btn>
            <Btn onClick={() => onNav("gacha")}>ガチャ管理へ</Btn>
          </div>
        </Card>
      )}

      {rows.length > 0 && (
        <>
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
                value={gachaId ?? ""}
                onChange={(e) => setGachaId(e.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-edge bg-white px-4 py-3 text-note text-slate"
              >
                {rows.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                    {x.status === "PUBLISHED" ? "" : "（お客様には出ていません）"}
                  </option>
                ))}
              </select>
            </div>

            {g && g.status !== "PUBLISHED" && (
              <p className="mt-4 rounded-xl border border-warn/35 bg-warn/8 px-4 py-3 text-note leading-[1.9] text-warn-ink">
                このガチャは、いまお客様の画面には出ていません。
                下に出しているのは「公開したら、こう見える」という下見です。
              </p>
            )}
          </Card>

          {/* ── お客様の画面 ── */}
          <Card
            title={mode === "sp" ? "お客様の画面（スマホ／幅390px）" : "お客様の画面（パソコン）"}
            note="管理画面の数字（設計還元率・粗利・仕入れ値）は、お客様には出しません。"
          >
            {detail.state.phase === "loading" && (
              <Skeleton rows={4} label="中身を読み込んでいます" />
            )}
            {detail.state.phase === "ng" && (
              <ErrorBox
                what={detail.state.why}
                code={detail.state.code}
                onRetry={detail.reload}
              />
            )}

            {g && (
              <>
                <div className="rounded-2xl bg-mist p-4 sm:p-6">
                  <div
                    className="mx-auto overflow-hidden rounded-2xl border border-edge2 bg-white shadow-lift"
                    style={{ maxWidth: mode === "sp" ? 390 : "100%" }}
                  >
                    <CustomerSite g={g} />
                  </div>
                </div>

                <p className="mt-5 text-note leading-[1.9] text-slate3">
                  ★お客様に出しているのは、料金・残り口数・賞の内容・残り本数だけです。
                  設計還元率・粗利・仕入れ値は出していません。
                  出すと、当たりやすい・当たりにくいを狙って引かれ、赤字になります。
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Btn onClick={() => onNav("gacha")}>このガチャの中身を見る</Btn>
                  <Btn onClick={() => onNav("rtp")}>実績還元率を見る</Btn>
                </div>
              </>
            )}
          </Card>

          {/* ── 引けない理由 ── */}
          <Card
            title="この画面では引けません"
            note="引けるのは、お客様がご自分のログインで入ったときだけです。"
          >
            <p className="text-note leading-[1.9] text-slate2">
              抽選の入口は、お客様のログインでしか通らないようにしてあります。
              管理者のログインでは、わざと通りません。
              <br />
              <strong className="font-bold text-slate">
                ここに「引く」ボタンを置いて動くように見せると、本当は誰も引いていないのに、
                引けたことになってしまいます。
              </strong>
              そのため、この画面の「引く」は押せない状態で出しています。
            </p>
            <p className="mt-4 text-note leading-[1.9] text-slate3">
              ★同じ依頼が2回届いたときの備えについて。
              連打・通信のやり直し・戻るボタンで、実際に起きます。
              ボタンを押せなくするだけでは防げません。押せなくなる前に、もう2回目が届いているからです。
              抽選の入口では、1回の購入操作ごとに鍵を1つ持たせ、
              同じ鍵の依頼は1回しか成立しないようにしています。
            </p>
          </Card>
        </>
      )}

      <DemoNote>
        ここに出しているガチャ・料金・残り口数・賞の内容は、保存されている本物です。
        ただし、この画面から本物の決済は動きません。お客様へのメール・SMSも送りません。
      </DemoNote>
    </>
  );
}

/* ══════════════════════════════════════════════
   お客様に見えている画面
   ══════════════════════════════════════════════ */

function CustomerSite({ g }: { g: GachaDetail }) {
  const soldPct = g.total > 0 ? Math.round(((g.total - g.leftCount) / g.total) * 100) : 0;

  /* ★賞の内容は、必ず本物の在庫から出すこと。
       ここで計算式から作ると、在庫が変わっても画面が変わりません。 */
  const pool = useMemo(
    () => [...g.stock].sort((a, b) => a.grade.localeCompare(b.grade)),
    [g.stock],
  );

  return (
    <div className="text-slate">
      {/* お店のヘッダー */}
      <div className="flex items-center justify-between bg-navy px-4 py-3">
        <span className="text-label font-bold tracking-wide text-white">SHOP</span>
      </div>

      <div className="px-4 py-5">
        <h2 className="text-h3 font-bold leading-[1.5] text-slate">{g.title}</h2>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="num text-[1.75rem] font-bold text-blue-ink">
            {g.price.toLocaleString()}
          </span>
          <span className="text-note text-slate2">pt / 1回</span>
        </div>

        {/* 残り */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-note text-slate2">残り</span>
            <span className="num text-note font-bold text-slate">
              {g.leftCount.toLocaleString()} / {g.total.toLocaleString()}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-mist">
            <div className="h-full rounded-full bg-blue" style={{ width: `${soldPct}%` }} />
          </div>
          <p className="mt-2 text-label text-slate3">{soldPct}% が売れました</p>
        </div>

        {/* 賞の内容 */}
        <div className="mt-5 rounded-xl border border-edge">
          <p className="border-b border-edge px-3 py-2 text-label font-bold text-slate2">
            賞の内容
          </p>
          {pool.length === 0 ? (
            <p className="px-3 py-3 text-note leading-[1.9] text-slate3">
              このガチャには、まだ賞が登録されていません。
            </p>
          ) : (
            <ul>
              {pool.map((p) => (
                <li
                  key={p.grade}
                  className="flex items-center justify-between gap-3 border-b border-edge px-3 py-2 last:border-b-0"
                >
                  <span className="text-note font-bold text-slate">
                    {p.grade}賞
                    <span className="ml-2 font-normal text-slate2">{p.name}</span>
                  </span>
                  <span className="num shrink-0 text-note text-slate2">
                    残り {p.left.toLocaleString()} / {p.total.toLocaleString()}本
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 引く（押せません） */}
        <div className="mt-5">
          <Btn kind="primary" full disabled title="この画面からは引けません">
            {g.status === "PUBLISHED" && g.leftCount > 0
              ? `${g.price.toLocaleString()}pt で引く`
              : "いまは引けません"}
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
