/**
 * 本物の送り口（RealMailProvider）。
 *
 * ═══════════════════════════════════════════════════════
 * ★いまの正直な状態
 * ═══════════════════════════════════════════════════════
 *
 *   メール配信会社とは、まだ契約していません。
 *   ですので、ここは「つなぐ場所」だけを先に作ってあります。
 *
 *     ・設定が入っていなければ、送る前にはっきり止まります
 *     ・設定が入っていれば、その宛先へ HTTP で投げます
 *     ・配信会社が受け取らなければ、例外にします
 *
 *   ★実際の配信会社での送信確認は、まだ済んでいません（未検証）。
 *     契約したら、まず1通だけ自分宛てに送って確かめてください。
 *     確かめる前に、お客様の宛先へは使わないこと。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ SMTP ではなく HTTP なのか
 * ═══════════════════════════════════════════════════════
 *
 *   SMTP でつなぐには、外部の部品を新しく入れる必要があります。
 *   入れた部品は、その日から自分たちの責任になります。
 *   いま欲しいのは「差し替えられる形」だけなので、
 *   標準の機能（fetch）だけで済む HTTP を選びました。
 *
 *   SMTP が必要になったら、この1ファイルと同じ形で
 *   もう1つ作って、index.ts の選び方に足すだけです。
 *   呼び出し側は変わりません。
 *
 * ═══════════════════════════════════════════════════════
 * ★設定（環境変数）
 * ═══════════════════════════════════════════════════════
 *
 *   MAIL_PROVIDER    "mock" または "http"
 *   MAIL_API_URL     配信会社の送信用URL（https のみ）
 *   MAIL_API_KEY     配信会社の鍵（★コードに書かないこと）
 *   MAIL_FROM        差出人（例 "ショップ名 <no-reply@example.com>"）
 *   MAIL_API_FORMAT  "resend" / "sendgrid" / "generic"
 *
 *   ★MAIL_API_KEY を既定値としてここに書かないこと。
 *     Git の履歴に残ると、あとから消しても消えません。
 */

import {
  MailNotConfiguredError,
  MailSendError,
  type Delivery,
  type Mail,
  type MailProvider,
  type Preflight,
} from "./types";

export type MailApiFormat = "resend" | "sendgrid" | "generic";

const FORMATS: MailApiFormat[] = ["resend", "sendgrid", "generic"];

const trim = (v: string | undefined) => String(v ?? "").trim();

export type HttpMailConfig = {
  url: string;
  key: string;
  from: string;
  format: MailApiFormat;
  /** 返事を待つ上限（ミリ秒）。待ち続けると登録画面が固まります */
  timeoutMs: number;
};

/** 環境変数から設定を読む（読むだけ。ここでは何も送らない） */
export function readHttpMailConfig(env: NodeJS.ProcessEnv): {
  config: HttpMailConfig | null;
  missing: string[];
  invalid: string[];
} {
  const url = trim(env.MAIL_API_URL);
  const key = trim(env.MAIL_API_KEY);
  const from = trim(env.MAIL_FROM);
  const rawFormat = trim(env.MAIL_API_FORMAT).toLowerCase();

  const missing: string[] = [];
  if (url === "") missing.push("MAIL_API_URL");
  if (key === "") missing.push("MAIL_API_KEY");
  if (from === "") missing.push("MAIL_FROM");
  if (rawFormat === "") missing.push("MAIL_API_FORMAT");

  const invalid: string[] = [];
  /* ★http:// を通さないこと。鍵と宛先が、そのまま経路上を流れます */
  if (url !== "" && !url.toLowerCase().startsWith("https://")) {
    invalid.push("MAIL_API_URL（https で始まる必要があります）");
  }
  if (from !== "" && !from.includes("@")) {
    invalid.push("MAIL_FROM（メールアドレスの形になっていません）");
  }
  if (rawFormat !== "" && !FORMATS.includes(rawFormat as MailApiFormat)) {
    invalid.push(`MAIL_API_FORMAT（${FORMATS.join(" / ")} のどれか）`);
  }

  if (missing.length > 0 || invalid.length > 0) {
    return { config: null, missing, invalid };
  }

  const rawTimeout = Number(trim(env.MAIL_TIMEOUT_MS));
  const timeoutMs =
    Number.isFinite(rawTimeout) && rawTimeout >= 1000 && rawTimeout <= 60_000
      ? Math.floor(rawTimeout)
      : 10_000;

  return {
    config: { url, key, from, format: rawFormat as MailApiFormat, timeoutMs },
    missing: [],
    invalid: [],
  };
}

/**
 * 配信会社へ渡す形を作る。
 *
 * ★resend / sendgrid の形は、各社の公開仕様に合わせて書いていますが、
 *   実際の送信での確認はまだしていません（未契約のため）。
 *   契約したら、まず自分宛てに1通送って確かめてください。
 *   どうしても合わないときは "generic" を使い、
 *   受け側（自社の中継）で形を合わせるほうが安全です。
 */
export function buildPayload(
  config: HttpMailConfig,
  mail: Mail,
): Record<string, unknown> {
  if (config.format === "resend") {
    return {
      from: config.from,
      to: [mail.to],
      subject: mail.subject,
      text: mail.body,
    };
  }
  if (config.format === "sendgrid") {
    return {
      personalizations: [{ to: [{ email: mail.to }] }],
      from: { email: extractAddress(config.from), name: extractName(config.from) },
      subject: mail.subject,
      content: [{ type: "text/plain", value: mail.body }],
    };
  }
  /* generic … 自社で受ける中継に渡す、いちばん素直な形 */
  return {
    kind: mail.kind,
    from: config.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.body,
  };
}

/** "名前 <a@b.jp>" から a@b.jp を取り出す */
export function extractAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

/** "名前 <a@b.jp>" から 名前 を取り出す（無ければ空） */
export function extractName(from: string): string {
  const m = from.match(/^([^<]+)</);
  return m ? m[1].trim() : "";
}

export class HttpMailProvider implements MailProvider {
  readonly kind = "REAL" as const;
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
  }

  get name(): string {
    const f = trim(this.env.MAIL_API_FORMAT).toLowerCase() || "unset";
    return `HTTP:${f}`;
  }

  preflight(): Preflight {
    const { config, missing, invalid } = readHttpMailConfig(this.env);
    if (config) {
      return {
        ok: true,
        provider: this.name,
        note: "本物の送り口の設定はそろっています。ただし、実際に届くかは1通送って確かめるまで分かりません。",
      };
    }
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`未設定：${missing.join(" / ")}`);
    if (invalid.length > 0) parts.push(`書き方が違います：${invalid.join(" / ")}`);
    return {
      ok: false,
      provider: this.name,
      code: missing.length > 0 ? "MAIL_CONFIG_MISSING" : "MAIL_CONFIG_INVALID",
      message: `メールの送り口の設定が足りません。${parts.join("、")}`,
      missing: [...missing, ...invalid],
    };
  }

  async send(mail: Mail): Promise<Delivery> {
    const pre = this.preflight();
    if (!pre.ok) {
      /* ★ここで LOG に落として成功を返さないこと。
           「送信しました」と表示して実際には送られていない状態を、
           絶対に作らないための一行です。 */
      throw new MailNotConfiguredError(pre.code, pre.message, pre.missing);
    }
    const { config } = readHttpMailConfig(this.env);
    if (!config) {
      throw new MailNotConfiguredError(
        "MAIL_CONFIG_MISSING",
        "メールの送り口の設定が足りません。",
        [],
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    let res: Response;
    try {
      res = await fetch(config.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.key}`,
        },
        body: JSON.stringify(buildPayload(config, mail)),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (e) {
      /* ★「たぶん送れました」と書かないこと。届いていません */
      throw new MailSendError(
        `メールの配信会社へつながりませんでした（${String((e as Error)?.message ?? e)}）。メールは送られていません。`,
        null,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      /* ★本文（body）を例外の文に混ぜないこと。
           配信会社の返事に、宛先や鍵の一部が入ることがあります。
           記録に残ると、記録を読める人全員に見えます。 */
      throw new MailSendError(
        `メールの配信会社が受け取りませんでした（${res.status}）。メールは送られていません。`,
        res.status,
      );
    }

    /* 受付番号が取れれば残す。取れなくても送信自体は成功扱いにする */
    let ref: string | null = null;
    try {
      const data = (await res.json()) as Record<string, unknown> | null;
      const raw = data?.id ?? data?.messageId ?? data?.message_id ?? null;
      ref = raw == null ? null : String(raw);
    } catch {
      ref = null;
    }

    return { via: "SENT", provider: this.name, ref };
  }
}
