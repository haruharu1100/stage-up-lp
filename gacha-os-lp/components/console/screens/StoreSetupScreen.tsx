/**
 * 店舗設定（初期設定ウィザード＋公開準備）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面が作られた理由
 * ═══════════════════════════════════════════════════════
 *
 *   これが無いと、お店を1社増やすたびに、
 *   こちらが会社名・住所・特商法・規約を手で入れることになります。
 *   それは「毎回こちらが設定してあげる受託システム」であって、
 *   複数社へ売れる商品ではありません。
 *
 *   ですので、この画面のKPIは「きれいに見えること」ではなく、
 *   ★契約したお店が、こちらに何も聞かずに営業開始できること、です。
 *
 * ═══════════════════════════════════════════════════════
 * ★空欄を、こちらの文例で埋めないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「返品について」が空だと、画面が寂しく見えます。
 *   一般的な文例を入れたくなります。★入れてはいけません。
 *
 *   ここに入れた文章は、そのお店が表示した「返品特約」になります。
 *   つまり、こちらが、そのお店の法的な表示を代筆したことになります。
 *   返品の条件は、お店ごとに違います。
 *
 *   ですので、この画面がするのは1つだけです。
 *       ★何を書く欄なのかを説明する。文章そのものは書かない。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここで「公開してよいか」を判定しないこと
 * ═══════════════════════════════════════════════════════
 *
 *   判定は lib/server/launchReadiness.ts の1か所だけです。
 *   この画面は、受け取った結果を並べるだけにします。
 *
 *   画面側でもう一度数え直すと、書いた日から必ずずれます。
 *   ずれ方が最悪です。画面には「準備できています」と出ているのに、
 *   公開ボタンを押すと断られる、という形になります。
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorBox,
  Field,
  Skeleton,
  WhatIsThis,
  inputClass,
} from "../ui";
import {
  useStoreSettings,
  useReadiness,
  saveStoreSettings,
  saveStoreFaqs,
  type ReadinessItem,
  type StoreFaq,
  type StoreSettingsData,
} from "@/lib/console/liveStore";
import { uploadImage } from "@/lib/console/liveImages";
import CategoryPanel from "../CategoryPanel";

/* ══════════════════════════════════════════════
   ウィザードの中身
   ══════════════════════════════════════════════ */

/**
 * 12ステップ。
 *
 * ★項目の「名前」をここに書かないこと。
 *   名前はサーバー（FIELD_LABEL）から来ます。
 *   ここに持つのは「どの順に、何をまとめて聞くか」だけです。
 *
 * ★ステップを増やすときは、必ず後ろに足すこと。
 *   途中に挿すと、お店に伝えてある「STEP 7 は特商法」がずれます。
 */
type Step = {
  no: number;
  title: string;
  /** この段で何をするのか、1〜2行で */
  note: string;
  /** 入力してもらう項目（サーバーの項目キー） */
  fields?: string[];
  /** 写真を選ぶ段 */
  logo?: boolean;
  /**
   * ほかの画面でやってもらう段。
   * 公開準備の項目キーで、済んだかどうかを見ます。
   */
  check?: { keys: string[]; href: string | null; hint: string };
};

const STEPS: Step[] = [
  {
    no: 1,
    title: "店舗名",
    note: "お客様の画面に、いちばん大きく出る名前です。屋号でもかまいません。",
    fields: ["shopName"],
  },
  {
    no: 2,
    title: "ロゴ",
    note: "お客様の画面の左上に出ます。無くても公開できます（そのときは店舗名の文字だけになります）。",
    logo: true,
  },
  {
    no: 3,
    title: "ブランドカラー",
    note: "ボタンや見出しの色になります。無くても公開できます。",
    fields: ["brandColor"],
  },
  {
    no: 4,
    title: "運営法人",
    note: "実際に販売する法人（または個人事業主）です。ここが特定商取引法の「販売業者」になります。",
    fields: ["legalName", "legalKana", "representative"],
  },
  {
    no: 5,
    title: "所在地",
    note: "登記上の住所、または事業を行っている住所です。私書箱だけの記載は認められないことがあります。",
    fields: ["postalCode", "address"],
  },
  {
    no: 6,
    title: "問い合わせ",
    note: "お客様が困ったときの連絡先です。ここが空だと、お客様の行き先がありません。",
    fields: ["phone", "contactEmail", "contactHours", "contactNote"],
  },
  {
    no: 7,
    title: "特定商取引法に基づく表記",
    note: "そのままお客様のページに出ます。お店の実際の運用に合わせて書いてください。",
    fields: [
      "priceNote",
      "extraFeeNote",
      "paymentMethod",
      "paymentTiming",
      "deliveryTime",
      "returnsNote",
      "antiqueLicense",
    ],
  },
  {
    no: 8,
    title: "利用規約",
    note: "お客様との取り決めです。そのまま全文が表示されます。",
    fields: ["termsText"],
  },
  {
    no: 9,
    title: "プライバシーポリシー",
    note: "氏名・住所・メールをお預かりするため、必要です。そのまま全文が表示されます。",
    fields: ["privacyText"],
  },
  {
    no: 10,
    title: "ポイント商品",
    note: "お客様が買うポイントの金額を決めます。1つも無いと、お客様はポイントを買えません。",
    check: {
      keys: ["pointProducts"],
      href: "/client-demo/point-sale",
      hint: "「ポイント販売」の画面で登録します。",
    },
  },
  {
    no: 11,
    title: "ポイントの有効期限",
    note: "「期限なし」も選べます。どちらにするかを決めるまで、公開できません。",
    check: {
      keys: ["pointPolicy"],
      href: "/client-demo/settings",
      hint: "「設定」の画面の中にあります。",
    },
  },
  {
    no: 12,
    title: "決済とメールの接続",
    note: "この2つは AI GACHA OS 側で接続します。お店の操作は要りません。",
    check: {
      keys: ["paymentProvider", "mailProvider"],
      href: null,
      hint: "まだのときは、担当者へご連絡ください。",
    },
  },
];

/**
 * 大きい入力欄にする項目。
 *
 * ★これは見た目だけの話です。
 *   何文字まで入るか（判定）は、サーバーが決めています。
 *   ここに書き忘れても、入力は通ります。狭い箱で書きにくいだけです。
 */
const LONG_FIELDS = new Set([
  "termsText",
  "privacyText",
  "returnsNote",
  "priceNote",
  "extraFeeNote",
  "paymentMethod",
  "paymentTiming",
  "deliveryTime",
  "contactNote",
]);

/**
 * 「何を書く欄なのか」の説明。
 *
 * ★ここに、そのまま貼れる文例を書かないこと。
 *   文例を書くと、お店はそれをコピーします。
 *   その瞬間、こちらが、そのお店の法的な表示を代筆したことになります。
 *   書いてよいのは「何について書くか」までです。
 */
const FIELD_HINT: Record<string, string> = {
  shopName: "お客様に見せる名前です。法人名と違っていてかまいません。",
  brandColor: "#1a2b3c の形式で指定します。",
  legalName: "登記されている名称、または屋号です。",
  legalKana: "ふりがな。無くても公開できます。",
  representative: "代表者、または業務の責任者のお名前です。",
  postalCode: "ハイフン付きでもかまいません。",
  address: "番地・建物名まで書きます。",
  phone: "お客様がかけられる番号を書きます。",
  contactEmail: "お客様からの連絡を受け取れるアドレスにしてください。",
  contactHours: "何時から何時まで受け付けるかを書きます。",
  contactNote: "返信までの目安など、伝えたいことがあれば書きます。",
  antiqueLicense:
    "中古品（開封済みカード等）を扱う場合に必要になることがあります。該当するかは、お店でご確認ください。",
  priceNote: "価格の表示方法（税込かどうか、ポイント表示かどうか）を書きます。",
  extraFeeNote: "送料・代引手数料など、商品代金以外にお客様が払う費用を書きます。",
  paymentMethod: "実際に使える支払い方法を書きます。",
  paymentTiming: "いつ支払いが確定するかを書きます。",
  deliveryTime: "発送までの日数、または引渡しの時期を書きます。",
  returnsNote:
    "返品を受けるか、受けないか。受ける場合の期限と条件を書きます。お店の実際の運用に合わせてください。",
  termsText: "全文をそのまま貼り付けてください。改行はそのまま表示されます。",
  privacyText: "全文をそのまま貼り付けてください。改行はそのまま表示されます。",
};

/* ══════════════════════════════════════════════
   小物
   ══════════════════════════════════════════════ */

function Mark({ done }: { done: boolean }) {
  return done ? <Badge tone="ok">済</Badge> : <Badge tone="warn">未</Badge>;
}

/** 保存のあと、何が起きたのかを必ず1行で出す */
function Msg({ ok, text }: { ok: boolean; text: string }) {
  if (!text) return null;
  return (
    <p
      className={`mt-3 text-note leading-[1.85] ${ok ? "text-ok-ink" : "text-danger-ink"}`}
      role={ok ? "status" : "alert"}
    >
      {text}
    </p>
  );
}

/* ══════════════════════════════════════════════
   公開準備（○/○ 完了）
   ══════════════════════════════════════════════ */

function ReadinessCard({
  onJump,
}: {
  onJump: (href: string) => void;
}) {
  const { state, reload } = useReadiness();

  if (state.phase === "loading") {
    return (
      <Card title="公開準備">
        <Skeleton rows={4} label="公開準備を読み込んでいます" />
      </Card>
    );
  }
  if (state.phase === "ng") {
    return (
      <Card title="公開準備">
        <ErrorBox
          what={state.why}
          code="readiness-load"
          onRetry={reload}
        />
      </Card>
    );
  }

  const { readiness, groups, blockMessage } = state.data;
  const pct =
    readiness.totalCount === 0
      ? 0
      : Math.round((readiness.doneCount / readiness.totalCount) * 100);

  return (
    <Card
      title="公開準備"
      note="ここが全部そろうまで、ガチャは一般公開できません"
      right={<Btn onClick={reload}>最新にする</Btn>}
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className="num text-[1.75rem] font-bold tabular-nums text-slate">
          {readiness.doneCount}/{readiness.totalCount}
        </p>
        <p className="text-note font-bold text-slate2">完了</p>
        {readiness.canPublish ? (
          <Badge tone="ok">販売開始できます</Badge>
        ) : (
          /* ★「準備中です」に言い換えないこと。
               売れるかどうかは、お店にとってお金の話です。 */
          <Badge tone="danger">まだ販売開始できません</Badge>
        )}
      </div>

      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-mist"
        role="progressbar"
        aria-valuenow={readiness.doneCount}
        aria-valuemin={0}
        aria-valuemax={readiness.totalCount}
      >
        <div
          className="h-full rounded-full bg-blue-ink transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>

      {blockMessage !== null && (
        <p className="mt-4 whitespace-pre-wrap rounded-xl border border-warn/35 bg-warn/12 px-4 py-3 text-note leading-[1.9] text-warn-ink">
          {blockMessage}
        </p>
      )}

      <div className="mt-5 space-y-5">
        {groups.map((g) => {
          const items = readiness.items.filter((i) => i.group === g.group);
          if (items.length === 0) return null;
          return (
            <div key={g.group}>
              <p className="text-note font-bold text-slate2">{g.label}</p>
              <ul className="mt-2 space-y-2">
                {items.map((i) => (
                  <ReadinessRow key={i.key} item={i} onJump={onJump} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ReadinessRow({
  item,
  onJump,
}: {
  item: ReadinessItem;
  onJump: (href: string) => void;
}) {
  return (
    <li className="rounded-xl border border-edge2 bg-paper2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Mark done={item.done} />
        <span className="text-note font-bold text-slate">{item.label}</span>
        {!item.blocking && (
          /* ★「必須ではない」ことを、必ず書くこと。
               書かないと、お店は止まっていないものを直そうとして探し回ります。 */
          <Badge>公開は止めません</Badge>
        )}
      </div>
      {item.todo !== null && (
        <p className="mt-2 whitespace-pre-wrap text-note leading-[1.9] text-slate3">
          {item.todo}
        </p>
      )}
      {item.todo !== null && item.href !== null && (
        <div className="mt-3">
          <Btn onClick={() => onJump(item.href as string)}>
            この設定を開く
          </Btn>
        </div>
      )}
    </li>
  );
}

/* ══════════════════════════════════════════════
   ウィザード
   ══════════════════════════════════════════════ */

function Wizard({
  data,
  onSaved,
  onJump,
}: {
  data: StoreSettingsData;
  onSaved: (d: StoreSettingsData) => void;
  onJump: (href: string) => void;
}) {
  const { state: rState, reload: rReload } = useReadiness();

  const label = useCallback(
    (f: string) => data.fields.find((x) => x.field === f)?.label ?? f,
    [data.fields],
  );
  const required = useCallback(
    (f: string) => data.fields.find((x) => x.field === f)?.required === true,
    [data.fields],
  );

  /* 入力中の内容。★null を "未設定" という文字にしないこと */
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    const d: Record<string, string> = {};
    for (const f of data.fields) d[f.field] = data.settings.values[f.field] ?? "";
    setDraft(d);
  }, [data]);

  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>({
    ok: true,
    text: "",
  });

  const step = STEPS[at];

  /** その段の項目のうち、値が変わったものだけを送る */
  async function hozon(): Promise<boolean> {
    const fs = step.fields ?? [];
    const patch: Record<string, string> = {};
    for (const f of fs) {
      const now = draft[f] ?? "";
      const was = data.settings.values[f] ?? "";
      if (now !== was) patch[f] = now;
    }
    if (Object.keys(patch).length === 0) return true;

    setBusy(true);
    setMsg({ ok: true, text: "" });
    const r = await saveStoreSettings(patch);
    setBusy(false);

    if (!r.ok) {
      setMsg({ ok: false, text: r.message });
      return false;
    }
    onSaved(r.data);
    rReload();
    setMsg({
      ok: true,
      text: `STEP ${step.no}「${step.title}」を保存しました。`,
    });
    return true;
  }

  async function tsugi() {
    if (!(await hozon())) return;
    setAt((n) => Math.min(n + 1, STEPS.length - 1));
  }

  async function modoru() {
    /* ★戻るときも保存すること。
         保存せずに戻すと、書いた内容が黙って消えます。 */
    if (!(await hozon())) return;
    setAt((n) => Math.max(n - 1, 0));
  }

  /* その段が済んでいるか（必須項目が全部埋まっているか） */
  function stepDone(s: Step): boolean {
    if (s.check) {
      if (rState.phase !== "ok") return false;
      return s.check.keys.every(
        (k) => rState.data.readiness.items.find((i) => i.key === k)?.done === true,
      );
    }
    const fs = s.logo ? ["logoImageId"] : (s.fields ?? []);
    const hissu = fs.filter((f) => required(f));
    if (hissu.length === 0) {
      /* 必須がない段は、1つでも入っていれば済み扱い。
         ★入っていなくても先へ進めます（止める理由がありません） */
      return fs.some((f) => (data.settings.values[f] ?? "") !== "");
    }
    return hissu.every((f) => (data.settings.values[f] ?? "") !== "");
  }

  return (
    <Card
      title="初期設定"
      note={`STEP ${step.no} / ${STEPS.length}　${step.title}`}
    >
      {/* 進み具合。押すと、その段へ直接行けます */}
      <div className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => {
          const done = stepDone(s);
          const now = i === at;
          return (
            <button
              key={s.no}
              type="button"
              onClick={() => setAt(i)}
              disabled={busy}
              title={s.title}
              className={`nb inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-note font-bold transition-colors disabled:opacity-45 ${
                now
                  ? "border-transparent bg-blue-ink text-white"
                  : done
                    ? "border-ok/30 bg-ok/10 text-ok-ink"
                    : "border-edge bg-paper text-slate3"
              }`}
            >
              {s.no}
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-note leading-[1.9] text-slate2">{step.note}</p>

      <div className="mt-5 space-y-5">
        {step.logo === true && (
          <LogoPicker
            imageId={data.settings.values.logoImageId ?? null}
            onSaved={onSaved}
          />
        )}

        {(step.fields ?? []).map((f) => (
          <Field
            key={f}
            label={label(f)}
            note={FIELD_HINT[f]}
            required={required(f)}
          >
            {f === "brandColor" ? (
              <span className="flex items-center gap-3">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(draft[f] ?? "") ? draft[f] : "#1d4ed8"}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [f]: e.target.value }))
                  }
                  className="h-11 w-16 cursor-pointer rounded-lg border border-silver bg-paper"
                  aria-label={label(f)}
                />
                <input
                  className={inputClass}
                  value={draft[f] ?? ""}
                  placeholder="#1d4ed8"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [f]: e.target.value }))
                  }
                />
              </span>
            ) : LONG_FIELDS.has(f) ? (
              <textarea
                className={`${inputClass} min-h-[9rem] leading-[1.9]`}
                value={draft[f] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
              />
            ) : (
              <input
                className={inputClass}
                value={draft[f] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
              />
            )}
          </Field>
        ))}

        {step.check && (
          <CheckStep
            keys={step.check.keys}
            href={step.check.href}
            hint={step.check.hint}
            onJump={onJump}
          />
        )}
      </div>

      <Msg ok={msg.ok} text={msg.text} />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Btn onClick={modoru} disabled={busy || at === 0}>
          ← 前へ
        </Btn>
        {at < STEPS.length - 1 ? (
          <Btn onClick={tsugi} kind="primary" disabled={busy}>
            {busy ? "保存しています…" : "保存して次へ →"}
          </Btn>
        ) : (
          <Btn onClick={hozon} kind="primary" disabled={busy}>
            {busy ? "保存しています…" : "保存する"}
          </Btn>
        )}
      </div>

      <p className="mt-3 text-note leading-[1.85] text-slate3">
        途中でやめても、ここまでの入力は保存されています。
        空欄のままでもかまいません。そのときは、お客様の画面に「未設定」と出ます。
      </p>
    </Card>
  );
}

/** ほかの画面でやってもらう段 */
function CheckStep({
  keys,
  href,
  hint,
  onJump,
}: {
  keys: string[];
  href: string | null;
  hint: string;
  onJump: (href: string) => void;
}) {
  const { state, reload } = useReadiness();

  if (state.phase === "loading") return <Skeleton rows={2} />;
  if (state.phase === "ng")
    return <ErrorBox what={state.why} code="readiness-step" onRetry={reload} />;

  const items = keys
    .map((k) => state.data.readiness.items.find((i) => i.key === k))
    .filter((i): i is ReadinessItem => i !== undefined);

  return (
    <div className="space-y-3">
      {items.map((i) => (
        <div key={i.key} className="rounded-xl border border-edge2 bg-paper2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Mark done={i.done} />
            <span className="text-note font-bold text-slate">{i.label}</span>
          </div>
          {i.todo !== null && (
            <p className="mt-2 whitespace-pre-wrap text-note leading-[1.9] text-slate3">
              {i.todo}
            </p>
          )}
        </div>
      ))}
      <p className="text-note leading-[1.85] text-slate3">{hint}</p>
      <div className="flex flex-wrap gap-3">
        {href !== null && <Btn onClick={() => onJump(href)}>その画面を開く</Btn>}
        <Btn onClick={reload}>最新にする</Btn>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   ロゴ
   ══════════════════════════════════════════════ */

function LogoPicker({
  imageId,
  onSaved,
}: {
  imageId: string | null;
  onSaved: (d: StoreSettingsData) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>({
    ok: true,
    text: "",
  });

  async function erabu(file: File | null) {
    if (file === null) return;
    setBusy(true);
    setMsg({ ok: true, text: "" });

    const up = await uploadImage(file, "SHOP_LOGO");
    if (!up.ok) {
      setBusy(false);
      setMsg({ ok: false, text: up.message });
      return;
    }

    /* ★上げただけで終わらせないこと。
         写真を預けても、設定に結び付けなければ、どこにも出ません。
         お店には「上がったのに出ない」としか見えません。 */
    const r = await saveStoreSettings({ logoImageId: up.imageId });
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.message });
      return;
    }
    onSaved(r.data);
    setMsg({ ok: true, text: "ロゴを設定しました。" });
  }

  async function kesu() {
    setBusy(true);
    const r = await saveStoreSettings({ logoImageId: "" });
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.message });
      return;
    }
    onSaved(r.data);
    setMsg({ ok: true, text: "ロゴを外しました。店舗名の文字だけになります。" });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-edge2 bg-paper2">
          {imageId === null ? (
            /* ★ここで仮のロゴを描かないこと。
                 設定されていないことが、見て分からなくなります。 */
            <span className="px-2 text-center text-[0.75rem] leading-[1.5] text-slate3">
              未設定
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/images/${imageId}`}
              alt="いま設定されているロゴ"
              className="h-full w-full object-contain"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="nb inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-edge bg-paper px-4 py-2.5 text-note font-bold text-slate transition-colors hover:bg-paper2">
            {imageId === null ? "ロゴを選ぶ" : "ロゴを差し替える"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                void erabu(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </label>
          {imageId !== null && (
            <Btn onClick={kesu} disabled={busy}>
              ロゴを外す
            </Btn>
          )}
        </div>
      </div>
      <Msg ok={msg.ok} text={msg.text} />
    </div>
  );
}

/* ══════════════════════════════════════════════
   よくある質問
   ══════════════════════════════════════════════ */

function FaqEditor({
  faqs,
  onSaved,
}: {
  faqs: StoreFaq[];
  onSaved: (d: StoreSettingsData) => void;
}) {
  const [rows, setRows] = useState<{ question: string; answer: string }[]>([]);
  useEffect(() => {
    setRows(faqs.map((f) => ({ question: f.question, answer: f.answer })));
  }, [faqs]);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>({
    ok: true,
    text: "",
  });

  async function hozon() {
    setBusy(true);
    setMsg({ ok: true, text: "" });
    const r = await saveStoreFaqs(rows);
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.message });
      return;
    }
    onSaved(r.data);
    setMsg({
      ok: true,
      text:
        rows.length === 0
          ? "よくある質問を空にしました。お客様の画面には「まだ登録されていません」と出ます。"
          : `よくある質問を ${rows.length} 件で保存しました。`,
    });
  }

  return (
    <Card
      title="よくあるご質問"
      note="無くても公開できます。多い問い合わせを載せると、返信の手間が減ります"
    >
      {rows.length === 0 ? (
        <Empty why="まだ1件も登録されていません。" />
      ) : (
        <ul className="space-y-4">
          {rows.map((r, i) => (
            <li key={i} className="rounded-xl border border-edge2 bg-paper2 px-4 py-4">
              <Field label={`${i + 1}件目の質問`}>
                <input
                  className={inputClass}
                  value={r.question}
                  onChange={(e) =>
                    setRows((xs) =>
                      xs.map((x, j) =>
                        j === i ? { ...x, question: e.target.value } : x,
                      ),
                    )
                  }
                />
              </Field>
              <div className="mt-3">
                <Field label="答え">
                  <textarea
                    className={`${inputClass} min-h-[6rem] leading-[1.9]`}
                    value={r.answer}
                    onChange={(e) =>
                      setRows((xs) =>
                        xs.map((x, j) =>
                          j === i ? { ...x, answer: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn
                  onClick={() =>
                    setRows((xs) => {
                      if (i === 0) return xs;
                      const y = [...xs];
                      [y[i - 1], y[i]] = [y[i], y[i - 1]];
                      return y;
                    })
                  }
                  disabled={i === 0}
                >
                  ↑ 上へ
                </Btn>
                <Btn
                  onClick={() =>
                    setRows((xs) => {
                      if (i === xs.length - 1) return xs;
                      const y = [...xs];
                      [y[i], y[i + 1]] = [y[i + 1], y[i]];
                      return y;
                    })
                  }
                  disabled={i === rows.length - 1}
                >
                  ↓ 下へ
                </Btn>
                <Btn
                  kind="danger"
                  onClick={() => setRows((xs) => xs.filter((_, j) => j !== i))}
                >
                  この行を削除
                </Btn>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Msg ok={msg.ok} text={msg.text} />

      <div className="mt-5 flex flex-wrap gap-3">
        <Btn onClick={() => setRows((xs) => [...xs, { question: "", answer: "" }])}>
          ＋ 質問を追加
        </Btn>
        <Btn onClick={hozon} kind="primary" disabled={busy}>
          {busy ? "保存しています…" : "保存する"}
        </Btn>
      </div>
      <p className="mt-3 text-note leading-[1.85] text-slate3">
        ★「保存する」を押すまで、お客様の画面は変わりません。
        空の行が1つでもあると保存できません（行ごと削除してください）。
      </p>
    </Card>
  );
}

/* ══════════════════════════════════════════════
   お客様に、いま何が出ているか
   ══════════════════════════════════════════════ */

function PublicLinks() {
  /* ★お店の方が、自分の目で確かめられるようにすること。
       管理画面で「済」と出ていても、実際のページを見ないと安心できません。 */
  const DOCS = [
    { path: "/store/company", label: "会社情報" },
    { path: "/store/legal", label: "特定商取引法に基づく表記" },
    { path: "/store/terms", label: "利用規約" },
    { path: "/store/privacy", label: "プライバシーポリシー" },
    { path: "/store/faq", label: "よくあるご質問" },
    { path: "/store/contact", label: "お問い合わせ" },
  ];
  return (
    <Card
      title="お客様に見えているページ"
      note="設定した内容が、実際にどう出るかを確認できます"
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {DOCS.map((d) => (
          <li key={d.path}>
            <a
              href={d.path}
              target="_blank"
              rel="noreferrer"
              className="nb block rounded-xl border border-edge bg-paper px-4 py-3 text-note font-bold text-slate transition-colors hover:bg-paper2"
            >
              {d.label} ↗
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ══════════════════════════════════════════════
   本体
   ══════════════════════════════════════════════ */

export default function StoreSetupScreen() {
  const router = useRouter();
  const { state, reload, put } = useStoreSettings();

  const onJump = useCallback(
    (href: string) => {
      router.push(href);
    },
    [router],
  );

  const body = useMemo(() => {
    if (state.phase === "loading") {
      return (
        <Card title="店舗設定">
          <Skeleton rows={5} label="店舗設定を読み込んでいます" />
        </Card>
      );
    }
    if (state.phase === "ng") {
      return (
        <Card title="店舗設定">
          {/* ★ここで「未設定です」と出さないこと。
                読めていないだけで、設定は消えていません。 */}
          <ErrorBox what={state.why} code="store-settings" onRetry={reload} />
        </Card>
      );
    }

    const data = state.data;

    if (!data.canEdit) {
      return (
        <Card title="店舗設定">
          <Empty
            why="この設定を変更する権限がありません。"
            next="法律上の表示と規約の本文を扱う画面のため、変更できる担当者を限っています。責任者の方にご依頼ください。"
          />
        </Card>
      );
    }

    return (
      <>
        <Wizard data={data} onSaved={put} onJump={onJump} />
        <FaqEditor faqs={data.faqs} onSaved={put} />
        <CategoryPanel />
        <PublicLinks />
      </>
    );
  }, [state, reload, put, onJump]);

  return (
    <>
      <WhatIsThis>
        お店の看板（店舗名・ロゴ・色）と、お客様に見せる法定ページ
        （会社情報・特定商取引法に基づく表記・利用規約・プライバシーポリシー・
        よくあるご質問・お問い合わせ）を、ここで設定します。
        ★空欄のままでは、ガチャを一般公開できません。
      </WhatIsThis>

      <ReadinessCard onJump={onJump} />
      {body}
    </>
  );
}
