/**
 * Apps Script Web App に追加するエンドポイント:
 *   mode: "update_postal_code_only"
 *
 * 既存「新シート」の各行を「会社名 + 旧住所(部分一致)」で照合し、
 * C列(住所)のみを new_address で上書きする。
 *
 * - G列(DM送付)/H列(面談状況)/I列(備考) は絶対に触らない
 * - 一致しなかった行はスキップ（errors に記録）
 * - K列(DM文章)・J列(LP URL) も触らない
 *
 * 既存の doPost(e) の冒頭で mode 判定を追加し、
 * "update_postal_code_only" の場合はこの関数を呼ぶように差し込んでください。
 *
 * リクエスト形式:
 * {
 *   "token": "WRITE_TOKEN",
 *   "mode": "update_postal_code_only",
 *   "records": [
 *     {
 *       "company_name": "株式会社AA",
 *       "old_address": "大阪府大阪市淀川区新高4丁目15番1-605号",
 *       "new_address": "〒532-0033 大阪府大阪市淀川区新高4丁目15番1-605号"
 *     },
 *     ...
 *   ]
 * }
 */

// ─── doPost に追加する差し込みコード ───
// function doPost(e) {
//   try {
//     const body = JSON.parse(e.postData.contents);
//     if (body.token !== WRITE_TOKEN) {
//       return _json({ ok: false, error: "invalid token" });
//     }
//
//     if (body.mode === "update_postal_code_only") {
//       return _json(updatePostalCodesOnly(body.records || []));
//     }
//
//     // 既存の追加処理（mode未指定 or "append"）
//     return _json(appendRecordsToMainSheet(body.records || []));
//   } catch (err) {
//     return _json({ ok: false, error: String(err) });
//   }
// }

/**
 * 新シートのC列(住所)のみを更新する。G/H/I/J/K は触らない。
 * 照合は「B列(会社名)が一致 かつ C列(現在の住所)が old_address を含むか、
 *  または old_address が C列を含む（郵便番号付き⇔なしを許容）」で行う。
 *
 * @param {Array<{company_name:string, old_address:string, new_address:string}>} records
 * @return {Object} 結果サマリ
 */
function updatePostalCodesOnly(records) {
  const SHEET_NAME = "新シート";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    return { ok: false, error: "新シートが見つかりません" };
  }

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return { ok: false, error: "新シートにデータがありません" };
  }

  // 1行目はヘッダー想定。B列(会社名)とC列(住所)を一括読込
  const range = sh.getRange(2, 2, lastRow - 1, 2); // B〜C列
  const values = range.getValues(); // [[name, addr], ...]

  let updated = 0;
  let notFound = 0;
  let alreadyMatched = 0;
  const updatedRows = [];
  const notFoundList = [];

  // 会社名→行番号(シート上の実行番号) のマップを構築
  const nameToRow = new Map();
  for (let i = 0; i < values.length; i++) {
    const nm = String(values[i][0] || "").trim();
    if (!nm) continue;
    // 同名複数行の可能性に備えて配列で保持
    if (!nameToRow.has(nm)) nameToRow.set(nm, []);
    nameToRow.get(nm).push({
      rowIndex: i + 2, // シート上の行番号
      currentAddr: String(values[i][1] || ""),
    });
  }

  // 一括更新用配列
  const updates = []; // [{row, value}]

  for (const rec of records) {
    const nm = String(rec.company_name || "").trim();
    const oldA = String(rec.old_address || "").trim();
    const newA = String(rec.new_address || "").trim();
    if (!nm || !newA) {
      notFoundList.push({ company_name: nm, reason: "company_name or new_address empty" });
      notFound++;
      continue;
    }

    const candidates = nameToRow.get(nm) || [];
    if (candidates.length === 0) {
      notFoundList.push({ company_name: nm, reason: "company not found in 新シート" });
      notFound++;
      continue;
    }

    // 候補の中から、現在のC列が old_address と一致 or 包含関係にある行を選ぶ
    // 郵便番号部分を除去して住所本体で比較
    const normalize = (s) => String(s || "").replace(/^〒\d{3}-?\d{4}\s*/, "").trim();
    const oldANorm = normalize(oldA);

    let matched = null;
    for (const c of candidates) {
      const curNorm = normalize(c.currentAddr);
      if (curNorm === oldANorm || curNorm.indexOf(oldANorm) >= 0 || oldANorm.indexOf(curNorm) >= 0) {
        matched = c;
        break;
      }
    }
    if (!matched) {
      // 旧住所が空文字でも、候補が1社しかなければ仮一致として採用（任意動作）
      if (candidates.length === 1 && oldA === "") {
        matched = candidates[0];
      } else {
        notFoundList.push({
          company_name: nm,
          reason: "old_address mismatch",
          candidates_addr: candidates.map(c => c.currentAddr),
        });
        notFound++;
        continue;
      }
    }

    // 既に同じ値ならスキップ
    if (String(matched.currentAddr).trim() === newA) {
      alreadyMatched++;
      continue;
    }

    updates.push({ row: matched.rowIndex, value: newA });
    updatedRows.push({
      row: matched.rowIndex,
      company_name: nm,
      old: matched.currentAddr,
      new: newA,
    });
  }

  // 一括書き込み (C列のみ)
  // G/H/I/J/K列は一切触らない
  for (const u of updates) {
    sh.getRange(u.row, 3).setValue(u.value); // C列 = 3列目
  }
  updated = updates.length;

  return {
    ok: true,
    mode: "update_postal_code_only",
    requested: records.length,
    updated: updated,
    already_up_to_date: alreadyMatched,
    not_found: notFound,
    updated_rows: updatedRows,
    not_found_list: notFoundList,
    note: "C列(住所)のみを更新しました。G/H/I/J/K列は変更していません。",
  };
}

/* ─── 動作確認用ヘルパー（任意） ─── */
function _testUpdateOne() {
  const res = updatePostalCodesOnly([{
    company_name: "株式会社AA",
    old_address: "大阪府大阪市淀川区新高4丁目15番1-605号",
    new_address: "〒532-0033 大阪府大阪市淀川区新高4丁目15番1-605号"
  }]);
  Logger.log(JSON.stringify(res, null, 2));
}
