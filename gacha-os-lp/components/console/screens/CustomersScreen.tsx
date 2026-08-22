/**
 * 会員管理。
 *
 * ═══════════════════════════════════════════════
 * ★この画面で気をつけること
 * ═══════════════════════════════════════════════
 *
 *   1) 会員の個人情報を、必要以上に画面へ出さないこと。
 *      毎日開く画面に本名・住所・電話番号を並べておくと、
 *      背後から覗かれただけで漏れます。
 *      詳しい情報は、必要なときに、理由を残して開く形にします。
 *
 *   2) 危険度の印は「決めつけ」ではなく「手がかり」として出すこと。
 *      同じIPは、会社・学校・寮・大手キャリアの回線でも起きます。
 *      印が付いている＝悪い人、ではありません。
 *
 *   3) この画面から、いきなり永久停止はしないこと。
 *      できるのは「一時的に止める」までです。誤検知は必ず起きます。
 *
 *   4) お客様が自分の画面でした操作を、ここから必ず見えるようにすること。
 *      お客様から「発送をお願いしたのに来ない」と電話が来たとき、
 *      運営がこの画面を開いて
 *      「〇月〇日に発送をご依頼いただき、いま準備中です」と
 *      その場で答えられなければ、折り返しになります。
 *      折り返しは、それだけで1件あたり10分以上かかります。
 *
 *      だから、獲得商品・ポイントの動き・発送・問い合わせを
 *      1人ぶんまとめて、ここに出します。
 *      お客様側の画面と、同じ1つのデータを見ています。
 */

"use client";

import { useState } from "react";
import type { ConsoleState, ConsoleUser } from "@/lib/console/state";
import {
  PRIZE_STATUS_LABEL,
  POINT_KIND_LABEL,
  ledgerBalance,
} from "@/lib/console/state";
import { Badge, Card, DemoNote, KV, RiskBadge, RowCard, Rows, Stat, Table, Td, WhatIsThis } from "../ui";

const STATUS: Record<
  ConsoleUser["status"],
  { label: string; tone: "ok" | "warn" | "danger" | "neutral" }
> = {
  ACTIVE: { label: "通常", tone: "ok" },
  STEP_UP: { label: "追加認証中", tone: "warn" },
  REVIEW: { label: "確認中", tone: "warn" },
  SUSPENDED: { label: "停止中", tone: "danger" },
};

export default function CustomersScreen({ s }: { s: ConsoleState }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const totalPoints = s.users.reduce((a, u) => a + u.points, 0);

  return (
    <>
      <WhatIsThis>
        会員を調べます。危険度の印が付いていても、
        <strong className="font-bold text-slate">それだけで悪い人だと決めつけないでください</strong>
        。同じ回線・同じ端末は、会社や家庭でも普通に起きます。
      </WhatIsThis>

      <Card title="会員の状況" note="デモでは5名分を表示しています。">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="会員数（全体）" value={2_847} unit="名" />
          <Stat
            label="確認中"
            value={s.users.filter((u) => u.status === "REVIEW").length}
            unit="名"
            tone="warn"
          />
          <Stat
            label="停止中"
            value={s.users.filter((u) => u.status === "SUSPENDED").length}
            unit="名"
            tone={s.users.filter((u) => u.status === "SUSPENDED").length > 0 ? "danger" : "ok"}
          />
          <Stat label="保有ポイント（表示分）" value={`${totalPoints.toLocaleString()}pt`} />
        </div>
      </Card>

      <Card title="会員一覧" note="行を押すと、判定の理由を開きます。">
        <Table head={["会員", "登録日", "保有pt", "使った金額", "発送回数", "危険度", "状態"]}>
          {s.users.map((u) => (
            <tr
              key={u.id}
              className="cursor-pointer hover:bg-paper2"
              onClick={() => setOpenId(openId === u.id ? null : u.id)}
            >
              <Td className="font-bold text-slate">{u.name}</Td>
              <Td className="num whitespace-nowrap">{u.joinedAt}</Td>
              <Td className="num whitespace-nowrap">{u.points.toLocaleString()}pt</Td>
              <Td className="num whitespace-nowrap">{u.spent.toLocaleString()}円</Td>
              <Td className="num">{u.shipments}回</Td>
              <Td>
                <RiskBadge level={u.risk.level} />
              </Td>
              <Td>
                <Badge tone={STATUS[u.status].tone}>{STATUS[u.status].label}</Badge>
              </Td>
            </tr>
          ))}
        </Table>

        <Rows>
          {s.users.map((u) => (
            <RowCard key={u.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-note font-bold text-slate">{u.name}</span>
                <Badge tone={STATUS[u.status].tone}>{STATUS[u.status].label}</Badge>
              </div>
              <div className="mt-2">
                <RiskBadge level={u.risk.level} />
              </div>
              <div className="mt-2 border-t border-edge pt-2">
                <KV k="登録日" v={<span className="num">{u.joinedAt}</span>} />
                <KV k="保有pt" v={<span className="num">{u.points.toLocaleString()}pt</span>} />
                <KV k="使った金額" v={<span className="num">{u.spent.toLocaleString()}円</span>} />
                <KV k="発送回数" v={<span className="num">{u.shipments}回</span>} />
              </div>
              <Reasons u={u} />
              <Activity s={s} u={u} />
            </RowCard>
          ))}
        </Rows>

        {/* PC で選んだ会員の詳細 */}
        {openId && (
          <div className="mt-4 hidden rounded-xl border border-edge bg-paper2 px-4 py-4 md:block">
            {(() => {
              const u = s.users.find((x) => x.id === openId);
              if (!u) return null;
              return (
                <>
                  <p className="text-note font-bold text-slate">{u.name} の判定内容</p>
                  <Reasons u={u} />
                  <Activity s={s} u={u} />
                </>
              );
            })()}
          </div>
        )}

        <p className="mt-5 rounded-xl border border-blue-pale bg-blue-pale/50 px-4 py-3 text-note leading-[1.9] text-slate2">
          <strong className="font-bold text-blue-ink">住所・電話番号・本名は、この一覧には出しません。</strong>{" "}
          発送のときなど、必要になった場面でだけ開きます。開いた記録は監査ログに残ります。
          毎日開く画面に個人情報を並べておくと、後ろから覗かれただけで漏れます。
        </p>
      </Card>

      <DemoNote>
        ここに出ている会員は、すべて架空です。実在の方の情報ではありません。
      </DemoNote>
    </>
  );
}

function Reasons({ u }: { u: ConsoleUser }) {
  if (u.risk.hits.length === 0) {
    return (
      <p className="mt-2 text-note leading-[1.85] text-slate3">
        気になる点はありません。
      </p>
    );
  }
  return (
    <div className="mt-2">
      <p className="text-note font-bold text-slate2">
        判定の手がかり
        <span className="num ml-2 font-medium text-slate3">（{u.risk.score}点）</span>
      </p>
      <ul className="mt-1 space-y-1">
        {u.risk.hits.map((h) => (
          <li key={h.key} className="flex flex-wrap items-baseline gap-2">
            <span className="text-note font-medium text-slate2">{h.label}</span>
            <span className="num text-note text-slate3">— {h.detail}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-note leading-[1.85] text-slate3">{u.risk.explain}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════
   この会員が、自分の画面でしたこと
   ══════════════════════════════════════════════ */

/**
 * 獲得商品・ポイントの動き・発送・問い合わせを、1人ぶんまとめて出す。
 *
 * ★お客様側の画面と、同じ1つのデータから作ること。
 *   ここで別のサンプルを表示してしまうと、
 *   画面はきれいでも、電話口で言った内容がお客様の画面と食い違います。
 *   お客様は自分の画面を見ながら電話をかけてきます。
 *
 * ★残高と、ポイント履歴の合計が合わないときは、必ず画面に出すこと。
 *   合わないということは、記録に残っていないお金が動いたということです。
 *   黙って隠すと、誰も気づかないまま月末を迎えます。
 */
function Activity({ s, u }: { s: ConsoleState; u: ConsoleUser }) {
  const prizes = s.prizes.filter((p) => p.userId === u.id);
  const orders = s.orders.filter((o) => o.userId === u.id);
  const tickets = s.tickets.filter((t) => t.userId === u.id);
  const ledger = s.ledger.filter((e) => e.userId === u.id);

  /* 台帳が1件も無い会員は、まだ何も動いていない */
  if (prizes.length + orders.length + tickets.length + ledger.length === 0) {
    return (
      <p className="mt-4 border-t border-edge pt-3 text-note leading-[1.85] text-slate3">
        この会員には、まだ獲得商品・ポイントの動き・発送依頼・お問い合わせがありません。
      </p>
    );
  }

  const led = ledgerBalance(s, u.id);
  const matched = led === u.points;
  const unchosen = prizes.filter((p) => p.status === "UNCHOSEN").length;

  return (
    <div className="mt-4 space-y-4 border-t border-edge pt-4">
      <p className="text-note font-bold text-slate">
        {u.name} が、お客様の画面でしたこと
      </p>

      {/* ── 残高が合っているか ── */}
      <div
        className={[
          "rounded-xl border px-4 py-3 text-note leading-[1.85]",
          matched
            ? "border-ok/30 bg-ok/10 text-ok-ink"
            : "border-danger/40 bg-danger/10 text-danger-ink",
        ].join(" ")}
      >
        {matched ? (
          <>
            <strong className="font-bold">ポイントは合っています。</strong>{" "}
            いまの残高{" "}
            <span className="num">{u.points.toLocaleString()}pt</span> は、
            下のポイント履歴{ledger.length}件を全部足した金額と一致しています。
          </>
        ) : (
          <>
            <strong className="font-bold">ポイントが合っていません。</strong>{" "}
            残高は <span className="num">{u.points.toLocaleString()}pt</span>、
            履歴の合計は <span className="num">{led.toLocaleString()}pt</span> です。
            記録に残っていないお金が動いています。原因が分かるまで、この会員のポイントは触らないでください。
          </>
        )}
      </div>

      {/* ── 獲得商品 ── */}
      <div>
        <p className="text-note font-bold text-slate2">
          獲得商品
          <span className="num ml-2 font-medium text-slate3">（{prizes.length}点）</span>
          {unchosen > 0 && (
            <span className="ml-2 font-medium text-warn-ink">
              うち{unchosen}点は、お客様がまだ受け取り方法を選んでいません
            </span>
          )}
        </p>
        {prizes.length === 0 ? (
          <p className="mt-1 text-note text-slate3">ありません。</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {prizes.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg bg-paper px-3 py-2"
              >
                <span className="text-note font-bold text-slate">
                  {p.grade}賞 {p.name}
                </span>
                <span className="num text-note text-slate3">{p.wonAt}</span>
                <Badge
                  tone={
                    p.status === "UNCHOSEN"
                      ? "warn"
                      : p.status === "SHIP_REQUESTED"
                        ? "blue"
                        : "neutral"
                  }
                >
                  {PRIZE_STATUS_LABEL[p.status]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── 発送依頼 ── */}
      <div>
        <p className="text-note font-bold text-slate2">
          発送依頼
          <span className="num ml-2 font-medium text-slate3">（{orders.length}件）</span>
        </p>
        {orders.length === 0 ? (
          <p className="mt-1 text-note text-slate3">ありません。</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {orders.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg bg-paper px-3 py-2"
              >
                <span className="text-note font-medium text-slate">{o.prize}</span>
                <span className="num text-note text-slate3">依頼 {o.requestedAt}</span>
                {o.tracking && (
                  <span className="num text-note text-slate3">
                    {o.carrier} {o.tracking}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── お問い合わせ ── */}
      <div>
        <p className="text-note font-bold text-slate2">
          お問い合わせ
          <span className="num ml-2 font-medium text-slate3">（{tickets.length}件）</span>
        </p>
        {tickets.length === 0 ? (
          <p className="mt-1 text-note text-slate3">ありません。</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {tickets.map((t) => (
              <li key={t.id} className="rounded-lg bg-paper px-3 py-2">
                <p className="text-note font-medium leading-[1.85] text-slate2">{t.subject}</p>
                <p className="num mt-0.5 text-note text-slate3">{t.at}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── ポイントの動き ── */}
      <div>
        <p className="text-note font-bold text-slate2">
          ポイントの動き
          <span className="num ml-2 font-medium text-slate3">（{ledger.length}件・新しい順）</span>
        </p>
        {ledger.length === 0 ? (
          <p className="mt-1 text-note text-slate3">ありません。</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {[...ledger].reverse().map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg bg-paper px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-note font-medium text-slate2">
                    {POINT_KIND_LABEL[e.kind]}
                  </span>
                  <span className="ml-2 text-note text-slate3">{e.memo}</span>
                </span>
                <span className="num shrink-0 text-note">
                  <span
                    className={e.delta >= 0 ? "font-bold text-ok-ink" : "font-bold text-slate2"}
                  >
                    {e.delta >= 0 ? "+" : ""}
                    {e.delta.toLocaleString()}pt
                  </span>
                  <span className="ml-2 text-slate3">
                    残高 {e.balanceAfter.toLocaleString()}pt
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
