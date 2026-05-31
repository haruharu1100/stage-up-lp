/**
 * STAGE UP 営業リスト 一括反映スクリプト v7
 *   - 新シート（gid=2079338722, 11列, MORIKA名義DM）に対応
 *   - 既存の営業優先シート(17列)・タスク管理シート(16列) は維持
 *   - データソース: GitHub上の data/sales_list.json (schema v1.2)
 *
 * 【初回セットアップ】（一度だけ）
 *   1. 拡張機能 → Apps Script → 既存コード全削除 → このコード貼付 → 保存
 *   2. シートをリロード → メニュー「STAGE UP同期」
 *   3. 初回のみ承認 → 許可
 *
 * 【日々の運用】
 *   メニュー「STAGE UP同期 → 新シートに反映」を押すだけ
 */

// ========== 設定 ==========
const DATA_JSON_URL = 'https://raw.githubusercontent.com/haruharu1100/stage-up-lp/main/data/sales_list.json';
const SHEET_PRIORITY = '営業優先シート';
const SHEET_TASK     = 'タスク管理シート';
const SHEET_NEW_GID  = 2079338722;     // 新シートのgid
const SHEET_NEW_FALLBACK_NAME = '新シート';  // 名前で見つからない場合のフォールバック
const ROW_HEIGHT_PX  = 21;

// ========== 内部定数 ==========
const HEADER_ROW = 1;
const DATA_START_ROW = 2;

const NUM_COLS_PRIORITY = 17;
const DEFAULT_HEADERS_PRIORITY = [
  '取得日','管理番号','会社名','法人番号','住所','設立日',
  'HP URL','HP有無','LINE有無','スマホ対応','業種予測',
  'DM送付','面談状況','備考','DM文章','LP URL','印刷用DM文章'
];
const DEFAULT_WIDTHS_PRIORITY = [90,60,220,120,300,90,180,60,60,70,140,80,80,260,380,280,420];

const NUM_COLS_TASK = 16;
const DEFAULT_HEADERS_TASK = [
  '取得日','管理番号','会社名','法人番号','住所','設立日',
  'HP URL','HP有無','LINE有無','スマホ対応','業種予測',
  'DM送付','面談状況','備考','DM文章','LP URL'
];
const DEFAULT_WIDTHS_TASK = [90,60,220,120,300,90,180,60,60,70,140,80,80,260,380,280];

// 新シート 11列
const NUM_COLS_NEW = 11;
const DEFAULT_HEADERS_NEW = [
  '管理番号','会社名','住所','HP URL','LINE有無','業種予測',
  'DM送付','面談状況','備考','LP URL','DM文章'
];
const DEFAULT_WIDTHS_NEW = [60,240,300,200,70,140,80,80,240,280,420];

/* ============================================================ */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('STAGE UP同期')
    .addItem('新シートに反映（推奨・MORIKA名義）', 'syncNewSheet')
    .addSeparator()
    .addItem('既存3シート一括反映', 'syncAllSheets')
    .addItem('営業優先シートのみ反映', 'syncPrioritySheet')
    .addItem('タスク管理シートのみ反映', 'syncTaskSheet')
    .addSeparator()
    .addItem('L列・M列を空白化（応急）', 'clearLMColumns')
    .addItem('表示設定だけリセット', 'resetDisplayOnly')
    .addSeparator()
    .addItem('データソース情報', 'showDataSource')
    .addToUi();
}

/* ============================================================ */
function fetchSalesList_() {
  const url = DATA_JSON_URL + '?t=' + Date.now();
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true, followRedirects: true,
    headers: { 'Cache-Control': 'no-cache' },
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('データ取得失敗: HTTP ' + code + '\n\nURL: ' + url +
      '\nレスポンス先頭: ' + res.getContentText().substring(0, 300));
  }
  const json = JSON.parse(res.getContentText());
  if (!Array.isArray(json.records)) throw new Error('JSON構造が不正: records配列がありません');
  return json;
}

function getNewSheet_(ss) {
  // gid で取得
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === SHEET_NEW_GID) return sheets[i];
  }
  // フォールバック: 名前で
  return ss.getSheetByName(SHEET_NEW_FALLBACK_NAME);
}

/* ============================================================
 *  メイン: 新シート反映（推奨）
 * ============================================================ */
function syncNewSheet() {
  const t0 = new Date();
  let json;
  try { json = fetchSalesList_(); }
  catch (e) { SpreadsheetApp.getUi().alert('❌ ' + e.message); return; }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getNewSheet_(ss);
  if (!sheet) {
    SpreadsheetApp.getUi().alert(
      '❌ 新シートが見つかりません。\n\n' +
      'gid=' + SHEET_NEW_GID + ' のシートを開いた状態で実行するか、\n' +
      'シート名を「' + SHEET_NEW_FALLBACK_NAME + '」にしてください。'
    );
    return;
  }

  const headers = json.headers_new || DEFAULT_HEADERS_NEW;
  const widths  = json.column_widths_new || DEFAULT_WIDTHS_NEW;

  // 1. ヘッダ
  sheet.getRange(HEADER_ROW, 1, 1, NUM_COLS_NEW).setValues([headers]);

  // 2. 既存データクリア
  const lastRow = sheet.getLastRow();
  if (lastRow >= DATA_START_ROW) {
    sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, sheet.getMaxColumns()).clear();
  }

  // 3. データ整形（LP URLがある社のみ採用）
  const cleaned = [];
  json.records.forEach(rec => {
    if (!rec || !Array.isArray(rec.new_row)) return;
    const out = rec.new_row.slice(0, NUM_COLS_NEW);
    while (out.length < NUM_COLS_NEW) out.push('');
    // LP URL (J列 = index 9) が https始まりの社のみ
    if (typeof out[9] !== 'string' || out[9].indexOf('https://') !== 0) return;

    // G/H/I 列 強制空白
    out[6] = '';
    out[7] = '';
    out[8] = '';

    // 各セル改行除去（K列以外）
    for (let i = 0; i < NUM_COLS_NEW; i++) {
      if (i === 10) continue;
      if (typeof out[i] === 'string') {
        out[i] = out[i].replace(/\r/g, '').replace(/\n/g, ' ').replace(/\\n/g, ' ');
      }
    }

    // K列: MORIKA名義の長文DM
    let dm = '';
    if (typeof rec.dm_morika === 'string' && rec.dm_morika.length > 100) {
      dm = rec.dm_morika;
    } else if (typeof rec.dm_long === 'string' && rec.dm_long.length > 100) {
      // フォールバック: STAGE UP版を MORIKA に置換
      dm = rec.dm_long.replace(/STAGE UPと申します/g, '株式会社MORIKAと申します');
    } else {
      dm = '【DM文章未生成】 ' + (out[1] || '');
    }
    out[10] = dm;

    cleaned.push(out);
  });

  if (cleaned.length === 0) {
    SpreadsheetApp.getUi().alert('⚠️ LP URLがある社が見つかりませんでした。');
    return;
  }

  // 4. 一括書き込み
  sheet.getRange(DATA_START_ROW, 1, cleaned.length, NUM_COLS_NEW).setValues(cleaned);

  // 5. 表示設定
  const dataRange = sheet.getRange(1, 1, cleaned.length + 1, NUM_COLS_NEW);
  dataRange.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  dataRange.setVerticalAlignment('middle');
  sheet.setRowHeightsForced(1, cleaned.length + 1, ROW_HEIGHT_PX);

  for (let i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }

  // ヘッダ装飾
  sheet.getRange(1, 1, 1, NUM_COLS_NEW)
    .setFontWeight('bold').setBackground('#f3f4f6').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  // 注釈
  sheet.getRange(1, 7).setNote('🚫 完全空白固定（運用者が手動管理）');
  sheet.getRange(1, 8).setNote('🚫 完全空白固定（運用者が手動管理）');
  sheet.getRange(1, 9).setNote('🚫 完全空白固定（運用者が手動管理・後で手入力）');
  sheet.getRange(1, 11).setNote(
    '📝 印刷用DM文章（株式会社MORIKA名義・改行あり長文）\n' +
    'セル選択→Cmd+C → Google Docsに貼付で改行が再現されます。\n' +
    'そのまま印刷・送付可能な営業文として設計されています。'
  );

  SpreadsheetApp.flush();

  const sec = ((new Date() - t0) / 1000).toFixed(1);
  SpreadsheetApp.getUi().alert(
    '✅ 新シートに反映完了\n\n' +
    '会社数: ' + cleaned.length + ' 社（LP URLあり）\n' +
    'シート: ' + sheet.getName() + ' (gid=' + sheet.getSheetId() + ')\n' +
    '送信者名: ' + (json.sender_name_new || '株式会社MORIKA') + '\n' +
    'データ生成日時: ' + (json.generated_at || '不明') + '\n' +
    '処理時間: ' + sec + ' 秒'
  );
}

/* ============================================================
 *  既存シート3つ一括反映（後方互換）
 * ============================================================ */
function syncAllSheets() {
  const t0 = new Date();
  let json;
  try { json = fetchSalesList_(); }
  catch (e) { SpreadsheetApp.getUi().alert('❌ ' + e.message); return; }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  syncSheet_(ss, SHEET_PRIORITY, json, true);
  const taskRows = json.records.filter(r =>
    r && Array.isArray(r.row) && typeof r.row[15] === 'string' && r.row[15].indexOf('https://') === 0
  );
  syncSheet_(ss, SHEET_TASK, Object.assign({}, json, {records: taskRows}), false);
  // 新シートも更新
  try { syncNewSheet(); } catch (e) { /* 新シートなければスキップ */ }
  const sec = ((new Date() - t0) / 1000).toFixed(1);
  SpreadsheetApp.getUi().alert(
    '✅ 既存3シート + 新シート 一括反映完了\n\n処理時間: ' + sec + ' 秒'
  );
}

function syncPrioritySheet() {
  let json;
  try { json = fetchSalesList_(); }
  catch (e) { SpreadsheetApp.getUi().alert('❌ ' + e.message); return; }
  syncSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_PRIORITY, json, true);
  SpreadsheetApp.getUi().alert('✅ 営業優先シート反映完了 (' + json.records.length + ' 社)');
}

function syncTaskSheet() {
  let json;
  try { json = fetchSalesList_(); }
  catch (e) { SpreadsheetApp.getUi().alert('❌ ' + e.message); return; }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const taskRows = json.records.filter(r =>
    r && Array.isArray(r.row) && typeof r.row[15] === 'string' && r.row[15].indexOf('https://') === 0
  );
  syncSheet_(ss, SHEET_TASK, Object.assign({}, json, {records: taskRows}), false);
  SpreadsheetApp.getUi().alert('✅ タスク管理シート反映完了 (' + taskRows.length + ' 社)');
}

/* ============================================================
 *  共通: 既存シート(営業優先/タスク管理) 書き込み
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

  sheet.getRange(HEADER_ROW, 1, 1, numCols).setValues([headers]);
  const lastRow = sheet.getLastRow();
  if (lastRow >= DATA_START_ROW) {
    sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, sheet.getMaxColumns()).clear();
  }

  const cleaned = json.records.map(rec => {
    if (!rec || !Array.isArray(rec.row)) {
      throw new Error('JSON record の構造が不正です: row 配列がありません。\n対象: ' + JSON.stringify(rec).substring(0, 200));
    }
    const base = rec.row.slice(0, NUM_COLS_TASK);
    while (base.length < NUM_COLS_TASK) base.push('');
    base[11] = ''; base[12] = '';
    for (let i = 0; i < NUM_COLS_TASK; i++) {
      if (i === 14) continue;
      if (typeof base[i] === 'string') {
        base[i] = base[i].replace(/\r/g, '').replace(/\n/g, ' ').replace(/\\n/g, ' ');
      }
    }
    const shortDm = String(base[14] || '').replace(/\r/g, '').replace(/\n/g, ' ').replace(/\\n/g, ' ');
    base[14] = shortDm.length > 50 ? shortDm :
      '【DM文章未生成】 ' + (base[2] || '') + ' / LP URL: ' + (base[15] || '');
    if (!isPriority) return base;
    let printDm = (typeof rec.dm_long === 'string' && rec.dm_long.length > 100) ? rec.dm_long : '【印刷用DM文章 未生成】 ' + (base[2] || '');
    return base.concat([printDm]);
  });

  if (cleaned.length === 0) return;
  sheet.getRange(DATA_START_ROW, 1, cleaned.length, numCols).setValues(cleaned);
  const dataRange = sheet.getRange(1, 1, cleaned.length + 1, numCols);
  dataRange.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  dataRange.setVerticalAlignment('middle');
  sheet.setRowHeightsForced(1, cleaned.length + 1, rowH);
  for (let i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
  sheet.getRange(1, 1, 1, numCols)
    .setFontWeight('bold').setBackground('#f3f4f6').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 12).setNote('🚫 完全空白固定（運用者が手動管理）');
  sheet.getRange(1, 13).setNote('🚫 完全空白固定（運用者が手動管理）');
  if (isPriority) {
    sheet.getRange(1, 17).setNote('📝 改行あり長文（Google Docs貼付→印刷可能）');
  }
  SpreadsheetApp.flush();
}

/* ============================================================ */
function clearLMColumns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let total = 0;
  [SHEET_PRIORITY, SHEET_TASK].forEach(name => {
    const sh = ss.getSheetByName(name); if (!sh) return;
    const lastRow = Math.max(sh.getLastRow(), 2);
    sh.getRange(2, 12, lastRow - 1, 2).clearContent();
    total += (lastRow - 1) * 2;
  });
  // 新シートの G/H/I 列も
  const newSh = getNewSheet_(ss);
  if (newSh) {
    const lastRow = Math.max(newSh.getLastRow(), 2);
    newSh.getRange(2, 7, lastRow - 1, 3).clearContent();
    total += (lastRow - 1) * 3;
  }
  SpreadsheetApp.getUi().alert('✅ 管理列を空白化（' + total + ' セル）');
}

function resetDisplayOnly() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
  const newSh = getNewSheet_(ss);
  if (newSh) {
    const lastRow = Math.max(newSh.getLastRow(), 2);
    newSh.getRange(1, 1, lastRow, NUM_COLS_NEW).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    newSh.setRowHeightsForced(1, lastRow, ROW_HEIGHT_PX);
  }
  SpreadsheetApp.getUi().alert('✅ 折り返し→切り詰め / 行高21px に再設定');
}

function showDataSource() {
  let info = 'データソース URL:\n' + DATA_JSON_URL + '\n\n';
  try {
    const json = fetchSalesList_();
    info += '✅ 取得成功\n\n';
    info += 'スキーマ: ' + (json.schema_version || '不明') + '\n';
    info += 'データ生成日時: ' + (json.generated_at || '不明') + '\n';
    info += '会社数: ' + json.records.length + '\n';
    info += '新シートgid: ' + (json.new_sheet_gid || '不明') + '\n';
    info += '新シート送信者名: ' + (json.sender_name_new || '株式会社MORIKA') + '\n';
    info += '新シート列数: ' + (json.num_cols_new || 11) + '\n';
    if (json.records.length > 0) {
      const nos = json.records.map(r => r.no);
      info += '管理番号範囲: ' + Math.min.apply(null, nos) + ' 〜 ' + Math.max.apply(null, nos);
    }
  } catch (e) {
    info += '❌ 取得失敗: ' + e.message;
  }
  SpreadsheetApp.getUi().alert(info);
}
