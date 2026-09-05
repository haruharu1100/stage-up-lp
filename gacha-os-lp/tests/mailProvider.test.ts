/**
 * メールの送り口の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が守っているたった1つのこと
 * ═══════════════════════════════════════════════════════
 *
 *   「送信しました」と表示して、実際には送られていない。
 *   これを、コードの上で起こせなくします。
 *
 *   ですので、いちばん大事なのは 3番目の試験です。
 *   本番の設定で、送り口が確認用（Mock）のままのとき、
 *   deliver が例外を投げること。
 *   ここが通らなくなったら、それは
 *   「本番でメールが1通も届かないのに、画面には成功と出る」
 *   ということです。
 *
 * ★この試験は、外へ1通も送りません。
 *   本物の送り口は、通信の直前で例外になる形だけを確かめます。
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { buildPayload, HttpMailProvider, readHttpMailConfig } from "../lib/server/mail/http";
import {
  deliver,
  isProductionEnv,
  mailReadiness,
  makeMailProvider,
} from "../lib/server/mail";
import { MockMailProvider } from "../lib/server/mail/mock";
import { MailNotConfiguredError } from "../lib/server/mail/types";

/** 環境変数を、試験のあいだだけ差し替える */
const KEYS = [
  "DATABASE_ENV",
  "VERCEL_ENV",
  "MAIL_PROVIDER",
  "MAIL_API_URL",
  "MAIL_API_KEY",
  "MAIL_FROM",
  "MAIL_API_FORMAT",
  "MAIL_TIMEOUT_MS",
] as const;

const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

function setEnv(patch: Record<string, string | undefined>) {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) process.env[k] = v;
  }
}

after(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

/** 本物の送り口の設定一式（★本物の鍵ではありません） */
const REAL_ENV = {
  MAIL_PROVIDER: "http",
  MAIL_API_URL: "https://example.invalid/send",
  MAIL_API_KEY: "test-key-not-real",
  MAIL_FROM: "テスト店 <no-reply@example.invalid>",
  MAIL_API_FORMAT: "generic",
};

const SAMPLE = {
  kind: "PASSWORD_RESET" as const,
  to: "customer@example.invalid",
  subject: "パスワードの再設定",
  body: "  /reset-password?token=xxxx\n",
};

describe("メールの送り口（Mock / Real の切り替え）", () => {
  it("①既定は確認用。外へは出さず、SENT とも言わない", async () => {
    setEnv({ DATABASE_ENV: "test" });

    const p = makeMailProvider(process.env);
    assert.equal(p.kind, "MOCK");
    assert.equal(p.name, "MOCK");

    const d = await deliver(SAMPLE);
    assert.equal(
      d.via,
      "LOG",
      "確認用なのに SENT と言っています。外へ出していないのに送ったことになります。",
    );
    assert.equal(d.provider, "MOCK");
    assert.equal(d.ref, null);
  });

  it("②確認用の送り口は、戻り値に本文を入れない", async () => {
    setEnv({ DATABASE_ENV: "development" });
    const d = (await new MockMailProvider().send(SAMPLE)) as Record<
      string,
      unknown
    >;
    const dumped = JSON.stringify(d);
    assert.ok(
      !dumped.includes("reset-password"),
      "戻り値に本文が入っています。呼び出し側が画面へ出せてしまいます。",
    );
    assert.ok(!dumped.includes("token"), "戻り値に合言葉が入っています。");
  });

  it("★③本番で確認用のままなら、はっきり止まる（成功を返さない）", async () => {
    setEnv({ DATABASE_ENV: "production" });

    const r = mailReadiness(process.env);
    assert.equal(r.production, true);
    assert.equal(r.canSend, false);
    assert.equal(r.blocking, true, "本番で Mock なのに、公開を止めていません。");
    assert.equal(r.code, "MAIL_PROVIDER_IS_MOCK_IN_PRODUCTION");

    await assert.rejects(
      () => deliver(SAMPLE),
      (e: unknown) => {
        assert.ok(
          e instanceof MailNotConfiguredError,
          "本番で Mock のまま、例外にせず進みました。届かないメールを送ったことにしています。",
        );
        return true;
      },
    );
  });

  it("④本番で VERCEL_ENV だけが production でも、同じように止まる", async () => {
    setEnv({ DATABASE_ENV: "preview", VERCEL_ENV: "production" });
    assert.equal(isProductionEnv(process.env), true);
    assert.equal(mailReadiness(process.env).blocking, true);
  });

  it("⑤本物を選んでいるのに設定が無いときは、本番でなくても止まる", async () => {
    setEnv({ DATABASE_ENV: "development", MAIL_PROVIDER: "http" });

    const r = mailReadiness(process.env);
    assert.equal(r.canSend, false);
    assert.equal(r.code, "MAIL_CONFIG_MISSING");
    assert.ok(r.missing.includes("MAIL_API_URL"));
    assert.ok(r.missing.includes("MAIL_API_KEY"));
    assert.ok(r.missing.includes("MAIL_FROM"));

    await assert.rejects(() => deliver(SAMPLE), MailNotConfiguredError);
  });

  it("⑥本番で本物の設定がそろっていれば、公開を止めない", () => {
    setEnv({ DATABASE_ENV: "production", ...REAL_ENV });
    const r = mailReadiness(process.env);
    assert.equal(r.kind, "REAL");
    assert.equal(r.canSend, true);
    assert.equal(r.blocking, false);
    assert.equal(r.missing.length, 0);
  });

  it("⑦https でない送信先は、受け付けない", () => {
    setEnv({ DATABASE_ENV: "production", ...REAL_ENV, MAIL_API_URL: "http://example.invalid/send" });
    const r = mailReadiness(process.env);
    assert.equal(r.canSend, false);
    assert.equal(r.code, "MAIL_CONFIG_INVALID");
    assert.equal(r.blocking, true, "鍵が経路上を流れる設定なのに、公開を止めていません。");
  });

  it("⑧知らない形式の指定は、黙って受け取らない", () => {
    setEnv({ DATABASE_ENV: "production", ...REAL_ENV, MAIL_API_FORMAT: "unknown-service" });
    const r = mailReadiness(process.env);
    assert.equal(r.canSend, false);
    assert.equal(r.code, "MAIL_CONFIG_INVALID");
  });

  it("⑨差出人がメールアドレスの形でなければ、受け取らない", () => {
    setEnv({ DATABASE_ENV: "production", ...REAL_ENV, MAIL_FROM: "テスト店" });
    const r = mailReadiness(process.env);
    assert.equal(r.canSend, false);
    assert.equal(r.code, "MAIL_CONFIG_INVALID");
  });

  it("⑩配信会社へ渡す形に、本文と宛先が正しく入っている", () => {
    setEnv({ DATABASE_ENV: "development", ...REAL_ENV, MAIL_API_FORMAT: "resend" });
    const { config } = readHttpMailConfig(process.env);
    assert.ok(config, "設定が読めていません。");

    const payload = buildPayload(config!, SAMPLE) as Record<string, unknown>;
    assert.deepEqual(payload.to, [SAMPLE.to]);
    assert.equal(payload.subject, SAMPLE.subject);
    assert.equal(payload.text, SAMPLE.body);
    assert.equal(payload.from, REAL_ENV.MAIL_FROM);
  });

  it("⑪待ち時間の上限は、必ず入っている（画面が固まらないため）", () => {
    setEnv({ DATABASE_ENV: "development", ...REAL_ENV });
    const { config } = readHttpMailConfig(process.env);
    assert.ok(config);
    assert.ok(config!.timeoutMs >= 1000 && config!.timeoutMs <= 60_000);
  });

  it("⑫つながらなかったときは「送れていない」と言い切る", async () => {
    setEnv({ DATABASE_ENV: "development", ...REAL_ENV });

    /* 通信そのものを差し替えて、つながらない状況を作る */
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    try {
      await assert.rejects(
        () => new HttpMailProvider(process.env).send(SAMPLE),
        (e: unknown) => {
          const m = String((e as Error).message ?? "");
          assert.ok(
            m.includes("送られていません"),
            `失敗の説明が曖昧です：${m}`,
          );
          assert.ok(
            !m.includes("たぶん") && !m.includes("かもしれません"),
            "「たぶん送れました」と読める文になっています。",
          );
          return true;
        },
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("⑬配信会社が受け取らなかったときも、成功にしない", async () => {
    setEnv({ DATABASE_ENV: "development", ...REAL_ENV });

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("forbidden", { status: 403 })) as typeof fetch;

    try {
      await assert.rejects(
        () => new HttpMailProvider(process.env).send(SAMPLE),
        (e: unknown) => {
          const m = String((e as Error).message ?? "");
          assert.ok(m.includes("403"), `状態番号が残っていません：${m}`);
          assert.ok(m.includes("送られていません"));
          return true;
        },
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("⑭受け取ってもらえたときだけ SENT と言う", async () => {
    setEnv({ DATABASE_ENV: "development", ...REAL_ENV });

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "msg_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    try {
      const d = await new HttpMailProvider(process.env).send(SAMPLE);
      assert.equal(d.via, "SENT");
      assert.equal(d.ref, "msg_123");
      assert.equal(d.provider, "HTTP:generic");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
