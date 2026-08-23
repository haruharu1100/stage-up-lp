#!/usr/bin/env node
// X API Cost Simulator
// 2026年2月にティア制(月額プラン)は廃止され従量課金へ移行した。
// 「月額いくらのプラン」という概念は存在しないので、実際の投稿数・Read数から都度算出する。

// checked_at: 2026-08-22 / 出典: https://docs.x.com/x-api (Pay-per-use pricing)
const UNIT_PRICE_USD = {
  postNoUrl: 0.015,   // Content Create
  postWithUrl: 0.2,   // Content Create with URL
  ownedRead: 0.001,   // Owned Read (1 resource)
};

const PRICE_CHECKED_AT = '2026-08-22';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function num(v, fallback) {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`値が不正です: ${v}`);
    process.exit(1);
  }
  return n;
}

function simulate({ posts, linkPosts, metricReads }) {
  if (linkPosts > posts) {
    console.error(`--link-posts (${linkPosts}) が --posts (${posts}) を超えています`);
    process.exit(1);
  }
  const noUrlPosts = posts - linkPosts;
  const lines = [
    { label: `投稿(URLなし) ${noUrlPosts}件`, usd: noUrlPosts * UNIT_PRICE_USD.postNoUrl },
    { label: `投稿(URLあり) ${linkPosts}件`, usd: linkPosts * UNIT_PRICE_USD.postWithUrl },
    { label: `実績取得 ${metricReads}回`, usd: metricReads * UNIT_PRICE_USD.ownedRead },
  ];
  const totalUsd = lines.reduce((s, l) => s + l.usd, 0);
  return { lines, totalUsd };
}

function yen(usd, rate) {
  return Math.round(usd * rate);
}

function fmtUsd(v) {
  return `$${v.toFixed(3)}`;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
X API Cost Simulator

  node scripts/cost-simulator.mjs [options]

  --posts <n>          期間中の総投稿数            (既定 90 = 1日3投稿×30日)
  --link-posts <n>     うちURLを含む投稿数         (既定 0)
  --metric-reads <n>   実績取得したリソース数      (既定 posts×4)
  --usd-jpy <n>        為替レート                  (既定 150)
  --budget-jpy <n>     想定予算(円)。超えたら警告のみ。自動停止はしない
  --exp001             EXP-001(リンク配置A/B)の30日コストを比較表示

単価 (checked_at ${PRICE_CHECKED_AT}):
  投稿URLなし ${fmtUsd(UNIT_PRICE_USD.postNoUrl)} / 投稿URLあり ${fmtUsd(UNIT_PRICE_USD.postWithUrl)} / 実績取得 ${fmtUsd(UNIT_PRICE_USD.ownedRead)}
`);
  process.exit(0);
}

const rate = num(args['usd-jpy'], 150);
const posts = num(args.posts, 90);
const linkPosts = num(args['link-posts'], 0);
const metricReads = num(args['metric-reads'], posts * 4);

console.log(`\nX API 費用シミュレーション  (単価 checked_at ${PRICE_CHECKED_AT} / 1USD=${rate}円)`);
console.log('='.repeat(60));

if (args.exp001) {
  // EXP-001: リンク配置A/B。同じ投稿本数で、リンクの置き場所だけを変える。
  // A案: 本文リンクなし + 自分のリプライにリンク → 本体は$0.015、リプライは$0.20
  // B案: 本文に直接リンク                        → $0.20
  const linkedPerGroup = num(args['link-posts'], Math.round(posts / 3));
  const a = simulate({ posts: posts + linkedPerGroup, linkPosts: linkedPerGroup, metricReads });
  const b = simulate({ posts, linkPosts: linkedPerGroup, metricReads });

  console.log(`\n前提: 各群 ${posts}投稿 / うちリンクを付けるのは ${linkedPerGroup}件 / 実績取得 ${metricReads}回\n`);
  console.log(`A案 (本文リンクなし + リプライにリンク)`);
  a.lines.forEach((l) => console.log(`  ${l.label.padEnd(24)} ${fmtUsd(l.usd).padStart(10)}  ${yen(l.usd, rate).toLocaleString()}円`));
  console.log(`  ${'合計'.padEnd(24)} ${fmtUsd(a.totalUsd).padStart(10)}  ${yen(a.totalUsd, rate).toLocaleString()}円`);
  console.log(`\nB案 (本文に直接リンク)`);
  b.lines.forEach((l) => console.log(`  ${l.label.padEnd(24)} ${fmtUsd(l.usd).padStart(10)}  ${yen(l.usd, rate).toLocaleString()}円`));
  console.log(`  ${'合計'.padEnd(24)} ${fmtUsd(b.totalUsd).padStart(10)}  ${yen(b.totalUsd, rate).toLocaleString()}円`);

  const diff = a.totalUsd - b.totalUsd;
  console.log(`\n差額: ${fmtUsd(Math.abs(diff))} (${Math.abs(yen(diff, rate)).toLocaleString()}円) ${diff > 0 ? 'A案の方が高い' : 'B案の方が高い'}`);
  console.log(`\n※ このコスト差は利益比較に必ず含めること。`);
  console.log(`   リーチが同じでも、コストが違えば RPM(収益÷表示×1000) から引く額が変わる。`);
  console.log(`※ リーチ差そのものは HYPOTHESIS。最低サンプルに達するまで結論を出さない。`);
  process.exit(0);
}

const { lines, totalUsd } = simulate({ posts, linkPosts, metricReads });
lines.forEach((l) => {
  console.log(`  ${l.label.padEnd(24)} ${fmtUsd(l.usd).padStart(10)}  ${yen(l.usd, rate).toLocaleString()}円`);
});
console.log('-'.repeat(60));
console.log(`  ${'合計'.padEnd(24)} ${fmtUsd(totalUsd).padStart(10)}  ${yen(totalUsd, rate).toLocaleString()}円`);

const totalYen = yen(totalUsd, rate);

if (args['budget-jpy'] !== undefined) {
  const budget = num(args['budget-jpy'], 0);
  console.log('');
  if (totalYen > budget) {
    // 警告のみ。自動停止・自動減便はしない。
    // 検証期間中に本数が勝手に変わると A/B の比較条件が崩れてデータが無駄になるため。
    console.log(`[警告] 想定予算 ${budget.toLocaleString()}円 を ${(totalYen - budget).toLocaleString()}円 超えています。`);
    console.log(`       止めるか続けるかは人間が判断してください。このツールは自動では止めません。`);
  } else {
    console.log(`[OK] 想定予算 ${budget.toLocaleString()}円 の範囲内です（残り ${(budget - totalYen).toLocaleString()}円）。`);
  }
}

console.log('');
