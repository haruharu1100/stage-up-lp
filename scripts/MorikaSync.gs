/**
 * 株式会社MORIKA 営業リスト自動同期 Apps Script（完成版）
 * --------------------------------------------------------------
 *
 * 機能:
 *   - GitHub上の morika_list.json を UrlFetchApp で取得
 *   - スプレッドシートの「MORIKA営業リスト」シートに反映
 *   - A〜F列・J列・K列のみ更新（G/H/I列は既存値を保持）
 *   - K列(DM文章)は折り返し表示
 *   - 1時間おきの自動更新トリガー作成/削除に対応
 *
 * 既存の営業優先シート・タスク管理シートには一切触りません。
 *
 * 初回設置:
 *   1. スプレッドシート → 拡張機能 → Apps Script
 *   2. 既存コードを全削除 → このコード全文を貼り付け → 保存（Cmd+S）
 *   3. シートをリロード → メニュー「MORIKA同期」が表示
 *   4. 初回実行時のみ承認ダイアログ → 「許可」
 *
 * 日々の運用:
 *   メニュー「MORIKA同期 → MORIKAリストを同期」を押すだけ。
 *   または「1時間おきの自動更新トリガーを作成」で完全自動化。
 */

// ========== 設定 ==========
const MORIKA_JSON_URL = 'https://raw.githubusercontent.com/haruharu1100/stage-up-lp/main/data/morika_list.json';
const SHEET_NAME      = 'MORIKA営業リスト';
const NUM_COLS        = 11;  // A〜K
const ROW_HEIGHT_PX   = 21;

const HEADERS = [
  '管理番号',     // A
  '会社名',       // B
  '住所',         // C
  'HP URL',       // D
  'LINE有無',     // E
  '業種予測',     // F
  'DM送付',       // G ← 既存値保持
  '面談状況',     // H ← 既存値保持
  '備考',         // I ← 既存値保持
  'LP URL',       // J
  'DM文章',       // K
];

const COLUMN_WIDTHS = [60, 240, 320, 220, 70, 140, 80, 80, 240, 280, 700];

// JSON更新対象カラム index (0-indexed)
const UPDATE_COLS = [0, 1, 2, 3, 4, 5, 9, 10];  // A,B,C,D,E,F,J,K
const PROTECTED_COLS = [6, 7, 8];                // G,H,I（人間が手入力）

/* ============================================================
 *  カスタムメニュー
 * ============================================================ */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('MORIKA同期')
    .addItem('MORIKAリストを同期', 'syncNewSheet')
    .addSeparator()
    .addItem('1時間おきの自動更新トリガーを作成', 'createHourlyTrigger')
    .addItem('自動更新トリガーを削除', 'deleteHourlyTrigger')
    .addItem('現在のトリガー一覧を表示', 'listTriggers')
    .addSeparator()
    .addItem('データソース情報を表示', 'showDataSource')
    .addToUi();
}

/* ============================================================
 *  JSON取得（キャッシュバスター付き）
 * ============================================================ */
function fetchMorikaJson_() {
  const url = MORIKA_JSON_URL + '?t=' + Date.now();
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'Cache-Control': 'no-cache' },
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('JSON取得失敗 HTTP ' + code + '\nURL: ' + url +
      '\nレスポンス先頭: ' + res.getContentText().substring(0, 300));
  }
  return JSON.parse(res.getContentText());
}

/* ============================================================
 *  JSON 構造の後方互換正規化
 *  対応スキーマ:
 *    - { records: [{ row: [10要素], dm_morika: "...", ... }] }
 *    - { records: [{ new_row: [10要素], dm_morika: "...", ... }] }
 *    - { rows: [...] }
 *    - 配列直下: [...]
 *    - キー名違い: rec.no/management_no/id, rec.name/company_name 等
 * ============================================================ */
function normalizeRecords_(json) {
  // 1. レコード配列を取り出す
  let raw;
  if (Array.isArray(json)) raw = json;
  else if (Array.isArray(json.records)) raw = json.records;
  else if (Array.isArray(json.rows))    raw = json.rows;
  else if (Array.isArray(json.data))    raw = json.data;
  else throw new Error('JSONからレコード配列を抽出できません。トップレベルキーを確認してください');

  // 2. 各レコードを「行データ + DM文章」に正規化
  return raw.map(rec => {
    // 行データ抽出
    let row;
    if (Array.isArray(rec.row)) row = rec.row;
    else if (Array.isArray(rec.new_row)) row = rec.new_row;
    else if (Array.isArray(rec)) row = rec;
    else {
      // オブジェクト形式 → 個別キーから組み立て
      row = [
        rec.no || rec.management_no || rec.managementNo || rec.id || rec.mgmt_no || '',
        rec.name || rec.company_name || rec.companyName || rec.kaisha || '',
        rec.address || rec.addr || rec.addr_z || rec.address_with_zip || '',
        rec.hp_url || rec.hpUrl || rec.hp || rec.website || rec.website_url || '',
        rec.line || rec.line_yn || rec.line_status || '',
        rec.industry || rec.gyoshu || rec.business || rec.category || '汎用コーポレート',
        '', '', '',  // G/H/I はJSON側に値があっても無視（既存値保持のため）
        rec.lp_url || rec.lpUrl || rec.url || rec.lp || '',
      ];
    }
    // パディング
    while (row.length < 10) row.push('');

    // DM文章抽出
    const dm = rec.dm_morika || rec.dmMorika || rec.dm_long || rec.dmLong || rec.dm || rec.dm_text || rec.dmText || '';

    return { row: row.slice(0, 10), dm: String(dm) };
  });
}

/* ============================================================
 *  メイン: MORIKA新シート反映
 * ============================================================ */
function syncNewSheet() {
  const t0 = new Date();

  // 1. JSON取得
  let json;
  try {
    json = fetchMorikaJson_();
  } catch (e) {
    safeAlert_('❌ ' + e.message);
    return;
  }

  // 2. レコード正規化
  let records;
  try {
    records = normalizeRecords_(json);
  } catch (e) {
    safeAlert_('❌ ' + e.message);
    return;
  }

  if (records.length === 0) {
    safeAlert_('⚠️ JSONレコード0件');
    return;
  }

  // 3. シート取得 or 作成
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  const isNew = !sheet;
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  // 4. 既存のG/H/I値を「管理番号 → {g, h, i}」マップとして取得
  const existingMap = {};
  const lastRow = sheet.getLastRow();
  if (!isNew && lastRow >= 2) {
    const existingValues = sheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues();
    existingValues.forEach(rowVals => {
      const key = String(rowVals[0]);
      if (key) {
        existingMap[key] = {
          g: rowVals[6] || '',
          h: rowVals[7] || '',
          i: rowVals[8] || '',
        };
      }
    });
  }

  // 5. ヘッダ書き込み
  sheet.getRange(1, 1, 1, NUM_COLS).setValues([HEADERS]);

  // 6. 新データ行 組み立て (G/H/I は既存値マージ)
  const newRows = records.map(rec => {
    const r = rec.row;
    const key = String(r[0]);
    const ex = existingMap[key] || { g: '', h: '', i: '' };
    return [
      r[0],           // A 管理番号
      cleanText_(r[1]),  // B 会社名
      cleanText_(r[2]),  // C 住所
      cleanText_(r[3]),  // D HP URL
      cleanText_(r[4]),  // E LINE有無
      cleanText_(r[5]),  // F 業種予測
      ex.g,           // G ← 既存値保持
      ex.h,           // H ← 既存値保持
      ex.i,           // I ← 既存値保持
      cleanText_(r[9]),  // J LP URL
      String(rec.dm),    // K DM文章 (改行保持)
    ];
  });

  // 7. データ範囲をクリア（既存G/H/Iは上で保存済みなのでクリアしてOK）
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clear();
  }

  // 8. 一括書き込み
  sheet.getRange(2, 1, newRows.length, NUM_COLS).setValues(newRows);

  // 9. 表示設定
  // A〜J列: CLIP (切り詰め)
  const aToJ = sheet.getRange(1, 1, newRows.length + 1, NUM_COLS - 1);
  aToJ.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  aToJ.setVerticalAlignment('top');
  // K列: WRAP (折り返し)
  const kRange = sheet.getRange(1, NUM_COLS, newRows.length + 1, 1);
  kRange.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  kRange.setVerticalAlignment('top');
  kRange.setFontSize(11);

  // 列幅
  for (let i = 0; i < COLUMN_WIDTHS.length; i++) {
    sheet.setColumnWidth(i + 1, COLUMN_WIDTHS[i]);
  }

  // ヘッダ装飾
  sheet.getRange(1, 1, 1, NUM_COLS)
    .setFontWeight('bold')
    .setBackground('#f3f4f6')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.setRowHeightsForced(1, 1, ROW_HEIGHT_PX);

  // G/H/I列ヘッダにメモ
  sheet.getRange(1, 7).setNote('🚫 自動更新時に既存値を保持します（人間が手入力する欄）');
  sheet.getRange(1, 8).setNote('🚫 自動更新時に既存値を保持します（人間が手入力する欄）');
  sheet.getRange(1, 9).setNote('🚫 自動更新時に既存値を保持します（人間が手入力する欄）');
  sheet.getRange(1, 11).setNote('📝 改行あり長文DM。セル選択→Cmd+C → Google Docs貼付で改行が再現されます。');

  SpreadsheetApp.flush();

  const sec = ((new Date() - t0) / 1000).toFixed(1);
  const preserved = Object.keys(existingMap).length;
  const msg =
    '✅ MORIKA営業リスト 同期完了\n\n' +
    '反映社数: ' + newRows.length + ' 社\n' +
    'G/H/I 既存値保持: ' + preserved + ' 社\n' +
    'シート: ' + SHEET_NAME + ' (gid=' + sheet.getSheetId() + ')\n' +
    'データ生成日時: ' + (json.generated_at || '不明') + '\n' +
    '処理時間: ' + sec + ' 秒';
  Logger.log(msg);
  safeAlert_(msg);
}

/* ============================================================
 *  ヘルパー
 * ============================================================ */
function cleanText_(s) {
  if (s == null) return '';
  return String(s).replace(/\r/g, '').replace(/\n/g, ' ').replace(/\\n/g, ' ');
}

function safeAlert_(msg) {
  // トリガー実行時はUIにアクセスできないので Logger に出す
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log(msg);
  }
}

/* ============================================================
 *  自動更新トリガー
 * ============================================================ */
function createHourlyTrigger() {
  // 既存の syncNewSheet トリガーを全て削除
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncNewSheet') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  // 新規 1時間おきトリガー
  ScriptApp.newTrigger('syncNewSheet')
    .timeBased()
    .everyHours(1)
    .create();
  safeAlert_(
    '✅ 1時間おきの自動更新トリガーを作成しました\n\n' +
    '既存トリガー削除: ' + removed + '\n' +
    '新規トリガー: 1個（1時間おきにsyncNewSheet実行）\n\n' +
    '※ Google Apps Scriptの仕様により、正確に「毎正時」ではなく\n' +
    '   「最後の実行から1時間経過後」に実行されます。'
  );
}

function deleteHourlyTrigger() {
  let count = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncNewSheet') {
      ScriptApp.deleteTrigger(t);
      count++;
    }
  });
  safeAlert_('✅ ' + count + ' 個のトリガーを削除しました');
}

function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let info = '【現在のトリガー一覧】\n\n';
  if (triggers.length === 0) {
    info += '（トリガーは設定されていません）';
  } else {
    triggers.forEach((t, i) => {
      info += (i + 1) + '. ' + t.getHandlerFunction() + ' / ' + t.getEventType() + ' / id=' + t.getUniqueId() + '\n';
    });
  }
  safeAlert_(info);
}

/* ============================================================
 *  データソース情報
 * ============================================================ */
function showDataSource() {
  let info = '【データソース情報】\n\n';
  info += 'URL: ' + MORIKA_JSON_URL + '\n';
  info += 'シート名: ' + SHEET_NAME + '\n';
  info += '列数: ' + NUM_COLS + '\n';
  info += '保護列(G/H/I): 既存値を保持\n\n';

  try {
    const json = fetchMorikaJson_();
    const records = normalizeRecords_(json);
    info += '✅ JSON取得成功\n';
    info += 'スキーマ: ' + (json.schema_version || '不明') + '\n';
    info += 'データ生成日時: ' + (json.generated_at || '不明') + '\n';
    info += '会社数: ' + records.length + '\n';
    if (records.length > 0) {
      info += '先頭社: ' + records[0].row[1] + '\n';
      info += '末尾社: ' + records[records.length - 1].row[1] + '\n';
      info += '先頭DM文字数: ' + records[0].dm.length + '\n';
    }
  } catch (e) {
    info += '❌ JSON取得失敗: ' + e.message;
  }
  safeAlert_(info);
}
