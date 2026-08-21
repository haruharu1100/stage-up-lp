import { NextResponse } from "next/server";
import { LEAD_STATUSES } from "@/lib/leadStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 問い合わせ受付API。
 *
 * 個人情報の扱いの方針：
 * - 受信した氏名・メール・電話・相談内容は、原則そのままログへ出さない。
 * - 送信先（CONTACT_WEBHOOK_URL）が未設定のまま本番で受け付けると
 *   「送ったのにどこにも届いていない」状態になるため、本番では 503 で明示的に断る。
 * - 開発時のみ、動作確認用にマスクした要約だけを出力する。
 */

const WINDOW_MS = 10 * 60 * 1000;
const IP_LIMIT = 5;
/**
 * 送信元IPが分からなかった場合の上限。
 *
 * ★ここを分けている理由（見た目では絶対に分からない不具合になる）
 * IPが取れないと、全員が "unknown" という1つの入れ物にまとめられます。
 * ここに通常と同じ「5件まで」を当てると、
 * 別々のお客様6人目の問い合わせが、何も悪いことをしていないのに拒否されます。
 * 共有の入れ物には、共有にふさわしい広い上限を当てる。
 * 個人の連投は、下のメールアドレス単位の上限で止めます。
 */
const UNKNOWN_IP_LIMIT = 40;
const KEY_LIMIT = 3;
/** 二重送信とみなす時間。二度押し・戻る操作を吸収できればよいので短くする */
const DUP_WINDOW_MS = 2 * 60 * 1000;
const MAX_BODY = 20_000; // bytes

/**
 * 簡易レート制限（プロセス内）。
 * 複数インスタンスにスケールした場合はプロセスごとの計数になるため、
 * 本番ではCDN/WAF側のレート制限、または共有ストア（Upstash Redis等）を併用する前提。
 * 置き換える場合はこの関数だけを差し替える。
 */
const hits = new Map<string, { n: number; t: number }>();

function limited(key: string, max: number, windowMs: number = WINDOW_MS) {
  const now = Date.now();

  // 古いエントリを掃除（メモリの上限を作る）
  if (hits.size > 5000) {
    hits.forEach((v, k) => {
      if (now - v.t > WINDOW_MS) hits.delete(k);
    });
  }

  const cur = hits.get(key);
  if (!cur || now - cur.t > windowMs) {
    hits.set(key, { n: 1, t: now });
    return false;
  }
  cur.n += 1;
  return cur.n > max;
}

/**
 * クライアントIPの推定。
 * x-forwarded-for は偽装できるため、信頼できるプロキシ（Vercel）が付ける
 * x-real-ip を優先し、無い場合のみ XFF の末尾側ではなく先頭を使う。
 * どちらも無い場合は "unknown" にまとめて制限する。
 */
function clientKey(req: Request) {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/**
 * ステップメール配信サービスへの接続ポイント。
 *
 * 重要：このアプリからメールは1通も送らない。
 * ここでは「新しいリードが1件入った」という事実だけを、設定された宛先へ渡す。
 * 実際の配信（メール1＝御礼／メール2＝できること／メール3＝実還元率デモ）は
 * 配信サービス側のシナリオで行う。
 *
 * MAIL_SYNC_URL が未設定なら何も起きない（既定＝無効）。
 * 失敗しても問い合わせ自体は成功として扱う（お客様の送信を止めない）。
 */
async function syncToMailService(payload: {
  requestId: string;
  receivedAt: string;
  name: string;
  email: string;
  company: string;
  status: string;
  plan: string;
  source: Record<string, string>;
}) {
  const url = process.env.MAIL_SYNC_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.MAIL_SYNC_TOKEN
          ? { Authorization: `Bearer ${process.env.MAIL_SYNC_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        // 配信サービスへ渡すのは、シナリオ開始に必要な最小限だけ。
        // 相談内容の本文は渡さない。
        event: "lead.created",
        requestId: payload.requestId,
        receivedAt: payload.receivedAt,
        email: payload.email,
        name: payload.name,
        company: payload.company,
        status: payload.status,
        plan: payload.plan,
        source: payload.source,
        // 配信シナリオ名。サービス側でこの名前のステップメールに紐づける。
        sequence: process.env.MAIL_SYNC_SEQUENCE || "gacha-os-inbound",
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    console.error("[contact] mail sync failed. requestId=", payload.requestId);
  }
}

/** ログ用の伏せ字。開発時の動作確認以外では使わない。 */
const mask = (v: string) => {
  if (!v) return "";
  const tail = v.slice(-2);
  return `${"*".repeat(Math.max(2, Math.min(8, v.length - 2)))}${tail}`;
};

export async function POST(req: Request) {
  const key = clientKey(req);

  if (limited(`ip:${key}`, key === "unknown" ? UNKNOWN_IP_LIMIT : IP_LIMIT)) {
    return NextResponse.json(
      { error: "送信回数の上限に達しました。しばらくしてからお試しください。" },
      { status: 429 }
    );
  }

  // Content-Type / サイズの明示チェック
  // JavaScript無効時の素のフォーム送信（form-urlencoded）も受け付ける
  const ctype = (req.headers.get("content-type") || "").toLowerCase();
  const isJson = ctype.includes("application/json");
  const isForm = ctype.includes("application/x-www-form-urlencoded");
  if (!isJson && !isForm) {
    return NextResponse.json(
      { error: "不正なリクエストです。" },
      { status: 415 }
    );
  }
  const len = Number(req.headers.get("content-length") || 0);
  if (len && len > MAX_BODY) {
    return NextResponse.json(
      { error: "送信内容が大きすぎます。" },
      { status: 413 }
    );
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY) {
    return NextResponse.json(
      { error: "送信内容が大きすぎます。" },
      { status: 413 }
    );
  }

  let body: Record<string, unknown>;
  if (isForm) {
    body = Object.fromEntries(new URLSearchParams(raw));
  } else {
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "不正なリクエストです。" },
        { status: 400 }
      );
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "不正なリクエストです。" },
        { status: 400 }
      );
    }
  }

  /** 素のフォーム送信のときは、JSONではなく画面遷移で結果を返す */
  const reply = (ok: boolean, status: number, error?: string) => {
    if (isForm) {
      const url = new URL(ok ? "/contact/thanks" : "/contact/error", req.url);
      return NextResponse.redirect(url, 303);
    }
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error }, { status });
  };

  // ハニーポット（人が触らない項目に入力があればbotとみなし、静かに成功を返す）
  if (str(body.hp, 20)) {
    return reply(true, 200);
  }

  const name = str(body.name, 80);
  const email = str(body.email, 200);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply(false, 400, "お名前とメールアドレスをご確認ください。");
  }

  // 同一メールアドレスからの連投も抑制する
  if (limited(`mail:${email.toLowerCase()}`, KEY_LIMIT)) {
    return reply(
      false,
      429,
      "送信回数の上限に達しました。しばらくしてからお試しください。"
    );
  }

  /**
   * 二重送信よけ。
   *
   * 送信ボタンの二度押し・戻る操作・通信リトライで、同じ内容が2件届くと
   * 営業側は「別の問い合わせ」と区別できません。
   * 同じメールアドレスから同じ内容が短時間に続いた場合は、
   * 受け付けたことにして通知だけを止めます（利用者にはエラーを見せない）。
   */
  const fingerprint = `${email.toLowerCase()}|${str(body.company, 120)}|${str(
    body.message,
    4000
  ).slice(0, 200)}`;
  if (limited(`dup:${fingerprint}`, 1, DUP_WINDOW_MS)) {
    console.warn("[contact] duplicate submission ignored.");
    return reply(true, 200);
  }

  const requestId =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ??
    Math.random().toString(36).slice(2, 10);

  const payload = {
    requestId,
    receivedAt: new Date().toISOString(),
    name,
    email,
    company: str(body.company, 120),
    tel: str(body.tel, 40),
    stage: str(body.stage, 80),
    /**
     * いま運営しているサイトのURL。
     * 「運営している」を選んだ方にだけ入力欄が出るので、
     * それ以外の方からは空で届きます（空でも正常）。
     * 商談前に現状のドメイン・決済・会員のつくりを見るために使います。
     */
    siteUrl: str(body.siteUrl, 300),
    intent: str(body.intent, 80),
    message: str(body.message, 4000),
    interests: Array.isArray(body.interests)
      ? body.interests.slice(0, 12).map((v) => str(v, 40)).filter(Boolean)
      : [],
    /**
     * 押された料金プラン（starter / growth / enterprise）。
     * 「プラン別の成約率」を出すには、問い合わせ1件ごとにこの値が必要。
     * 計測（GA4）は人数しか分からず、個別の問い合わせと結びつかないため。
     */
    plan: str(body.plan, 40),
    // 最初の着地（FIRST TOUCH）＝どの経路・どの営業担当からの問い合わせか
    source: {
      ref: str(body.ref, 40),
      channel: str(body.channel, 40),
      utmSource: str(body.utmSource, 80),
      utmMedium: str(body.utmMedium, 80),
      utmCampaign: str(body.utmCampaign, 120),
      landing: str(body.landing, 300),
      referrer: str(body.referrer, 300),
      variant: str(body.variant, 20),
    },
    /**
     * 直近の入口（LAST TOUCH）。
     * 同じ訪問中に別のURLから入り直した場合だけ入る（例：広告で来て、後から営業URLで再訪）。
     * 空のときは「最初の入口のまま問い合わせた」という意味。
     */
    lastTouch: {
      ref: str(body.lastRef, 40),
      channel: str(body.lastChannel, 40),
      utmSource: str(body.lastUtmSource, 80),
      utmMedium: str(body.lastUtmMedium, 80),
      utmCampaign: str(body.lastUtmCampaign, 120),
      at: str(body.lastAt, 40),
    },
    // 営業側の初期ステータス（受け取り側で NEW→CONTACTED→… と更新する前提）
    status: LEAD_STATUSES[0],
  };

  const webhook = process.env.CONTACT_WEBHOOK_URL;

  if (!webhook) {
    if (process.env.NODE_ENV === "production") {
      // 届かないまま「送信できました」と返さない
      console.error(
        "[contact] CONTACT_WEBHOOK_URL is not configured. requestId=",
        requestId
      );
      return reply(
        false,
        503,
        "ただいまフォームからの受付ができません。お手数ですが時間をおいて再度お試しください。"
      );
    }
    // 開発時のみ、個人情報を伏せた要約を出す
    console.log("[contact:dev]", {
      requestId,
      receivedAt: payload.receivedAt,
      name: mask(name),
      email: mask(email),
      hasTel: Boolean(payload.tel),
      messageLength: payload.message.length,
      interests: payload.interests.length,
      // 「どの営業から・どのプランのボタンから来たか」は個人情報ではないので、
      // 開発時の動作確認としてそのまま出す（ここが空なら流入元が切れている）
      ref: payload.source.ref,
      channel: payload.source.channel,
      utmSource: payload.source.utmSource,
      lastRef: payload.lastTouch.ref,
      plan: payload.plan,
    });
    return reply(true, 200);
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    // 失敗理由に本文（個人情報）は含めない
    console.error("[contact] delivery failed. requestId=", requestId);
    return reply(false, 502, "送信に失敗しました。時間をおいて再度お試しください。");
  }

  // 営業側への通知が成功したときだけ、配信サービスへも連携する（既定は無効）
  await syncToMailService({
    requestId: payload.requestId,
    receivedAt: payload.receivedAt,
    name: payload.name,
    email: payload.email,
    company: payload.company,
    status: payload.status,
    plan: payload.plan,
    source: payload.source,
  });

  return reply(true, 200);
}
