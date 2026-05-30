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
  "16-posuten":     SAMPLE_AUTH,  // ポスティング業（株式会社ポスティング角屋）
  "17-postcom":     SAMPLE_AUTH,  // 広告代理店・地域情報誌（ポストコミュニケーション株式会社）
  "20-matsunagajuku": SAMPLE_AUTH, // 学習塾（株式会社松永塾）
  "22-maholab":     SAMPLE_AUTH,  // AI/IoT/データ活用（まほろば創研株式会社）
  "23-manshoudou":  SAMPLE_AUTH,  // 和菓子老舗（合同会社萬勝堂）

  // ─── 汎用コーポレートサイト型 LP（業種不明・新ルール対応）───
  "3-aikou":        SAMPLE_AUTH,  // 愛光合同会社 / 業種不明
  "9-kumon":        SAMPLE_AUTH,  // 株式会社公文 / 業種不明
  "11-fujinexus":   SAMPLE_AUTH,  // フジネクサス株式会社 / 業種不明
  "12-freerun":     SAMPLE_AUTH,  // 株式会社フリーラン / 業種不明
  "13-bright":      SAMPLE_AUTH,  // 有限会社ブライト奈良 / 業種不明
  "14-brairy":      SAMPLE_AUTH,  // ブレイリー合同会社 / 業種不明
  "15-progress":    SAMPLE_AUTH,  // プログレス・インターナショナル / 業種不明
  "18-marble":      SAMPLE_AUTH,  // 合同会社マーブルメイト / 業種不明
  "19-machinomori": SAMPLE_AUTH,  // 株式会社まちのもり / 業種不明
  "24-manyo-hd":    SAMPLE_AUTH,  // MANYOホールディングス / 業種不明（持株会社）
  "26-mirai":       SAMPLE_AUTH,  // 株式会社みらい / 業種不明
  "27-mirai-kokusai": SAMPLE_AUTH,// 株式会社MIRAI KOKUSAI / 業種不明
  "28-minkawa":     SAMPLE_AUTH,  // 株式会社MINKAWA / 新設法人

  // ─── 7社追加（30-36）───
  "30-melos-family":      SAMPLE_AUTH,  // 有限会社メロスファミリー / 業種不明
  "31-moku-hd":           SAMPLE_AUTH,  // 株式会社もくホールディングス / 持株会社
  "32-mot":               SAMPLE_AUTH,  // 株式会社MOT / 業種不明
  "33-morita":            SAMPLE_AUTH,  // 株式会社モリタ / 業種不明
  "34-yamase":            SAMPLE_AUTH,  // 株式会社ヤマセ / 業種不明
  "35-yamatoliving":      SAMPLE_AUTH,  // 株式会社ヤマトリビング / 住宅・不動産（専門）
  "36-yumi-construction": SAMPLE_AUTH,  // 株式会社優美総合建設 / 総合建設業（専門）

  // ─── 10社追加（37-46）───
  "37-union":         SAMPLE_AUTH,  // 株式会社ユニオン / 法人サービス（ネイビー×白）
  "38-yura":          SAMPLE_AUTH,  // 合同会社YURA / 業種不明・汎用（ベージュ×白）
  "39-yoshino":       SAMPLE_AUTH,  // 有限会社吉野 / 地域密着老舗（深緑×アイボリー）
  "40-like":          SAMPLE_AUTH,  // 株式会社ライク / IT（ブルー×白）
  "41-rise-corp":     SAMPLE_AUTH,  // 株式会社RISE CORPORATION / 法人コンサル（ブラック×ゴールド）
  "42-lighthouse":    SAMPLE_AUTH,  // 株式会社ライトハウス / コンサル（白×ライトブルー）
  "43-life-koubou":   SAMPLE_AUTH,  // 株式会社らいふ工房 / リフォーム工房（木目×ベージュ）
  "44-rio":           SAMPLE_AUTH,  // 合同会社RIO / 汎用（グレー×ネイビー）
  "45-rits-k-base":   SAMPLE_AUTH,  // 合同会社リッツケイベース / ベンチャー支援（白×ダークグリーン）
  "46-little-blue":   SAMPLE_AUTH,  // 合同会社リトル・ブルー / クリエイティブ（ブルーグラデ）

  // ─── 5社追加（47-51）───
  "47-remix-lab":     SAMPLE_AUTH,  // 株式会社ReMIX LAB / IT・研究開発（白×ブルー×グレー）
  "48-ryuhou":        SAMPLE_AUTH,  // 株式会社龍鳳 / 地域密着・和風老舗（赤茶×黒×白）
  "49-lumina":        SAMPLE_AUTH,  // 合同会社Lumina / 美容・ライフスタイル（白×ベージュ×淡ゴールド）
  "50-ynsystems":     SAMPLE_AUTH,  // 合同会社YNSystems / IT・SaaS（白×ネイビー×シアン）
  "51-wasabilab":     SAMPLE_AUTH,  // 株式会社ワサビラボ / クリエイティブ（白×グリーン×ブラック）

  // ─── 大阪府 27社追加（52-88・3年以内フィルタ通過分）───
  // ※ 52, 54, 56, 57, 64, 65, 67, 69, 75, 83 は3年フィルタ除外
  "53-arc-trust":     SAMPLE_AUTH,  // 株式会社ARC TRUST / 業種不明（汎用）
  "55-aasha-trading": SAMPLE_AUTH,  // Aasha Trading株式会社 / 業種不明（汎用）
  "58-r-co":          SAMPLE_AUTH,  // R.株式会社 / 業種不明（汎用）
  "59-rra":           SAMPLE_AUTH,  // 株式会社RRA / 業種不明（汎用）
  "60-r-asset":       SAMPLE_AUTH,  // R Asset合同会社 / 業種不明（汎用）
  "61-iwall":         SAMPLE_AUTH,  // 株式会社Iwall / 業種不明（汎用）
  "62-isf":           SAMPLE_AUTH,  // 株式会社ISF / 業種不明（汎用）
  "63-in-co":         SAMPLE_AUTH,  // 株式会社in / 業種不明（汎用）
  "66-ims":           SAMPLE_AUTH,  // IMS合同会社 / 業種不明（汎用）
  "68-iqt":           SAMPLE_AUTH,  // iQT株式会社 / 業種不明（汎用）
  "70-rd-intl":       SAMPLE_AUTH,  // 株式会社R&D International Holdings / 業種不明（汎用）
  "71-rea-japan":     SAMPLE_AUTH,  // REA Japan合同会社 / 業種不明（汎用）
  "72-rms":           SAMPLE_AUTH,  // 株式会社RMS / 業種不明（汎用）
  "73-ror":           SAMPLE_AUTH,  // 合同会社ROR / 業種不明（汎用）
  "74-r-crest-link":  SAMPLE_AUTH,  // 株式会社R Crest Link / 業種不明（汎用）
  "76-r-dining-plus": SAMPLE_AUTH,  // 合同会社R Dining Plus / 業種不明（汎用）
  "77-rtr-four":      SAMPLE_AUTH,  // 株式会社RTRFour / 業種不明（汎用）
  "78-r-denki":       SAMPLE_AUTH,  // アール電気工事株式会社 / 電気工事業
  "79-r-mode":        SAMPLE_AUTH,  // 株式会社アールモード / 業種不明（汎用）
  "80-ic":            SAMPLE_AUTH,  // 株式会社IC / 業種不明（汎用）
  "81-aisia":         SAMPLE_AUTH,  // Aisia合同会社 / 業種不明（汎用）
  "82-aysh":          SAMPLE_AUTH,  // 株式会社aysh / 業種不明（汎用）
  "84-aiz":           SAMPLE_AUTH,  // AIZ合同会社 / 業種不明（汎用）
  "85-aite":          SAMPLE_AUTH,  // 株式会社AITE / 業種不明（汎用）
  "86-ito":           SAMPLE_AUTH,  // 合同会社ito / 業種不明（汎用）
  "87-itex":          SAMPLE_AUTH,  // 株式会社Itex / 業種不明（近大KINCUBA入居）
  "88-ainekea":       SAMPLE_AUTH,  // 合同会社アイネケア / 業種不明（汎用）

  // ─── 大阪府 62社追加（89-184・3年以内フィルタ通過分）───
  // ※ 95,96,97,99,107,110,111,112,117,118,127,128,133,139,140,141,148,153,155,161,163,164,165,168,170,171,173,175,177,178,179,181,182,184 は3年フィルタ除外
  "89-aino-studio":       SAMPLE_AUTH,
  "90-ai-no-memo":        SAMPLE_AUTH,
  "91-i-be":              SAMPLE_AUTH,
  "92-aibii":             SAMPLE_AUTH,
  "93-ip":                SAMPLE_AUTH,
  "94-ipc":               SAMPLE_AUTH,
  "98-islandbase":        SAMPLE_AUTH,
  "100-ai-link":          SAMPLE_AUTH,
  "101-avanzare":         SAMPLE_AUTH,
  "102-avince":           SAMPLE_AUTH,
  "103-avera":            SAMPLE_AUTH,
  "104-aura":             SAMPLE_AUTH,
  "105-aurion-val-tesh":  SAMPLE_AUTH,
  "106-owlarc":           SAMPLE_AUTH,
  "108-aoisora-sky":      SAMPLE_AUTH,
  "109-aohara-create":    SAMPLE_AUTH,
  "113-akatsuki":         SAMPLE_AUTH,
  "114-akatsuki-estate":  SAMPLE_AUTH,
  "115-akari-ltd":        SAMPLE_AUTH,
  "116-agare":            SAMPLE_AUTH,
  "119-agin":             SAMPLE_AUTH,
  "120-akua":             SAMPLE_AUTH,
  "121-aqua-japan":       SAMPLE_AUTH,
  "122-aquas-marketing":  SAMPLE_AUTH,
  "123-aqua-resort":      SAMPLE_AUTH,
  "124-axia-amami":       SAMPLE_AUTH,
  "125-axis-time":        SAMPLE_AUTH,
  "126-axel":             SAMPLE_AUTH,
  "129-again":            SAMPLE_AUTH,
  "130-asahi-shoji":      SAMPLE_AUTH,
  "131-asahi-pharmacy":   SAMPLE_AUTH,  // 薬局・薬剤師
  "132-asahi-pm":         SAMPLE_AUTH,  // プロパティマネジメント（不動産）
  "134-azalea":           SAMPLE_AUTH,
  "135-asia-nougyou":     SAMPLE_AUTH,  // 一般社団法人（亜洲農産業連合促進会）
  "136-astreva":          SAMPLE_AUTH,
  "137-az":               SAMPLE_AUTH,
  "138-assets-care-hd":   SAMPLE_AUTH,  // 持株会社（Assets Care HD）
  "142-asoto-hotel":      SAMPLE_AUTH,
  "143-asoviva":          SAMPLE_AUTH,
  "144-adaxis-japan":     SAMPLE_AUTH,  // 在日フランス商工会議所内
  "145-adachi-asset":     SAMPLE_AUTH,  // アセットマネジメント
  "146-adan":             SAMPLE_AUTH,
  "147-atsukei":          SAMPLE_AUTH,
  "149-at-end":           SAMPLE_AUTH,
  "150-atbat":            SAMPLE_AUTH,
  "151-upper-home":       SAMPLE_AUTH,
  "152-upwell":           SAMPLE_AUTH,
  "154-up-lift":          SAMPLE_AUTH,
  "156-attend":           SAMPLE_AUTH,
  "157-atom-estate":      SAMPLE_AUTH,  // 不動産系
  "158-atria":            SAMPLE_AUTH,
  "159-atelier-kura":     SAMPLE_AUTH,
  "160-atelier-fusion":   SAMPLE_AUTH,
  "162-atre-osaka":       SAMPLE_AUTH,
  "166-adsapo":           SAMPLE_AUTH,
  "167-advantis":         SAMPLE_AUTH,
  "169-another-story":    SAMPLE_AUTH,
  "172-animanode":        SAMPLE_AUTH,
  "174-anela":            SAMPLE_AUTH,
  "176-avante":           SAMPLE_AUTH,
  "180-afritx":           SAMPLE_AUTH,
  "183-apua":             SAMPLE_AUTH,

  // ─── LP作成しない（NPO・宗教・半公的団体）───
  //   10-farm:            ファーム弁天 / 農業（半公的） / 低
  //   21-mahoroba-coop:   まほろば協同組合 / 協同組合 / 低
  //   25-mitsuhanoki:     みつはのきNPO / NPO / 低
  //   29-munakata:        宗像神社大頭屋講 / 宗教 / 低
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
