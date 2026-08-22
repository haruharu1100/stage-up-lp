"use client";

import Link from "next/link";
import Reveal from "../ui/Reveal";
import { demoVideo as raw_demoVideo } from "@/content/site";
/*
  ★このデータは「ただの日本語」で持つこと。
    折り返しを止めるための見えない文字（U+2060 など）を混ぜないこと。
    画面に出すときに lib/jp.tsx の jp() を通せば、
    守るべき言葉だけが <span class="nb"> で包まれます。
*/

const demoVideo = raw_demoVideo;
import { EV, trackOnce } from "@/lib/track";

/**
 * 製品デモ動画。
 *
 * ★中身は作り物の映像ではありません。
 * このサイトの画面（#builder → /demo → /demo?side=customer）を
 * 実際にクリックして、そのまま録画したものです。
 * content/site.ts の demoVideo.src が null の間は何も描画しません
 * （空の「準備中」枠は出しません）。
 *
 * ★音は「あってもなくても同じだけ分かる」状態にしてあります。
 * 2026-08-22 に日本語のナレーションを足しました（scripts/make-demo-narration.mjs）。
 * ただし声は、画面に出ている文字を読み上げているのではなく、
 * 「いま何が起きているか」を短く言い添えているだけです。
 * 意味はすべて、字幕（.vtt）と画面の中の文字だけで最後まで通ります。
 * 声にしか無い情報を作らないこと。ここが崩れると、
 * 音を出せない場所で見ている人に伝わらなくなります。
 *
 * ★はじめは音を消してあります（muted）。外さないこと。
 * スマホで画面を触った瞬間に音が鳴ると、電車の中では事故になります。
 * 見る人が自分でスピーカーの印を押したときだけ、声が出ます。
 *
 * ★自動再生はしません。
 * 音のない自動再生でも、通信量とバッテリーを勝手に使うことになるためです。
 * 動画を見ない人にも同じことが伝わるよう、
 * このすぐ下に「ガチャ運営の1日」（OperatingDay）を置いています。
 *
 * ★動画と、触れるデモは、役目が違います。
 * 動画は「約40秒で全体を分かってもらう」もの。
 * /demo は「自分の手で確かめてもらう」もの。
 * だから動画のすぐ下のボタンは /demo へ送っています。
 *
 * 再生開始と最後まで見たかどうかを計測します
 * （動画が本当に効いているのかを、感覚ではなく数字で見るため）。
 */
export default function ProductVideo() {
  if (!demoVideo.src) return null;

  return (
    <section id="video" className="relative scroll-mt-24 bg-paper py-20 sm:py-24">
      <div className="container-x">
        <Reveal>
          <div className="mx-auto max-w-[42em] text-center">
            <span className="num text-label text-slate3">PRODUCT DEMO</span>
            {/*
              ★ここの見出しと説明は、動画の中身と必ず一致させること。
                以前は「30秒で分かる」「還元率を見張り、発送し、記録が残るまで」と
                書いてありましたが、動画は31秒になり、中身も
                「作るところ」から「お客様が実際に引いて発送を頼むところ」まで
                に変わりました。書いてあることと映っているものが違うのは、
                それだけで信用を落とします（景品表示法）。
                長さは content/site.ts の lengthLabel から出しています。

              ★2026-08-22：AIが人へ渡したあと、運営者が返信して
                その返信がお客様のスマホに届くところまでを足しました。
                動画は約40秒になっています。
                「31秒」という数字を守るために場面を削らないこと。
                目的は、見るだけで全体が分かることです。
            */}
            <h2 className="h-display mt-5 text-h2 text-balance text-slate">
              <span className="num">{demoVideo.lengthLabel}</span>。
              <br className="sm:hidden" />
              作るところから、
              <br className="sm:hidden" />
              お客様への返信まで。
            </h2>
            <p className="mx-auto mt-6 max-w-[34em] text-note text-pretty leading-[1.95] text-slate2">
              資料ではなく、動いている画面です。
              AIに伝えてガチャができ、公開前に赤字になる条件を試し、人が承認し、
              お客様が引いて、発送を頼み、AIが答え、判断が要る相談は人へ回り、
              運営者が返信し、その返信がお客様のスマホに届くまで。
              1コマも作らず、この画面をそのまま録画しています。
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.06}>
          <figure className="mx-auto mt-12 max-w-5xl">
            <div className="relative overflow-hidden rounded-3xl border border-edge bg-paper2 shadow-float">
              <video
                className="block h-auto w-full"
                poster={demoVideo.poster ?? undefined}
                controls
                /*
                  ★muted を外さないこと。
                    この動画には日本語のナレーションが入っています。
                    はじめから音が出る状態にすると、
                    電車やお店で開いた人の手元で、いきなり声が鳴ります。
                    見る人が自分でスピーカーの印を押したときだけ鳴らします。
                */
                muted
                playsInline
                preload="metadata"
                onPlay={() => trackOnce(EV.videoPlay, { place: "lp" })}
                onEnded={() => trackOnce(EV.videoComplete, { place: "lp" })}
              >
                {demoVideo.srcWebm && (
                  <source src={demoVideo.srcWebm} type="video/webm" />
                )}
                <source src={demoVideo.src} type="video/mp4" />
                {/*
                  ★字幕。消さないこと。
                    この動画は、はじめは音が消えた状態で置いてあります。
                    つまり多くの人は、声を聞かずにこの動画を見終わります。
                    画面に焼き込んだ文字は「絵」なので、
                    読み上げソフトを使う人にも、検索にも、届いていません。
                    default を付けているのは、
                    「字幕があることに気づいてもらう」ためではなく、
                    この動画では字幕が本文そのものだからです。
                    ★ナレーションの文言をここへ写さないこと。
                      字幕は画面の説明、声は言い添え。役目が違います。
                */}
                {demoVideo.captions && (
                  <track
                    kind="captions"
                    src={demoVideo.captions}
                    srcLang="ja"
                    label="日本語"
                    default
                  />
                )}
                お使いのブラウザは動画の再生に対応していません。
              </video>

              <span className="num pointer-events-none absolute right-4 top-4 rounded-full border border-edge bg-white/85 px-3.5 py-1.5 text-label text-slate3 shadow-lift backdrop-blur">
                {demoVideo.lengthLabel}
              </span>
            </div>

            <figcaption className="mx-auto mt-6 max-w-[46em] text-center text-note leading-[1.95] text-slate3">
              {demoVideo.caption}
            </figcaption>

            {/*
              ★この2行を消さないこと。

                1行目は、見る人への案内です。
                はじめは音が消えているので、
                「音が入っていること」自体に気づいてもらえません。

                2行目は、使わせてもらっている決まりです。
                ナレーションは VOICEVOX（この機械の中で動く読み上げ）で作っています。
                VOICEVOX は、使った場合にどの声を使ったかを書くことが条件です。
                消すと、規約を守っていない状態になります。
            */}
            <p className="mx-auto mt-3.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-label text-slate3/80">
              <span className="nb">音声ナレーション入り</span>
              <span className="text-slate3/40" aria-hidden>
                ／
              </span>
              <span className="nb">はじめは音が消えています</span>
              <span className="text-slate3/40" aria-hidden>
                ／
              </span>
              <span className="num nb">音声：VOICEVOX:No.7</span>
            </p>
          </figure>
        </Reveal>

        <Reveal delay={0.12}>
          {/*
            ★2つの行き先の順番を入れ替えないこと。
              動画を見終わった直後の人が次にしたいのは、
              「相談する」ではなく「本当に動くのか自分で確かめる」です。
              先に触ってもらってから、相談へ進んでもらいます。
          */}
          <div className="mt-10 flex flex-col items-center gap-3.5 sm:flex-row sm:justify-center">
            <Link href="/demo" className="btn-primary btn-lg w-full sm:w-auto">
              自分で触ってみる
            </Link>
            <Link href="#contact" className="btn-outline btn-lg w-full sm:w-auto">
              導入について相談する
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
