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
 */

"use client";

import { useState } from "react";
import type { ConsoleState, ConsoleUser } from "@/lib/console/state";
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
