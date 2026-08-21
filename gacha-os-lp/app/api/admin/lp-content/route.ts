import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  lpDiff,
  sanitizeValues,
  type LpStore,
  type LpHistoryEntry,
} from "@/lib/lpText";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * LP CONTENT EDITOR の保存先。
 *
 * ★ここで扱ってよいのは「文章・改行・表示するかしないか」だけです。
 *   金額・還元率・バックテスト・セキュリティ・APIの設定は、
 *   lib/lpText.ts の一覧に載せていないので、ここを通っても保存されません
 *   （sanitizeValues が一覧に無い項目を捨てます）。
 *
 * ★合言葉について
 *   ADMIN_KEY を設定すると、その合言葉を知っている人しか開けません。
 *   未設定のときは、開発中（localhost）だけ開けます。
 *   本番で未設定のまま置いておくと誰でも文章を書き換えられてしまうため、
 *   本番かつ未設定なら、読み書きの両方を断ります。
 */

const FILE = path.join(process.cwd(), "content", "lp-content.json");
const EMPTY: LpStore = { draft: {}, published: {}, history: [] };
/** 履歴は増え続けるので上限を決める。古いものから消す */
const HISTORY_MAX = 50;

function authError(req: Request): string | null {
  const key = process.env.ADMIN_KEY ?? "";
  const given =
    req.headers.get("x-admin-key") ??
    new URL(req.url).searchParams.get("key") ??
    "";
  if (key) return given === key ? null : "合言葉が違います。";
  if (process.env.NODE_ENV === "production") {
    return "ADMIN_KEY が設定されていないため、この画面は使えません。";
  }
  return null;
}

async function read(): Promise<LpStore> {
  try {
    const raw = await readFile(FILE, "utf8");
    const j = JSON.parse(raw) as Partial<LpStore>;
    return {
      draft: j.draft ?? {},
      published: j.published ?? {},
      history: j.history ?? [],
    };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * 書き込み。
 * Vercel のような読み取り専用の場所では失敗するので、
 * 「なぜ保存できないか」と「どうすればよいか」を日本語で返します。
 */
async function write(store: LpStore): Promise<string | null> {
  try {
    await writeFile(FILE, JSON.stringify(store, null, 2) + "\n", "utf8");
    return null;
  } catch {
    return "この場所ではファイルを保存できません（読み取り専用のサーバーです）。画面右上の［変更内容を書き出す］でファイルをダウンロードし、開発担当へ渡してください。";
  }
}

/** 公開したあと、置き換え先へ「作り直して」と伝える（設定されていれば） */
async function triggerDeploy(): Promise<string | null> {
  const url = process.env.DEPLOY_HOOK_URL;
  if (!url) return null;
  try {
    const r = await fetch(url, { method: "POST" });
    return r.ok ? "公開処理を開始しました。反映まで数分かかります。" : null;
  } catch {
    return null;
  }
}

function push(store: LpStore, entry: LpHistoryEntry) {
  store.history.unshift(entry);
  store.history = store.history.slice(0, HISTORY_MAX);
}

/* ── 読み出し ── */
export async function GET(req: Request) {
  const err = authError(req);
  if (err) return NextResponse.json({ error: err }, { status: 401 });
  const store = await read();
  return NextResponse.json(store);
}

/* ── 下書き保存 / 公開 / 元に戻す ── */
export async function POST(req: Request) {
  const err = authError(req);
  if (err) return NextResponse.json({ error: err }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "内容を読み取れませんでした。" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  const by = String(body.by ?? "").slice(0, 40) || "名前なし";
  const store = await read();

  if (action === "draft") {
    const next = sanitizeValues(body.values);
    const changed = lpDiff(store.draft, next);
    store.draft = next;
    push(store, {
      at: new Date().toISOString(),
      by,
      action: "draft",
      changed,
      snapshot: next,
    });
    const w = await write(store);
    if (w) return NextResponse.json({ error: w, store }, { status: 503 });
    return NextResponse.json({ ok: true, message: "下書きを保存しました。", store });
  }

  if (action === "publish") {
    const next = sanitizeValues(body.values ?? store.draft);
    const changed = lpDiff(store.published, next);
    if (changed.length === 0) {
      return NextResponse.json({ ok: true, message: "公開中の内容と同じでした。", store });
    }
    store.draft = next;
    store.published = next;
    push(store, {
      at: new Date().toISOString(),
      by,
      action: "publish",
      changed,
      snapshot: next,
    });
    const w = await write(store);
    if (w) return NextResponse.json({ error: w, store }, { status: 503 });
    const deploy = await triggerDeploy();
    return NextResponse.json({
      ok: true,
      message:
        deploy ??
        `${changed.length}件を公開しました。実際のページに出るのは、次にサイトを作り直したときです。`,
      store,
    });
  }

  if (action === "revert") {
    const at = String(body.at ?? "");
    const entry = store.history.find((h) => h.at === at);
    if (!entry) {
      return NextResponse.json({ error: "その記録が見つかりません。" }, { status: 404 });
    }
    const next = sanitizeValues(entry.snapshot);
    store.draft = next;
    push(store, {
      at: new Date().toISOString(),
      by,
      action: "revert",
      changed: lpDiff(store.draft, next),
      snapshot: next,
    });
    const w = await write(store);
    if (w) return NextResponse.json({ error: w, store }, { status: 503 });
    return NextResponse.json({
      ok: true,
      message: "その時点の内容を下書きに戻しました。内容を確かめてから公開してください。",
      store,
    });
  }

  return NextResponse.json({ error: "知らない操作です。" }, { status: 400 });
}
