import { appendDecision, ensureStructure, vaultAvailable, OS_ROOT } from '../lib/obsidian';

/**
 * 検索基盤についての判断を Obsidian の DECISIONS.md に残す。
 *
 * 何度も走らせると同じ内容が積み上がるため、これは1回だけ実行する記録用スクリプト。
 * （日々の同期は npm run obsidian の方）
 *
 * ここに残すのは「なぜそう決めたか」。決定だけを残すと、後から状況が変わった時に
 * その決定をひっくり返してよいのか判断できなくなる。
 */
function main() {
  if (!vaultAvailable()) {
    console.log('Obsidian Vaultが見つかりません（ORICO未接続の可能性）。書き込みをスキップしました。');
    return;
  }
  ensureStructure();

  appendDecision({
    ideaId: null,
    kind: '検索基盤の方針：Google Custom Search JSON API を中核にしない',
    before: 'Google Custom Search JSON API の鍵取得を待って、これを主要な検索基盤にする前提だった',
    after: 'LEGACY / OPTIONAL に格下げ。既存コードは削除せず、鍵を既に持っている場合のみ動く扱いにした',
    reason:
      '2026年8月時点のGoogle公式情報では、Custom Search JSON API は新規顧客には提供されず、' +
      '既存顧客向けも2027年1月1日に終了予定。数年動かし続ける前提のシステムの中核を、' +
      '終了日が決まっている外部サービスに置くと、その日に発掘が止まって事業ごと止まる',
    hypothesis:
      '検索エンジンを差し替え可能にしておけば、提供終了や値上げが起きても、' +
      '呼び出し側のコードを変えずに乗り換えられる',
    outcome:
      '検索処理は search(query) の共通入口だけを使う形にした。' +
      'Google 用のコードは残っているが、新規採用はしない',
    adopted: true,
    learning:
      '外部サービスに依存する部分は、最初から差し替え口を作る。' +
      '「今使えるから」で1社に固定すると、その会社の都合で事業が止まる',
  });

  appendDecision({
    ideaId: null,
    kind: '検索エンジンの採用順：第一候補 Brave / 第二候補 Tavily / Google は LEGACY',
    before: 'Google Custom Search JSON API の1本だけ',
    after:
      'SEARCH_PROVIDER を4種類（BRAVE / TAVILY / GOOGLE_LEGACY / FUTURE_PROVIDER）に分け、' +
      '普段の広い検索は Brave、上位候補の深掘りだけ Tavily を使う二段階にした',
    reason:
      'Brave は独自の検索索引を持ち、公式APIとして提供されていて安く広く引ける（スクレイピングではない）。' +
      'Tavily は単純検索ではなく、深掘り調査・ページ本文抽出・複数ソース比較に向く代わりに単価が高い。' +
      '発掘した158件すべてに高価な調査をかけると費用が見合わないため、' +
      '「広く安く絞る → 上位だけ深く調べる」に分けた',
    hypothesis:
      '安い検索で20〜50件まで絞り、そこから深掘りで10件に絞れば、' +
      '調査費用を抑えたまま判断の精度を落とさずに済む',
    outcome:
      '鍵は BRAVE_SEARCH_API_KEY / TAVILY_API_KEY として .env のみに置く。' +
      'Git・Obsidian・CSV・ログには一切書かない。鍵が未設定の間は検索を実行せず安全停止する。' +
      '検索費用は Provider ごとに回数と見積り額を記録し、P&L の検索API費に乗せる',
    adopted: true,
    learning:
      '1つの検索エンジンの結果だけで「日本に競合がいない」と結論を出さない。' +
      '最低2種類の情報源が揃うまでは判定不能のままにする',
  });

  console.log(`DECISIONS.md へ2件の判断を記録しました: ${OS_ROOT}/09_LEARNINGS/DECISIONS.md`);
}

main();
