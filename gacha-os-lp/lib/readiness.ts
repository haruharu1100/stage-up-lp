/**
 * 公開前チェック（Launch Readiness）。
 *
 * ここが「公開してよいかどうか」の唯一の判断基準。
 * ・画面（/launch）
 * ・ビルド時のチェック（scripts/check-launch.mjs）
 * の両方が、この同じ定義を見る。二重管理にしない。
 *
 * ────────────────────────────────────────────
 * ★なぜ3段階に分けるのか
 * ────────────────────────────────────────────
 *
 * 「コードは書いた」と「本番で動いている」は、まったく別のことです。
 * ここを1つのチェックにまとめると、
 *
 *   GA4のタグを埋め込んだ → チェック✅ → 公開 → 実は1件も計測されていなかった
 *
 * ということが起きます。画面上は準備完了に見えるのに、
 * 実際には何も届いていない。この製品でいちばん避けたい壊れ方そのものです。
 *
 * そこで、1項目につき必ず3段階で見ます。
 *
 *   IMPLEMENTED   コードとして実装されているか（自動で判定できる）
 *   CONNECTED     本番の外部サービスに実際につながっているか（設定値で判定できる）
 *   E2E VERIFIED  本当に最後まで通ったのを、人が自分の目で確かめたか
 *
 * 3つそろって、はじめて PRODUCTION READY です。
 * 「IDを設定した」だけでは CONNECTED どまりで、まだ公開できません。
 */

/** 3段階のどれか */
export type StageId = "implemented" | "connected" | "verified";

export const STAGE_ORDER: StageId[] = ["implemented", "connected", "verified"];

export const STAGE_LABEL: Record<StageId, string> = {
  implemented: "IMPLEMENTED",
  connected: "CONNECTED",
  verified: "E2E VERIFIED",
};

export const STAGE_MEANING: Record<StageId, string> = {
  implemented: "コードとして実装されているか",
  connected: "本番の外部サービスに実際につながっているか",
  verified: "本当に最後まで通ったのを、人が自分の目で確かめたか",
};

/**
 * 各段階の状態。
 * - ok   … 済み
 * - todo … まだ
 * - na   … この項目にはこの段階が無い（例：セキュリティヘッダーに「接続」は無い）
 */
export type StageState = "ok" | "todo" | "na";

export type Stage = {
  /** 自動で判定できるか。false = 人が確かめてチェックを付ける */
  auto: boolean;
  state: StageState;
  /** 何をすれば ok になるか（非エンジニアにも分かる言葉で） */
  detail: string;
};

export type CheckItem = {
  key: string;
  /** 画面に出す名前 */
  label: string;
  /** なぜ確認するのか */
  why: string;
  /** 公開してはいけない項目か（＝公開ブロッカー） */
  required: boolean;
  stages: Record<StageId, Stage>;
  /**
   * E2E VERIFIED にするために、全部通す必要がある細目。
   * 「設定しただけ」で済ませないための一覧。
   */
  e2eSteps?: string[];
  /** ビルドを止めるときのエラー記号 */
  code?: string;
};

const has = (v: string | undefined) => Boolean(v && v.trim() !== "");

/** 開発・プレビュー用のURLかどうか。本番URLとして使ってはいけないもの */
export const DEV_URL_HINTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  ".vercel.app",
  "staging.",
  "preview.",
  "ngrok",
];

export function looksLikeProductionUrl(url: string | undefined): boolean {
  if (!has(url)) return false;
  const u = url!.trim().toLowerCase();
  if (!u.startsWith("https://")) return false;
  return !DEV_URL_HINTS.some((h) => u.includes(h));
}

const na = (detail: string): Stage => ({ auto: true, state: "na", detail });

/**
 * 環境変数を受け取って判定する。
 * サーバー側（/launch ページ・ビルドスクリプト）から呼ぶ。
 */
export function buildChecklist(env: NodeJS.ProcessEnv): CheckItem[] {
  const isProd =
    env.VERCEL_ENV === "production" || env.NODE_ENV === "production";

  const contactOk = has(env.CONTACT_WEBHOOK_URL);
  const ga4Ok = has(env.NEXT_PUBLIC_GA4_ID);
  const clarityOk = has(env.NEXT_PUBLIC_CLARITY_ID);
  const gscOk = has(env.NEXT_PUBLIC_GSC_VERIFICATION);
  const siteUrlSet = has(env.NEXT_PUBLIC_SITE_URL);
  const siteUrlProd = looksLikeProductionUrl(env.NEXT_PUBLIC_SITE_URL);
  const mailOk = has(env.MAIL_SYNC_URL);
  const operatorOk =
    has(env.NEXT_PUBLIC_OPERATOR_NAME) && has(env.NEXT_PUBLIC_OPERATOR_CONTACT);

  return [
    /* ══════════════════════════════════════
       本番接続の4項目。ここが今回の山場。
       ══════════════════════════════════════ */

    {
      key: "contact",
      label: "① 問い合わせの通知先",
      why: "ここが本当につながっていないと、お客様が送信しても誰にも届きません。売上に直結する最重要項目です。",
      required: true,
      code: "CONTACT_DESTINATION_MISSING",
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail:
            "フォーム・受付API・二重送信よけ・ボット対策・連打制限まで実装済み。届け先が未設定のときは「送信できました」と嘘をつかず、受付できない旨を返します。",
        },
        connected: {
          auto: true,
          state: contactOk ? "ok" : "todo",
          detail: contactOk
            ? "通知先が設定されています。"
            : "CONTACT_WEBHOOK_URL が未設定です。まずは普段確実に確認するメールアドレス1つで構いません。そこへ通知が飛ぶURLを設定してください。",
        },
        verified: {
          auto: false,
          state: "todo",
          detail:
            "設定しただけでは完了にしません。実際に1件テスト送信し、下の7項目が全部そろったらチェックしてください。",
        },
      },
      e2eSteps: [
        "問い合わせが実際に届く",
        "選んだプラン（GROWTHなど）が残っている",
        "営業担当（sales_ref）が残っている",
        "広告のUTMが残っている",
        "最初の経路（first_touch）と最後の経路（last_touch）が両方残っている",
        "日本語が文字化けしていない",
        "同じ内容が二重に通知されない",
      ],
    },

    {
      key: "ga4",
      label: "② GA4（アクセス解析）",
      why: "どこで離脱しているかが分からないと、改善が感覚になります。IDを入れただけでは計測できているとは限りません。",
      required: true,
      code: "GA4_NOT_CONNECTED",
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail:
            "計測イベント（デモ開始・バックテスト閲覧・ROI完了・料金到達・プラン選択・問い合わせ送信ほか）を実装済み。営業担当・流入経路・A/Bの出し分けも一緒に送っています。",
        },
        connected: {
          auto: true,
          state: ga4Ok ? "ok" : "todo",
          detail: ga4Ok
            ? "計測IDが設定されています。"
            : "NEXT_PUBLIC_GA4_ID が未設定です。このLP専用、または事業サイト用のプロパティを作って接続してください。",
        },
        verified: {
          auto: false,
          state: "todo",
          detail:
            "実際のブラウザから下の6イベントを発火させ、GA4の「リアルタイム」で受信を確認できたらチェックしてください。",
        },
      },
      e2eSteps: [
        "demo_start（デモを開いた）",
        "backtest_view（バックテストを見た）",
        "roi_complete（ROI計算を最後までやった）",
        "pricing_view（料金まで到達した）",
        "plan_select（プランのボタンを押した）",
        "contact_submit（問い合わせを送った）",
      ],
    },

    {
      key: "clarity",
      label: "③ Microsoft Clarity（録画・ヒートマップ）",
      why: "実際にどこまで読まれ、どこで止まったかを見ます。ただし録画に個人情報が写り込むと、それ自体が事故になります。",
      required: true,
      code: "CLARITY_NOT_CONNECTED",
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail:
            "タグの読み込みと、入力欄のマスキング指定を実装済み。氏名・メール・電話・問い合わせ本文は録画に残さない設定にしています。",
        },
        connected: {
          auto: true,
          state: clarityOk ? "ok" : "todo",
          detail: clarityOk
            ? "計測IDが設定されています。"
            : "NEXT_PUBLIC_CLARITY_ID が未設定です。録画・ヒートマップ取得用に接続してください。",
        },
        verified: {
          auto: false,
          state: "todo",
          detail:
            "タグを置いただけでは完了にしません。自分で1回問い合わせフォームまで入力し、その録画を再生して、下の4つが見えないことを確認してください。",
        },
      },
      e2eSteps: [
        "録画に氏名が写っていない",
        "録画にメールアドレスが写っていない",
        "録画に電話番号が写っていない",
        "録画に問い合わせ本文が写っていない",
      ],
    },

    {
      key: "domain",
      label: "④ 本番ドメイン",
      why: "検索エンジンやSNSに渡す正しいアドレス。開発用のURLが残っていると、共有時に別の場所を指したり、検索に登録されなかったりします。",
      required: true,
      code: "SITE_URL_MISSING",
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail:
            "canonical・OGP・sitemap・robots・構造化データは、すべて設定した本番URLを見るように実装済み。ソースにURLを直書きしていません。",
        },
        connected: {
          auto: true,
          state: siteUrlProd ? "ok" : "todo",
          detail: siteUrlProd
            ? "本番URLが設定されています。"
            : siteUrlSet
              ? "NEXT_PUBLIC_SITE_URL に開発用・プレビュー用のURLが入っています。独自ドメイン（https://…）に変えてください。"
              : "NEXT_PUBLIC_SITE_URL が未設定です。公開するドメインを取得して設定してください。",
        },
        verified: {
          auto: false,
          state: "todo",
          detail:
            "ドメイン接続後、下の7つを本番URLで実際に開いて確認してください。開発用URLの残留は `npm run check:urls` でも検出できます。",
        },
      },
      e2eSteps: [
        "canonical が本番URLになっている",
        "OGP（SNSシェア時の画像・タイトル）が本番URLで正しく出る",
        "sitemap.xml が本番URLで出る",
        "robots.txt が本番URLで出る",
        "構造化データが本番URLになっている",
        "問い合わせURL・デモURLが本番URLに統一されている",
        "localhost / preview / staging / 古い vercel.app のURLが1つも残っていない",
      ],
    },

    /* ══════════════════════════════════════
       最後の通し確認。ここが YES になったら公開候補。
       ══════════════════════════════════════ */

    {
      key: "production_e2e",
      label: "⑤ 本番相当での通し確認",
      why: "個々の項目が○でも、つないだ瞬間に切れることがあります。営業が実際にやる順番で、最初から最後まで1本通します。",
      required: true,
      code: "PRODUCTION_E2E_UNVERIFIED",
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail: "営業URL→LP→デモ→バックテスト→ROI→料金→問い合わせの導線は実装済み。",
        },
        connected: na("この項目に「接続」はありません。上の4項目がつながっていることが前提です。"),
        verified: {
          auto: false,
          state: "todo",
          detail:
            "本番相当の環境で、下の順に1本通してください。途中で情報が切れたらやり直しです。ここが通ったら PRODUCTION READY = YES です。",
        },
      },
      e2eSteps: [
        "営業URL（?ref=sales01）を開く",
        "LPが正しく表示される",
        "デモを開く",
        "バックテストを見る",
        "ROIを計算する",
        "料金まで到達する",
        "GROWTHを選ぶ",
        "問い合わせを送る",
        "通知が届く（プラン・営業担当・UTM・経路が残っている）",
        "GA4とClarityに記録されている",
      ],
    },

    /* ══════════════════════════════════════
       法務・安全（公開ブロッカー）
       ══════════════════════════════════════ */

    {
      key: "backtest_regression",
      label: "バックテストの回帰テスト",
      why: "『公開する前に、赤字になる未来を試す』が売り文句なので、その計算が静かに変わっていないことを毎回確かめます。画面が正常に見えたまま数字だけ間違うのが、この製品でいちばん危ない壊れ方です。",
      required: true,
      code: "BACKTEST_REGRESSION_UNCONFIRMED",
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail: "基準値を凍結した回帰テスト57件を実装済み。",
        },
        connected: na("この項目に「接続」はありません。"),
        verified: {
          auto: false,
          state: "todo",
          detail:
            "`npm test` を実行し、57件すべてが通ることを確認してください。基準値（設計還元率93.2%／通常SAFE／相場+25%でDANGER・粗利−264,000円）が動いた場合は、意図した変更かバグかを確かめるまでチェックしないでください。",
        },
      },
    },

    {
      key: "security",
      label: "セキュリティヘッダー",
      why: "他サイトへの埋め込みや、不正なスクリプトの差し込みを防ぐ設定です。",
      required: true,
      code: "SECURITY_UNVERIFIED",
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail:
            "CSP・X-Frame-Options・HSTS などを next.config.mjs で常時付与しています。",
        },
        connected: na("この項目に「接続」はありません。"),
        verified: {
          auto: false,
          state: "todo",
          detail:
            "本番URLで、ヘッダーが実際に返ってきていることを確認してください（ブラウザの開発者ツール、または securityheaders.com）。",
        },
      },
    },

    {
      key: "legal_privacy",
      label: "個人情報の取り扱い（事業者情報）",
      why: "お名前・メールをお預かりするため、誰が預かり、どこへ連絡すればよいかの明示が必要です。",
      required: true,
      code: "OPERATOR_INFO_MISSING",
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail: "/legal/privacy を実装済み。",
        },
        connected: {
          auto: true,
          state: operatorOk ? "ok" : "todo",
          detail: operatorOk
            ? "事業者名と問い合わせ窓口が設定されています。"
            : "事業者名または問い合わせ窓口が未設定です。NEXT_PUBLIC_OPERATOR_NAME と NEXT_PUBLIC_OPERATOR_CONTACT（または config/legal.ts）を設定してください。",
        },
        verified: {
          auto: false,
          state: "todo",
          detail:
            "本番URLで /legal/privacy を開き、事業者名・連絡先・取得する情報・利用目的が正しいことを確認してください。",
        },
      },
    },

    /*
      ★ここは「まだ無いものを、有ると書かない」場所。
      以前はどちらも「ページの枠は実装済み」と書いてありましたが、
      実際には app/legal/ の中に privacy しかありません。
      チェックリストが嘘をつくと、チェックリスト自体が意味を失うため、
      現状のまま（未作成）を書いています。
    */
    {
      key: "legal_terms",
      label: "利用規約",
      why: "契約条件を示すページ。サイト上で申し込みまで完結させる場合は必要です。",
      required: true,
      code: "LEGAL_TERMS_UNCONFIRMED",
      stages: {
        implemented: {
          auto: true,
          state: "todo",
          detail:
            "利用規約ページはまだありません。いまのサイトはご相談を受け取るだけで、契約条件は個別の契約書で定めています。サイト上で申し込み・決済まで行う形にする場合は、公開前に作成してください。",
        },
        connected: na("この項目に「接続」はありません。"),
        verified: {
          auto: false,
          state: "todo",
          detail:
            "内容を確認し、公開できる状態になったらチェックしてください。具体的な法的適合性は専門家にご確認ください。",
        },
      },
    },

    {
      key: "legal_tokushoho",
      label: "特定商取引法に基づく表記",
      why: "サイト上で申し込み・決済まで完結させる（通信販売の広告に当たる）場合に必要な表示です。",
      required: true,
      code: "LEGAL_TOKUSHOHO_UNCONFIRMED",
      stages: {
        implemented: {
          auto: true,
          state: "todo",
          detail:
            "特商法表記のページはまだありません。いまのサイトは申し込み・決済を行わないご相談の窓口のため、事業者情報は /legal/privacy に記載しています。サイト上で申し込み・決済まで行う形にする場合は、電話番号を含む表記が別途必要です。",
        },
        connected: na("この項目に「接続」はありません。"),
        verified: {
          auto: false,
          state: "todo",
          detail:
            "事業者名・所在地・連絡先・料金・支払方法・解約条件を確認してください。具体的な法的適合性は専門家にご確認ください。",
        },
      },
    },

    {
      key: "monitoring",
      label: "稼働監視",
      why: "落ちたことに気づけない状態で公開しないため。",
      required: true,
      code: "MONITORING_UNCONFIRMED",
      stages: {
        implemented: na("このLPの外側（監視サービス）で設定する項目です。"),
        connected: {
          auto: false,
          state: "todo",
          detail: "死活監視・エラー通知の宛先を設定してください。",
        },
        verified: {
          auto: false,
          state: "todo",
          detail: "わざと落として（または通知テストで）、実際に通知が届くことを確認してください。",
        },
      },
    },

    {
      key: "backup",
      label: "バックアップ",
      why: "問い合わせ内容が失われたときに戻せる状態か。",
      required: true,
      code: "BACKUP_UNCONFIRMED",
      stages: {
        implemented: na("届け先（スプレッドシート／CRM）側で設定する項目です。"),
        connected: {
          auto: false,
          state: "todo",
          detail: "届け先側のバックアップ設定を有効にしてください。",
        },
        verified: {
          auto: false,
          state: "todo",
          detail: "実際に1件復元できることを確認してください。",
        },
      },
    },

    /* ══════════════════════════════════════
       推奨（公開は止めない）
       ══════════════════════════════════════ */

    {
      key: "demo_video",
      label: "デモ動画",
      why: "実画面が動いて見えるかどうかで、伝わり方が大きく変わります。ただし公開を止める理由にはしません。",
      required: false,
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail:
            "動画の置き場所と再生の計測（video_play / video_complete）は実装済み。絵コンテは docs/demo-video-storyboard.md にあります。",
        },
        connected: na("この項目に「接続」はありません。"),
        verified: {
          auto: false,
          state: "todo",
          detail:
            "公開前に間に合えば入れる扱いです。撮影する場合は、設計上93.2%でも相場+25%で赤字になる場面を必ず入れてください。",
        },
      },
    },

    {
      key: "pricing",
      label: "料金の確定",
      why: "金額が決まっていないと、問い合わせから先に進みません。",
      required: false,
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail: "config/pricing.ts に3プランと初期構築費を実装済み。",
        },
        connected: na("この項目に「接続」はありません。"),
        verified: {
          auto: false,
          state: "todo",
          detail:
            "いまの価格は「営業を始めてよい価格」であって「正解の価格」ではありません。最初の商談10〜20件で価格への反応を記録し、そのうえで確定してください。",
        },
      },
    },

    {
      key: "mobile",
      label: "スマホ表示",
      why: "問い合わせの多くはスマホから来ます。",
      required: false,
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail: "スマホ幅のレイアウトを実装済み。",
        },
        connected: na("この項目に「接続」はありません。"),
        verified: {
          auto: false,
          state: "todo",
          detail:
            "実機（iPhone / Android）で、横スクロールと文字の潰れが無いか確認してください。",
        },
      },
    },

    {
      key: "gsc",
      label: "Search Console",
      why: "検索からの流入と検索順位を見るために使います。",
      required: false,
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail: "所有権確認コードの埋め込みを実装済み。",
        },
        connected: {
          auto: true,
          state: gscOk ? "ok" : "todo",
          detail: gscOk
            ? "所有権確認コードが設定されています。"
            : "NEXT_PUBLIC_GSC_VERIFICATION が未設定です。",
        },
        verified: {
          auto: false,
          state: "todo",
          detail: "所有権が確認され、sitemap を登録できたらチェックしてください。",
        },
      },
    },

    {
      key: "mail_sync",
      label: "ステップメール連携",
      why: "問い合わせ後の自動フォローを行う場合に使います。",
      required: false,
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail: "連携の口は実装済み（既定＝無効。このサイトからメールは送りません）。",
        },
        connected: {
          auto: true,
          state: mailOk ? "ok" : "todo",
          detail: mailOk
            ? "配信サービスへの連携先が設定されています。"
            : "MAIL_SYNC_URL が未設定です。使わない場合はこのままで問題ありません。",
        },
        verified: {
          auto: false,
          state: "todo",
          detail: "使う場合のみ。1件テストして、意図しない大量送信が起きないことを確認してください。",
        },
      },
    },

    {
      key: "audit_security",
      label: "セキュリティ監査",
      why: "第三者の目で穴を潰したかどうか。",
      required: false,
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail: "docs/audit/対応状況_2026-08-20.md に対応内容を記録済み。",
        },
        connected: na("この項目に「接続」はありません。"),
        verified: {
          auto: false,
          state: "todo",
          detail: "再監査を実施し、指摘が残っていないことを確認してください。",
        },
      },
    },

    {
      key: "audit_e2e",
      label: "販売導線の外部監査（Codex）",
      why: "営業URL→LP→デモ→ROI→問い合わせ→通知→営業管理が最後まで通るかを、第三者の目で見ます。",
      required: false,
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail: "依頼文 docs/codex-e2e-audit-prompt.md を用意済み。",
        },
        connected: na("この項目に「接続」はありません。"),
        verified: {
          auto: false,
          state: "todo",
          detail: "監査を実施し、指摘に対応したらチェックしてください。",
        },
      },
    },

    {
      key: "production_build",
      label: "本番ビルド",
      why: "本番と同じ状態で組み上がるかを確認します。",
      required: false,
      stages: {
        implemented: {
          auto: true,
          state: "ok",
          detail: "ビルド時に公開前チェックが自動で走る仕組みを実装済み。",
        },
        connected: {
          auto: true,
          state: isProd ? "ok" : "todo",
          detail: isProd
            ? "本番環境として動作しています。"
            : "いまは本番環境ではありません。",
        },
        verified: {
          auto: false,
          state: "todo",
          detail: "本番ビルドが成功し、本番URLで表示できたらチェックしてください。",
        },
      },
    },
  ];
}

/* ────────────────────────────────
   判定
   ──────────────────────────────── */

/** その項目が3段階すべて済んでいるか（na は「済み」として扱う） */
export function isItemReady(item: CheckItem): boolean {
  return STAGE_ORDER.every((s) => item.stages[s].state !== "todo");
}

/** その項目で、まだ済んでいない段階 */
export function pendingStages(item: CheckItem): StageId[] {
  return STAGE_ORDER.filter((s) => item.stages[s].state === "todo");
}

/** 公開ブロッカーのうち、まだ3段階そろっていないもの */
export function blockingItems(items: CheckItem[]): CheckItem[] {
  return items.filter((i) => i.required && !isItemReady(i));
}

/**
 * 自動判定できるのに満たされていない必須項目（ビルドを止める対象）。
 *
 * 人が目で確かめる段階（E2E VERIFIED）はビルドでは判定できないので、
 * ここには入れません。ビルドが通ること＝公開してよいこと、ではありません。
 */
export function hardFailures(items: CheckItem[]): CheckItem[] {
  return items.filter(
    (i) =>
      i.required &&
      STAGE_ORDER.some(
        (s) => i.stages[s].auto && i.stages[s].state === "todo"
      )
  );
}

/** PRODUCTION READY = YES か */
export function isProductionReady(items: CheckItem[]): boolean {
  return blockingItems(items).length === 0;
}

/**
 * 公開判断のための一覧。
 * 商談前・公開前に、この表だけ見れば良い状態にしてあります。
 */
export const LAUNCH_SUMMARY: { name: string; keys: string[] }[] = [
  { name: "Contact", keys: ["contact"] },
  { name: "GA4", keys: ["ga4"] },
  { name: "Clarity", keys: ["clarity"] },
  { name: "Production URL", keys: ["domain"] },
  { name: "Production E2E", keys: ["production_e2e"] },
  { name: "Backtest Regression", keys: ["backtest_regression"] },
  { name: "Security", keys: ["security"] },
  { name: "Privacy", keys: ["legal_privacy"] },
  { name: "Terms", keys: ["legal_terms"] },
  { name: "Legal", keys: ["legal_tokushoho"] },
  { name: "Monitoring", keys: ["monitoring"] },
  { name: "Backup", keys: ["backup"] },
  { name: "Codex E2E", keys: ["audit_e2e"] },
  { name: "Mobile", keys: ["mobile"] },
  { name: "Pricing", keys: ["pricing"] },
  { name: "Demo Video", keys: ["demo_video"] },
];

export type SummaryRow = {
  name: string;
  required: boolean;
  ready: boolean;
  /** 3段階それぞれの状態 */
  stages: Record<StageId, StageState>;
  /** まだ済んでいない段階の名前 */
  pending: string[];
};

/** 一覧を作る。複数項目をまとめている行は、いちばん遅れている状態に合わせる。 */
export function launchSummary(items: CheckItem[]): SummaryRow[] {
  const byKey = new Map(items.map((i) => [i.key, i]));

  return LAUNCH_SUMMARY.map(({ name, keys }) => {
    const found = keys.map((k) => byKey.get(k)).filter(Boolean) as CheckItem[];

    // 参照先が消えている＝定義のずれ。黙って ✅ にしない
    if (found.length === 0) {
      return {
        name,
        required: true,
        ready: false,
        stages: { implemented: "todo", connected: "todo", verified: "todo" },
        pending: STAGE_ORDER.map((s) => STAGE_LABEL[s]),
      };
    }

    const stages = {} as Record<StageId, StageState>;
    for (const s of STAGE_ORDER) {
      // 1つでも todo があれば todo。全部 na なら na。
      const states = found.map((f) => f.stages[s].state);
      stages[s] = states.includes("todo")
        ? "todo"
        : states.every((v) => v === "na")
          ? "na"
          : "ok";
    }

    return {
      name,
      required: found.some((f) => f.required),
      ready: found.every(isItemReady),
      stages,
      pending: STAGE_ORDER.filter((s) => stages[s] === "todo").map(
        (s) => STAGE_LABEL[s]
      ),
    };
  });
}
