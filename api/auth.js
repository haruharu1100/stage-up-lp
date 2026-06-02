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


  // ─── MORIKA新シート 55社追加 ───
  "m201-amano-capital":                  SAMPLE_AUTH,  // 株式会社アマノキャピタル / IT・システム開発
  "m202-am-l":                           SAMPLE_AUTH,  // 株式会社AM-L / 汎用コーポレート
  "m203-amsk":                           SAMPLE_AUTH,  // 株式会社AMSK / 汎用コーポレート
  "m204-american-mkt":                   SAMPLE_AUTH,  // アメリカのマーケティング合同会社 / 広告・マーケティング
  "m205-arakichi":                       SAMPLE_AUTH,  // 株式会社アラキッチ / 飲食業
  "m206-alesdesign":                     SAMPLE_AUTH,  // 株式会社ALESDESIGN / 広告・マーケティング
  "m207-allenia":                        SAMPLE_AUTH,  // 株式会社ALLENIA / 汎用コーポレート
  "m208-aloy":                           SAMPLE_AUTH,  // 株式会社アロイ / 汎用コーポレート
  "m209-encourage":                      SAMPLE_AUTH,  // 株式会社アンクラージュ / 汎用コーポレート
  "m210-uncruise":                       SAMPLE_AUTH,  // 合同会社アンクルーズ / 汎用コーポレート
  "m211-anshin":                         SAMPLE_AUTH,  // 安心株式会社 / 汎用コーポレート
  "m212-ange":                           SAMPLE_AUTH,  // 株式会社Ange / 汎用コーポレート
  "m213-ant-style":                      SAMPLE_AUTH,  // 株式会社ANT style / 汎用コーポレート
  "m214-antrace":                        SAMPLE_AUTH,  // 株式会社アントレース / 汎用コーポレート
  "m215-allier":                         SAMPLE_AUTH,  // 株式会社ALLIER / 汎用コーポレート
  "m216-ariendo":                        SAMPLE_AUTH,  // 株式会社アリエンド / 汎用コーポレート
  "m217-arisawa-zoen":                   SAMPLE_AUTH,  // 株式会社有澤造園土木 / 建設業
  "m218-argrow":                         SAMPLE_AUTH,  // 株式会社アルグロウ / 汎用コーポレート
  "m219-archeon":                        SAMPLE_AUTH,  // ARCHEON株式会社 / 汎用コーポレート
  "m220-ayuto":                          SAMPLE_AUTH,  // 歩人運輸株式会社 / 汎用コーポレート
  "m221-albus":                          SAMPLE_AUTH,  // 株式会社Albus / 汎用コーポレート
  "m222-alba-flowers":                   SAMPLE_AUTH,  // 株式会社アルバフローズ / 美容・サロン
  "m223-andmore":                        SAMPLE_AUTH,  // 株式会社アンドモア / 汎用コーポレート
  "m224-anmavie":                        SAMPLE_AUTH,  // 株式会社ANMAVIE / 汎用コーポレート
  "m225-eskk":                           SAMPLE_AUTH,  // 株式会社ESKK / 汎用コーポレート
  "m226-ex":                             SAMPLE_AUTH,  // 合同会社EX / 汎用コーポレート
  "m227-en":                             SAMPLE_AUTH,  // 株式会社EN / 汎用コーポレート
  "m228-eagle-raise":                    SAMPLE_AUTH,  // 株式会社イーグルレイズ / 汎用コーポレート
  "m229-ec":                             SAMPLE_AUTH,  // 合同会社EC / 小売・EC
  "m230-easter":                         SAMPLE_AUTH,  // 株式会社Easter / IT・システム開発
  "m231-e-style":                        SAMPLE_AUTH,  // 株式会社e-style / IT・システム開発
  "m232-eastnow":                        SAMPLE_AUTH,  // 株式会社イーストノウ / 汎用コーポレート
  "m233-erotackle":                      SAMPLE_AUTH,  // イーロタックル株式会社 / 汎用コーポレート
  "m234-ikigai":                         SAMPLE_AUTH,  // 株式会社IKIGAI / IT・システム開発
  "m235-ikunohouse":                     SAMPLE_AUTH,  // Ikunohouse合同会社 / 汎用コーポレート
  "m236-ikeda-auto":                     SAMPLE_AUTH,  // 池田自動車株式会社 / 汎用コーポレート
  "m237-holdingcompany":                 SAMPLE_AUTH,  // 株式会社130HoldingCompany / 総合サービス業
  "m238-isan-osaka":                     SAMPLE_AUTH,  // 株式会社遺産相続対策大阪パートナー / 不動産業
  "m239-ishida-bldg":                    SAMPLE_AUTH,  // 石田ビル株式会社 / 不動産業
  "m240-ikoro":                          SAMPLE_AUTH,  // 衣心株式会社 / 汎用コーポレート
  "m241-ism":                            SAMPLE_AUTH,  // 株式会社ism / 汎用コーポレート
  "m242-ism-partners":                   SAMPLE_AUTH,  // 株式会社ism partners / 士業・コンサルティング
  "m243-isoda":                          SAMPLE_AUTH,  // 株式会社ISODA建工 / 建設業
  "m244-itadaki":                        SAMPLE_AUTH,  // 合同会社頂 / IT・システム開発
  "m245-ichigo-ichiyo":                  SAMPLE_AUTH,  // 合同会社一期一葉 / 汎用コーポレート
  "m246-ichihara":                       SAMPLE_AUTH,  // 株式会社壱原 / 汎用コーポレート
  "m247-co-032589":                      SAMPLE_AUTH,  // 合同会社1002 / 汎用コーポレート
  "m248-ichiryo":                        SAMPLE_AUTH,  // 株式会社一了 / 汎用コーポレート
  "m249-ichikou":                        SAMPLE_AUTH,  // 株式会社一興 / 汎用コーポレート
  "m250-issei":                          SAMPLE_AUTH,  // 株式会社一成 / 汎用コーポレート
  "m251-ito-photo":                      SAMPLE_AUTH,  // 株式会社いとう写真 / 広告・マーケティング
  "m252-inobeed":                        SAMPLE_AUTH,  // 株式会社イノビード / IT・システム開発
  "m253-inorio":                         SAMPLE_AUTH,  // 株式会社INORIO / 汎用コーポレート
  "m254-event-revolution":               SAMPLE_AUTH,  // 合同会社イベント革命軍 / 汎用コーポレート
  "m255-imu":                            SAMPLE_AUTH,  // 株式会社いむ / 汎用コーポレート


  // ─── MORIKA新シート 56社追加 (256-311) ───
  "m256-aa":                             SAMPLE_AUTH,  // 株式会社AA / 汎用コーポレート
  "m257-ace":                            SAMPLE_AUTH,  // 株式会社ACE / 汎用コーポレート
  "m258-ace-art":                        SAMPLE_AUTH,  // エースアート株式会社 / 汎用コーポレート
  "m259-ace-spo":                        SAMPLE_AUTH,  // 合同会社えーすぽ / 汎用コーポレート
  "m260-abao":                           SAMPLE_AUTH,  // 株式会社ABAO / 汎用コーポレート
  "m261-app":                            SAMPLE_AUTH,  // 株式会社APP / 汎用コーポレート
  "m262-ahome":                          SAMPLE_AUTH,  // 株式会社Ahome総合サービス / 不動産業
  "m263-auv":                            SAMPLE_AUTH,  // AUV合同会社 / 汎用コーポレート
  "m264-hrm-woodworks":                  SAMPLE_AUTH,  // 株式会社HRM woodworks / 汎用コーポレート
  "m265-hm":                             SAMPLE_AUTH,  // HM企画株式会社 / 汎用コーポレート
  "m266-hl-construction":                SAMPLE_AUTH,  // HL Construction株式会社 / 建設業
  "m267-hcc":                            SAMPLE_AUTH,  // 株式会社HCC準備会社 / 汎用コーポレート
  "m268-h2n":                            SAMPLE_AUTH,  // 株式会社H2N / 汎用コーポレート
  "m269-yale-connect":                   SAMPLE_AUTH,  // 株式会社エールコネクト / 小売・EC
  "m270-a-works":                        SAMPLE_AUTH,  // 株式会社A-WORKS / 汎用コーポレート
  "m271-a-1design":                      SAMPLE_AUTH,  // A-1DESIGN合同会社 / 広告・マーケティング
  "m272-eiichido":                       SAMPLE_AUTH,  // 株式会社永一天堂 / 汎用コーポレート
  "m273-eichi":                          SAMPLE_AUTH,  // 叡智株式会社 / 汎用コーポレート
  "m274-equas":                          SAMPLE_AUTH,  // 株式会社Equas / 汎用コーポレート
  "m275-exoplus":                        SAMPLE_AUTH,  // エクソプラス株式会社 / 汎用コーポレート
  "m276-ecvo":                           SAMPLE_AUTH,  // 株式会社ECVO / 小売・EC
  "m277-echoes":                         SAMPLE_AUTH,  // echoes株式会社 / 小売・EC
  "m278-eco-banchou":                    SAMPLE_AUTH,  // 株式会社エコ番長 / 小売・EC
  "m279-hd":                             SAMPLE_AUTH,  // 株式会社HDオリジンスタイル / 汎用コーポレート
  "m280-eitech":                         SAMPLE_AUTH,  // エイテック合同会社 / IT・システム開発
  "m281-eight":                          SAMPLE_AUTH,  // 株式会社エイト / 汎用コーポレート
  "m282-eivn":                           SAMPLE_AUTH,  // 株式会社Eivn / 汎用コーポレート
  "m283-aim":                            SAMPLE_AUTH,  // 株式会社AIM / 汎用コーポレート
  "m284-everen":                         SAMPLE_AUTH,  // 株式会社Everen / 汎用コーポレート
  "m285-egao":                           SAMPLE_AUTH,  // 株式会社笑がお / 汎用コーポレート
  "m286-srm":                            SAMPLE_AUTH,  // 株式会社SRM / 汎用コーポレート
  "m287-srb":                            SAMPLE_AUTH,  // 株式会社SRB / 汎用コーポレート
  "m288-s-t":                            SAMPLE_AUTH,  // S&T株式会社 / 汎用コーポレート
  "m289-s-y":                            SAMPLE_AUTH,  // S&Y株式会社 / 汎用コーポレート
  "m290-esac":                           SAMPLE_AUTH,  // エスエイシー株式会社 / 汎用コーポレート
  "m291-s-h":                            SAMPLE_AUTH,  // 合同会社S.H / 汎用コーポレート
  "m292-sk":                             SAMPLE_AUTH,  // SK株式会社 / 汎用コーポレート
  "m293-skc":                            SAMPLE_AUTH,  // SKC株式会社 / 汎用コーポレート
  "m294-sc":                             SAMPLE_AUTH,  // SC特別目的株式会社 / 汎用コーポレート
  "m295-sc-food":                        SAMPLE_AUTH,  // エスシーフード株式会社 / 汎用コーポレート
  "m296-swbsecurity":                    SAMPLE_AUTH,  // SWBSECURITY株式会社 / IT・システム開発
  "m297-st-cargo":                       SAMPLE_AUTH,  // 株式会社ST.cargo / 汎用コーポレート
  "m298-esnadia":                        SAMPLE_AUTH,  // 株式会社ESNADIA / 汎用コーポレート
  "m299-splus":                          SAMPLE_AUTH,  // 株式会社SPLUS / 汎用コーポレート
  "m300-s-plus":                         SAMPLE_AUTH,  // 株式会社エスプラス / 汎用コーポレート
  "m301-s-property":                     SAMPLE_AUTH,  // 株式会社エスプロパティ / 汎用コーポレート
  "m302-espoir-links":                   SAMPLE_AUTH,  // 株式会社Espoir Links / 汎用コーポレート
  "m303-s-ride":                         SAMPLE_AUTH,  // 株式会社エスライド / 汎用コーポレート
  "m304-srod":                           SAMPLE_AUTH,  // 合同会社SROD / 汎用コーポレート
  "m305-esora":                          SAMPLE_AUTH,  // エソラ合同会社 / 汎用コーポレート
  "m306-eternal":                        SAMPLE_AUTH,  // 株式会社Eternal / 汎用コーポレート
  "m307-any-c":                          SAMPLE_AUTH,  // 株式会社Any C / 汎用コーポレート
  "m308-en":                             SAMPLE_AUTH,  // 株式会社縁 / 汎用コーポレート
  "m309-nrh":                            SAMPLE_AUTH,  // 合同会社エヌ・アール・エイチ / 汎用コーポレート
  "m310-n-n":                            SAMPLE_AUTH,  // N&N株式会社 / 汎用コーポレート
  "m311-n8group":                        SAMPLE_AUTH,  // 株式会社N8GROUP / 汎用コーポレート


  // ─── MORIKA第3弾 57社追加 (312-368) ───
  "m312-nku":                            SAMPLE_AUTH,  // 合同会社NKUホーム / 汎用コーポレート
  "m313-nvg":                            SAMPLE_AUTH,  // 合同会社NVG / 汎用コーポレート
  "m314-effectory":                      SAMPLE_AUTH,  // 株式会社EFFECTORY / 小売・EC
  "m315-m-a":                            SAMPLE_AUTH,  // 合同会社M&Aグループ / 汎用コーポレート
  "m316-mak-works":                      SAMPLE_AUTH,  // 株式会社MaK WORKS / 汎用コーポレート
  "m317-m":                              SAMPLE_AUTH,  // 株式会社エムケイピー / 汎用コーポレート
  "m318-m":                              SAMPLE_AUTH,  // 合同会社エムルーツ / 汎用コーポレート
  "m319-area27":                         SAMPLE_AUTH,  // 合同会社Area27 / 汎用コーポレート
  "m320-lhh":                            SAMPLE_AUTH,  // 株式会社LHH / 汎用コーポレート
  "m321-el-via":                         SAMPLE_AUTH,  // 株式会社EL VIA / 汎用コーポレート
  "m322-enflow":                         SAMPLE_AUTH,  // 株式会社エンフロー / 汎用コーポレート
  "m323-ovit":                           SAMPLE_AUTH,  // 株式会社オーヴィット / IT・システム開発
  "m324-omo":                            SAMPLE_AUTH,  // 合同会社OMO / 汎用コーポレート
  "m325-autumn":                         SAMPLE_AUTH,  // 株式会社オータム / 汎用コーポレート
  "m326-n-modern":                       SAMPLE_AUTH,  // 株式会社N.MODERN / 汎用コーポレート
  "m327-ff":                             SAMPLE_AUTH,  // FFベルキャピタル合同会社 / 資産運用・金融
  "m328-m-h-capital-partners":           SAMPLE_AUTH,  // M&H Capital Partners株式会社 / IT・システム開発
  "m329-m":                              SAMPLE_AUTH,  // 株式会社エムエスコーポレーション / 汎用コーポレート
  "m330-m-style-works":                  SAMPLE_AUTH,  // 株式会社M-STYLE WORKS / 汎用コーポレート
  "m331-mtf":                            SAMPLE_AUTH,  // 株式会社MTF / 汎用コーポレート
  "m332-m":                              SAMPLE_AUTH,  // 株式会社エムテック / 汎用コーポレート
  "m333-myk-plus":                       SAMPLE_AUTH,  // 合同会社MYK-Plus / 汎用コーポレート
  "m334-l":                              SAMPLE_AUTH,  // 合同会社エルアール / 汎用コーポレート
  "m335-l-equus":                        SAMPLE_AUTH,  // 株式会社L-Equus / 汎用コーポレート
  "m336-lc":                             SAMPLE_AUTH,  // 株式会社LC / 汎用コーポレート
  "m337-l":                              SAMPLE_AUTH,  // エルピスアベイロン株式会社 / 汎用コーポレート
  "m338-encurrent":                      SAMPLE_AUTH,  // 株式会社エンカレント / 汎用コーポレート
  "m339-enbridge":                       SAMPLE_AUTH,  // エンブリッジ・ジャパン合同会社 / 総合サービス業
  "m340-n":                              SAMPLE_AUTH,  // Nトラスト株式会社 / 汎用コーポレート
  "m341-n-lab":                          SAMPLE_AUTH,  // 合同会社N-lab / IT・システム開発
  "m342-epiphany":                       SAMPLE_AUTH,  // 株式会社Epiphany / 汎用コーポレート
  "m343-m-k-energy":                     SAMPLE_AUTH,  // 合同会社M&K Energy / 汎用コーポレート
  "m344-m-s":                            SAMPLE_AUTH,  // 株式会社M's / 汎用コーポレート
  "m345-m-t-o":                          SAMPLE_AUTH,  // 株式会社M・T・O / 汎用コーポレート
  "m346-mb":                             SAMPLE_AUTH,  // 株式会社MB管理 / 汎用コーポレート
  "m347-my":                             SAMPLE_AUTH,  // 株式会社MYスマイルコーポレーション / 汎用コーポレート
  "m348-lig":                            SAMPLE_AUTH,  // 株式会社LIG / 汎用コーポレート
  "m349-ls-consulting":                  SAMPLE_AUTH,  // 株式会社LS Consulting / 士業・コンサルティング
  "m350-el":                             SAMPLE_AUTH,  // 株式会社ELシステム / 汎用コーポレート
  "m351-l":                              SAMPLE_AUTH,  // 株式会社エル・フューズ / 汎用コーポレート
  "m352-en-dress":                       SAMPLE_AUTH,  // 株式会社en&dress / 汎用コーポレート
  "m353-enlink":                         SAMPLE_AUTH,  // エンリンク株式会社 / 汎用コーポレート
  "m354-oaks":                           SAMPLE_AUTH,  // 合同会社オークス事務所 / 汎用コーポレート
  "m355-oco":                            SAMPLE_AUTH,  // 株式会社OCO / 汎用コーポレート
  "m356-ndk-union":                      SAMPLE_AUTH,  // NDK Union合同会社 / 汎用コーポレート
  "m357-eno":                            SAMPLE_AUTH,  // 合同会社ENO / 汎用コーポレート
  "m358-f-h-base-resort":                SAMPLE_AUTH,  // F&H BASE RESORT株式会社 / 汎用コーポレート
  "m359-mam":                            SAMPLE_AUTH,  // 合同会社MAM / 汎用コーポレート
  "m360-m":                              SAMPLE_AUTH,  // 株式会社エムズライフ / 汎用コーポレート
  "m361-mt-support":                     SAMPLE_AUTH,  // 合同会社MT support / 汎用コーポレート
  "m362-m-maketh":                       SAMPLE_AUTH,  // 株式会社M-Maketh / 汎用コーポレート
  "m363-l-m-japan":                      SAMPLE_AUTH,  // L&M Japan株式会社 / 総合サービス業
  "m364-ltl":                            SAMPLE_AUTH,  // 株式会社LTL / 汎用コーポレート
  "m365-l":                              SAMPLE_AUTH,  // エルリープ株式会社 / 汎用コーポレート
  "m366-ember-queen":                    SAMPLE_AUTH,  // 株式会社EMBER QUEEN / 汎用コーポレート
  "m367-ora":                            SAMPLE_AUTH,  // ORA合同会社 / 汎用コーポレート
  "m368-ok":                             SAMPLE_AUTH,  // OK合同会社 / 汎用コーポレート

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
