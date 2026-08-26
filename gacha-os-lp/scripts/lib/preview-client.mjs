/**
 * 公開先（Preview）を、ネット越しに1人ぶん触る道具。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、ここに切り出したのか
 * ═══════════════════════════════════════════════════════
 *
 *   公開先を実際に叩いて確かめる道具は、これから増えます。
 *   そのどれもが「クッキーを持ち回る」「ログインする」
 *   「認証アプリの6桁を作る」を必要とします。
 *
 *   これを道具ごとに書き写すと、入り方が変わった日に、
 *   直し忘れた道具から順に落ちます。
 *   しかも落ち方が「押しても出ない」なので、
 *   受け取った人には何のことか分かりません（2026-08-26 に実際に起きました）。
 *
 *   ★入り方の知識を、これ以上ばらまかないこと。
 *
 * ═══════════════════════════════════════════════════════
 * ★合言葉を、ここに書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   パスワードも、認証アプリの鍵も、この中に直接書きません。
 *   呼ぶ側から渡します。書いた瞬間にGitの履歴へ残り、
 *   あとから消しても履歴からは消えません。
 */

import { createHmac } from "node:crypto";

/* 認証アプリの文字（0・1・8・9 は入りません。見間違えるためです） */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * その30秒に出るはずの6桁。
 * ★lib/server/mfa.ts と同じ計算にすること。
 *   ずれると「合っているのに通らない」になり、原因が分かりません。
 */
export function totp(secret, counter) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const c of String(secret).toUpperCase().replace(/=+$/, "")) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac("sha1", Buffer.from(bytes)).update(buf).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[off] & 0x7f) << 24) |
    ((mac[off + 1] & 0xff) << 16) |
    ((mac[off + 2] & 0xff) << 8) |
    (mac[off + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

/**
 * そのメールの担当者が認証アプリを登録していれば、いまの6桁を返す。
 * 登録していなければ null（お客様はここに来ます）。
 *
 * @param db lib/server/db.ts の db 関数
 */
export async function mfaCodeFor(db, email) {
  try {
    const r = await db().execute({
      sql: `SELECT mfa_secret, mfa_enabled FROM app_users WHERE email = ? LIMIT 1`,
      args: [email],
    });
    const row = r.rows[0];
    if (!row || Number(row.mfa_enabled ?? 0) !== 1 || !row.mfa_secret) return null;
    return totp(row.mfa_secret, Math.floor(Date.now() / 1000 / 30));
  } catch {
    return null;
  }
}

/**
 * 「1人ぶん」を作る道具を返す。
 *
 * @param base     公開先の URL（末尾のスラッシュは付けない）
 * @param password ログインに使う合言葉
 * @param db       lib/server/db.ts の db 関数（6桁を作るために使う）
 */
export function makePreviewClient({ base, password, db }) {
  return class Hito {
    constructor(label) {
      this.label = label;
      this.jar = new Map();
      this.vids = new Set();
    }

    cookie() {
      return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    }

    async call(path, method = "GET", body, extraHeaders = {}) {
      const headers = { "content-type": "application/json", ...extraHeaders };
      const c = this.cookie();
      if (c) headers.cookie = c;
      const csrf = this.jar.get("gos_csrf");
      if (csrf) headers["x-gos-csrf"] = csrf;

      /**
       * ★必ず、待つ時間の上限を決めること（2026-08-26 に一度これで止まりました）。
       *
       *   上限を決めずに待つと、相手が黙ったときに、
       *   点検そのものが、いつまでも終わらなくなります。
       *   しかも「失敗」ではなく「無言」です。画面には何も出ません。
       *   動いているのか死んでいるのか分かりません。
       *
       *   ★止まったら、止まったと分かるようにすること。
       */
      const MACHI = Number(process.env.AUDIT_TIMEOUT_MS ?? 30_000);
      let res = null;
      let saigo = null;
      for (let kai = 0; kai < 3; kai++) {
        try {
          res = await fetch(`${base}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            redirect: "manual",
            signal: AbortSignal.timeout(MACHI),
          });
          break;
        } catch (e) {
          saigo = e;
          /* 二重実行の鍵を使う書き込みは、やり直しても増えません（鍵で守られています） */
          await new Promise((r) => setTimeout(r, 400 * (kai + 1)));
        }
      }
      if (res === null) {
        throw new Error(
          `${method} ${path} が ${MACHI / 1000}秒×3回 返事をしませんでした` +
            `（${saigo instanceof Error ? saigo.message : String(saigo)}）`,
        );
      }

      for (const line of res.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(";");
        const i = pair.indexOf("=");
        if (i > 0) {
          const k = pair.slice(0, i).trim();
          const v = pair.slice(i + 1).trim();
          if (v === "" || /Max-Age=0/i.test(line)) this.jar.delete(k);
          else this.jar.set(k, v);
        }
      }

      const vid = res.headers.get("x-vercel-id") ?? "";
      const inst = vid.split("::").pop()?.split("-")[0] ?? "";
      if (inst) this.vids.add(inst);

      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* HTML が返ることもある（画面そのもの） */
      }
      return { status: res.status, json, text, vid, headers: res.headers };
    }

    /**
     * ログインする。
     *
     * ★認証アプリを登録している担当者は、ログインにも6桁が要ります。
     *   登録していない担当者に6桁を送っても、無視されるだけです。
     *   ですから、作れるときは黙って添えます。
     *
     *   これをしないと、担当者が認証アプリを登録した瞬間に
     *   点検そのものが動かなくなります（実際に一度なりました）。
     */
    async login(kind, tenantCode, email) {
      const code = await mfaCodeFor(db, email);
      const okuru = (mfaCode) =>
        this.call("/api/auth/login", "POST", {
          kind,
          tenantCode,
          email,
          password,
          ...(mfaCode ? { mfaCode } : {}),
        });

      let r = await okuru(code);

      /**
       * ★同じ6桁は、二度使えません。次の30秒を待ってやり直します。
       *
       *   認証アプリの6桁は、一度使うと同じ30秒のあいだ二度と通りません
       *   （lib/server/auth.ts の mfa_last_counter）。
       *   これは、盗み見た6桁で入られないための、正しい作りです。
       *
       *   ところが点検の道具は、同じ担当者で続けて2回入ることがあります。
       *   すると2回目だけが 401 で落ち、画面には
       *   「ログインできません」としか出ません。
       *   受け取った人には、鍵が壊れたのか、点検の都合なのか分かりません。
       *
       *   ★ここで「6桁を送らない」で逃げないこと。
       *     送らなければ通ってしまうなら、それは鍵が効いていない証拠です。
       *     待って、新しい6桁でやり直します。
       *
       *   ★やり直しは1回だけにすること。
       *     間違った6桁を何度も送ると、その担当者は
       *     本当に締め出されます（連続失敗で鍵がかかります）。
       */
      if (code && r.status !== 200 && r.json?.code === "MFA_INVALID") {
        const ima = Math.floor(Date.now() / 1000 / 30);
        const tsugi = (ima + 1) * 30 * 1000 + 1200;
        await new Promise((res) => setTimeout(res, Math.max(0, tsugi - Date.now())));
        const atarashii = await mfaCodeFor(db, email);
        r = await okuru(atarashii);
      }

      return r;
    }
  };
}
