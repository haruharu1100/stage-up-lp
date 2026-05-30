/**
 * STAGE UP 営業リスト 一括反映スクリプト v5（GitHub JSON 動的取得型）
 * --------------------------------------------------------------
 *
 * 【v5の最大変更】
 * - データを Apps Script 内に持たず、GitHub上の data/sales_list.json から取得
 * - 一度このコードを設置すれば、以降は貼り替え不要
 * - 新規会社追加・データ更新は GitHub への push だけで完結
 * - スプレッドシートでメニュー「STAGE UP同期 → 全シート一括反映」を押すだけ
 *
 * 【初回セットアップ】（一度だけ）
 *   1. スプレッドシート → 拡張機能 → Apps Script
 *   2. 既存コード全削除 → このファイル全文を貼り付け → 保存（Cmd+S）
 *   3. シートをリロード（F5）→ メニュー「STAGE UP同期」が現れる
 *   4. 初回実行時のみ承認ダイアログ → 「許可」
 *
 * 【日々の運用】
 *   1. メニュー「STAGE UP同期 → 全シート一括反映（推奨）」をクリック
 *   2. GitHubの最新 sales_list.json が自動取得・反映される
 *   ※ GitHub CDNキャッシュ最大5分の遅延あり（push直後はキャッシュバスター付きURLで取得）
 *
 * 【保証される表示設定】
 *   - L列・M列: 完全空白固定（書き込み時に強制""上書き）
 *   - 折り返し: CLIP（切り詰め）
 *   - 行の高さ: 21px
 *   - 営業優先シートのDM文章: 改行あり長文（Google Docs貼付→印刷可能）
 *   - タスク管理シートのDM文章: 短文1行（セル崩れ防止）
 */

// ========== 設定（変更可能箇所はここだけ） ==========
const DATA_JSON_URL = 'https://raw.githubusercontent.com/haruharu1100/stage-up-lp/main/data/sales_list.json';
const SHEET_PRIORITY = '営業優先シート';
const SHEET_TASK     = 'タスク管理シート';
const ROW_HEIGHT_PX  = 21;

// ========== 内部定数 ==========
const HEADER_ROW = 1;
const DATA_START_ROW = 2;
const NUM_COLS = 16;
const DEFAULT_HEADERS = [
  '取得日','管理番号','会社名','法人番号','住所','設立日',
  'HP URL','HP有無','LINE有無','スマホ対応','業種予測',
  'DM送付','面談状況','備考','DM文章','LP URL'
];
const DEFAULT_WIDTHS = [90,60,220,120,300,90,180,60,60,70,140,80,80,260,380,280];

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
  try {
    json = fetchSalesList_();
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ ' + e.message);
    return;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  syncSheet_(ss, SHEET_PRIORITY, json, true);
  const taskRows = json.records.filter(r =>
    typeof r.row[15] === 'string' && r.row[15].indexOf('https://') === 0
  );
  const taskJson = Object.assign({}, json, { records: taskRows });
  syncSheet_(ss, SHEET_TASK, taskJson, false);
  const sec = ((new Date() - t0) / 1000).toFixed(1);
  SpreadsheetApp.getUi().alert(
    '✅ 完了\n\n' +
    '営業優先シート: ' + json.records.length + ' 社（DM長文）\n' +
    'タスク管理シート: ' + taskRows.length + ' 社（DM短文）\n' +
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
  SpreadsheetApp.getUi().alert('✅ 営業優先シートに ' + json.records.length + ' 社（DM長文）反映完了');
}

function syncTaskSheet() {
  let json;
  try { json = fetchSalesList_(); }
  catch (e) { SpreadsheetApp.getUi().alert('❌ ' + e.message); return; }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const taskRows = json.records.filter(r =>
    typeof r.row[15] === 'string' && r.row[15].indexOf('https://') === 0
  );
  const taskJson = Object.assign({}, json, { records: taskRows });
  syncSheet_(ss, SHEET_TASK, taskJson, false);
  SpreadsheetApp.getUi().alert('✅ タスク管理シートに ' + taskRows.length + ' 社（DM短文）反映完了');
}

/* ============================================================
 *  共通: シート単位の書き込み
 *  @param {boolean} useLongDM - true: DM長文 / false: DM短文
 * ============================================================ */
function syncSheet_(ss, sheetName, json, useLongDM) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  const headers = json.headers || DEFAULT_HEADERS;
  const widths  = json.column_widths || DEFAULT_WIDTHS;
  const rowH    = json.row_height_px || ROW_HEIGHT_PX;

  // 1. ヘッダ
  sheet.getRange(HEADER_ROW, 1, 1, NUM_COLS).setValues([headers]);

  // 2. 既存データクリア
  const lastRow = sheet.getLastRow();
  if (lastRow >= DATA_START_ROW) {
    sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, sheet.getMaxColumns()).clear();
  }

  // 3. データ整形
  const cleaned = json.records.map(rec => {
    const out = (rec.row || []).slice(0, NUM_COLS);
    while (out.length < NUM_COLS) out.push('');
    // L/M列 強制空白
    out[11] = '';
    out[12] = '';
    // O列以外: 改行除去
    for (let i = 0; i < NUM_COLS; i++) {
      if (i === 14) continue;
      if (typeof out[i] === 'string') {
        out[i] = out[i].replace(/\r/g, '').replace(/\n/g, ' ').replace(/\\n/g, ' ');
      }
    }
    // O列: 営業優先=長文 / タスク管理=短文
    if (useLongDM && typeof rec.dm_long === 'string' && rec.dm_long) {
      out[14] = rec.dm_long;  // 改行保持
    } else {
      out[14] = String(out[14] || '').replace(/\r/g, '').replace(/\n/g, ' ').replace(/\\n/g, ' ');
    }
    return out;
  });

  if (cleaned.length === 0) return;

  // 4. 一括書き込み
  sheet.getRange(DATA_START_ROW, 1, cleaned.length, NUM_COLS).setValues(cleaned);

  // 5. 表示設定
  const dataRange = sheet.getRange(1, 1, cleaned.length + 1, NUM_COLS);
  dataRange.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  dataRange.setVerticalAlignment('middle');
  sheet.setRowHeightsForced(1, cleaned.length + 1, rowH);

  for (let i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }

  sheet.getRange(1, 1, 1, NUM_COLS)
    .setFontWeight('bold')
    .setBackground('#f3f4f6')
    .setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 12).setNote('🚫 完全空白固定（運用者が手動管理）');
  sheet.getRange(1, 13).setNote('🚫 完全空白固定（運用者が手動管理）');
  if (useLongDM) {
    sheet.getRange(1, 15).setNote(
      '📝 改行あり長文（Google Docs貼付→印刷可能）。\n' +
      'セル選択→Cmd+Cでコピー、Docsに貼り付けで改行が再現されます。'
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
  [SHEET_PRIORITY, SHEET_TASK].forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const lastRow = Math.max(sh.getLastRow(), 2);
    sh.getRange(1, 1, lastRow, NUM_COLS).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    sh.setRowHeightsForced(1, lastRow, ROW_HEIGHT_PX);
  });
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
    if (json.records.length > 0) {
      const nos = json.records.map(r => r.no);
      info += '管理番号範囲: ' + Math.min.apply(null, nos) + ' 〜 ' + Math.max.apply(null, nos);
    }
  } catch (e) {
    info += '❌ 取得失敗: ' + e.message;
  }
  SpreadsheetApp.getUi().alert(info);
}
