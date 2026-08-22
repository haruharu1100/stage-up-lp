import { migrate, run } from '../lib/db/client';
import { getIdea } from '../lib/dashboard';
import { buildLadder } from '../lib/products';
import { generateNoteOutline, generateSalesAssets, generateXPosts, saveContents } from '../lib/content';
import { getScore } from '../lib/score';
import { getMarketBacktest } from '../lib/backtest/market';
import { getSalesBacktest } from '../lib/backtest/montecarlo';
import { appendDecision, saveIdeaNote } from '../lib/obsidian';
import { getJapanAssessment } from '../lib/japan';

/** ONE CLICK BUSINESS の中身。外部公開はしない。原稿を作るだけ。 */
async function main() {
  await migrate();
  const id = process.argv[2];
  if (!id) {
    console.log('使い方: npm run productize -- idea_xxxxxxxx');
    return;
  }
  const idea = await getIdea(id);
  if (!idea) {
    console.log(`案件が見つかりません: ${id}`);
    return;
  }

  const [score, market, sales, japan] = await Promise.all([
    getScore(idea.id),
    getMarketBacktest(idea.id),
    getSalesBacktest(idea.id),
    getJapanAssessment(idea.id),
  ]);

  if (!sales || sales.verdict !== 'PASS') {
    console.log(`⚠ 販売バックテスト未通過（${sales?.verdict ?? '未実施'}）。原稿は作りますが販売は開始しません。`);
  }

  const products = await buildLadder(idea);
  console.log(`商品階層を作成: ${products.length}段`);
  for (const p of products) {
    console.log(`  LEVEL${p.level} ${p.name} — ${p.priceYen === 0 ? '無料/個別見積' : `${p.priceYen.toLocaleString()}円`}`);
  }

  const ctx = { idea, score, market, sales };
  const noteUrl = 'https://note.com/your_account/n/xxxxxxxx';
  const xs = generateXPosts(ctx, noteUrl);
  const notes = [980, 2980, 9800].map((p) => generateNoteOutline(ctx, p));
  const assets = generateSalesAssets(ctx);
  const allContent = [...xs, ...notes, ...assets];

  await saveContents(idea.id, allContent);

  const blocked = allContent.filter((c) => c.issues.some((i) => i.severity === 'BLOCK'));
  const expert = allContent.filter((c) => c.issues.some((i) => i.severity === 'EXPERT_REVIEW'));

  console.log(`\n原稿を生成: X投稿${xs.length}本 / note${notes.length}本 / 営業資料${assets.length}点`);
  console.log(`表現チェック: 公開不可 ${blocked.length}件 / 要専門家確認 ${expert.length}件`);
  for (const c of blocked) {
    console.log(`  [公開不可] ${c.title}: ${c.issues.map((i) => i.phrase).join(', ')}`);
  }

  await run('UPDATE ideas SET status = ? WHERE id = ?', ['APPROVED', idea.id]);
  idea.status = 'APPROVED';
  saveIdeaNote(idea, { score, japan, market, sales });

  appendDecision({
    ideaId: idea.id,
    kind: '事業化候補として商品化',
    before: 'REVIEWING',
    after: 'APPROVED',
    reason: `採点${score?.normalized100 ?? '未採点'}点（${score?.grade ?? '未採点'}）、販売バックテスト${sales?.verdict ?? '未実施'}`,
    hypothesis: `${idea.title} の型は日本でも通用する`,
    outcome: '未計測（公開前）',
    adopted: true,
    learning: '公開は人間承認後。原稿生成までを自動で行った',
  });

  console.log('\n公開・送信は行っていません（AUTO_PUBLISH=false）。原稿の確認後、人の手で公開してください。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
