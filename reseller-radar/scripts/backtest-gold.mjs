// =====================================================================
// 第3フェーズ バックテスト用 GOLD LABEL データセット（正解付き）
// ---------------------------------------------------------------------
// 【データの出所・重要】
//  ・これは「ライブ取得した実Amazonデータ」ではない。SP-API/Keepaへの
//    追加通信は禁止されているため、実在ブランド・実在する型番体系・実際の
//    タイトル揺れ（ノイズ）を反映して人手で構成した正解付きコーパスである。
//  ・各ケースの expect（同一商品か否か）は推測ではなく「作問者が根拠を持って
//    定義した正解」。なぜ同一/別商品かを evidence に必ず残している。
//  ・分からないものは無理に true/false にせず expect:"unknown" を許可。
//  ・diff_dim は expect:false のとき「どの次元が違うか」を記録（誤判定原因の
//    集計に使う。engineの出力からではなく正解側から与える）。
//  ・最終的な「実用化できる精度か」は、第4フェーズで実Keepaレスポンスを
//    数件監査してから確定する。本コーパスは照合ロジックの精度測定用。
// ---------------------------------------------------------------------
// フィールド:
//   id, genre
//   supplier   … 仕入れ元タイトル
//   sjan       … 仕入れ元JAN（無ければ null。null のときは型番/名前照合パス）
//   smodel     … 仕入れ元の「明示された型番欄」（構造化。無ければ null＝タイトルのみ）
//   amazon     … Amazon側タイトル
//   codes      … Amazon/Keepa候補が公開する識別子一覧(eanList/upcList相当)。
//                sjan があるとき JAN照合に使う。空 [] は「識別子が取れない(不明)」。
//   amodel     … Amazon側の明示型番欄（無ければ null）
//   expect     … true=同一商品 / false=別商品 / "unknown"=判定不能
//   diff_dim   … expect:false のときの相違次元
//   reason     … ラベル理由（短く）
//   evidence   … 同一/別の根拠（短く）
// =====================================================================

function mk(o) {
  return {
    id: o.id,
    genre: o.genre,
    supplier: o.supplier,
    sjan: o.sjan ?? null,
    smodel: o.smodel ?? null,
    amazon: o.amazon,
    codes: o.codes ?? [],
    amodel: o.amodel ?? null,
    expect: o.expect,
    diff_dim: o.diff_dim ?? null,
    reason: o.reason ?? "",
    evidence: o.evidence ?? "",
  };
}

// JAN文字列（合成・13桁）。関係性(一致/不一致)の検証が目的。
const J = (n) => String(n);

export const GOLD = [
  // ============ SSD / SDカード（18） ============
  mk({ id: "sd001", genre: "SDカード", supplier: "SanDisk Extreme microSDXC 256GB UHS-I U3 V30 A2 R:190MB/s SDSQXAV-256G-GN6MN", smodel: "SDSQXAV-256G-GN6MN", amazon: "サンディスク Extreme microSDXC 256GB SDSQXAV-256G-GN6MN 190MB/s A2 V30 U3", amodel: "SDSQXAV-256G-GN6MN", expect: true, reason: "同一型番の明示一致", evidence: "型番SDSQXAV-256G-GN6MNが両側で完全一致" }),
  mk({ id: "sd002", genre: "SDカード", supplier: "SanDisk Extreme microSDXC 256GB R:190MB/s U3 V30 A2 Class10", amazon: "SanDisk Extreme PRO microSDXC 256GB R:200MB/s U3 V30 A2", expect: false, diff_dim: "series", reason: "Extreme と Extreme PRO は別系列", evidence: "無印ExtremeとExtreme PROは別商品(速度190/200・型番体系も別)" }),
  mk({ id: "sd003", genre: "SDカード", supplier: "サンディスク microSDカード 128GB Extreme SDSQXAV-128G", smodel: "SDSQXAV-128G", amazon: "SanDisk Extreme microSDXC 256GB SDSQXAV-256G", amodel: "SDSQXAV-256G", expect: false, diff_dim: "capacity", reason: "容量違い(128GB vs 256GB)", evidence: "型番末尾の容量表記が128G/256Gで異なる" }),
  mk({ id: "sd004", genre: "SSD", supplier: "SanDisk ポータブルSSD 1TB Extreme USB3.2 Gen2 SDSSDE61-1T00-J25", smodel: "SDSSDE61-1T00-J25", amazon: "サンディスク エクストリーム ポータブルSSD 1TB SDSSDE61-1T00-J25 [並行輸入品]", amodel: "SDSSDE61-1T00-J25", expect: true, reason: "同一型番", evidence: "SDSSDE61-1T00-J25が両側一致・容量1TB一致" }),
  mk({ id: "sd005", genre: "SSD", supplier: "SanDisk Extreme ポータブルSSD 1TB SDSSDE61-1T00", smodel: "SDSSDE61-1T00", amazon: "SanDisk Extreme PRO ポータブルSSD 1TB SDSSDE81-1T00", amodel: "SDSSDE81-1T00", expect: false, diff_dim: "model", reason: "型番中盤違い E61 vs E81", evidence: "SDSSDE61とSDSSDE81は別製品(Extreme/Extreme PRO)" }),
  mk({ id: "sd006", genre: "SSD", supplier: "Samsung 980 PRO 1TB M.2 NVMe MZ-V8P1T0B/IT", smodel: "MZ-V8P1T0B/IT", amazon: "サムスン 980 PRO 1TB NVMe MZ-V8P1T0B/IT ヒートシンクなし", amodel: "MZ-V8P1T0B/IT", expect: true, reason: "同一型番", evidence: "MZ-V8P1T0B/ITが一致" }),
  mk({ id: "sd007", genre: "SSD", supplier: "Samsung 980 PRO 1TB MZ-V8P1T0B", smodel: "MZ-V8P1T0B", amazon: "Samsung 990 PRO 1TB MZ-V9P1T0B", amodel: "MZ-V9P1T0B", expect: false, diff_dim: "generation", reason: "980 PRO と 990 PRO は世代違い", evidence: "V8P/V9Pで世代が異なる別製品" }),
  mk({ id: "sd008", genre: "SDカード", supplier: "サンディスク microSDXC 512GB Ultra SDSQUAC-512G-GN6MN", smodel: "SDSQUAC-512G-GN6MN", amazon: "SanDisk Ultra microSDXC 512GB SDSQUAC-512G-GN6MN 150MB/s", amodel: "SDSQUAC-512G-GN6MN", expect: true, reason: "同一型番", evidence: "SDSQUAC-512G-GN6MN一致" }),
  mk({ id: "sd009", genre: "SDカード", supplier: "SanDisk Ultra microSDXC 512GB SDSQUAC-512G", amazon: "SanDisk Extreme microSDXC 512GB SDSQXAV-512G", expect: false, diff_dim: "series", reason: "Ultra と Extreme は別系列", evidence: "UltraとExtremeはグレード・型番体系が別" }),
  mk({ id: "sd010", genre: "SDカード", supplier: "サンディスク SDカード 64GB Extreme PRO SDSDXXU-064G", smodel: "SDSDXXU-064G", amazon: "SanDisk Extreme PRO SDXC 64GB SDSDXXU-064G-GN4IN 170MB/s", amodel: "SDSDXXU-064G-GN4IN", expect: true, reason: "型番前方一致(サフィックス地域差)", evidence: "SDSDXXU-064G共通・容量とグレード一致(GN4INは仕向地サフィックス)" }),
  mk({ id: "sd011", genre: "SSD", supplier: "Crucial MX500 500GB SATA SSD CT500MX500SSD1", sjan: J("4988755061001"), amazon: "Crucial MX500 500GB 2.5インチ SATA SSD", codes: [J("4988755061001")], expect: true, reason: "JAN一致", evidence: "仕入れJANがAmazon識別子一覧に含まれる" }),
  mk({ id: "sd012", genre: "SSD", supplier: "Crucial MX500 500GB CT500MX500SSD1", sjan: J("4988755061001"), amazon: "Crucial MX500 1TB 2.5インチ SATA SSD CT1000MX500SSD1", codes: [J("4988755061018")], expect: false, diff_dim: "jan", reason: "JAN不一致(容量違い)", evidence: "識別子が取れたが仕入れJANを含まない=別商品" }),
  mk({ id: "sd013", genre: "SDカード", supplier: "キオクシア microSDXC 256GB EXCERIA PLUS LMPL1M256GG4", sjan: J("4582563854123"), amazon: "KIOXIA EXCERIA PLUS microSDXC 256GB LMPL1M256GG4", codes: [], expect: true, reason: "同一だが識別子未取得(JAN不明)", evidence: "型番一致だがAmazon側codes空=JAN照合は不明のまま" }),
  mk({ id: "sd014", genre: "SDカード", supplier: "Transcend microSDXC 128GB TS128GUSD300S-A", smodel: "TS128GUSD300S-A", amazon: "トランセンド microSDXC 128GB TS128GUSD300S-A アダプタ付", amodel: "TS128GUSD300S-A", expect: true, reason: "同一型番", evidence: "TS128GUSD300S-A一致" }),
  mk({ id: "sd015", genre: "SSD", supplier: "WD Blue SN570 1TB NVMe WDS100T3B0C", smodel: "WDS100T3B0C", amazon: "Western Digital WD Blue SN570 500GB WDS500G3B0C", amodel: "WDS500G3B0C", expect: false, diff_dim: "capacity", reason: "容量違い(1TB vs 500GB)", evidence: "WDS100T/WDS500Gで容量が異なる" }),
  mk({ id: "sd016", genre: "SDカード", supplier: "SanDisk microSD 256GB R:190MB/s W:130MB/s U3 V30 A2 Nintendo Switch動作確認", amazon: "SanDisk microSDXC 256GB Extreme PRO U3 V30 4K A2対応 SDアダプター付 [並行輸入品]", expect: false, diff_dim: "series", reason: "無印Extreme相当 vs Extreme PRO(実findings id63型)", evidence: "共通スペック語のみ一致・系列違い。型番の明示欄なし→MODEL_VERIFIED不可が正解" }),
  mk({ id: "sd017", genre: "SSD", supplier: "サムスン T7 ポータブルSSD 1TB MU-PC1T0T", smodel: "MU-PC1T0T", amazon: "Samsung T7 Shield ポータブルSSD 1TB MU-PE1T0S", amodel: "MU-PE1T0S", expect: false, diff_dim: "model", reason: "T7 と T7 Shield は別製品", evidence: "MU-PC/MU-PEで型番が異なる" }),
  mk({ id: "sd018", genre: "SDカード", supplier: "SanDisk Extreme PRO SDXC UHS-II 128GB SDSDXDK-128G-GN4IN", smodel: "SDSDXDK-128G-GN4IN", amazon: "サンディスク Extreme PRO SDXC UHS-II 128GB SDSDXDK-128G", amodel: "SDSDXDK-128G", expect: true, reason: "型番前方一致", evidence: "SDSDXDK-128G共通・UHS-II/容量一致" }),

  // ============ プリンターインク（16） ============
  mk({ id: "ink01", genre: "プリンターインク", supplier: "エプソン 純正インク IC6CL50 6色セット", smodel: "IC6CL50", amazon: "EPSON 純正 インクカートリッジ IC6CL50 6色パック", amodel: "IC6CL50", expect: true, reason: "同一型番6色", evidence: "IC6CL50一致・6色で一致" }),
  mk({ id: "ink02", genre: "プリンターインク", supplier: "エプソン IC4CL62 4色パック", smodel: "IC4CL62", amazon: "EPSON IC4CL62 4色パック 純正", amodel: "IC4CL62", expect: true, reason: "同一型番", evidence: "IC4CL62一致" }),
  mk({ id: "ink03", genre: "プリンターインク", supplier: "エプソン IC4CL62", smodel: "IC4CL62", amazon: "EPSON IC4CL46 4色パック", amodel: "IC4CL46", expect: false, diff_dim: "model", reason: "型番違い IC4CL62 vs IC4CL46", evidence: "62と46で対応機種が異なる別品番" }),
  mk({ id: "ink04", genre: "プリンターインク", supplier: "エプソン IC6CL50 6色 2セット", smodel: "IC6CL50", amazon: "EPSON IC6CL50 6色パック 単品", amodel: "IC6CL50", expect: false, diff_dim: "pack", reason: "セット数違い(2セット vs 単品)", evidence: "型番同一だが数量が2セット/1セットで異なる=価格前提が別" }),
  mk({ id: "ink05", genre: "プリンターインク", supplier: "キヤノン BCI-381+380/6MP 6色マルチパック", smodel: "BCI-381+380/6MP", amazon: "Canon 純正 BCI-381+380/6MP 6色マルチパック", amodel: "BCI-381+380/6MP", expect: true, reason: "同一型番", evidence: "BCI-381+380/6MP一致" }),
  mk({ id: "ink06", genre: "プリンターインク", supplier: "キヤノン BCI-381+380/6MP", smodel: "BCI-381+380/6MP", amazon: "Canon BCI-381+380/5MP 5色マルチパック", amodel: "BCI-381+380/5MP", expect: false, diff_dim: "pack", reason: "6色 vs 5色構成違い", evidence: "6MP/5MPで色数構成が異なる" }),
  mk({ id: "ink07", genre: "プリンターインク", supplier: "ブラザー LC3111-4PK 4色パック", smodel: "LC3111-4PK", amazon: "brother 純正 LC3111-4PK 4色パック", amodel: "LC3111-4PK", expect: true, reason: "同一型番", evidence: "LC3111-4PK一致" }),
  mk({ id: "ink08", genre: "プリンターインク", supplier: "ブラザー LC3111-4PK", smodel: "LC3111-4PK", amazon: "brother LC3117-4PK 大容量 4色パック", amodel: "LC3117-4PK", expect: false, diff_dim: "model", reason: "LC3111(標準) vs LC3117(大容量)", evidence: "3111と3117は容量違いの別品番" }),
  mk({ id: "ink09", genre: "プリンターインク", supplier: "エプソン IC4CL62 4色パック", smodel: "IC4CL62", amazon: "エプソン IC4CL62 4色パック 2個セット", amodel: "IC4CL62", expect: false, diff_dim: "pack", reason: "単品 vs 2個セット", evidence: "同一型番だが数量が違う" }),
  mk({ id: "ink10", genre: "プリンターインク", supplier: "HP 純正 HP61 黒 CH561WA", sjan: J("0886112397814"), amazon: "HP 61 ブラック インクカートリッジ CH561WA", codes: [J("0886112397814")], expect: true, reason: "JAN一致", evidence: "仕入れJANが識別子一覧に含まれる" }),
  mk({ id: "ink11", genre: "プリンターインク", supplier: "HP 純正 HP61 黒 CH561WA", sjan: J("0886112397814"), amazon: "HP 61 カラー(3色) インクカートリッジ CH562WA", codes: [J("0886112397821")], expect: false, diff_dim: "jan", reason: "JAN不一致(黒 vs カラー)", evidence: "識別子は取れたが仕入れJANを含まない別商品" }),
  mk({ id: "ink12", genre: "プリンターインク", supplier: "エプソン インク KAM-6CL 6色 (カメ)", smodel: "KAM-6CL", amazon: "EPSON KAM-6CL-L 増量6色パック (カメ)", amodel: "KAM-6CL-L", expect: false, diff_dim: "capacity", reason: "標準 vs 増量(L)", evidence: "KAM-6CLとKAM-6CL-Lは容量違い" }),
  mk({ id: "ink13", genre: "プリンターインク", supplier: "エプソン SAT-6CL サツマイモ 6色", smodel: "SAT-6CL", amazon: "エプソン 純正 SAT-6CL 6色パック さつまいも", amodel: "SAT-6CL", expect: true, reason: "同一型番", evidence: "SAT-6CL一致" }),
  mk({ id: "ink14", genre: "プリンターインク", supplier: "キヤノン BC-345 黒 BC-346 カラー セット", amazon: "Canon BC-345 + BC-346 ブラック/カラー 純正 セット", expect: true, reason: "同一構成(型番明示欄なし・タイトルのみ)", evidence: "BC-345/BC-346が両側一致・型番欄未設定のため自動確定は保留が正解" }),
  mk({ id: "ink15", genre: "プリンターインク", supplier: "エプソン IC6CL80L 増量6色 とうもろこし", smodel: "IC6CL80L", amazon: "エプソン IC6CL80 6色 とうもろこし(標準)", amodel: "IC6CL80", expect: false, diff_dim: "capacity", reason: "増量80L vs 標準80", evidence: "末尾Lの有無で容量が異なる" }),
  mk({ id: "ink16", genre: "プリンターインク", supplier: "ブラザー LC211-4PK 4色", smodel: "LC211-4PK", amazon: "brother LC211-4PK 4色パック 純正", amodel: "LC211-4PK", expect: true, reason: "同一型番", evidence: "LC211-4PK一致" }),

  // ============ PC周辺機器（12） ============
  mk({ id: "pc01", genre: "PC周辺機器", supplier: "ロジクール ワイヤレスマウス M705m", smodel: "M705m", amazon: "Logicool マラソンマウス M705m ワイヤレス", amodel: "M705m", expect: true, reason: "同一型番", evidence: "M705m一致" }),
  mk({ id: "pc02", genre: "PC周辺機器", supplier: "ロジクール マウス M705m", smodel: "M705m", amazon: "Logicool マウス M590 サイレント", amodel: "M590", expect: false, diff_dim: "model", reason: "型番違い M705m vs M590", evidence: "別モデル" }),
  mk({ id: "pc03", genre: "PC周辺機器", supplier: "ロジクール 有線マウス M100r", smodel: "M100r", amazon: "Logicool ワイヤレスマウス M100 (無線)", amodel: "M100", expect: false, diff_dim: "connectivity", reason: "有線 vs 無線", evidence: "接続方式が異なる(有線/ワイヤレス)" }),
  mk({ id: "pc04", genre: "PC周辺機器", supplier: "エレコム USBハブ 4ポート U3H-A408BBK", smodel: "U3H-A408BBK", amazon: "ELECOM USB3.0ハブ 4ポート U3H-A408BBK", amodel: "U3H-A408BBK", expect: true, reason: "同一型番", evidence: "U3H-A408BBK一致" }),
  mk({ id: "pc05", genre: "PC周辺機器", supplier: "エレコム USBハブ U3H-A408B", smodel: "U3H-A408BBK", amazon: "ELECOM USBハブ 7ポート U3H-A712SBK", amodel: "U3H-A712SBK", expect: false, diff_dim: "model", reason: "4ポート vs 7ポート別型番", evidence: "A408/A712で別製品" }),
  mk({ id: "pc06", genre: "PC周辺機器", supplier: "Anker USB-C ハブ 7-in-1 A8346", smodel: "A8346", amazon: "Anker PowerExpand 7-in-1 USB-C ハブ A8346", amodel: "A8346", expect: true, reason: "同一型番", evidence: "A8346一致" }),
  mk({ id: "pc07", genre: "PC周辺機器", supplier: "ロジクール キーボード K295 静音 ワイヤレス", smodel: "K295", amazon: "Logicool K295 サイレント ワイヤレスキーボード", amodel: "K295", expect: true, reason: "同一型番", evidence: "K295一致" }),
  mk({ id: "pc08", genre: "PC周辺機器", supplier: "ロジクール Webカメラ C270n HD", smodel: "C270n", amazon: "Logicool C920n HD Pro ウェブカメラ", amodel: "C920n", expect: false, diff_dim: "model", reason: "C270n vs C920n", evidence: "別グレードの別型番" }),
  mk({ id: "pc09", genre: "PC周辺機器", supplier: "バッファロー 外付けHDD 4TB HD-AD4U3", smodel: "HD-AD4U3", amazon: "BUFFALO 外付けHDD 4TB HD-AD4U3 USB3.1", amodel: "HD-AD4U3", expect: true, reason: "同一型番", evidence: "HD-AD4U3一致・容量4TB一致" }),
  mk({ id: "pc10", genre: "PC周辺機器", supplier: "バッファロー 外付けHDD HD-AD4U3 4TB", smodel: "HD-AD4U3", amazon: "BUFFALO 外付けHDD 6TB HD-AD6U3", amodel: "HD-AD6U3", expect: false, diff_dim: "capacity", reason: "4TB vs 6TB", evidence: "型番の容量表記が違う" }),
  mk({ id: "pc11", genre: "PC周辺機器", supplier: "エレコム 無線LAN子機 WDC-433DU2HBK", smodel: "WDC-433DU2HBK", amazon: "ELECOM 無線LAN子機 WDC-433DU2H シリーズ WDC-433DU2HBK ブラック", amodel: "WDC-433DU2HBK", expect: true, reason: "同一型番", evidence: "WDC-433DU2HBK一致" }),
  mk({ id: "pc12", genre: "PC周辺機器", supplier: "サンワサプライ USB切替器 SW-US22", smodel: "SW-US22", amazon: "サンワサプライ USB2.0手動切替器 SW-US22N", amodel: "SW-US22N", expect: false, diff_dim: "model", reason: "SW-US22 vs SW-US22N", evidence: "末尾Nの有無で別品番の可能性が高い→少なくとも自動確定不可" }),

  // ============ ゲーム周辺機器（12） ============
  mk({ id: "gm01", genre: "ゲーム周辺機器", supplier: "HORI ファイティングコマンダー OCTA for PS5 SPF-023", smodel: "SPF-023", amazon: "HORI ワイヤレスファイティングコマンダー OCTA SPF-023 PS5", amodel: "SPF-023", expect: true, reason: "同一型番", evidence: "SPF-023一致" }),
  mk({ id: "gm02", genre: "ゲーム周辺機器", supplier: "ファイティングコマンダー OCTA Pro for PlayStation5、Windows PC [SPF-040]", smodel: "SPF-040", amazon: "HORIワイヤレスファイティングコマンダー OCTA Pro PlayStation5およびWindows用 SPF-040U", amodel: "SPF-040U", expect: false, diff_dim: "model", reason: "SPF-040 vs SPF-040U(実findings id37型)", evidence: "末尾Uの有無で別品番(有線/無線やロット差)" }),
  mk({ id: "gm03", genre: "ゲーム周辺機器", supplier: "SONY DualSense ワイヤレスコントローラー ホワイト CFI-ZCT1J", smodel: "CFI-ZCT1J", amazon: "PS5 DualSense ワイヤレスコントローラー CFI-ZCT1J ホワイト", amodel: "CFI-ZCT1J", expect: true, reason: "同一型番・同色", evidence: "CFI-ZCT1J一致・ホワイト一致" }),
  mk({ id: "gm04", genre: "ゲーム周辺機器", supplier: "DualSense ワイヤレスコントローラー ホワイト", amazon: "DualSense ワイヤレスコントローラー ミッドナイトブラック", expect: false, diff_dim: "color", reason: "色違い(ホワイト vs ブラック)", evidence: "本体色が異なる別SKU" }),
  mk({ id: "gm05", genre: "ゲーム周辺機器", supplier: "Nintendo Switch Joy-Con(L)/(R) ネオンブルー/ネオンレッド", amazon: "Joy-Con (L)/(R) ネオンブルー/ネオンレッド Nintendo Switch", expect: true, reason: "同一色構成", evidence: "L/R色構成が一致(型番欄なし→自動確定は保留が正解)" }),
  mk({ id: "gm06", genre: "ゲーム周辺機器", supplier: "Joy-Con (L)/(R) ネオンブルー/ネオンレッド", amazon: "Joy-Con (L)/(R) パステルピンク/パステルパープル", expect: false, diff_dim: "color", reason: "色構成違い", evidence: "色が異なる別SKU" }),
  mk({ id: "gm07", genre: "ゲーム周辺機器", supplier: "8BitDo Pro 2 コントローラー 有線/無線 ブラックエディション", amazon: "8BitDo Pro 2 Bluetooth コントローラー グレー", expect: false, diff_dim: "color", reason: "色違い(ブラック vs グレー)", evidence: "エディション色が異なる" }),
  mk({ id: "gm08", genre: "ゲーム周辺機器", supplier: "Xbox ワイヤレスコントローラー カーボンブラック QAT-00006", smodel: "QAT-00006", amazon: "Xbox ワイヤレス コントローラー カーボン ブラック QAT-00006", amodel: "QAT-00006", expect: true, reason: "同一型番", evidence: "QAT-00006一致" }),
  mk({ id: "gm09", genre: "ゲーム周辺機器", supplier: "Xbox コントローラー QAT-00006 ブラック", smodel: "QAT-00006", amazon: "Xbox ワイヤレスコントローラー ロボットホワイト QAS-00006", amodel: "QAS-00006", expect: false, diff_dim: "model", reason: "型番違い(黒/白でSKU別)", evidence: "QAT/QASで色=別品番" }),
  mk({ id: "gm10", genre: "ゲーム周辺機器", supplier: "HORI グリップコントローラー Fit for Nintendo Switch ピカチュウ NSW-410", smodel: "NSW-410", amazon: "ホリ グリップコントローラーFit ピカチュウ POINT UP NSW-410 Switch用", amodel: "NSW-410", expect: true, reason: "同一型番", evidence: "NSW-410一致" }),
  mk({ id: "gm11", genre: "ゲーム周辺機器", supplier: "PS5 コントローラー 充電スタンド 2台同時 対応 DualSense用", amazon: "PlayStation5 DualSense Windows PC対応 ワイヤレスコントローラー本体", expect: false, diff_dim: "device", reason: "充電スタンド(アクセサリ) vs コントローラー本体", evidence: "商品種別が別(周辺 vs 本体)。共通語PlayStation5/Windowsは型番でない" }),
  mk({ id: "gm12", genre: "ゲーム周辺機器", supplier: "Nintendo Switch 有機ELモデル Joy-Con ホワイト HEG-S-KAAAA", smodel: "HEG-S-KAAAA", amazon: "Nintendo Switch 有機ELモデル ホワイト HEG-S-KAAAA 本体", amodel: "HEG-S-KAAAA", expect: true, reason: "同一型番", evidence: "HEG-S-KAAAA一致" }),

  // ============ 家電（10） ============
  mk({ id: "ap01", genre: "家電", supplier: "パナソニック メンズシェーバー ラムダッシュ ES-LT2B-K 3枚刃", smodel: "ES-LT2B-K", amazon: "Panasonic ラムダッシュ メンズシェーバー ES-LT2B-K 黒 3枚刃", amodel: "ES-LT2B-K", expect: true, reason: "同一型番", evidence: "ES-LT2B-K一致" }),
  mk({ id: "ap02", genre: "家電", supplier: "パナソニック シェーバー ES-LT2B-K 3枚刃", smodel: "ES-LT2B-K", amazon: "Panasonic ラムダッシュ ES-LT8B-S 5枚刃", amodel: "ES-LT8B-S", expect: false, diff_dim: "model", reason: "3枚刃 vs 5枚刃別型番", evidence: "ES-LT2B/ES-LT8Bで別グレード" }),
  mk({ id: "ap03", genre: "家電", supplier: "象印 電気ケトル 1.0L CK-AX10-BA ブラック", smodel: "CK-AX10-BA", amazon: "象印 電気ケトル 1.0L CK-AX10 ブラック CK-AX10-BA", amodel: "CK-AX10-BA", expect: true, reason: "同一型番", evidence: "CK-AX10-BA一致" }),
  mk({ id: "ap04", genre: "家電", supplier: "象印 電気ケトル CK-AX10-BA 1.0L", smodel: "CK-AX10-BA", amazon: "象印 電気ケトル 0.8L CK-AX08-BA", amodel: "CK-AX08-BA", expect: false, diff_dim: "capacity", reason: "1.0L vs 0.8L", evidence: "AX10/AX08で容量が違う" }),
  mk({ id: "ap05", genre: "家電", supplier: "アイリスオーヤマ サーキュレーター PCF-SC15T", smodel: "PCF-SC15T", amazon: "アイリスオーヤマ サーキュレーターアイ PCF-SC15T 静音", amodel: "PCF-SC15T", expect: true, reason: "同一型番", evidence: "PCF-SC15T一致" }),
  mk({ id: "ap06", genre: "家電", supplier: "アイリスオーヤマ サーキュレーター PCF-SC15T", smodel: "PCF-SC15T", amazon: "アイリスオーヤマ サーキュレーター PCF-SC15 旧型", amodel: "PCF-SC15", expect: "unknown", reason: "末尾T有無・同一か不明", evidence: "PCF-SC15/PCF-SC15Tが同一世代か資料不足で断定不能" }),
  mk({ id: "ap07", genre: "家電", supplier: "ティファール 電気ケトル アプレシア 0.8L KO4901JP", smodel: "KO4901JP", amazon: "T-fal アプレシア エージー・プラス 0.8L KO4901JP", amodel: "KO4901JP", expect: true, reason: "同一型番", evidence: "KO4901JP一致" }),
  mk({ id: "ap08", genre: "家電", supplier: "シャープ 加湿空気清浄機 KI-NS40-W ホワイト", smodel: "KI-NS40-W", amazon: "SHARP プラズマクラスター 加湿空気清浄機 KI-NS40-W", amodel: "KI-NS40-W", expect: true, reason: "同一型番", evidence: "KI-NS40-W一致" }),
  mk({ id: "ap09", genre: "家電", supplier: "パナソニック ドライヤー ナノケア EH-NA0J-A ディープネイビー", smodel: "EH-NA0J-A", amazon: "Panasonic ヘアドライヤー ナノケア EH-NA0J-P ピンク", amodel: "EH-NA0J-P", expect: false, diff_dim: "color", reason: "色違い(ネイビー vs ピンク)", evidence: "型番末尾A/Pで色が違う別SKU" }),
  mk({ id: "ap10", genre: "家電", supplier: "パナソニック 目もとエステ EH-SW68-P ピンク", sjan: J("4549980612345"), amazon: "Panasonic 目もとエステ EH-SW68-P", codes: [J("4549980612345")], expect: true, reason: "JAN一致", evidence: "仕入れJANが識別子一覧に含まれる" }),

  // ============ スマホ周辺機器（10） ============
  mk({ id: "sp01", genre: "スマホ周辺機器", supplier: "Anker PowerCore 10000 モバイルバッテリー A1263", smodel: "A1263", amazon: "Anker PowerCore 10000 A1263 コンパクト モバイルバッテリー", amodel: "A1263", expect: true, reason: "同一型番", evidence: "A1263一致" }),
  mk({ id: "sp02", genre: "スマホ周辺機器", supplier: "Anker PowerCore 10000 A1263", smodel: "A1263", amazon: "Anker PowerCore 20000 A1271 モバイルバッテリー", amodel: "A1271", expect: false, diff_dim: "capacity", reason: "10000 vs 20000mAh 別型番", evidence: "A1263/A1271で容量が違う" }),
  mk({ id: "sp03", genre: "スマホ周辺機器", supplier: "Anker 充電器 PowerPort III 20W A2149 ホワイト", smodel: "A2149", amazon: "Anker PowerPort III Nano 20W A2149 白", amodel: "A2149", expect: true, reason: "同一型番", evidence: "A2149一致" }),
  mk({ id: "sp04", genre: "スマホ周辺機器", supplier: "iPhone15 ケース クリア MagSafe対応", amazon: "iPhone15 Pro ケース クリア MagSafe対応", expect: false, diff_dim: "device", reason: "iPhone15 vs iPhone15 Pro対応違い", evidence: "対応機種が異なる(サイズ非互換)" }),
  mk({ id: "sp05", genre: "スマホ周辺機器", supplier: "エレコム iPhone14 ガラスフィルム PM-A22AFLGG", smodel: "PM-A22AFLGG", amazon: "ELECOM iPhone14 液晶保護 ガラスフィルム PM-A22AFLGG", amodel: "PM-A22AFLGG", expect: true, reason: "同一型番", evidence: "PM-A22AFLGG一致" }),
  mk({ id: "sp06", genre: "スマホ周辺機器", supplier: "Anker USB-C to Lightningケーブル 0.9m A8632 ホワイト", smodel: "A8632", amazon: "Anker PowerLine III USB-C & ライトニング 0.9m A8632", amodel: "A8632", expect: true, reason: "同一型番", evidence: "A8632一致" }),
  mk({ id: "sp07", genre: "スマホ周辺機器", supplier: "Anker USB-C to Lightning 0.9m A8632", smodel: "A8632", amazon: "Anker USB-C to Lightning 1.8m A8633", amodel: "A8633", expect: false, diff_dim: "model", reason: "長さ違い別型番 0.9m/1.8m", evidence: "A8632/A8633で長さ=別品番" }),
  mk({ id: "sp08", genre: "スマホ周辺機器", supplier: "Spigen iPhone15 Pro Max ケース ウルトラハイブリッド マットブラック", amazon: "Spigen iPhone15 Pro Max ウルトラ・ハイブリッド フロステッド・クリア", expect: false, diff_dim: "color", reason: "色違い(マットブラック vs クリア)", evidence: "同型ケースだが色が別SKU" }),
  mk({ id: "sp09", genre: "スマホ周辺機器", supplier: "CIO NovaPort DUO 45W USB-C 2ポート充電器 ブラック", amazon: "CIO NovaPort DUO 45W 2ポート 充電器 ホワイト", expect: false, diff_dim: "color", reason: "色違い(黒/白)", evidence: "同型番系だが色が違う" }),
  mk({ id: "sp10", genre: "スマホ周辺機器", supplier: "Anker Soundcore Life P2 Mini ワイヤレスイヤホン ブラック A3944", smodel: "A3944", amazon: "Anker Soundcore Life P2 Mini A3944 ワイヤレスイヤホン 黒", amodel: "A3944", expect: true, reason: "同一型番", evidence: "A3944一致" }),

  // ============ おもちゃ（8） ============
  mk({ id: "toy01", genre: "おもちゃ", supplier: "レゴ クラシック 黄色のアイデアボックス プラス 10696", smodel: "10696", amazon: "LEGO クラシック 黄色のアイデアボックス プラス 10696", amodel: "10696", expect: true, reason: "同一セット番号", evidence: "10696一致" }),
  mk({ id: "toy02", genre: "おもちゃ", supplier: "レゴ クラシック アイデアボックス 10696", smodel: "10696", amazon: "LEGO クラシック 黄色のアイデアボックス スペシャル 10698", amodel: "10698", expect: false, diff_dim: "model", reason: "10696 vs 10698 別セット", evidence: "セット番号が異なる" }),
  mk({ id: "toy03", genre: "おもちゃ", supplier: "リカちゃん ドール LD-01 きせかえ", smodel: "LD-01", amazon: "リカちゃん きせかえ ドール LD-01", amodel: "LD-01", expect: true, reason: "同一型番", evidence: "LD-01一致" }),
  mk({ id: "toy04", genre: "おもちゃ", supplier: "トミカ No.1 日産 GT-R (箱)", amazon: "トミカ No.24 マツダ ロードスター (箱)", expect: false, diff_dim: "model", reason: "No.違い(別車種)", evidence: "トミカ番号と車種が違う" }),
  mk({ id: "toy05", genre: "おもちゃ", supplier: "アンパンマン ブロックラボ はじめてのブロックワゴン", amazon: "アンパンマン ブロックラボ NEW ブロックワゴン", expect: "unknown", reason: "旧/NEWで同一か不明", evidence: "パッケージ表記違いが仕様差か販売時期差か断定不能" }),
  mk({ id: "toy06", genre: "おもちゃ", supplier: "ベイブレードバースト B-193 アルティメットヴァルキリー", smodel: "B-193", amazon: "ベイブレード バースト B-193 アルティメットヴァルキリー.Lô.Vl-0", amodel: "B-193", expect: true, reason: "同一型番", evidence: "B-193一致" }),
  mk({ id: "toy07", genre: "おもちゃ", supplier: "プラレール S-28 新幹線 E5系 はやぶさ", smodel: "S-28", amazon: "プラレール S-14 D51 蒸気機関車", amodel: "S-14", expect: false, diff_dim: "model", reason: "S-28 vs S-14 別車両", evidence: "品番と車種が違う" }),
  mk({ id: "toy08", genre: "おもちゃ", supplier: "シルバニアファミリー 赤い屋根の大きなお家 ハ-48", smodel: "ハ-48", amazon: "シルバニアファミリー 赤い屋根の大きなお家 ハ-48", amodel: "ハ-48", expect: true, reason: "同一型番", evidence: "ハ-48一致(日本語品番)" }),

  // ============ ホビー/プラモ（6） ============
  mk({ id: "hb01", genre: "ホビー", supplier: "バンダイ RG 1/144 νガンダム", amazon: "BANDAI RG 1/144 νガンダム ガンプラ", expect: true, reason: "同一キット(型番欄なし)", evidence: "グレード/スケール/機体が一致・型番欄なしのため自動確定は保留が正解" }),
  mk({ id: "hb02", genre: "ホビー", supplier: "バンダイ RG 1/144 νガンダム", amazon: "BANDAI MG 1/100 νガンダム Ver.Ka", expect: false, diff_dim: "model", reason: "RG/144 vs MG/100 別キット", evidence: "グレードとスケールが違う" }),
  mk({ id: "hb03", genre: "ホビー", supplier: "タミヤ 1/24 トヨタ GR スープラ 24337", smodel: "24337", amazon: "タミヤ 1/24 スポーツカー トヨタ GRスープラ 24337", amodel: "24337", expect: true, reason: "同一品番", evidence: "24337一致" }),
  mk({ id: "hb04", genre: "ホビー", supplier: "タミヤ 1/24 トヨタ GRスープラ 24337", smodel: "24337", amazon: "タミヤ 1/24 日産 GT-R 24300", amodel: "24300", expect: false, diff_dim: "model", reason: "24337 vs 24300 別車種", evidence: "品番と車種が違う" }),
  mk({ id: "hb05", genre: "ホビー", supplier: "フィギュアーツ 仮面ライダーギーツ マグナムフォーム", amazon: "S.H.Figuarts 仮面ライダーギーツ ブーストフォームII", expect: false, diff_dim: "edition", reason: "フォーム違い", evidence: "同キャラだが造形バリエーションが別商品" }),
  mk({ id: "hb06", genre: "ホビー", supplier: "ねんどろいど 初音ミク 2.0 グッドスマイル", amazon: "ねんどろいど 初音ミク 2.0", expect: true, reason: "同一商品(バージョン2.0一致)", evidence: "キャラ・ver2.0一致(型番欄なし→保留が正解)" }),

  // ============ 本（6） ============
  mk({ id: "bk01", genre: "本", supplier: "リファクタリング 第2版 単行本 9784274224546", sjan: J("9784274224546"), amazon: "リファクタリング(第2版) 既存のコードを安全に改善する", codes: [J("9784274224546")], expect: true, reason: "ISBN(JAN)一致", evidence: "ISBN-13が識別子一覧に含まれる" }),
  mk({ id: "bk02", genre: "本", supplier: "現場のプロが教える 実践入門 第1版 9784297100001", sjan: J("9784297100001"), amazon: "現場のプロが教える 実践入門 改訂第2版", codes: [J("9784297123456")], expect: false, diff_dim: "jan", reason: "版違いでISBN不一致", evidence: "識別子は取れたが仕入れISBNを含まない(第1版/第2版)" }),
  mk({ id: "bk03", genre: "本", supplier: "鬼滅の刃 23巻 通常版 集英社", amazon: "鬼滅の刃 23巻 フィギュア付き同梱版", expect: false, diff_dim: "edition", reason: "通常版 vs 同梱版", evidence: "同一巻だが通常版と特装(同梱)版は別商品" }),
  mk({ id: "bk04", genre: "本", supplier: "呪術廻戦 0 東京都立呪術高等専門学校 9784088820001", sjan: J("9784088820001"), amazon: "呪術廻戦 0 東京都立呪術高等専門学校", codes: [J("9784088820001")], expect: true, reason: "ISBN一致", evidence: "ISBN一致" }),
  mk({ id: "bk05", genre: "本", supplier: "TOEIC L&R テスト 公式問題集 8", amazon: "TOEIC L&R テスト 公式問題集 9", expect: false, diff_dim: "model", reason: "巻数違い(8 vs 9)", evidence: "号数が異なる別書籍" }),
  mk({ id: "bk06", genre: "本", supplier: "スラムダンク 新装再編版 1巻", amazon: "SLAM DUNK 新装再編版 1", expect: true, reason: "同一書籍(表記揺れ)", evidence: "同版・同巻(型番欄なし→保留)" }),

  // ============ CD/DVD（6） ============
  mk({ id: "cd01", genre: "CD/DVD", supplier: "米津玄師 STRAY SHEEP 通常盤 CD SECL-2600", smodel: "SECL-2600", amazon: "米津玄師 STRAY SHEEP 通常盤 SECL-2600", amodel: "SECL-2600", expect: true, reason: "同一品番", evidence: "SECL-2600一致" }),
  mk({ id: "cd02", genre: "CD/DVD", supplier: "米津玄師 STRAY SHEEP 通常盤 SECL-2600", smodel: "SECL-2600", amazon: "米津玄師 STRAY SHEEP アートブック盤 SECL-2596", amodel: "SECL-2596", expect: false, diff_dim: "edition", reason: "通常盤 vs アートブック盤", evidence: "品番SECL-2600/2596で盤仕様が違う" }),
  mk({ id: "cd03", genre: "CD/DVD", supplier: "劇場版 鬼滅の刃 無限列車編 DVD 通常版 ANSB-3401", smodel: "ANSB-3401", amazon: "劇場版 鬼滅の刃 無限列車編 DVD 通常版 ANSB-3401", amodel: "ANSB-3401", expect: true, reason: "同一品番", evidence: "ANSB-3401一致" }),
  mk({ id: "cd04", genre: "CD/DVD", supplier: "劇場版 鬼滅の刃 無限列車編 DVD 通常版 ANSB-3401", smodel: "ANSB-3401", amazon: "劇場版 鬼滅の刃 無限列車編 完全生産限定版 Blu-ray ANZX-14801", amodel: "ANZX-14801", expect: false, diff_dim: "edition", reason: "DVD通常 vs BD限定版", evidence: "メディアと版が違う別品番" }),
  mk({ id: "cd05", genre: "CD/DVD", supplier: "あいみょん 瞬間的シックスセンス 初回限定盤 CD+DVD", amazon: "あいみょん 瞬間的シックスセンス 通常盤 CD", expect: false, diff_dim: "edition", reason: "初回限定盤 vs 通常盤", evidence: "付属DVDの有無で別商品" }),
  mk({ id: "cd06", genre: "CD/DVD", supplier: "ジブリ となりのトトロ Blu-ray VWBS-1111", smodel: "VWBS-1111", amazon: "となりのトトロ ブルーレイ VWBS-1111 スタジオジブリ", amodel: "VWBS-1111", expect: true, reason: "同一品番", evidence: "VWBS-1111一致" }),

  // ============ 日用品（8） ============
  mk({ id: "dy01", genre: "日用品", supplier: "花王 アタックZERO 詰め替え 360g 1個", amazon: "花王 アタックZERO 洗濯洗剤 詰め替え 360g", expect: true, reason: "同一(容量/形態一致)", evidence: "360g詰替で一致・数量1個(型番欄なし→保留が正解)" }),
  mk({ id: "dy02", genre: "日用品", supplier: "花王 アタックZERO 詰め替え 360g 1個", amazon: "花王 アタックZERO 詰め替え 360g 6個セット", expect: false, diff_dim: "pack", reason: "1個 vs 6個セット", evidence: "同一商品だが販売数量が違う" }),
  mk({ id: "dy03", genre: "日用品", supplier: "ライオン トップ スーパーNANOX 本体 400g", amazon: "ライオン トップ スーパーNANOX 詰め替え 360g", expect: false, diff_dim: "capacity", reason: "本体400g vs 詰替360g", evidence: "形態と容量が違う別SKU" }),
  mk({ id: "dy04", genre: "日用品", supplier: "P&G アリエール ジェルボール4D 15個入", amazon: "P&G アリエール ジェルボール4D 32個入", expect: false, diff_dim: "pack", reason: "15個 vs 32個", evidence: "入数が違う別SKU" }),
  mk({ id: "dy05", genre: "日用品", supplier: "エリエール トイレットペーパー ダブル 12ロール", amazon: "エリエール トイレットペーパー ダブル 12ロール", expect: true, reason: "同一(入数一致)", evidence: "ダブル12ロールで一致(型番欄なし→保留が正解)" }),
  mk({ id: "dy06", genre: "日用品", supplier: "ユニ・チャーム ムーニー テープ Sサイズ 84枚", amazon: "ムーニー オムツ テープ Mサイズ 64枚", expect: false, diff_dim: "size", reason: "Sサイズ vs Mサイズ", evidence: "サイズと枚数が違う" }),
  mk({ id: "dy07", genre: "日用品", supplier: "花王 ビオレu 泡ハンドソープ 本体 250ml", amazon: "花王 ビオレu 泡ハンドソープ 詰め替え 800ml", expect: false, diff_dim: "capacity", reason: "本体250ml vs 詰替800ml", evidence: "形態と容量が違う" }),
  mk({ id: "dy08", genre: "日用品", supplier: "小林製薬 熱さまシート 大人用 16枚", amazon: "小林製薬 熱さまシート 大人用 12+4枚", expect: "unknown", reason: "16枚と12+4枚が同一SKUか不明", evidence: "総枚数は同じだが増量版か通常版か断定不能" }),

  // ============ 飲料（8） ============
  mk({ id: "bv01", genre: "飲料", supplier: "サントリー 天然水 550ml 24本 ケース", amazon: "サントリー 天然水 550ml × 24本", expect: true, reason: "同一(容量/本数一致)", evidence: "550ml×24本で一致(型番欄なし→保留が正解)" }),
  mk({ id: "bv02", genre: "飲料", supplier: "サントリー 天然水 550ml 24本", amazon: "サントリー 天然水 2L × 9本 ケース", expect: false, diff_dim: "capacity", reason: "550ml vs 2L 別容量", evidence: "容量と本数が違う別SKU" }),
  mk({ id: "bv03", genre: "飲料", supplier: "コカ・コーラ 500ml 24本", amazon: "コカ・コーラ ゼロ 500ml 24本", expect: false, diff_dim: "edition", reason: "通常 vs ゼロ", evidence: "中身が別商品(無糖)" }),
  mk({ id: "bv04", genre: "飲料", supplier: "伊藤園 お〜いお茶 緑茶 525ml 24本", amazon: "伊藤園 お〜いお茶 濃い茶 525ml 24本", expect: false, diff_dim: "edition", reason: "緑茶 vs 濃い茶", evidence: "商品ラインが別" }),
  mk({ id: "bv05", genre: "飲料", supplier: "レッドブル エナジードリンク 250ml 24本", amazon: "レッドブル エナジードリンク 250ml × 24本", expect: true, reason: "同一(容量/本数一致)", evidence: "250ml×24本で一致" }),
  mk({ id: "bv06", genre: "飲料", supplier: "アサヒ 三ツ矢サイダー 500ml 24本", amazon: "アサヒ 三ツ矢サイダー 350ml 24本", expect: false, diff_dim: "capacity", reason: "500ml vs 350ml", evidence: "容量違い" }),
  mk({ id: "bv07", genre: "飲料", supplier: "ポカリスエット 900ml 12本", amazon: "ポカリスエット 900ml × 12本 大塚製薬", expect: true, reason: "同一(容量/本数一致)", evidence: "900ml×12本で一致" }),
  mk({ id: "bv08", genre: "飲料", supplier: "キリン 午後の紅茶 ストレート 500ml 24本", amazon: "キリン 午後の紅茶 ミルクティー 500ml 24本", expect: false, diff_dim: "edition", reason: "ストレート vs ミルクティー", evidence: "フレーバーが別商品" }),

  // ============ セット/色/容量 追加adversarial（6） ============
  mk({ id: "adv01", genre: "セット商品", supplier: "エレコム マウス M-XGL10DBBK 単品", smodel: "M-XGL10DBBK", amazon: "ELECOM マウス M-XGL10DBBK 2個セット お得用", amodel: "M-XGL10DBBK", expect: false, diff_dim: "pack", reason: "単品 vs 2個セット(型番同一)", evidence: "型番一致でも数量が違う→自動確定不可が正解" }),
  mk({ id: "adv02", genre: "色違い商品", supplier: "サーモス 水筒 500ml JNL-506 ブラック", smodel: "JNL-506", amazon: "サーモス 水筒 500ml JNL-506 マットブルー", amodel: "JNL-506", expect: false, diff_dim: "color", reason: "型番同一だが色が別SKU", evidence: "JNL-506系だがカラーコードで在庫別=別商品扱い" }),
  mk({ id: "adv03", genre: "容量違い商品", supplier: "無印良品 化粧水 敏感肌用 高保湿 200ml", amazon: "無印良品 化粧水 敏感肌用 高保湿 400ml", expect: false, diff_dim: "capacity", reason: "200ml vs 400ml", evidence: "容量違いの別SKU" }),
  mk({ id: "adv04", genre: "世代違い商品", supplier: "Apple AirPods 第2世代 MV7N2J/A", smodel: "MV7N2J/A", amazon: "Apple AirPods 第3世代 MME73J/A", amodel: "MME73J/A", expect: false, diff_dim: "generation", reason: "第2世代 vs 第3世代", evidence: "型番も世代も違う" }),
  mk({ id: "adv05", genre: "世代違い商品", supplier: "Apple AirPods Pro 第2世代 MTJV3J/A USB-C", smodel: "MTJV3J/A", amazon: "Apple AirPods Pro 第2世代 MTJV3J/A", amodel: "MTJV3J/A", expect: true, reason: "同一型番", evidence: "MTJV3J/A一致" }),
  mk({ id: "adv06", genre: "似ている別商品", supplier: "エレコム HDMIケーブル 2m DH-HD14EL20BK", smodel: "DH-HD14EL20BK", amazon: "ELECOM HDMIケーブル 1m DH-HD14EL10BK", amodel: "DH-HD14EL10BK", expect: false, diff_dim: "model", reason: "2m vs 1m 別型番", evidence: "EL20/EL10で長さ=別品番" }),
];

export default GOLD;
