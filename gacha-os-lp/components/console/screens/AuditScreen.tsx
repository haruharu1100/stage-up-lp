/**
 * 監査ログ。
 *
 * ★「誰が・いつ・何を・なぜ・いくらからいくらへ」を、必ず1行で読めるようにすること。
 *   ハッシュ値だけが並んでいる画面は、運営者には使えません。
 *   ハッシュは「後から書き換えられていない」ことの証拠であって、
 *   人が読むためのものではありません。だから、末尾に小さく添えるだけにします。
 *
 * ★このデモでは、この画面に記録が溜まっていくのを見ていただけます。
 *   何か操作するたびに1件増えます。
 *   増えないなら、それは記録されていないということです。
 */

"use client";

import { useState } from "react";
import type { ConsoleState } from "@/lib/console/state";
import type { AuditAction } from "@/lib/console/audit";
import { Badge, Card, KV, Rows, RowCard, Table, Td, WhatIsThis } from "../ui";

/** 操作の種類を、日本語にする */
const ACTION_LABEL: Record<AuditAction, string> = {
  LOGIN: "ログイン",
  LOGIN_FAILED: "ログイン失敗",
  MFA_VERIFIED: "2段階認証",
  GACHA_CREATE: "ガチャ作成",
  BACKTEST_RUN: "公開前バックテスト",
  GACHA_PUBLISH: "ガチャ公開",
  GACHA_PAUSE: "販売停止",
  POINT_ADJUST_REQUEST: "ポイント変更の申請",
  POINT_ADJUST_APPROVE: "ポイント変更の承認",
  POINT_ADJUST_REJECT: "ポイント変更の却下",
  POINT_ADJUST_APPLY: "ポイント変更",
  USER_SUSPEND: "会員の停止",
  FRAUD_REVIEW: "不正判定の処理",
  FRAUD_BLOCK: "登録の停止",
  SHIPPING_MARK: "発送処理",
  PRIZE_SHIP_REQUEST: "お客様が発送を依頼",
  PRIZE_EXCHANGE: "お客様が商品をポイントに交換",
  USER_ASK: "お客様からの問い合わせ",
  SUPPORT_REPLY: "問い合わせ返信",
  ROLE_CHANGE: "権限の変更",
  SETTINGS_CHANGE: "設定の変更",
  DEMO_RESET: "デモの初期化",
};

/**
 * お金が動く操作は、目立たせる。
 *
 * ★お客様のポイント交換も、ここに入れること。
 *   交換した瞬間に残高が増えるので、
 *   運営から見れば、ポイントを1件発行したのと同じです。
 *   管理者の操作ではないからという理由で外さないこと。
 */
const MONEY: AuditAction[] = [
  "POINT_ADJUST_REQUEST",
  "POINT_ADJUST_APPROVE",
  "POINT_ADJUST_REJECT",
  "POINT_ADJUST_APPLY",
  "PRIZE_EXCHANGE",
];

export default function AuditScreen({ s }: { s: ConsoleState }) {
  const [onlyMoney, setOnlyMoney] = useState(false);
  const list = [...s.audit]
    .reverse()
    .filter((e) => !onlyMoney || MONEY.includes(e.action));

  return (
    <>
      <WhatIsThis>
        誰が・いつ・何を・なぜ行ったかの記録です。
        操作するたびに1件増えます。あとから消したり書き換えたりはできません
        （書き換えると、セキュリティ画面の検証で分かります）。
      </WhatIsThis>

      <Card
        title="操作の記録"
        note={`${s.audit.length}件。新しいものが上です。`}
        right={
          <label className="nb flex items-center gap-2 text-note font-medium text-slate2">
            <input
              type="checkbox"
              checked={onlyMoney}
              onChange={(e) => setOnlyMoney(e.target.checked)}
              className="h-4 w-4"
            />
            お金が動いた操作だけ
          </label>
        }
      >
        {list.length === 0 ? (
          <p className="text-note text-slate3">
            {s.audit.length === 0
              ? "まだ記録がありません。ほかの画面で操作すると、ここに増えていきます。"
              : "この条件に合う記録はありません。"}
          </p>
        ) : (
          <>
            <Table head={["No", "いつ", "誰が", "何を", "変更前 → 変更後", "なぜ"]}>
              {list.map((e) => (
                <tr key={e.seq}>
                  <Td className="num font-bold text-slate">{e.seq}</Td>
                  <Td className="num whitespace-nowrap">{e.at}</Td>
                  <Td>
                    <span className="font-medium text-slate">{e.actorName}</span>
                    <br />
                    <span className="text-slate3">{e.actorRole}</span>
                  </Td>
                  <Td>
                    <Badge tone={MONEY.includes(e.action) ? "warn" : "neutral"}>
                      {ACTION_LABEL[e.action]}
                    </Badge>
                    <br />
                    <span className="mt-1 block">{e.summary}</span>
                  </Td>
                  <Td className="num whitespace-nowrap">
                    {e.before || e.after ? `${e.before ?? "-"} → ${e.after ?? "-"}` : "-"}
                  </Td>
                  <Td>{e.reason ?? "-"}</Td>
                </tr>
              ))}
            </Table>

            <Rows>
              {list.map((e) => (
                <RowCard key={e.seq}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="num text-note font-bold text-slate">No.{e.seq}</span>
                    <Badge tone={MONEY.includes(e.action) ? "warn" : "neutral"}>
                      {ACTION_LABEL[e.action]}
                    </Badge>
                  </div>
                  <p className="mt-2 text-note font-medium leading-[1.85] text-slate2">
                    {e.summary}
                  </p>
                  <div className="mt-2 border-t border-edge pt-2">
                    <KV k="いつ" v={<span className="num">{e.at}</span>} />
                    <KV k="誰が" v={`${e.actorName}（${e.actorRole}）`} />
                    {(e.before || e.after) && (
                      <KV
                        k="変更前 → 変更後"
                        v={<span className="num">{`${e.before ?? "-"} → ${e.after ?? "-"}`}</span>}
                      />
                    )}
                    {e.reason && <KV k="なぜ" v={e.reason} />}
                  </div>
                </RowCard>
              ))}
            </Rows>
          </>
        )}

        <p className="mt-5 text-note leading-[1.9] text-slate3">
          記録1件ごとに、前の1件とつながる値（ハッシュ）を持っています。
          その値が合っているかは、セキュリティ画面の「検証する」で確かめられます。
          ハッシュそのものは人が読むものではないので、ここには出していません。
        </p>
      </Card>
    </>
  );
}
