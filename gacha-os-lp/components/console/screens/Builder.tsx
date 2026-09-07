/**
 * AI ガチャ作成（AI GACHA BUILDER）。
 *
 * ═══════════════════════════════════════════════
 * ★この画面の考え方
 * ═══════════════════════════════════════════════
 *
 *   ガチャを作るとき、いちばん時間がかかるのは
 *   「賞の数と値段を、還元率が合うように決め直す作業」です。
 *   S賞を1つ強くすると、下の賞を全部いじり直すことになります。
 *   これを電卓でやっていると、1本作るのに何時間もかかります。
 *
 *   ここでは、日本語で条件を書くと、たたき台が出ます。
 *   出たものに「S賞をもう少し強く」と足すと、全体を組み直します。
 *
 * ★出た案を、そのまま公開できるようにしないこと。
 *   この画面からできるのは「下書きとして登録する」ところまでです。
 *   登録した時点では、検証結果を空のままにします。
 *   ここに表示している判定は、あくまで下書き前の下見です。
 *   ガチャ管理でもう一度「検証を実行」し、その結果を保存してからでないと
 *   公開ボタンは通りません。
 *   人が考えたものでもAIが出したものでも、検証を飛ばさせません。
 *
 * ═══════════════════════════════════════════════
 * ★2026-09-04 に直したこと（保存していなかった）
 * ═══════════════════════════════════════════════
 *
 *   この画面の「この案を下書きとして登録する」は、
 *   押すと緑色で「下書きに登録しました」と出ていましたが、
 *   サーバーへは何も送っていませんでした。
 *   ブラウザの中の配列に足していただけなので、
 *   画面を開き直すと、作ったガチャは消えていました。
 *   IDも `g_202` のように画面側で組み立てた作り物でした。
 *
 *   いまは POST /api/console/gachas へ送り、
 *   保存できたときにサーバーが返したIDだけを表示します。
 *   ★保存できたと書くのは、保存できてからにすること。
 *
 * ★このデモでは、案はブラウザの中の計算で作っています。
 *   外部のAIには接続していません（完全Sandboxのため）。
 *   組み立ての手順と、出てくる数字の性質は本番と同じにしてあります。
 *   ただし「登録」だけは本物です。押すと本当に保存されます。
 *
 * ═══════════════════════════════════════════════
 * ★商品の写真について
 * ═══════════════════════════════════════════════
 *
 *   お客様の売り場に出るのは、ここで預けた写真だけです。
 *   タイトルから絵を描いて商品の顔にすることはしません。
 *   お客様が払っているのは、絵ではなく現物に対してだからです。
 *   預けていない賞は、売り場で「画像未登録」と出ます。
 *
 *   ★写真は spec の中に入れません。
 *     spec の指紋が変わると、写真を差し替えただけで
 *     販売中のガチャが「未検証」に戻ります。
 */

"use client";

import { useMemo, useState } from "react";
import { backtestReport, designedRtp, verdictLabel, type GachaSpec } from "@/lib/backtest";
import { createGachaDraft } from "@/lib/console/liveGachas";
import { uploadImage, type ImageKind } from "@/lib/console/liveImages";
import { STRENGTH_LABEL, buildSpec, type Strength } from "@/lib/console/spec";
/* 賞の呼び名（特賞 / 1等 …）。★仮置きの景品名を、この呼び名で作るために読みます */
import { useGradeLabels } from "@/lib/console/liveStore";
import { BACKTEST_SEED, can, type ConsoleState } from "@/lib/console/state";
import type { MenuKey } from "../menu";
import { Badge, Btn, Card, DemoNote, Field, KV, RowCard, Rows, Table, Td, WhatIsThis, inputClass } from "../ui";

/**
 * 写真を1枚あずける枠。
 *
 * ★断られたときに、前の写真を消さないこと。
 *   差し替えようとして1枚弾かれただけで、
 *   さっき上げた写真まで消えると、最初からやり直しになります。
 *
 * ★断られた理由を、そのまま出すこと。
 *   「失敗しました」だけだと、同じ写真を何度も送り直します。
 */
function PhotoPicker({
  label,
  note,
  kind,
  imageId,
  onPicked,
}: {
  label: string;
  note?: string;
  kind: ImageKind;
  imageId: string | null;
  onPicked: (id: string | null) => void;
}) {
  const [okurichuu, setOkurichuu] = useState(false);
  const [kotowari, setKotowari] = useState<string | null>(null);

  const erabu = async (f: File | null) => {
    if (!f) return;
    setOkurichuu(true);
    setKotowari(null);
    const r = await uploadImage(f, kind);
    setOkurichuu(false);
    if (!r.ok) {
      setKotowari(r.message);
      return;
    }
    onPicked(r.imageId);
  };

  return (
    <div className="rounded-xl border border-edge2 bg-paper2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* いま預かっている写真。★預かっていないときに絵を描かないこと */}
        {imageId ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/api/images/${imageId}`}
            alt={label}
            className="h-16 w-16 shrink-0 rounded-lg border border-edge object-cover"
          />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-edge bg-slate-100 text-center text-[0.65rem] font-medium text-slate-500">
            画像未登録
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-note font-bold text-slate">{label}</p>
          {note && <p className="mt-0.5 text-label leading-[1.8] text-slate3">{note}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center rounded-lg border border-edge bg-white px-3 py-1.5 text-label font-medium text-slate2 hover:bg-paper2">
              {okurichuu ? "送っています…" : imageId ? "写真を差し替える" : "写真を選ぶ"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={okurichuu}
                onChange={(e) => {
                  void erabu(e.target.files?.[0] ?? null);
                  /* 同じファイルをもう一度選べるようにしておく */
                  e.target.value = "";
                }}
              />
            </label>
            {imageId && (
              <Btn kind="ghost" onClick={() => onPicked(null)}>
                取り消す
              </Btn>
            )}
          </div>
        </div>
      </div>

      {kotowari && (
        <p className="mt-2 rounded-lg border border-warn/35 bg-warn/10 px-3 py-2 text-label leading-[1.85] text-warn-ink">
          {kotowari}
        </p>
      )}
    </div>
  );
}

/** 「500円・1000口で」のような文から、数字を拾う */
function readPrompt(text: string): { price?: number; total?: number; strength?: Strength } {
  const price = text.match(/(\d[\d,]*)\s*円/);
  const total = text.match(/(\d[\d,]*)\s*口/);
  const num = (m: RegExpMatchArray | null) =>
    m ? Number(m[1].replace(/,/g, "")) : undefined;

  let strength: Strength | undefined;
  if (/(S賞|大当たり|上|1等).*(強|厚|大き|派手)/.test(text)) strength = 2;
  if (/(安全|堅|控えめ|抑え)/.test(text)) strength = 0;

  return { price: num(price), total: num(total), strength };
}

const PRESETS = [
  "500円・1000口で、人気カード中心。S賞を強めに。",
  "1000円・500口で、スニーカー中心。堅めに。",
  "300円・2000口で、週末限定。気軽に引ける構成。",
];

export default function Builder({
  s,
  onNav,
}: {
  s: ConsoleState;
  onNav: (k: MenuKey) => void;
}) {
  const [text, setText] = useState(PRESETS[0]);
  const [spec, setSpec] = useState<GachaSpec | null>(null);
  const [price, setPrice] = useState(500);
  const [total, setTotal] = useState(1000);
  const [strength, setStrength] = useState<Strength>(1);
  const [target, setTarget] = useState(95);
  const [log, setLog] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  /** 登録済みのガチャID。★サーバーが返したものだけを入れること */
  const [savedId, setSavedId] = useState<string | null>(null);
  /** 送っている最中か。連打で2本できるのを防ぐ */
  const [okurichuu, setOkurichuu] = useState(false);
  /** 断られた理由。★「登録できませんでした」で終わらせない */
  const [shippai, setShippai] = useState<string | null>(null);

  /**
   * 表紙の写真のID。
   * ★先に /api/console/images へ預けて、受け取ったIDだけを入れること。
   *   ここでファイルそのものを持ったまま登録すると、
   *   写真が1枚弾かれただけでガチャの登録ごとやり直しになります。
   */
  const [coverImageId, setCoverImageId] = useState<string | null>(null);
  /** 等級ごとの写真のID（S / A / B …） */
  const [prizeImages, setPrizeImages] = useState<Record<string, string>>({});

  const mayEdit = s.me ? can(s.me.role, "gacha.edit") : false;

  /**
   * そのお店が決めた、賞の呼び名。
   *
   * ★読めていないときは、渡さないこと（undefined のまま）。
   *   ここで「S賞」を組み立てて渡すと、
   *   通信が遅かった日にだけ「S賞」で保存される、という
   *   再現しにくい取り違えが起きます。
   *   渡さなければ、buildSpec 側の既定（S賞…）が1か所で決まります。
   */
  const { state: yobinaState } = useGradeLabels();
  const yobina = useMemo(() => {
    if (yobinaState.phase !== "ok") return undefined;
    const out: Record<string, string> = {};
    for (const g of yobinaState.data.grades) out[g.grade] = g.label;
    return out;
  }, [yobinaState]);

  const generate = (nextStrength = strength, nextTarget = target, note?: string) => {
    const read = readPrompt(text);
    const p = read.price ?? price;
    const t = read.total ?? total;
    const st = note ? nextStrength : (read.strength ?? nextStrength);
    setPrice(p);
    setTotal(t);
    setStrength(st);
    setTarget(nextTarget);
    const atarashii = buildSpec("AIが組んだ案", p, t, st, nextTarget, yobina);
    setSpec(atarashii);

    /* 組み直しても、預けた写真はそのまま残します。
       ★ただし、無くなった等級ぶんは外すこと。
         S賞が消えたのに S賞の写真だけ残ると、
         どこにも出ない写真をサーバーへ送ることになります。 */
    const nokoru = new Set(atarashii.prizes.map((pr) => pr.grade));
    setPrizeImages((prev) => {
      const next: Record<string, string> = {};
      for (const [grade, id] of Object.entries(prev)) {
        if (nokoru.has(grade)) next[grade] = id;
      }
      return next;
    });

    /* 組み直したら、それは別の案です。登録済みの印を外します */
    setSavedId(null);
    setShippai(null);
    if (!titleTouched) setTitle(`${p.toLocaleString()}円 ${t.toLocaleString()}口 ガチャ`);
    setLog((prev) => [
      ...prev,
      note ?? `「${text}」から、${p.toLocaleString()}円 × ${t.toLocaleString()}口 で組みました。`,
    ]);
  };

  /* 出た案を、その場で検証にかける。判定を見ないまま次へ進ませない */
  const report = useMemo(
    () => (spec ? backtestReport(spec, BACKTEST_SEED, "2026-08-22 12:00") : null),
    [spec],
  );

  /**
   * 登録できるか。名前が空・権限なし・送信中は、押す前に止める。
   *
   * ★同じ名前があるかどうかを、この画面で判断しないこと。
   *   ここで見られるのは、この画面が持っている見本の一覧だけです。
   *   本当に登録されているガチャは、サーバーにしかありません。
   *   同じ名前かどうかは、サーバーが断ります（DUP_TITLE）。
   */
  const canSave =
    mayEdit && !!spec && title.trim().length > 0 && !savedId && !okurichuu;

  /**
   * 写真がまだ無い賞の数。
   *
   * ★これで登録を止めないこと。
   *   写真が揃うのは、たいてい商品が届いたあとです。
   *   ここで止めると、先に組んでおくことができなくなります。
   *   出るのは注意書きだけにして、判断は運営に残します。
   */
  const mikitouroku = spec
    ? spec.prizes.filter((p) => !prizeImages[p.grade]).length
    : 0;

  const save = async () => {
    if (!spec || !canSave) return;
    const namae = title.trim();
    setOkurichuu(true);
    setShippai(null);

    /* ★名前は、いま入力されているものに合わせて送ること。
         案を作ったときの名前のまま送ると、
         画面に出ている名前と、保存された名前が違うものになります。 */
    const r = await createGachaDraft({
      title: namae,
      spec: { ...spec, name: namae },
      /* ★写真は spec の外へ渡すこと。
           spec に混ぜると指紋が変わり、写真を差し替えただけで
           販売中のガチャが「未検証」に戻ります。 */
      coverImageId,
      prizeImages,
    });
    setOkurichuu(false);

    if (!r.ok) {
      setShippai(r.message);
      setLog((prev) => [...prev, `「${namae}」は登録できませんでした：${r.message}`]);
      return;
    }
    /* ★IDは、保存できたサーバーが返したものだけを使うこと */
    setSavedId(r.gachaId);
    setLog((prev) => [...prev, `「${namae}」を下書きとして登録しました（検証はこれから）。`]);
  };

  return (
    <>
      <WhatIsThis>
        日本語で条件を書くと、賞の数と値段のたたき台が出ます。
        出た案は<strong className="font-bold text-slate">その場で検証にかけます</strong>。
        この画面から直接は公開できません。
      </WhatIsThis>

      {/* ── 条件を書く ── */}
      <Card title="どんなガチャを作りますか" note="値段と口数は、文の中に書いても拾います。">
        <div className="space-y-4">
          <Field label="条件" note="例）500円・1000口で、人気カード中心。S賞を強めに。">
            <textarea
              className={`${inputClass} min-h-[5rem]`}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Btn key={p} kind="ghost" onClick={() => setText(p)}>
                {p.slice(0, 14)}…
              </Btn>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="1回の値段">
              <input
                className={`${inputClass} num`}
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value.replace(/\D/g, "")) || 0)}
              />
            </Field>
            <Field label="口数">
              <input
                className={`${inputClass} num`}
                inputMode="numeric"
                value={total}
                onChange={(e) => setTotal(Number(e.target.value.replace(/\D/g, "")) || 0)}
              />
            </Field>
            <Field label="目標の還元率" note="景品にいくら回すか。90〜97%が一般的です。">
              <select
                className={inputClass}
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
              >
                {[90, 92, 94, 95, 96, 97].map((v) => (
                  <option key={v} value={v}>
                    {v}%
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Btn kind="primary" onClick={() => generate()}>
            案を作る
          </Btn>
        </div>
      </Card>

      {/* ── 出た案 ── */}
      {spec && report && (
        <>
          <Card
            title="AIが組んだ案"
            note={`${price.toLocaleString()}円 × ${total.toLocaleString()}口 ／ S賞は「${STRENGTH_LABEL[strength]}」`}
            right={<Badge tone="blue">設計還元率 {designedRtp(spec).toFixed(1)}%</Badge>}
          >
            <Table head={["賞", "本数", "1本あたりの価値", "この賞に回す金額"]}>
              {spec.prizes.map((p) => (
                <tr key={p.grade}>
                  <Td className="font-bold text-slate">{p.grade}賞</Td>
                  <Td className="num">{p.count.toLocaleString()}本</Td>
                  <Td className="num">{p.value.toLocaleString()}円</Td>
                  <Td className="num">{(p.value * p.count).toLocaleString()}円</Td>
                </tr>
              ))}
            </Table>

            <Rows>
              {spec.prizes.map((p) => (
                <RowCard key={p.grade}>
                  <p className="text-note font-bold text-slate">{p.grade}賞</p>
                  <div className="mt-2 border-t border-edge pt-2">
                    <KV k="本数" v={<span className="num">{p.count.toLocaleString()}本</span>} />
                    <KV k="1本あたり" v={<span className="num">{p.value.toLocaleString()}円</span>} />
                    <KV k="合計" v={<span className="num">{(p.value * p.count).toLocaleString()}円</span>} />
                  </div>
                </RowCard>
              ))}
            </Rows>

            <div className="mt-5 border-t border-edge2 pt-4">
              <p className="text-note font-bold text-slate2">案を直す</p>
              <p className="mt-1 text-note leading-[1.85] text-slate3">
                押すと、全体を組み直します。1つの賞だけ変えて還元率がずれる、が起きません。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn
                  onClick={() =>
                    generate(Math.min(2, strength + 1) as Strength, target, "S賞をもう少し強くして、組み直しました。")
                  }
                  disabled={strength === 2}
                >
                  S賞をもう少し強く
                </Btn>
                <Btn
                  onClick={() =>
                    generate(Math.max(0, strength - 1) as Strength, target, "S賞を控えめにして、組み直しました。")
                  }
                  disabled={strength === 0}
                >
                  S賞を控えめに
                </Btn>
                <Btn
                  onClick={() => generate(strength, Math.max(90, target - 2), "景品に回す割合を下げて、組み直しました。")}
                  disabled={target <= 90}
                >
                  もう少し利益を残す
                </Btn>
                <Btn
                  onClick={() => generate(strength, Math.min(97, target + 2), "景品に回す割合を上げて、組み直しました。")}
                  disabled={target >= 97}
                >
                  もう少しお得に見せる
                </Btn>
              </div>
            </div>
          </Card>

          {/* ── その場で検証 ── */}
          <Card
            title="この案の検証結果"
            note="6つの状況で200回ずつ試しています。公開可否は【設計】シナリオだけで決めます。"
          >
            {!report.usable ? (
              <div className="rounded-xl border border-warn/35 bg-warn/10 px-4 py-4">
                <Badge tone="warn">判定できません</Badge>
                <ul className="mt-2 space-y-1">
                  {report.issues.map((i) => (
                    <li key={i.code} className="text-note leading-[1.9] text-warn-ink">
                      {i.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <div
                  className={`rounded-xl border px-4 py-4 ${
                    report.overall === "SAFE"
                      ? "border-ok/30 bg-ok/10"
                      : report.overall === "CAUTION"
                        ? "border-warn/35 bg-warn/10"
                        : "border-danger/30 bg-danger/10"
                  }`}
                >
                  <p className="text-label font-bold tracking-wide text-slate3">
                    【設計】このまま公開してよいか
                  </p>
                  <div className="mt-2">
                    <Badge
                      tone={
                        report.overall === "SAFE" ? "ok" : report.overall === "CAUTION" ? "warn" : "danger"
                      }
                    >
                      {report.overall} ／ {verdictLabel[report.overall]}
                    </Badge>
                  </div>
                  <p className="mt-2 text-note leading-[1.9] text-slate2">
                    当選の順番だけを200通り試したとき、赤字になった回は
                    <span className="num font-bold">
                      {" "}
                      {(
                        Math.max(
                          ...report.scenarios
                            .filter((sc) => sc.kind === "design")
                            .map((sc) => sc.distribution.lossRate),
                        ) * 100
                      ).toFixed(1)}
                      %{" "}
                    </span>
                    でした。
                  </p>
                </div>

                {/* 公開したあとに見張る線 */}
                {report.stopLineUpPct !== null && (
                  <div className="mt-3 rounded-xl border border-edge2 bg-paper2 px-4 py-4">
                    <p className="text-label font-bold tracking-wide text-slate3">
                      【運営】公開したあと、見張る線
                    </p>
                    <p className="mt-2 text-note leading-[1.9] text-slate2">
                      景品の相場が
                      <strong className="num font-bold text-slate">
                        +{report.stopLineUpPct.toFixed(1)}%
                      </strong>
                      を超えると、このガチャは赤字に変わります。
                      相場ウォッチがこの線を超えたら知らせます。
                    </p>
                  </div>
                )}

                <ul className="mt-4 space-y-2">
                  {report.scenarios.map((sc) => (
                    <li
                      key={sc.key}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-edge2 bg-paper2 px-4 py-3"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={sc.kind === "design" ? "blue" : "neutral"}>
                          {sc.kind === "design" ? "設計" : "運営"}
                        </Badge>
                        <span className="text-note font-medium text-slate2">{sc.label}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="num text-note text-slate3">
                          最悪 {sc.distribution.rtpWorst.toFixed(1)}%
                        </span>
                        <Badge
                          tone={
                            sc.verdict === "SAFE" ? "ok" : sc.verdict === "CAUTION" ? "warn" : "danger"
                          }
                        >
                          {sc.verdict}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className="mt-4 text-note leading-[1.9] text-slate3">
              ★ここに出ている判定は、登録する前の下見です。
              下書きに登録したあと、ガチャ管理でもう一度
              「検証を実行」を押して結果を保存しないと、公開ボタンは通りません。
              <br />
              ★AIが出した案でも、検証を飛ばして公開することはできません。
            </p>
          </Card>

          {/* ── 商品の写真 ── */}
          <Card
            title="商品の写真"
            note="お客様の売り場に出るのは、ここで預けた写真だけです。"
          >
            {!mayEdit ? (
              <p className="text-note leading-[1.9] text-warn-ink">
                いまの権限では写真を預けられません。
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-note leading-[1.9] text-slate3">
                  タイトルから絵を描いて商品の顔にすることはしません。
                  お客様が払っているのは、絵ではなく現物に対してだからです。
                  預けていない賞は、売り場で
                  <strong className="font-bold text-slate">「画像未登録」</strong>
                  と出ます。あとから足すこともできます。
                </p>

                <PhotoPicker
                  label="表紙の写真"
                  note="一覧と詳細で、このガチャの顔になります。"
                  kind="GACHA_COVER"
                  imageId={coverImageId}
                  onPicked={setCoverImageId}
                />

                {spec.prizes.map((p) => (
                  <PhotoPicker
                    key={p.grade}
                    label={`${p.grade}賞の写真`}
                    note={`${p.count.toLocaleString()}本 ／ 1本あたり ${p.value.toLocaleString()}円`}
                    kind="PRIZE"
                    imageId={prizeImages[p.grade] ?? null}
                    onPicked={(id) =>
                      setPrizeImages((prev) => {
                        const next = { ...prev };
                        if (id) next[p.grade] = id;
                        else delete next[p.grade];
                        return next;
                      })
                    }
                  />
                ))}

                {mikitouroku > 0 && (
                  <p className="rounded-xl border border-edge2 bg-paper2 px-4 py-3 text-note leading-[1.9] text-slate2">
                    写真がまだ無い賞が<span className="num font-bold">{mikitouroku}</span>件あります。
                    このまま登録もできます。その賞は売り場で「画像未登録」と出ます。
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* ── 下書きとして登録する ── */}
          <Card
            title="この案を登録する"
            note="登録しても、まだ公開はされません。検証結果は空のままです。"
          >
            {!mayEdit ? (
              <p className="text-note leading-[1.9] text-warn-ink">
                いまの権限ではガチャを登録できません。運営または管理者に切り替えてお試しください。
              </p>
            ) : savedId ? (
              <div className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-4">
                <Badge tone="ok">下書きに登録しました</Badge>
                <p className="mt-2 text-note leading-[1.9] text-slate2">
                  「{title.trim()}」を下書きとして登録しました。
                  この画面を開き直しても残ります。
                  検証結果は<strong className="font-bold text-slate">まだ空</strong>です。
                  次に、ガチャ管理で「検証を実行」を押してください。
                </p>
                <p className="mt-2 text-label leading-[1.9] text-slate3">
                  登録番号：<span className="num">{savedId}</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn kind="primary" onClick={() => onNav("gacha")}>
                    ガチャ管理へ進む
                  </Btn>
                  <Btn kind="ghost" onClick={() => onNav("backtest")}>
                    公開前バックテストへ進む
                  </Btn>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <Field label="ガチャの名前" note="お客様の画面に出る名前です。">
                  <input
                    className={inputClass}
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setTitleTouched(true);
                    }}
                  />
                </Field>
                {shippai && (
                  <p className="rounded-xl border border-warn/35 bg-warn/10 px-4 py-3 text-note leading-[1.9] text-warn-ink">
                    {shippai}
                  </p>
                )}
                <Btn kind="primary" onClick={save} disabled={!canSave}>
                  {okurichuu ? "登録しています…" : "この案を下書きとして登録する"}
                </Btn>
                <p className="text-note leading-[1.9] text-slate3">
                  ★登録した時点では、検証結果は空のままにしています。
                  ここで「検証済み」にしてしまうと、公開前の関門がその場で無意味になります。
                </p>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── やりとりの記録 ── */}
      {log.length > 0 && (
        <Card title="ここまでの操作" note="何をどう直したかが残ります。">
          <ol className="space-y-2">
            {log.map((l, i) => (
              <li key={i} className="flex gap-3 text-note leading-[1.9] text-slate2">
                <span className="num shrink-0 font-bold text-slate3">{i + 1}</span>
                <span>{l}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <DemoNote>
        このデモでは、案をブラウザの中の計算で作っています。外部のAIには接続していません。
        実際にお使いいただく管理画面では、同じ手順でAIが案を出します。
        検証の計算そのものは、本番と同じものを使っています。
        <br />
        ★「下書きとして登録する」だけは本物です。押すと本当に保存され、
        画面を開き直しても残ります。ガチャ管理の一覧にも出ます。
      </DemoNote>
    </>
  );
}
