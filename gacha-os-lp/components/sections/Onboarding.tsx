/**
 * 「で、申し込んだあと何が起きるの？」に、料金の直後で答える1枚。
 *
 * ═══════════════════════════════════════════════
 * ★このセクションの役目
 * ═══════════════════════════════════════════════
 *
 *   金額を見た人の頭に最初に浮かぶのは「高い／安い」ではありません。
 *   「これ、自分にできるんだろうか」です。
 *
 *   ここが見えないと、金額に納得していても止まります。
 *   だから料金のすぐ後ろに置き、やることを5つだけに絞って見せます。
 *
 * ═══════════════════════════════════════════════
 * ★2本立てにしている理由
 * ═══════════════════════════════════════════════
 *
 *   このページを見る人は2種類います。
 *     ・これから始める方（まだサイトが無い）
 *     ・すでに運営している方（今のサイトがある）
 *
 *   この2つは、やることが最初から最後まで違います。
 *   1本の手順にまとめると、どちらの人も「自分の話ではない」と感じます。
 *   だから、はじめから2本並べます。
 *
 * ═══════════════════════════════════════════════
 * ★書くときの決まり
 * ═══════════════════════════════════════════════
 *
 *   ・「最短◯日で公開」のような期間の断定を書かないこと。
 *     決済会社の審査や、商品点数や、先方の準備で必ず変わります。
 *     書いた瞬間に、守れない約束になります（景品表示法）。
 *
 *   ・ステップは、どちらも4つまで。増やさないこと（2026-08-22）。
 *
 *     前は 5つ と 6つ でした。
 *     ここは「自分にもできそうか」を確かめる場所であって、
 *     作業手順書ではありません。工程が増えるほど「大変そう」になります。
 *     細かい作業は、この下の詳細セクション側に置くこと。
 *
 *     ★ただし「会員・ポイント・決済がどうなるか」は必ず文字で出すこと。
 *       既存の運営者がいちばん怖いのは、機能ではなくここです。
 *       工程は畳んでよいですが、この言葉まで消すと、
 *       不安を抱えたまま料金の話に進むことになります。
 *       いまは EXISTING の 01 の本文に入れています。
 *
 *   ・「お客様がやること」と「こちらがやること」を混ぜないこと。
 *     混ぜると、全部お客様の仕事に見えます。
 */

import Reveal from "../ui/Reveal";
import Section from "../ui/Section";
import { jp } from "@/lib/jp";
import { OS } from "@/lib/text";

type Step = {
  code: string;
  title: string;
  /** その工程で、実際に何が起きるか */
  body: string;
  /** ★誰の手が動くか。ここが混ざると全部お客様の仕事に見えます */
  who: "us" | "you";
};

/** これから始める方 */
const NEW_TRACK: Step[] = [
  {
    code: "01",
    title: "相談",
    body: "扱う商品、価格帯、狙いたい還元率をうかがい、全体像を決めます。",
    who: "us",
  },
  {
    code: "02",
    title: "設定",
    body: "店名・ロゴ・色・ドメインと、決済・配送をつなぎます。申し込みと審査だけ、そちらでお願いします。",
    who: "us",
  },
  {
    code: "03",
    title: "テスト",
    body: "本番と同じ画面で、購入から発送依頼までを一度通します。",
    who: "us",
  },
  {
    code: "04",
    title: "公開",
    body: "承認をいただいた時点で公開。以後は管理画面から、ご自身でガチャを出せます。",
    who: "you",
  },
];

/** すでに運営している方 */
const EXISTING_TRACK: Step[] = [
  {
    /*
      ★「会員・ポイント・決済」という言葉を、この本文から消さないこと。
        既存の運営者がいちばん気にするのは、機能ではなく
        「今の会員とポイント残高がどうなるか」です。
        ここに書いていないと、その不安を抱えたまま料金の話に進みます。
    */
    code: "01",
    title: "既存環境の確認",
    body: "今のサイト・ドメイン・会員データ・ポイント残高・決済契約を、どこまでそのまま引き継げるか1件ずつ突き合わせます。",
    who: "us",
  },
  {
    code: "02",
    title: "Migration Dry Run",
    body: "本番には一切触れず、複製した環境へ移してみます。ここで問題を出し切ります。",
    who: "us",
  },
  {
    code: "03",
    title: "差分の確認",
    body: "移行前と移行後で、在庫・履歴・ポイントが合っているかを並べて見ていただきます。",
    who: "you",
  },
  {
    code: "04",
    title: "本番切替",
    body: "納得いただいてから切り替えます。お客様から見えるURLは、そのままです。",
    who: "you",
  },
];

function Track({
  label,
  head,
  lead,
  steps,
  accent,
}: {
  label: string;
  head: string;
  lead: string;
  steps: Step[];
  /** 2本を色で見分けさせる。青＝これから／濃紺＝すでに運営 */
  accent: "blue" | "deep";
}) {
  const isDeep = accent === "deep";

  return (
    <div className="flex h-full flex-col rounded-[28px] border border-edge bg-white p-6 shadow-lift sm:p-9">
      {/* ── どちらの人向けか ── */}
      <div>
        <span
          className={`num text-label tracking-[0.16em] ${
            isDeep ? "text-blue-deep" : "text-blue-ink"
          }`}
        >
          {label}
        </span>
        <p className="h-display mt-2.5 text-h3 text-balance text-slate">
          {jp(head)}
        </p>
        <p className="mt-2.5 text-note leading-[1.95] text-pretty text-slate2">
          {jp(lead)}
        </p>
      </div>

      {/* ── 4つの工程 ── */}
      <ol className="mt-7 sm:mt-9">
        {steps.map((s, i) => (
          <li key={s.code} className="relative flex gap-4 pb-6 last:pb-0">
            {/*
              ★番号どうしをつなぐ縦線。
                最後の1つには出さないこと。出すと、まだ先があるように見えます。
            */}
            {i < steps.length - 1 ? (
              <span
                aria-hidden
                className="absolute left-[17px] top-9 h-[calc(100%-1.75rem)] w-px bg-edge"
              />
            ) : null}

            <span
              className={`num relative z-10 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                isDeep
                  ? "bg-blue-deep text-white"
                  : "bg-blue-pale text-blue-deep"
              }`}
            >
              {s.code}
            </span>

            <div className="min-w-0 pt-1">
              <p className="text-note font-bold text-slate">{jp(s.title)}</p>
              <p className="mt-1.5 text-note leading-[1.95] text-pretty text-slate2">
                {jp(s.body)}
              </p>
              {/*
                ★「どちらが動くか」を必ず出すこと。
                  これが無いと、5つ全部が自分の仕事に見えて、重く感じます。
              */}
              <span
                className={`mt-2 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${
                  s.who === "us"
                    ? "bg-mist text-slate2"
                    : "bg-blue-pale text-blue-deep"
                }`}
              >
                {s.who === "us" ? "こちらで進めます" : "ご一緒に確認します"}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function Onboarding() {
  return (
    <Section
      id="onboarding"
      no=""
      eyebrow="HOW TO START"
      title={<>導入は、こう進みます。</>}
      lead={jp(
        "これから始める方と、すでに運営している方とでは、やることが違います。どちらも、こちらで動く工程と、ご一緒に確認いただく工程を分けてあります。",
      )}
    >
      <Reveal>
        <div className="grid gap-5 lg:grid-cols-2 lg:gap-7">
          <Track
            accent="blue"
            label="NEW BUSINESS"
            head="これから始める方"
            lead={`まだサイトが無い状態から、${OS}の上に1店つくります。`}
            steps={NEW_TRACK}
          />
          <Track
            accent="deep"
            label="EXISTING BUSINESS"
            head="すでに運営している方"
            lead="今のサイトを止めずに、裏側の運営だけを移します。本番に触るのは最後です。"
            steps={EXISTING_TRACK}
          />
        </div>
      </Reveal>

      {/*
        ★期間の断定を書かないこと。
          決済会社の審査、商品点数、移行元の作りで必ず変わります。
          「最短◯日」と書いた時点で、守れない約束になります（景品表示法）。
      */}
      <Reveal delay={0.06}>
        <p className="mt-6 text-note leading-[1.95] text-pretty text-slate3 sm:mt-9">
          {jp(
            "かかる期間は、商品点数・決済会社の審査・移行元の作りによって変わります。最初の相談の時点で、そちらの条件での見込みをお伝えします。",
          )}
        </p>
        {/*
          ★この注記を消さないこと（景品表示法）。
            移行できる範囲は、相手のシステムの作り・契約・データの持ち方で本当に変わります。
            「全部移せます」と読まれる状態にしておくのは、優良誤認になり得ます。
        */}
        <p className="mt-3 text-note leading-[1.95] text-pretty text-slate3">
          {jp(
            "※ 移行できる範囲は、既存システムの仕様・契約・データ構造によって異なります。現状を確認したうえで、できること・できないことを分けてお出しします。",
          )}
        </p>
      </Reveal>
    </Section>
  );
}
