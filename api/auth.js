/**
 * STAGE UP Basic 認証ゲート
 *
 * URL: /admin                  → 営業LP一覧（管理画面）
 *      /1-aireform 他           → 各社別 提案LP（公式サイト風）
 *
 * 認証ロジック：
 *   - 各 slug ごとの user/pass（クライアントに渡す用）
 *   - MASTER（admin）はどのページにもアクセス可能（運営側用）
 *
 * 新規企業追加：
 *   1. ACCOUNTS に { user, pass } を追加
 *   2. _proposals/<slug>.html を作成（業種が判明している場合のみ）
 *   3. push → 自動デプロイ
 *
 * ※ 業種不明の企業は LP 作成保留 → スプレッドシート管理（営業優先度：高（?））
 *    例：愛光合同会社（3-aikou）、株式会社公文（9-kumon）
 */

const fs = require("fs");
const path = require("path");

// 運営マスター（どのページにも入れる管理者）
const MASTER = { user: "admin", pass: "stageup-master-2025" };

// 企業別 LP 共通の Basic 認証情報（全社で統一）
const SAMPLE_AUTH = { user: "sample", pass: "sample1234" };

// 各 slug 別の Basic 認証情報（業種が判明し、LP制作済みの企業のみ登録）
const ACCOUNTS = {
  // 管理画面（運営者専用・専用パスワード）
  "admin":          MASTER,

  // 各社別 提案 LP（業種判明・LP制作済み）
  // ※ 共通の sample / sample1234 を使用。各社個別パスワードは廃止。
  "1-aireform":     SAMPLE_AUTH,  // リフォーム会社
  "4-its":          SAMPLE_AUTH,  // IT会社
  "5-aokikensetsu": SAMPLE_AUTH,  // 工務店・建設

  // ─── LP未作成（業種不明・スプレッドシート管理）───
  //   3-aikou:  愛光合同会社 / 業種不明 / 営業優先度 高（?）
  //   9-kumon:  株式会社公文 / 業種不明 / 営業優先度 高（?）
};

// realm を統一しておくと、admin がマスターでログインしたら
// 同一ホストの他ページへの遷移時にもブラウザがマスター資格を再送する
const REALM = "STAGE UP";

module.exports = (req, res) => {
  const slug = (req.query && req.query.slug) || "";
  const account = ACCOUNTS[slug];

  // 未登録 slug は 404
  if (!account) {
    res.status(404).setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send("Not Found");
    return;
  }

  // ─── Basic 認証ヘッダ検証 ───
  const authHeader = req.headers.authorization || "";
  let authed = false;
  if (authHeader.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
      const idx = decoded.indexOf(":");
      if (idx >= 0) {
        const user = decoded.slice(0, idx);
        const pass = decoded.slice(idx + 1);

        // 1) MASTER は常に通す（運営者・全ページアクセス可）
        if (user === MASTER.user && pass === MASTER.pass) {
          authed = true;
        }
        // 2) admin ページは MASTER のみ。それ以外は slug 別資格も許可
        else if (slug !== "admin") {
          if (user === account.user && pass === account.pass) {
            authed = true;
          }
        }
      }
    } catch (e) {
      authed = false;
    }
  }

  if (!authed) {
    res.setHeader("WWW-Authenticate", `Basic realm="${REALM}"`);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(401).send("Authentication required");
    return;
  }

  // ─── 認証成功 → HTML 配信 ───
  const filePath = path.join(process.cwd(), "_proposals", `${slug}.html`);
  try {
    const html = fs.readFileSync(filePath, "utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).send(html);
  } catch (e) {
    res.status(404).setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(`Page "${slug}" not found in _proposals/`);
  }
};
