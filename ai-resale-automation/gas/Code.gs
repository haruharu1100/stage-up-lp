/**
 * ================================================================
 * AI物販自動化システム  Google Apps Script(Code.gs)
 * ----------------------------------------------------------------
 * このスクリプトは Googleスプレッドシート に貼り付けて使います。
 *
 * できること:
 *   ・専用メニュー「物販ツール」を追加
 *   ・ヘッダー(A〜Z)を自動でセット
 *   ・利益率・出品判定の色分け(条件付き書式)
 *   ・X列「出品OKチェック」にチェックボックスを設置
 *   ・出品OKした行だけを別シート「出品リスト」へコピー
 *   ・CSVとしてダウンロード(Googleドライブに保存)
 *
 * 使い方は README.md の「Google Apps Script」を参照してください。
 * ================================================================
 */

// ヘッダー(Pythonの出力CSVと同じ並び:A〜Z)
var HEADERS = [
  '取得日', '管理番号', '商品名', 'JANコード', '型番', '仕入れ先', '仕入れURL',
  '仕入れ価格', '在庫数', '販売先', '販売価格', '販売手数料', '送料', 'その他費用',
  '粗利益', '利益率', '過去1ヶ月販売数', '競合数', '禁止商品リスク', '出品判定',
  'AIタイトル', 'AI説明文', '注意事項', '出品OKチェック', 'ステータス', '備考'
];

var DATA_SHEET_NAME = '出品候補';
var LISTING_SHEET_NAME = '出品リスト';

/**
 * スプレッドシートを開いたときに、自動でメニューを追加する。
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('物販ツール')
    .addItem('① ヘッダーを準備する', 'setupHeaders')
    .addItem('② 色分け・チェックボックスを設定する', 'setupFormatting')
    .addItem('③ 出品OKだけを出品リストへコピー', 'copyCheckedToListing')
    .addItem('④ このシートをCSVで保存', 'exportCsv')
    .addToUi();
}

/**
 * ① ヘッダー(A〜Z)を1行目にセットする。
 */
function setupHeaders() {
  var sheet = getOrCreateSheet(DATA_SHEET_NAME);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.getRange(1, 1, 1, HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#1f3864')
    .setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  SpreadsheetApp.getActiveSpreadsheet().toast('ヘッダーを準備しました。', '完了', 5);
}

/**
 * ② 利益率・出品判定の色分けと、X列のチェックボックスを設定する。
 */
function setupFormatting() {
  var sheet = getOrCreateSheet(DATA_SHEET_NAME);
  var maxRow = 1000; // 余裕を持って1000行まで設定

  // --- X列(24列目)出品OKチェックにチェックボックス ---
  sheet.getRange(2, 24, maxRow - 1, 1).insertCheckboxes();

  // --- 条件付き書式をいったんクリア ---
  sheet.clearConditionalFormatRules();
  var rules = [];

  // 出品判定(T列=20列目)の色分け
  var judgeRange = sheet.getRange(2, 20, maxRow - 1, 1);
  rules.push(makeTextRule(judgeRange, '出品候補', '#c6efce', '#006100')); // 緑
  rules.push(makeTextRule(judgeRange, '要確認', '#ffeb9c', '#9c6500'));   // 黄
  rules.push(makeTextRule(judgeRange, '利益不足', '#ffc7ce', '#9c0006')); // 赤
  rules.push(makeTextRule(judgeRange, '需要不足', '#ffc7ce', '#9c0006')); // 赤
  rules.push(makeTextRule(judgeRange, '在庫切れ', '#d9d9d9', '#3f3f3f')); // 灰
  rules.push(makeTextRule(judgeRange, '除外', '#d9d9d9', '#3f3f3f'));     // 灰

  // 利益率(P列=16列目)が25%以上なら緑、未満なら赤
  var rateRange = sheet.getRange(2, 16, maxRow - 1, 1);
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThanOrEqualTo(25)
      .setBackground('#c6efce')
      .setRanges([rateRange])
      .build()
  );
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(25)
      .setBackground('#ffc7ce')
      .setRanges([rateRange])
      .build()
  );

  // 禁止商品リスク(S列=19列目)が「あり」なら黄色
  var riskRange = sheet.getRange(2, 19, maxRow - 1, 1);
  rules.push(makeTextRule(riskRange, 'あり', '#ffeb9c', '#9c6500'));

  sheet.setConditionalFormatRules(rules);
  SpreadsheetApp.getActiveSpreadsheet().toast('色分けとチェックボックスを設定しました。', '完了', 5);
}

/**
 * ③ X列(出品OKチェック)にチェックが入った行を「出品リスト」シートへコピーする。
 */
function copyCheckedToListing() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var source = getOrCreateSheet(DATA_SHEET_NAME);
  var lastRow = source.getLastRow();
  if (lastRow < 2) {
    ss.toast('データがありません。', '注意', 5);
    return;
  }

  var values = source.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var checkedRows = [];
  for (var i = 0; i < values.length; i++) {
    var isChecked = values[i][23]; // X列(0始まりで23番目)
    if (isChecked === true) {
      checkedRows.push(values[i]);
    }
  }

  if (checkedRows.length === 0) {
    ss.toast('チェックされた行がありません。X列にチェックを入れてください。', '注意', 6);
    return;
  }

  var target = getOrCreateSheet(LISTING_SHEET_NAME);
  target.clear();
  target.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  target.getRange(2, 1, checkedRows.length, HEADERS.length).setValues(checkedRows);
  target.setFrozenRows(1);

  ss.toast(checkedRows.length + ' 件を「' + LISTING_SHEET_NAME + '」へコピーしました。', '完了', 6);
}

/**
 * ④ 現在のデータシートをCSVファイルとしてGoogleドライブに保存する。
 */
function exportCsv() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(DATA_SHEET_NAME);
  var lastRow = sheet.getLastRow();
  var lastCol = HEADERS.length;
  if (lastRow < 1) {
    ss.toast('データがありません。', '注意', 5);
    return;
  }

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var csv = values.map(function (row) {
    return row.map(function (cell) {
      var text = (cell === null || cell === undefined) ? '' : String(cell);
      // ダブルクォート・カンマ・改行を含む場合はクォートで囲む
      if (text.indexOf('"') !== -1 || text.indexOf(',') !== -1 || text.indexOf('\n') !== -1) {
        text = '"' + text.replace(/"/g, '""') + '"';
      }
      return text;
    }).join(',');
  }).join('\n');

  var fileName = '出品候補_' + formatNow() + '.csv';
  // BOMを付けてExcelでも文字化けしないようにする
  var blob = Utilities.newBlob('﻿' + csv, 'text/csv', fileName);
  var file = DriveApp.createFile(blob);

  ss.toast('Googleドライブに保存しました: ' + fileName, '完了', 8);
  Logger.log('保存先URL: ' + file.getUrl());
}

/* ------------------- 補助関数(さわらなくてOK)------------------- */

function getOrCreateSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function makeTextRule(range, text, bgColor, fontColor) {
  return SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(text)
    .setBackground(bgColor)
    .setFontColor(fontColor)
    .setRanges([range])
    .build();
}

function formatNow() {
  var d = new Date();
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
}
