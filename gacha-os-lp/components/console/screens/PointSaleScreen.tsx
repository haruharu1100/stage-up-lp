/**
 * ポイント販売。
 * 売っている商品を店舗が自分で決め、購入と入金の記録を突き合わせる画面。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面が無いと、商品として成立しません
 * ═══════════════════════════════════════════════════════
 *
 *   「1,000円 → 1,000pt」をコードに書くと、
 *   値段を変えるたびに、こちらへ依頼が来ます。
 *   売っているものを、売っている人が変えられない状態は、
 *   売り物ではなく、預かり物です。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここからポイントを足せるようにしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   この画面を見るのは、たいてい次の問い合わせが来たときです。
 *
 *       「お金は払ったのに、ポイントが増えていません」
 *
 *   そのとき、この画面に「足す」ボタンがあれば、必ず押されます。
 *   押した数分後に、遅れていた確定通知が届きます。
 *   同じ入金で、2回ポイントが増えます。
 *
 *   足りない分は、ポイント管理の調整（二人承認）で扱います。
 *   ここにあるのは「調べる道具」だけです。
 *
 * ═══════════════════════════════════════════════════════
 * ★値段を直しても、過去の注文は動きません
 * ═══════════════════════════════════════════════════════
 *
 *   注文を作った時点で、名前・金額・付与ptを注文へ写し取っています。
 *   それを画面にも書いてあります。
 *   書いておかないと「昨日の注文がどうなるか分からない」ので、
 *   怖くて誰も値段を直せません。直せない機能は、無いのと同じです。
 */

"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Btn,
  Card,
  Drawer,
  Empty,
  ErrorBox,
  Field,
  KV,
  RowCard,
  Rows,
  Skeleton,
  Stat,
  Table,
  Td,
  Tr,
  WhatIsThis,
  inputClass,
} from "@/components/console/ui";
import {
  savePointProduct,
  usePointOrders,
  usePointProducts,
  type PointProduct,
} from "@/lib/console/livePointSale";

/* ══════════════════════════════════════════════
   表示の小道具
   ══════════════════════════════════════════════ */

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const pt = (n: number) => `${n.toLocaleString("ja-JP")}pt`;

/** 日時。★秒まで出すこと。二重通知は数秒差で届きます */
function when(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * 注文の状態。
 *
 * ★色だけで伝えないこと。必ず日本語も出します。
 */
function OrderBadge({ status }: { status: "PENDING" | "PAID" | "CANCELED" }) {
  if (status === "PAID") return <Badge tone="ok">支払い済み</Badge>;
  if (status === "CANCELED") return <Badge>取り消し</Badge>;
  return <Badge tone="warn">支払い待ち</Badge>;
}

/**
 * 確定通知をどう扱ったか。
 *
 * ★記号のまま出さないこと。
 *   「MISMATCH」と書いてあっても、何をすればよいか伝わりません。
 *   何が起きたのかを、日本語で書きます。
 */
const EVENT_LABEL: Record<string, { text: string; tone: "ok" | "warn" | "danger" | "neutral" }> = {
  APPLIED: { text: "反映した", tone: "ok" },
  DUPLICATE: { text: "同じ通知（反映しない）", tone: "neutral" },
  MISMATCH: { text: "金額が違う（反映しない）", tone: "danger" },
  REJECTED: { text: "受け付けなかった", tone: "danger" },
  NO_ORDER: { text: "注文が見つからない", tone: "danger" },
};

function EventBadge({ result }: { result: string }) {
  const v = EVENT_LABEL[result] ?? { text: result || "不明", tone: "neutral" as const };
  return <Badge tone={v.tone}>{v.text}</Badge>;
}

/* ══════════════════════════════════════════════
   本体
   ══════════════════════════════════════════════ */

type EditTarget =
  | { mode: "new" }
  | { mode: "edit"; product: PointProduct }
  | null;

export function PointSaleScreen() {
  const shouhin = usePointProducts();
  const chuumon = usePointOrders();
  const [edit, setEdit] = useState<EditTarget>(null);

  const p = shouhin.state.phase === "ok" ? shouhin.state.data : null;
  const o = chuumon.state.phase === "ok" ? chuumon.state.data : null;

  /* 数えるのは「見えている一覧の中身」だけ。
     売上のような、他の画面にもある数字はここで作りません。 */
  const uriBaKazu = useMemo(
    () => (p ? p.products.filter((x) => x.status === "ACTIVE").length : null),
    [p],
  );
  const machiKazu = useMemo(
    () => (o ? o.orders.filter((x) => x.status === "PENDING").length : null),
    [o],
  );

  return (
    <div className="space-y-5">
      <WhatIsThis>
        お客様がポイントを買うときに並ぶ商品を、ここで決めます。
        販売金額・付与ポイント・おまけ・並び順・停止のすべてを、
        店舗側だけで変えられます。
        値段を直しても、すでに作られている注文の金額は変わりません
        （注文を作った時点の金額を、注文の側へ写してあるためです）。
        下半分は、入金の確定通知が届いたかどうかを調べる場所です。
        この画面からポイントを足すことはできません。足りない分は
        「ポイント管理」の調整（承認つき）で行います。
      </WhatIsThis>

      {/* ★決済のしくみが決まっていないことは、いちばん先に出す。
            商品を並べても、誰も買えない状態だからです。 */}
      {p?.providerError && (
        <div className="rounded-xl border-2 border-dashed border-warn/50 bg-warn/10 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-warn-ink px-2 py-1 text-[11px] font-bold tracking-wide text-white">
              決済が未設定
            </span>
            <span className="text-note font-bold text-warn-ink">
              いまは、お客様が購入を完了できません
            </span>
          </div>
          <p className="mt-2 text-note leading-[1.9] text-warn-ink">
            {p.providerError}
          </p>
        </div>
      )}

      {/* ★金額不一致は、いちばん上に出す。
            一覧の下のほうに置くと、誰も気づきません。 */}
      {o && o.mismatchCount > 0 && (
        <ErrorBox
          what={`入金額と注文の金額が合わない通知が ${o.mismatchCount} 件あります。ポイントは反映していません。`}
          code="AMOUNT_MISMATCH"
          onRetry={chuumon.reload}
        />
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="売り場に出ている商品"
          value={uriBaKazu === null ? "—" : uriBaKazu}
          unit={uriBaKazu === null ? undefined : "件"}
          sub="止めている商品は数えていません"
        />
        <Stat
          label="支払い待ちの注文"
          value={machiKazu === null ? "—" : machiKazu}
          unit={machiKazu === null ? undefined : "件"}
          sub="直近100件のうち"
        />
        <Stat
          label="金額が合わない通知"
          value={o === null ? "—" : o.mismatchCount}
          unit={o === null ? undefined : "件"}
          tone={o && o.mismatchCount > 0 ? "danger" : "normal"}
          sub="0件が正常です"
        />
        <Stat
          label="決済のしくみ"
          value={p === null ? "—" : (p.provider ?? "未設定")}
          sub={p?.provider === "mock" ? "検証用。実際のお金は動きません" : undefined}
        />
      </div>

      {/* ── 売っている商品 ───────────────────────── */}
      <Card
        title="売っているポイント商品"
        note="ここに並べたものが、そのままお客様の購入画面に出ます"
        right={
          p?.canEdit ? (
            <Btn kind="primary" onClick={() => setEdit({ mode: "new" })}>
              商品を追加する
            </Btn>
          ) : (
            <Badge>変更する権限がありません</Badge>
          )
        }
      >
        {shouhin.state.phase === "loading" && <Skeleton rows={3} />}

        {shouhin.state.phase === "ng" && (
          <ErrorBox
            what={shouhin.state.why}
            code={shouhin.state.code}
            onRetry={shouhin.reload}
          />
        )}

        {p && p.products.length === 0 && (
          <Empty
            why="まだ、売るポイント商品を1つも作っていません。この状態では、お客様は残高が足りなくなったときに何も買えません。"
            next={
              p.canEdit
                ? "右上の「商品を追加する」から、販売金額と付与ポイントを決めてください。"
                : "商品を作るには、経理または全権管理者の権限が要ります。"
            }
          />
        )}

        {p && p.products.length > 0 && (
          <>
            <Table
              head={[
                "並び順",
                "商品名",
                "販売金額",
                "付与pt",
                "おまけpt",
                "受け取る合計",
                "状態",
              ]}
            >
              {p.products.map((x) => (
                <Tr
                  key={x.id}
                  onOpen={
                    p.canEdit
                      ? () => setEdit({ mode: "edit", product: x })
                      : undefined
                  }
                  tone={x.status === "DISABLED" ? "warn" : undefined}
                >
                  <Td className="num tabular-nums">{x.sortOrder}</Td>
                  <Td className="font-bold text-slate">{x.name}</Td>
                  <Td className="num tabular-nums">{yen(x.priceYen)}</Td>
                  <Td className="num tabular-nums">{pt(x.points)}</Td>
                  <Td className="num tabular-nums">
                    {x.bonusPoints > 0 ? pt(x.bonusPoints) : "—"}
                  </Td>
                  <Td className="num font-bold tabular-nums text-slate">
                    {pt(x.totalPoints)}
                  </Td>
                  <Td>
                    {x.status === "ACTIVE" ? (
                      <Badge tone="ok">売り場に出ている</Badge>
                    ) : (
                      <Badge tone="warn">止めている</Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </Table>

            <Rows>
              {p.products.map((x) => (
                <RowCard key={x.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-note font-bold text-slate">
                      {x.name}
                    </span>
                    {x.status === "ACTIVE" ? (
                      <Badge tone="ok">売り場に出ている</Badge>
                    ) : (
                      <Badge tone="warn">止めている</Badge>
                    )}
                  </div>
                  <div className="mt-2">
                    <KV k="販売金額" v={yen(x.priceYen)} />
                    <KV k="付与pt" v={pt(x.points)} />
                    <KV
                      k="おまけpt"
                      v={x.bonusPoints > 0 ? pt(x.bonusPoints) : "—"}
                    />
                    <KV k="受け取る合計" v={pt(x.totalPoints)} />
                    <KV k="並び順" v={String(x.sortOrder)} />
                  </div>
                  {p.canEdit && (
                    <div className="mt-3">
                      <Btn full onClick={() => setEdit({ mode: "edit", product: x })}>
                        この商品を直す
                      </Btn>
                    </div>
                  )}
                </RowCard>
              ))}
            </Rows>

            <p className="mt-4 text-note leading-[1.9] text-slate3">
              値段や付与ポイントを直しても、
              <strong className="font-bold text-slate2">
                すでに作られている注文の金額は変わりません
              </strong>
              。注文を作った時点の内容を、注文の側へ写してあるためです。
              売るのをやめるときは、行を消すのではなく「止めている」にしてください。
              消してしまうと、過去の注文が何を買ったものか分からなくなります。
            </p>
          </>
        )}
      </Card>

      {/* ── 購入一覧 ─────────────────────────────── */}
      <Card
        title="ポイントの購入"
        note="直近100件。金額と付与ポイントは、注文を作った時点のものです"
        right={<Btn onClick={chuumon.reload}>読み直す</Btn>}
      >
        {chuumon.state.phase === "loading" && <Skeleton rows={3} />}

        {chuumon.state.phase === "ng" && (
          <ErrorBox
            what={chuumon.state.why}
            code={chuumon.state.code}
            onRetry={chuumon.reload}
          />
        )}

        {o && o.orders.length === 0 && (
          <Empty
            why="まだ、ポイントの購入がありません。異常ではありません。"
            next="お客様が購入画面から注文を作ると、ここに1件ずつ増えます。"
          />
        )}

        {o && o.orders.length > 0 && (
          <>
            <Table
              head={["注文", "会員", "商品", "金額", "付与pt", "状態", "作成", "入金"]}
            >
              {o.orders.map((x) => (
                <Tr key={x.id} tone={x.status === "PENDING" ? "warn" : undefined}>
                  <Td className="num font-mono text-[0.78rem]">{x.id}</Td>
                  <Td>{x.userName || "（退会・不明）"}</Td>
                  <Td>{x.productName}</Td>
                  <Td className="num tabular-nums">{yen(x.priceYen)}</Td>
                  <Td className="num tabular-nums">{pt(x.totalPoints)}</Td>
                  <Td>
                    <OrderBadge status={x.status} />
                  </Td>
                  <Td className="num tabular-nums">{when(x.createdAt)}</Td>
                  <Td className="num tabular-nums">
                    {x.paidAt ? when(x.paidAt) : "—"}
                  </Td>
                </Tr>
              ))}
            </Table>

            <Rows>
              {o.orders.map((x) => (
                <RowCard key={x.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-note font-bold text-slate">
                      {x.productName}
                    </span>
                    <OrderBadge status={x.status} />
                  </div>
                  <div className="mt-2">
                    <KV k="会員" v={x.userName || "（退会・不明）"} />
                    <KV k="金額" v={yen(x.priceYen)} />
                    <KV k="付与pt" v={pt(x.totalPoints)} />
                    <KV k="作成" v={when(x.createdAt)} />
                    <KV k="入金" v={x.paidAt ? when(x.paidAt) : "—"} />
                    <KV
                      k="注文番号"
                      v={<span className="font-mono text-[0.78rem]">{x.id}</span>}
                    />
                  </div>
                </RowCard>
              ))}
            </Rows>
          </>
        )}
      </Card>

      {/* ── 確定通知の受信記録 ───────────────────── */}
      <Card
        title="入金の確定通知（受信記録）"
        note="「払ったのにポイントが増えない」を切り分けるための記録です"
      >
        {chuumon.state.phase === "loading" && <Skeleton rows={3} />}

        {o && o.events.length === 0 && (
          <Empty
            why="まだ、決済のしくみからの通知を1件も受け取っていません。"
            next="購入がまだ無いのであれば、正常です。購入があるのに1件も無い場合は、決済のしくみ側から通知が届いていません。"
          />
        )}

        {o && o.events.length > 0 && (
          <>
            <Table head={["受信", "扱い", "注文", "通知の金額", "通知の番号", "備考"]}>
              {o.events.map((e) => (
                <Tr
                  key={`${e.provider}:${e.eventId}`}
                  tone={
                    e.result === "MISMATCH" || e.result === "REJECTED"
                      ? "danger"
                      : undefined
                  }
                >
                  <Td className="num tabular-nums">{when(e.createdAt)}</Td>
                  <Td>
                    <EventBadge result={e.result} />
                  </Td>
                  <Td className="num font-mono text-[0.78rem]">
                    {e.orderId ?? "—"}
                  </Td>
                  {/* ★null を 0円 と書かないこと。
                        「金額が入っていない通知」と「0円の通知」は別ものです */}
                  <Td className="num tabular-nums">
                    {e.amountYen === null ? "—" : yen(e.amountYen)}
                  </Td>
                  <Td className="num font-mono text-[0.78rem]">{e.eventId}</Td>
                  <Td>{e.note || "—"}</Td>
                </Tr>
              ))}
            </Table>

            <Rows>
              {o.events.map((e) => (
                <RowCard key={`${e.provider}:${e.eventId}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="num text-note text-slate3">
                      {when(e.createdAt)}
                    </span>
                    <EventBadge result={e.result} />
                  </div>
                  <div className="mt-2">
                    <KV k="注文" v={e.orderId ?? "—"} />
                    <KV
                      k="通知の金額"
                      v={e.amountYen === null ? "—" : yen(e.amountYen)}
                    />
                    <KV k="備考" v={e.note || "—"} />
                  </div>
                </RowCard>
              ))}
            </Rows>

            <p className="mt-4 text-note leading-[1.9] text-slate3">
              「反映した」が1件あれば、ポイントは足りています。同じ入金で
              「同じ通知」が何度届いても、増えるのは1回だけです。
              「金額が違う」が出ているときは、こちらでは反映していません。
              入金の事実を決済のしくみ側で確認してから、
              「ポイント管理」の調整（承認つき）で処理してください。
            </p>
          </>
        )}
      </Card>

      <EditDrawer
        target={edit}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          shouhin.reload();
        }}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════
   商品を作る・直す板
   ══════════════════════════════════════════════ */

/**
 * ★入力欄を、数値型（type="number"）にしていません。
 *   数値型は、上下キーやホイールで勝手に値が変わります。
 *   金額の欄でそれが起きると、直したつもりのない桁が動きます。
 *   文字として受け取り、整数かどうかはサーバーが見ます。
 */
function EditDrawer({
  target,
  onClose,
  onSaved,
}: {
  target: EditTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const cur = target?.mode === "edit" ? target.product : null;

  /* 板を開き直すたびに、中身を入れ直す。
     ★前に開いた商品の値が残ったまま保存されるのを避けるため、
       key で作り直しています（下の <EditForm key=...> ）。 */
  return (
    <Drawer
      open={target !== null}
      title={cur ? "ポイント商品を直す" : "ポイント商品を追加する"}
      note={
        cur
          ? "直しても、すでに作られている注文の金額は変わりません"
          : "販売金額と、お客様が受け取るポイントを決めます"
      }
      onClose={onClose}
    >
      {target && (
        <EditForm
          key={cur?.id ?? "new"}
          product={cur}
          onCancel={onClose}
          onSaved={onSaved}
        />
      )}
    </Drawer>
  );
}

function EditForm({
  product,
  onCancel,
  onSaved,
}: {
  product: PointProduct | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [priceYen, setPriceYen] = useState(
    product ? String(product.priceYen) : "",
  );
  const [points, setPoints] = useState(product ? String(product.points) : "");
  const [bonus, setBonus] = useState(
    product ? String(product.bonusPoints) : "0",
  );
  const [sortOrder, setSortOrder] = useState(
    product ? String(product.sortOrder) : "0",
  );
  const [active, setActive] = useState(
    product ? product.status === "ACTIVE" : true,
  );
  const [okuruChu, setOkuruChu] = useState(false);
  const [shippai, setShippai] = useState<{ message: string; code: string } | null>(
    null,
  );

  /* 受け取る合計だけは、打っている最中に見せます。
     ★これは保存する値ではありません。打ち間違いに気づくための表示です。
       保存されるのは付与ptとおまけptで、合計はサーバーが足します。 */
  const nP = Number(points);
  const nB = Number(bonus);
  const goukei =
    Number.isFinite(nP) && Number.isFinite(nB) && points !== "" ? nP + nB : null;

  async function hozon() {
    setOkuruChu(true);
    setShippai(null);
    const r = await savePointProduct({
      productId: product?.id,
      name,
      priceYen: Number(priceYen),
      points: Number(points),
      bonusPoints: Number(bonus === "" ? 0 : bonus),
      status: active ? "ACTIVE" : "DISABLED",
      sortOrder: Number(sortOrder === "" ? 0 : sortOrder),
    });
    setOkuruChu(false);
    if (r.ok) {
      onSaved();
      return;
    }
    setShippai({ message: r.message, code: r.code });
  }

  return (
    <div className="space-y-4">
      {shippai && (
        <div
          className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3"
          role="alert"
        >
          <p className="text-note font-bold leading-[1.85] text-danger-ink">
            {shippai.message}
          </p>
          <p className="mt-1 text-note text-slate3">
            保存していません（記号：{shippai.code}）。
          </p>
        </div>
      )}

      <Field
        label="商品名"
        required
        note="お客様の購入画面に、そのまま出ます（60文字まで）"
      >
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="1,000円ぶん"
        />
      </Field>

      <Field label="販売金額（円）" required note="お客様が支払う金額です">
        <input
          className={inputClass}
          value={priceYen}
          inputMode="numeric"
          onChange={(e) => setPriceYen(e.target.value)}
          placeholder="1000"
        />
      </Field>

      <Field
        label="付与ポイント"
        required
        note="支払いと引きかえに渡すポイントです"
      >
        <input
          className={inputClass}
          value={points}
          inputMode="numeric"
          onChange={(e) => setPoints(e.target.value)}
          placeholder="1000"
        />
      </Field>

      <Field
        label="おまけポイント"
        note="まとめ買いの上乗せぶん。無いときは 0 のままにします"
      >
        <input
          className={inputClass}
          value={bonus}
          inputMode="numeric"
          onChange={(e) => setBonus(e.target.value)}
          placeholder="0"
        />
      </Field>

      <div className="rounded-xl border border-edge2 bg-paper2 px-4 py-3">
        <p className="text-note text-slate3">お客様が受け取る合計</p>
        <p className="num mt-1 text-[1.5rem] font-bold tabular-nums text-slate">
          {goukei === null ? "—" : pt(goukei)}
        </p>
        <p className="mt-1 text-note text-slate3">
          付与ポイントとおまけポイントの合計です。ここは入力できません。
        </p>
      </div>

      <Field
        label="並び順"
        note="小さいほど上に出ます。同じ数字のときは、金額の安い順です"
      >
        <input
          className={inputClass}
          value={sortOrder}
          inputMode="numeric"
          onChange={(e) => setSortOrder(e.target.value)}
          placeholder="0"
        />
      </Field>

      <div className="rounded-xl border border-edge2 bg-paper2 px-4 py-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-blue-ink"
          />
          <span className="min-w-0">
            <span className="block text-note font-bold text-slate2">
              売り場に出す
            </span>
            <span className="mt-1 block text-note leading-[1.85] text-slate3">
              外すと、お客様の購入画面から消えます。
              すでに作られている支払い待ちの注文は、そのまま支払えます。
              記録を残すため、商品そのものを消す口は用意していません。
            </span>
          </span>
        </label>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Btn kind="primary" onClick={hozon} disabled={okuruChu}>
          {okuruChu ? "保存しています…" : "保存する"}
        </Btn>
        <Btn kind="ghost" onClick={onCancel} disabled={okuruChu}>
          やめる
        </Btn>
      </div>

      <p className="text-note leading-[1.9] text-slate3">
        保存すると、この内容がすぐお客様の購入画面に反映されます。
        すでに作られている注文の金額と付与ポイントは、変わりません。
      </p>
    </div>
  );
}
