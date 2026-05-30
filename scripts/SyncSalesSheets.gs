/**
 * STAGE UP 営業リスト 一括反映スクリプト v6（Q列「印刷用DM文章」追加）
 * --------------------------------------------------------------
 *
 * 【v6 変更点】
 * - 営業優先シート: A〜Q列の 17列構造（Q列に「印刷用DM文章」を新設）
 *   - Q列 = 改行あり高品質長文 = Googleドキュメント貼付→印刷可能
 *   - 既存O列(DM文章)はそのまま短文で残す（影響なし）
 * - タスク管理シート: A〜P列の 16列構造（従来通り・Q列なし）
 * - データソース: GitHub上の data/sales_list.json (schema v1.1)
 * - 一度設置すれば貼り替え不要、メニュー1クリックで最新化
 *
 * 【初回セットアップ】（一度だけ）
 *   1. 拡張機能 → Apps Script → 既存コード全削除 → このコード貼り付け → 保存
 *   2. シートをリロード（F5）→ メニュー「STAGE UP同期」が現れる
 *   3. 初回実行時のみ承認ダイアログ → 「許可」
 *
 * 【日々の運用】
 *   1. メニュー「STAGE UP同期 → 全シート一括反映（推奨）」をクリック
 *   2. GitHubの最新 sales_list.json が自動取得・反映される
 */

// ========== 設定 ==========
const DATA_JSON_URL = 'https://raw.githubusercontent.com/haruharu1100/stage-up-lp/main/data/sales_list.json';
const SHEET_PRIORITY = '営業優先シート';
const SHEET_TASK     = 'タスク管理シート';
const ROW_HEIGHT_PX  = 21;

// ========== 内部定数 ==========
const HEADER_ROW = 1;
const DATA_START_ROW = 2;

// 営業優先シート: 17列（A〜Q）
const NUM_COLS_PRIORITY = 17;
const DEFAULT_HEADERS_PRIORITY = [
  '取得日','管理番号','会社名','法人番号','住所','設立日',
  'HP URL','HP有無','LINE有無','スマホ対応','業種予測',
  'DM送付','面談状況','備考','DM文章','LP URL','印刷用DM文章'
];
const DEFAULT_WIDTHS_PRIORITY = [90,60,220,120,300,90,180,60,60,70,140,80,80,260,380,280,420];

// タスク管理シート: 16列（A〜P）
const NUM_COLS_TASK = 16;
const DEFAULT_HEADERS_TASK = [
  '取得日','管理番号','会社名','法人番号','住所','設立日',
  'HP URL','HP有無','LINE有無','スマホ対応','業種予測',
  'DM送付','面談状況','備考','DM文章','LP URL'
];
const DEFAULT_WIDTHS_TASK = [90,60,220,120,300,90,180,60,60,70,140,80,80,260,380,280];

/* ============================================================
 *  カスタムメニュー
 * ============================================================ */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('STAGE UP同期')
    .addItem('全シート一括反映（推奨）', 'syncAllSheets')
    .addSeparator()
    .addItem('営業優先シートのみ反映', 'syncPrioritySheet')
    .addItem('タスク管理シートのみ反映', 'syncTaskSheet')
    .addSeparator()
    .addItem('L列・M列を空白化（応急）', 'clearLMColumns')
    .addItem('表示設定だけリセット', 'resetDisplayOnly')
    .addSeparator()
    .addItem('データソース情報', 'showDataSource')
    .addToUi();
}

/* ============================================================
 *  最新JSON取得（キャッシュバスター付き）
 * ============================================================ */
function fetchSalesList_() {
  const url = DATA_JSON_URL + '?t=' + Date.now();
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'Cache-Control': 'no-cache' },
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error(
      'データ取得失敗: HTTP ' + code + '\n\n' +
      'URL: ' + url + '\n' +
      'レスポンス先頭: ' + res.getContentText().substring(0, 300)
    );
  }
  let json;
  try {
    json = JSON.parse(res.getContentText());
  } catch (e) {
    throw new Error('JSONパース失敗: ' + e.message);
  }
  if (!Array.isArray(json.records)) {
    throw new Error('JSON構造が不正: records配列がありません');
  }
  return json;
}

/* ============================================================
 *  メイン: 全シート一括反映
 * ============================================================ */
function syncAllSheets() {
  const t0 = new Date();
  let json;
  try { json = fetchSalesList_(); }
  catch (e) { SpreadsheetApp.getUi().alert('❌ ' + e.message); return; }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // 営業優先シート: 17列・Q列に印刷用DM長文
  syncSheet_(ss, SHEET_PRIORITY, json, /*isPriority=*/true);
  // タスク管理シート: 16列・LP URL社のみ
  const taskRows = json.records.filter(r =>
    r && Array.isArray(r.row) && typeof r.row[15] === 'string' && r.row[15].indexOf('https://') === 0
  );
  const taskJson = Object.assign({}, json, { records: taskRows });
  syncSheet_(ss, SHEET_TASK, taskJson, /*isPriority=*/false);

  const sec = ((new Date() - t0) / 1000).toFixed(1);
  SpreadsheetApp.getUi().alert(
    '✅ 完了\n\n' +
    '営業優先シート: ' + json.records.length + ' 社（17列・Q列=印刷用DM長文）\n' +
    'タスク管理シート: ' + taskRows.length + ' 社（16列・O列=DM短文）\n' +
    'データ生成日時: ' + (json.generated_at || '不明') + '\n' +
    '処理時間: ' + sec + ' 秒'
  );
}

function syncPrioritySheet() {
  let json;
  try { json = fetchSalesList_(); }
  catch (e) { SpreadsheetApp.getUi().alert('❌ ' + e.message); return; }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  syncSheet_(ss, SHEET_PRIORITY, json, true);
  SpreadsheetApp.getUi().alert('✅ 営業優先シートに ' + json.records.length + ' 社（17列）反映完了');
}

function syncTaskSheet() {
  let json;
  try { json = fetchSalesList_(); }
  catch (e) { SpreadsheetApp.getUi().alert('❌ ' + e.message); return; }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const taskRows = json.records.filter(r =>
    r && Array.isArray(r.row) && typeof r.row[15] === 'string' && r.row[15].indexOf('https://') === 0
  );
  const taskJson = Object.assign({}, json, { records: taskRows });
  syncSheet_(ss, SHEET_TASK, taskJson, false);
  SpreadsheetApp.getUi().alert('✅ タスク管理シートに ' + taskRows.length + ' 社（16列）反映完了');
}

/* ============================================================
 *  共通: シート単位の書き込み
 *  @param {boolean} isPriority - true: 営業優先(17列+Q列長文) / false: タスク管理(16列)
 * ============================================================ */
function syncSheet_(ss, sheetName, json, isPriority) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  const numCols = isPriority ? NUM_COLS_PRIORITY : NUM_COLS_TASK;
  const headers = isPriority
    ? (json.headers_priority || DEFAULT_HEADERS_PRIORITY)
    : (json.headers_task     || json.headers || DEFAULT_HEADERS_TASK);
  const widths = isPriority
    ? (json.column_widths_priority || DEFAULT_WIDTHS_PRIORITY)
    : (json.column_widths_task     || json.column_widths || DEFAULT_WIDTHS_TASK);
  const rowH = json.row_height_px || ROW_HEIGHT_PX;

  // 1. ヘッダ
  sheet.getRange(HEADER_ROW, 1, 1, numCols).setValues([headers]);

  // 2. 既存データクリア
  const lastRow = sheet.getLastRow();
  if (lastRow >= DATA_START_ROW) {
    sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, sheet.getMaxColumns()).clear();
  }

  // 3. データ整形
  const cleaned = json.records.map(rec => {
    if (!rec || !Array.isArray(rec.row)) {
      throw new Error('JSON record の構造が不正です: row 配列がありません。\n対象: ' + JSON.stringify(rec).substring(0, 200));
    }
    // A〜P列: 既存16列をベースに
    const base = rec.row.slice(0, NUM_COLS_TASK);
    while (base.length < NUM_COLS_TASK) base.push('');

    // L/M列 強制空白
    base[11] = '';
    base[12] = '';

    // O列以外（A〜N, P列）: 改行除去
    for (let i = 0; i < NUM_COLS_TASK; i++) {
      if (i === 14) continue;
      if (typeof base[i] === 'string') {
        base[i] = base[i].replace(/\r/g, '').replace(/\n/g, ' ').replace(/\\n/g, ' ');
      }
    }

    // O列(DM短文): 両シートとも改行なし1行
    const shortDm = String(base[14] || '').replace(/\r/g, '').replace(/\n/g, ' ').replace(/\\n/g, ' ');
    base[14] = shortDm.length > 50 ? shortDm :
      '【DM文章未生成】 ' + (base[2] || '') + ' / LP URL: ' + (base[15] || '');

    if (!isPriority) {
      // タスク管理シート: 16列で返す
      return base;
    }

    // 営業優先シート: 17列に拡張、Q列(index 16)に印刷用DM長文
    let printDm = '';
    if (typeof rec.dm_long === 'string' && rec.dm_long.length > 100) {
      printDm = rec.dm_long;  // 改行保持
    } else {
      printDm = '【印刷用DM文章 未生成】 ' + (base[2] || '');
    }
    return base.concat([printDm]);
  });

  if (cleaned.length === 0) return;

  // 4. 一括書き込み
  sheet.getRange(DATA_START_ROW, 1, cleaned.length, numCols).setValues(cleaned);

  // 5. 表示設定
  const dataRange = sheet.getRange(1, 1, cleaned.length + 1, numCols);
  dataRange.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  dataRange.setVerticalAlignment('middle');
  sheet.setRowHeightsForced(1, cleaned.length + 1, rowH);

  for (let i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }

  // ヘッダ装飾
  sheet.getRange(1, 1, 1, numCols)
    .setFontWeight('bold')
    .setBackground('#f3f4f6')
    .setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  // 注釈
  sheet.getRange(1, 12).setNote('🚫 完全空白固定（運用者が手動管理）');
  sheet.getRange(1, 13).setNote('🚫 完全空白固定（運用者が手動管理）');
  if (isPriority) {
    sheet.getRange(1, 17).setNote(
      '📝 印刷用DM文章（改行あり長文）\n' +
      'セル選択→Cmd+C → Google Docsに貼付で改行が再現されます。\n' +
      'そのまま印刷・送付可能な営業文として設計されています。'
    );
  }

  SpreadsheetApp.flush();
}

/* ============================================================
 *  応急処置: L列・M列 全空白化
 * ============================================================ */
function clearLMColumns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let total = 0;
  [SHEET_PRIORITY, SHEET_TASK].forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const lastRow = Math.max(sh.getLastRow(), 2);
    sh.getRange(2, 12, lastRow - 1, 2).clearContent();
    total += (lastRow - 1) * 2;
  });
  SpreadsheetApp.getUi().alert('✅ L列・M列を空白化（' + total + ' セル）');
}

/* ============================================================
 *  応急処置: 表示設定だけリセット
 * ============================================================ */
function resetDisplayOnly() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // 営業優先=17列, タスク管理=16列
  const pri = ss.getSheetByName(SHEET_PRIORITY);
  if (pri) {
    const lastRow = Math.max(pri.getLastRow(), 2);
    pri.getRange(1, 1, lastRow, NUM_COLS_PRIORITY).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    pri.setRowHeightsForced(1, lastRow, ROW_HEIGHT_PX);
  }
  const task = ss.getSheetByName(SHEET_TASK);
  if (task) {
    const lastRow = Math.max(task.getLastRow(), 2);
    task.getRange(1, 1, lastRow, NUM_COLS_TASK).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    task.setRowHeightsForced(1, lastRow, ROW_HEIGHT_PX);
  }
  SpreadsheetApp.getUi().alert('✅ 折り返し→切り詰め / 行高21px に再設定');
}

/* ============================================================
 *  データソース確認
 * ============================================================ */
function showDataSource() {
  let info = 'データソース URL:\n' + DATA_JSON_URL + '\n\n';
  try {
    const json = fetchSalesList_();
    info += '✅ 取得成功\n\n';
    info += 'スキーマ: ' + (json.schema_version || '不明') + '\n';
    info += 'データ生成日時: ' + (json.generated_at || '不明') + '\n';
    info += 'データ日付: ' + (json.date || '不明') + '\n';
    info += '会社数: ' + json.records.length + '\n';
    info += '営業優先シート列数: ' + (json.num_cols_priority || 16) + '\n';
    info += 'タスク管理シート列数: ' + (json.num_cols_task || 16) + '\n';
    if (json.records.length > 0) {
      const nos = json.records.map(r => r.no);
      info += '管理番号範囲: ' + Math.min.apply(null, nos) + ' 〜 ' + Math.max.apply(null, nos);
    }
  } catch (e) {
    info += '❌ 取得失敗: ' + e.message;
  }
  SpreadsheetApp.getUi().alert(info);
}
