/**
 * 監査ログ。
 *
 * ★「誰が・いつ・何を・なぜ・いくらからいくらへ」を、必ず1行で読めるようにすること。
 *   ハッシュ値だけが並んでいる画面は、運営者には使えません。
 *   ハッシュは「後から書き換えられていない」ことの証拠であって、
 *   人が読むためのものではありません。だから、末尾に小さく添えるだけにします。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面には、性質のちがう2つの記録が並びます
 * ═══════════════════════════════════════════════════════
 *
 *   上：サーバーに本当に残っている記録。
 *       ログインや仮パスワードの発行など、実際に起きたことです。
 *       画面を閉じても、別の端末から見ても、同じものが出ます。
 *
 *   下：このデモの中だけの記録。
 *       この画面で操作を試すと増えますが、再読み込みで消えます。
 *
 *   ★この2つを混ぜて1つの表にしないこと。
 *     混ぜると「本当に残っているのはどれか」が誰にも分からなくなります。
 *     監査ログで、それは致命的です。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConsoleState } from "@/lib/console/state";
import type { AuditAction } from "@/lib/console/audit";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorBox,
  KV,
  Rows,
  RowCard,
  Skeleton,
  Table,
  Td,
  WhatIsThis,
} from "../ui";

/** 操作の種類を、日本語にする */
const ACTION_LABEL: Record<AuditAction, string> = {
  LOGIN: "ログイン",
  LOGIN_FAILED: "ログイン失敗",
  MFA_VERIFIED: "2段階認証",
  GACHA_CREATE: "ガチャ作成",
  BACKTEST_RUN: "公開前バックテスト",
  GACHA_PUBLISH: "ガチャ公開",
  GACHA_PAUSE: "販売停止",
  GACHA_RESUME: "販売再開",
  POINT_ADJUST_REQUEST: "ポイント変更の申請",
  POINT_ADJUST_APPROVE: "ポイント変更の承認",
  POINT_ADJUST_REJECT: "ポイント変更の却下",
  POINT_ADJUST_APPLY: "ポイント変更",
  /* ★「会員」と「担当者」を、同じ言葉で書かないこと。
        止まる範囲がまったく違います（管理画面に入れない／ガチャが引けない） */
  USER_SUSPEND: "担当者の停止・解除",
  CUSTOMER_SUSPEND: "お客様の利用停止・解除",
  FRAUD_REVIEW: "不正判定の処理",
  FRAUD_BLOCK: "登録の停止",
  SHIPPING_MARK: "発送処理",
  PRIZE_SHIP_REQUEST: "お客様が発送を依頼",
  PRIZE_EXCHANGE: "お客様が商品をポイントに交換",
  USER_ASK: "お客様からの問い合わせ",
  SUPPORT_REPLY: "問い合わせ返信",

  /* 問い合わせ。
     ★「返信した」を1つの言葉にまとめないこと。
       AIが書いた下書きなのか、人が書いて送ったのかは、
       苦情になったとき必ず聞かれます。
       まとめてしまうと、あとから分けることはできません */
  TICKET_CREATED: "お客様が問い合わせを作成",
  AI_REPLY_CREATED: "AIが下書きを作成",
  TICKET_ASSIGNED: "問い合わせの担当者を変更",
  HUMAN_REPLY_CREATED: "担当者が返信を送信",
  TICKET_STATUS_CHANGED: "問い合わせの状態を変更",
  TICKET_RESOLVED: "問い合わせを解決済みにした",

  /* 通知。
     ★「送信」ではなく「作成」と書くこと。
       いまの送り先は Mock（練習用の受け皿）で、
       実際のメールもSMSも出ていません。
       ここで「送信」と書くと、記録を読んだ人が
       お客様に届いたものと思い込みます。
       本物の送信会社につないだ日に、言い方を変えます */
  NOTIFICATION_CREATE: "お知らせを作成",

  /* 商品の写真。
     ★「預かった」と「お客様に見える形で出した」を分けて書くこと。
       お金を払う判断の材料になっているのは、金額でも説明文でもなく写真です。
       売っている最中に写真だけを差し替えられると、
       引いた方が見ていたものと、いま並んでいるものがズレます */
  IMAGE_UPLOAD: "商品写真を登録",
  IMAGE_ATTACH: "商品写真を商品に設定",
  /* ★この2つの言い方を、似た言葉にそろえないこと。
       上は「これから引く方の見え方」だけが変わります。
       下は「すでに当てた方の履歴の写真」まで消えます。
       一覧をざっと見た人が、取り違えないようにするためです */
  IMAGE_REPLACE: "商品写真を差し替え（当選済みの記録はそのまま）",
  IMAGE_PURGE: "商品写真を完全削除（当選済みの記録からも消去）",

  /* ポイントの購入。
     ★「注文」と「入金の確定」を、同じ言葉で書かないこと。
       注文はお客様が押した時刻、確定は決済会社からお金の知らせが
       届いた時刻です。「買ったのに増えていない」と言われたとき、
       この2つの差だけが答えになります。

     ★金額不一致は、いちばん強い言葉にすること。
       注文の金額と、届いた金額が違うということは、
       事故か、改ざんの試みか、どちらかしかありません。
       ポイントは足していません。人が見るまで、そのままにしてあります */
  POINT_PRODUCT_CREATE: "ポイント商品を追加",
  POINT_PRODUCT_UPDATE: "ポイント商品を変更",
  POINT_ORDER_CREATE: "お客様がポイント購入を注文",
  POINT_ORDER_CANCEL: "ポイント購入の注文を取り消し",
  POINT_ORDER_AMOUNT_MISMATCH: "【要確認】入金額が注文と不一致（加算していません）",
  POINT_PURCHASE_APPLIED: "ポイント購入の入金確定・付与",

  /* 強制取消（チャージバック等）。
     ★「返金」と書かないこと。
       こちらの意思で返したのではなく、決済会社の側で
       引き戻された、という別のできごとです。
       同じ言葉にすると、あとで区別できなくなります。 */
  POINT_PURCHASE_REVERSED: "【要確認】決済会社による強制取消（逆仕訳で減算）",
  POINT_REVERSAL_UNRECOVERED: "【要確認】強制取消で回収できなかった額が出ました",
  CUSTOMER_REVIEW_FLAGGED: "会員を要確認にしました（利用停止ではありません）",
  CUSTOMER_REVIEW_CLEARED: "会員の要確認を解除しました",

  /* ポイントの有効期限の決まり。
     ★「ポイントを失効させました」と書かないこと。
       保存しただけで、1ptも消えていません。
       同じ言葉にすると、消えたと勘違いされます。 */
  POINT_POLICY_UPDATED: "ポイント有効期限の決まりを保存（まだ失効はしません）",

  /* お店の看板と、法定ページ。
     ★「設定を変更しました」と書かないこと。
       変えているのは、特商法の表記・規約・法人情報です。
       ほかの設定と同じ言い方にすると、
       あとから探すときに、ほかの設定に埋もれます。 */
  TENANT_SETTINGS_UPDATED: "店舗情報・法定ページを変更（特商法／規約／法人情報）",
  TENANT_FAQ_UPDATED: "よくある質問を変更",

  /* ガチャの棚（カテゴリ）。
     ★DELETE を目立たせること。
       棚を消すと、そこに入っていたガチャが、
       お客様の絞り込みからまとめて消えます。 */
  GACHA_CATEGORY_CREATE: "カテゴリを追加",
  GACHA_CATEGORY_RENAME: "カテゴリの名前を変更",
  GACHA_CATEGORY_DELETE: "【要確認】カテゴリを削除（中のガチャが絞り込みから消えます）",
  GACHA_CATEGORY_ASSIGN: "ガチャのカテゴリを付け替え",

  /* 抽選。
     ★いちばんお金が動く操作なので、必ず同じ鎖に残すこと。
       残高がどう動いたか・何が出たか・残数がいくつになったかまで、
       1件で追えるようにしてあります */
  DRAW: "抽選（ガチャを1回）",

  /* お客様の本人確認まわり。
     ★ログインと住所変更を必ず残すこと。
       乗っ取りは、ほぼ必ず「ログイン→住所変更→高額発送」の順で進みます。
       前の2つが残っていないと、最後の発送だけを見ることになり、
       なぜそれが起きたのかを、誰も説明できません */
  CUSTOMER_LOGIN: "お客様のログイン",
  CUSTOMER_STEP_UP: "お客様の追加本人確認",

  /* 会員登録まわり。
     ★「登録した」と「確認まで終えた」を、別の行として残すこと。
       1つにまとめると、
       「登録はしたが、確認メールを開かなかった方が何人いるか」
       を、あとから数えられなくなります。
       この数が多いときは、メールが届いていない疑いがあります。 */
  CUSTOMER_SIGNUP: "お客様の会員登録",
  CUSTOMER_EMAIL_VERIFIED: "お客様のメール確認完了",

  /* 出ていった記録と、鍵まわり。
     ★ログアウトも残すこと。入った記録だけだと、
       事故が起きた時刻に誰が中にいたのかを言えません。
     ★締め出しは、攻撃を受けた証拠そのものです */
  LOGOUT: "ログアウト",
  CUSTOMER_LOGOUT: "お客様のログアウト",
  ACCOUNT_LOCKED: "連続失敗による締め出し",
  MFA_ENABLED: "2段階認証を有効化",
  MFA_DISABLED: "2段階認証を解除",

  /* 鍵の作り直し。
     ★「有効化」と別の言葉にすること。
       作り直したということは、その前の鍵が
       もう信用できない状態になった、という一大事です。
       同じ言い方にすると、あとから読む人が読み落とします */
  MFA_ROTATED: "2段階認証の鍵を作り直し",

  /* パスワードまわり。
     ★仮パスワードの発行は、いちばん強い操作のひとつです。
       その人のパスワードを、こちらが知っている値に置き換える、
       つまり「その人として入れる」ということだからです。
       誰が・誰に・なぜ発行したかが残ってはじめて、
       あとから確かめられます */
  TEMP_PASSWORD_ISSUED: "仮パスワード発行",
  PASSWORD_CHANGED: "パスワードの変更",
  PASSWORD_RESET: "パスワードの再設定",

  ADDRESS_UPDATE: "お届け先の変更",
  SET_CUSTOMER_AUTH: "お客様の認証方式の変更",

  /* 止めた記録。
     ★「起きなかったこと」も残すこと。
       成功した操作だけが並ぶ記録は、いつもきれいなままです。
       きれいな記録は、攻撃されていない証明にはなりません */
  IDOR_BLOCKED: "他人の商品への操作を拒否",
  RBAC_DENIED: "権限のない操作を拒否",

  ROLE_CHANGE: "権限の変更",
  SETTINGS_CHANGE: "設定の変更",
  DEMO_RESET: "デモの初期化",

  /* 注文と発送。
     ★注文と発送を、別の名前で残すこと。
       ひとつの「発送処理」にまとめると、
       「頼まれた」のか「箱に入れた」のか「家を出た」のかが、
       あとから見分けられません。
       お客様から「まだ届かない」と言われたとき、
       どこで止まっているかを答えられるのは、この区別だけです。
     ★お届け先の変更は、赤で出します。
       乗っ取りは、最後にかならずここを通ります。 */
  ORDER_CREATE: "注文の受付",
  ORDER_UPDATE: "注文の変更",
  ORDER_CANCEL: "注文の取り消し",
  SHIPMENT_CREATE: "発送の作成",
  SHIPMENT_SPLIT: "分割発送の作成",
  SHIPMENT_TRACKING_SET: "追跡番号の登録",
  SHIPMENT_SHIPPED: "発送の確定（出荷）",
  SHIPMENT_STATUS: "発送状態の更新",
  SHIPMENT_ADDRESS_CHANGE: "発送先の変更",
  SHIPMENT_CANCEL: "発送の取り消し",
};

/**
 * 日本語の名前にする。
 *
 * ★知らない種類が来たら、記号のまま出すこと。
 *   「その他」にまとめると、新しい操作が増えたときに、
 *   画面上では見分けがつかなくなります。
 *   読みにくい記号のほうが、消えてしまうよりずっとましです。
 */
function actionLabel(a: string): string {
  return (ACTION_LABEL as Record<string, string>)[a] ?? a;
}

/**
 * お金が動く操作は、目立たせる。
 *
 * ★お客様のポイント交換も、ここに入れること。
 *   交換した瞬間に残高が増えるので、
 *   運営から見れば、ポイントを1件発行したのと同じです。
 *   管理者の操作ではないからという理由で外さないこと。
 */
const MONEY: string[] = [
  "POINT_ADJUST_REQUEST",
  "POINT_ADJUST_APPROVE",
  "POINT_ADJUST_REJECT",
  "POINT_ADJUST_APPLY",
  "PRIZE_EXCHANGE",
];

/**
 * 「強い操作」。
 *
 * ★お金は動かないけれど、その人になりすませてしまう操作です。
 *   仮パスワードの発行が、その代表です。
 *   お金の色（黄）とは別の色（赤）で出して、
 *   毎日この画面を開く人の目に、必ず引っかかるようにします。
 */
const TSUYOI: string[] = [
  "TEMP_PASSWORD_ISSUED",
  "ROLE_CHANGE",
  "MFA_DISABLED",
  "PASSWORD_RESET",

  /* ★発送先の変更を、ここに入れること。
       金額は動きませんが、品物の行き先が変わります。
       乗っ取りの被害が実際に出るのは、この1行のあとです。 */
  "SHIPMENT_ADDRESS_CHANGE",
];

function tone(a: string): "neutral" | "warn" | "danger" {
  if (TSUYOI.includes(a)) return "danger";
  if (MONEY.includes(a)) return "warn";
  return "neutral";
}

/** サーバーに残っている記録 1件 */
type Honmono = {
  seq: number;
  at: string;
  actorKind: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  target: string;
  summary: string;
  before: string | null;
  after: string | null;
  reason: string | null;
  requestId: string | null;
  data: Record<string, unknown> | null;
};

/** 日時を、読める形にする */
function nichiji(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const n = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}/${n(d.getMonth() + 1)}/${n(d.getDate())} ${n(d.getHours())}:${n(d.getMinutes())}`;
}

/** 追加項目の名前を、日本語にする */
const DATA_LABEL: Record<string, string> = {
  targetAdminId: "相手のID",
  targetName: "相手の名前",
  targetEmail: "相手のメール",
  issuedAt: "発行した時刻",
  expiresAt: "使える期限",
  validHours: "有効時間",
  freshStepUp: "直前の6桁の再確認",
  result: "結果",
};

function dataLabel(k: string): string {
  return DATA_LABEL[k] ?? k;
}

/**
 * 追加項目の中身を、読める形にする。
 *
 * ★時刻を、機械の形のまま出さないこと。
 *   2026-08-28T06:27:43.417Z は、機械には正確ですが、
 *   人には「28日の何時なのか」がすぐ分かりません。
 *   監査ログは、急いでいる人が読む画面です。
 */
function dataValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "あり" : "なし";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return nichiji(v);
  }
  return String(v);
}

/* ══════════════════════════════════════════════════════
   本物の記録
   ══════════════════════════════════════════════════════ */

function HonmonoNoKiroku() {
  const [list, setList] = useState<Honmono[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [tsuyoiDake, setTsuyoiDake] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch("/api/console/audit?limit=100", {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        events?: Honmono[];
        total?: number;
        message?: string;
        code?: string;
      };
      if (!res.ok || !data.ok) {
        /*
         * ★見る権限が無い、を「エラー」として赤く出さないこと。
         *   権限どおりに止まっているだけで、壊れてはいません。
         */
        if (res.status === 403) {
          setErr("KENGEN");
          setList([]);
          return;
        }
        setErr(data.message ?? "記録を読み込めませんでした。");
        setList([]);
        return;
      }
      setList(data.events ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setErr("記録を読み込めませんでした。");
      setList([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (list === null) {
    return (
      <Card title="サーバーに残っている記録" note="読み込んでいます">
        <Skeleton rows={4} label="監査ログを読み込んでいます" />
      </Card>
    );
  }

  if (err === "KENGEN") {
    return (
      <Card title="サーバーに残っている記録">
        <Empty
          why="この記録を見る権限が、いまのアカウントにはありません。"
          next="監査ログは、全員が見てよい情報ではありません。必要な場合は、設定画面で権限をお確かめください。"
        />
      </Card>
    );
  }

  if (err) {
    return (
      <Card title="サーバーに残っている記録">
        <ErrorBox what={err} onRetry={() => void load()} />
      </Card>
    );
  }

  const hyouji = tsuyoiDake
    ? list.filter((e) => TSUYOI.includes(e.action))
    : list;

  return (
    <Card
      title="サーバーに残っている記録"
      note={
        total === 0
          ? "まだ1件もありません。"
          : `全部で ${total} 件。新しいものが上です。`
      }
      right={
        <div className="flex items-center gap-3">
          <label className="nb flex items-center gap-2 text-note font-medium text-slate2">
            <input
              type="checkbox"
              checked={tsuyoiDake}
              onChange={(e) => setTsuyoiDake(e.target.checked)}
              className="h-4 w-4"
            />
            強い操作だけ
          </label>
          <Btn kind="ghost" onClick={() => void load()}>
            最新にする
          </Btn>
        </div>
      }
    >
      <p className="mb-4 text-note leading-[1.9] text-slate3">
        ここに出ているのは、このデモの中の見本ではなく、
        サーバーに本当に書き込まれた記録です。
        たとえば設定画面で仮パスワードを1件発行すると、
        「仮パスワード発行」として、この一覧が1件増えます。
        <br />
        <span className="font-bold text-slate2">
          ★パスワードそのものは、ここにも、記録の中にも、残していません。
        </span>
      </p>

      {hyouji.length === 0 ? (
        <Empty
          why={
            total === 0
              ? "まだ記録が1件もありません。"
              : "この条件に合う記録はありません。"
          }
          next={
            total === 0
              ? "ログインや仮パスワードの発行を行うと、ここに増えていきます。"
              : "「強い操作だけ」のチェックを外すと、すべての記録が出ます。"
          }
        />
      ) : (
        <>
          <Table head={["No", "いつ", "誰が", "何を", "なぜ", "くわしく"]}>
            {hyouji.map((e) => (
              <tr key={e.seq}>
                <Td className="num font-bold text-slate">{e.seq}</Td>
                <Td className="num whitespace-nowrap">{nichiji(e.at)}</Td>
                <Td>
                  <span className="font-medium text-slate">
                    {e.actorName || e.actorId || "-"}
                  </span>
                  <br />
                  <span className="text-slate3">{e.actorRole || "-"}</span>
                </Td>
                <Td>
                  <Badge tone={tone(e.action)}>{actionLabel(e.action)}</Badge>
                  <br />
                  <span className="mt-1 block">{e.summary}</span>
                </Td>
                <Td>{e.reason ?? "-"}</Td>
                <Td>
                  {e.data ? (
                    <span className="text-note text-slate3">
                      {Object.entries(e.data)
                        .map(([k, v]) => `${dataLabel(k)}：${dataValue(v)}`)
                        .join(" / ")}
                    </span>
                  ) : (
                    "-"
                  )}
                </Td>
              </tr>
            ))}
          </Table>

          <Rows>
            {hyouji.map((e) => (
              <RowCard key={e.seq}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="num text-note font-bold text-slate">
                    No.{e.seq}
                  </span>
                  <Badge tone={tone(e.action)}>{actionLabel(e.action)}</Badge>
                </div>
                <p className="mt-2 text-note font-medium leading-[1.85] text-slate2">
                  {e.summary}
                </p>
                <div className="mt-2 border-t border-edge pt-2">
                  <KV k="いつ" v={<span className="num">{nichiji(e.at)}</span>} />
                  <KV
                    k="誰が"
                    v={`${e.actorName || e.actorId || "-"}（${e.actorRole || "-"}）`}
                  />
                  {e.reason && <KV k="なぜ" v={e.reason} />}
                  {e.data &&
                    Object.entries(e.data).map(([k, v]) => (
                      <KV key={k} k={dataLabel(k)} v={dataValue(v)} />
                    ))}
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
  );
}

/* ══════════════════════════════════════════════════════
   画面
   ══════════════════════════════════════════════════════ */

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
        （書き換えると、セキュリティ画面の「検証する」で分かります）。
      </WhatIsThis>

      <HonmonoNoKiroku />

      <Card
        title="この画面で試した操作の記録（デモ）"
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
        <p className="mb-4">
          <span className="rounded-xl border border-warn/30 bg-warn/8 px-4 py-3 text-note leading-[1.85] text-warn-ink">
            <span className="mr-2 font-bold">デモ</span>
            こちらは、この画面の中だけの記録です。ガチャの公開やポイント変更をこの場で試すと増えますが、
            画面を読み込み直すと消えます。サーバーに残っているのは、上の一覧のほうです。
          </span>
        </p>

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
                      {actionLabel(e.action)}
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
                      {actionLabel(e.action)}
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
      </Card>
    </>
  );
}
