/**
 * どの決済を使うかを、ここ1か所で決める。
 *
 * ═══════════════════════════════════════════════════════
 * ★このファイルが止めたい、たった1つの事故
 * ═══════════════════════════════════════════════════════
 *
 *   「練習用の決済のまま、本番を開けてしまう」
 *
 *   そうなると、こうなります。
 *
 *     ・本番の画面に「支払ったことにする」ボタンが出る
 *     ・押した人は、1円も払わずにポイントを手に入れる
 *     ・そのポイントで、実在するカードが当たる
 *     ・エラーは1つも出ない。誰も気づかない
 *
 *   ですので、人の注意力ではなく、コードとビルドで止めます。
 *
 * ═══════════════════════════════════════════════════════
 * ★本番で本物の決済を有効にする条件は、3つ全部そろうこと
 * ═══════════════════════════════════════════════════════
 *
 *   ① 決済会社のAPIの鍵がある
 *   ② 確定通知（Webhook）の鍵がある
 *   ③ 本番の保存先につながっている
 *
 *   ★③を条件に入れている理由を、忘れないでください。
 *
 *     ①②だけ見て通すと、こういう状態が作れます。
 *
 *       本物のカード決済で、お客様から本当にお金を受け取る
 *         ↓
 *       ポイントの台帳は、検証用（preview）の保存先に書かれる
 *         ↓
 *       検証用の保存先は、いつ作り直されてもおかしくない
 *         ↓
 *       ある日、購入履歴とポイントが消える
 *
 *     お金だけ受け取って、記録が消えます。これは返金対応もできません。
 *     ですので、保存先が本番でなければ、本物の決済を有効にしません。
 *
 * ═══════════════════════════════════════════════════════
 * ★判定を1か所にしていること
 * ═══════════════════════════════════════════════════════
 *
 *   画面・API・ビルド前チェックが、全部この paymentReadiness を見ます。
 *   同じ判定を別の場所へ書き写さないでください。
 *   写した瞬間から、片方だけ直した日にずれ始めます。
 */

import { isProductionEnv } from "../env";
import { MockPaymentProvider } from "./mock";
import { liveKeyProblem, RealPaymentProvider } from "./real";
import {
  PAYMENT_CODES,
  PaymentNotConfiguredError,
  type PaymentPreflight,
  type PaymentProviderImpl,
  type PaymentProviderName,
} from "./types";

export * from "./types";
export { MockPaymentProvider } from "./mock";
export { RealPaymentProvider } from "./real";
export { isProductionEnv } from "../env";

const t = (v: unknown): string => String(v ?? "").trim();

/* ══════════════════════════════════════════════
   ① どれを使いたいと言われているか
   ══════════════════════════════════════════════ */

/**
 * 設定で選ばれている決済業者の名前。
 *
 * ★既定を "stripe" などにしないこと。
 *   設定を書き忘れた環境が、勝手に本物へつながります。
 */
export function wantedPaymentProvider(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return t(env.PAYMENT_PROVIDER).toLowerCase() || "mock";
}

const KNOWN: PaymentProviderName[] = ["mock", "stripe", "gmo"];

function isKnown(v: string): v is PaymentProviderName {
  return (KNOWN as string[]).includes(v);
}

/**
 * 決済の送り口を作る（まだ何もしない）。
 *
 * ★ここでは投げないこと。
 *   管理画面が「いま何が足りないか」を表示するために、
 *   止まっている状態でも中身を見たい場面があります。
 *
 * @returns 知らない名前が指定されていたら null
 */
export function makePaymentProvider(
  env: NodeJS.ProcessEnv = process.env,
): PaymentProviderImpl | null {
  const want = wantedPaymentProvider(env);
  if (!isKnown(want)) return null;
  if (want === "mock") return new MockPaymentProvider();
  return new RealPaymentProvider(want);
}

/* ══════════════════════════════════════════════
   ② 本番の保存先につながっているか
   ══════════════════════════════════════════════ */

export type ProductionDbState = {
  connected: boolean;
  missing: string[];
  reason: string;
};

/**
 * 本番の保存先につながっている、と言える状態か。
 *
 * ★「つながる設定が書いてある」ではなく
 *   「本番として使ってよいと、はっきり許可されている」を見ます。
 *
 *   条件は3つです。
 *     ・DATABASE_ENV が production
 *       （本物のお金を受け取るのに、台帳が検証用では困ります）
 *     ・ALLOW_PRODUCTION_DB=yes-i-am-sure
 *       （lib/server/db.ts が実際に要求している合図です）
 *     ・DATABASE_URL が、手元のファイルではない外部の保存先
 *
 *   ★最後の1つを外さないこと。
 *     公開先の一時ファイルは、しばらく使われないと中身ごと消えます。
 *     サーバーが増えれば、保存先が別々に増えます。
 *     「昨日買ったポイントが無い」が、原因不明のまま起きます。
 */
export function productionDbState(
  env: NodeJS.ProcessEnv = process.env,
): ProductionDbState {
  const missing: string[] = [];

  const dbEnv = t(env.DATABASE_ENV).toLowerCase();
  if (dbEnv !== "production") missing.push("DATABASE_ENV=production");

  if (t(env.ALLOW_PRODUCTION_DB) !== "yes-i-am-sure") {
    missing.push("ALLOW_PRODUCTION_DB=yes-i-am-sure");
  }

  const url = t(env.DATABASE_URL);
  if (url === "") {
    missing.push("DATABASE_URL");
  } else {
    const lower = url.toLowerCase();
    const isRemote =
      lower.startsWith("libsql://") ||
      lower.startsWith("https://") ||
      lower.startsWith("wss://");
    if (!isRemote) {
      missing.push("DATABASE_URL（手元のファイルではなく、外部の保存先）");
    }
  }

  if (missing.length === 0) {
    return { connected: true, missing: [], reason: "" };
  }

  return {
    connected: false,
    missing,
    reason:
      `本番の保存先につながっていません：${missing.join(" / ")}。` +
      "この状態で本物の決済を開けると、お金だけ受け取って、購入履歴とポイントが消える事故になります。",
  };
}

/* ══════════════════════════════════════════════
   ③ いまの状態（画面・API・ビルドが全部これを見る）
   ══════════════════════════════════════════════ */

export type PaymentReadiness = {
  /** 本番として扱っているか */
  production: boolean;
  /** 設定で選ばれている名前（知らない値でもそのまま入れる） */
  provider: string;
  /** 練習用か本物か。知らない値のときは null */
  kind: "MOCK" | "REAL" | null;
  /** いま本当に決済を受け付けてよい状態か */
  canCharge: boolean;
  /** 本番なのに受け付けられない状態か（＝公開してはいけない状態） */
  blocking: boolean;
  code: string | null;
  message: string;
  missing: string[];
};

export function paymentReadiness(
  env: NodeJS.ProcessEnv = process.env,
): PaymentReadiness {
  const production = isProductionEnv(env);
  const want = wantedPaymentProvider(env);
  const provider = makePaymentProvider(env);

  /* ── 知らない名前 ── */
  if (provider === null) {
    return {
      production,
      provider: want,
      kind: null,
      canCharge: false,
      /* ★本番でなくても止めること。
           打ち間違いに気づく、唯一の機会です。 */
      blocking: true,
      code: PAYMENT_CODES.UNKNOWN,
      message: `PAYMENT_PROVIDER の値が正しくありません: "${want}"（mock / stripe / gmo）`,
      missing: ["PAYMENT_PROVIDER"],
    };
  }

  /* ── 本番なのに練習用 ── */
  if (production && provider.kind === "MOCK") {
    return {
      production,
      provider: provider.name,
      kind: provider.kind,
      canCharge: false,
      blocking: true,
      code: PAYMENT_CODES.MOCK_IN_PRODUCTION,
      message:
        "本番なのに、決済が練習用（Mock）のままです。" +
        "このままだと、1円も払わずにポイントを増やせる入口が本番に開きます。" +
        "決済会社と契約し、PAYMENT_PROVIDER と鍵を設定してください。",
      missing: ["PAYMENT_PROVIDER"],
    };
  }

  /* ── 鍵がそろっているか ── */
  const pre: PaymentPreflight = provider.preflight(env);
  if (!pre.ok) {
    return {
      production,
      provider: provider.name,
      kind: provider.kind,
      canCharge: false,
      /* ★本物を選んでいるのに鍵が無いのは、本番でなくても止めます。
           手元で「なぜか買えない」を延々と調べることになるからです。 */
      blocking: true,
      code: pre.code,
      message: pre.message,
      missing: pre.missing,
    };
  }

  /* ── 本番のときだけ、あと2つ見る ── */
  if (production && provider.kind === "REAL") {
    const live = liveKeyProblem(provider.name, env);
    if (live !== null) {
      return {
        production,
        provider: provider.name,
        kind: provider.kind,
        canCharge: false,
        blocking: true,
        code: PAYMENT_CODES.KEY_MISSING,
        message: live,
        missing: ["STRIPE_SECRET_KEY"],
      };
    }

    const dbState = productionDbState(env);
    if (!dbState.connected) {
      return {
        production,
        provider: provider.name,
        kind: provider.kind,
        canCharge: false,
        blocking: true,
        code: PAYMENT_CODES.DB_NOT_PRODUCTION,
        message: dbState.reason,
        missing: dbState.missing,
      };
    }
  }

  return {
    production,
    provider: provider.name,
    kind: provider.kind,
    canCharge: true,
    blocking: false,
    code: null,
    message: pre.note,
    missing: [],
  };
}

/**
 * 使ってよい決済業者の名前を返す。だめなら投げる。
 *
 * ★「だめなときに mock へ戻す」を、絶対に書かないこと。
 *   それが、このファイル全体をむだにする1行です。
 */
export function resolvePaymentProvider(
  env: NodeJS.ProcessEnv = process.env,
): PaymentProviderName {
  const r = paymentReadiness(env);
  if (r.blocking || !r.canCharge) {
    throw new PaymentNotConfiguredError(
      r.code ?? "PAYMENT_NOT_READY",
      r.message,
      r.missing,
    );
  }
  return r.provider as PaymentProviderName;
}

/**
 * 起動時に1回だけ確かめる。
 *
 * ★1件目の決済で初めて気づく、では遅すぎます。
 *   その1件目は、実在するお客様の支払いです。
 */
export function assertPaymentReadyAtBoot(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const r = paymentReadiness(env);
  if (r.blocking) {
    throw new PaymentNotConfiguredError(
      r.code ?? "PAYMENT_NOT_READY",
      r.message,
      r.missing,
    );
  }
}
