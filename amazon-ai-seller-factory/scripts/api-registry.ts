/**
 * API契約台帳を初期化して、いまの状態を日本語で表示する。
 * ===================================================================
 * ユーザー指示（2026-08-20）：
 *   「新しく api_contract_registry を作ってください。APIごとに
 *     provider / api_name / official_document_url / verified_date /
 *     required_permission / required_credentials / request_fields /
 *     response_fields / implementation_status を保存。
 *     公式資料のURLが無いAPIはDOCUMENTEDにしない。」
 *
 * ★このスクリプトは**外部APIを1回も呼びません**（課金0円）。
 *   公式ドキュメントで確認した内容を、台帳へ書き写すだけです。
 *
 * 実行： npm run api:registry
 */
import { migrate } from '../lib/db/client';
import {
  seedContracts,
  listContracts,
  contractSummary,
  CONTRACT_STATUS_LABEL,
  CONTRACT_RANK,
} from '../lib/providers/apiContractRegistry';

async function main() {
  console.log('=== API契約台帳の登録 ===\n');
  console.log('★外部APIは1回も呼びません。公式ドキュメントで確認した内容を記録するだけです。\n');

  await migrate();
  const saved = await seedContracts();
  console.log(`${saved.length}件を台帳に登録しました。\n`);

  const rows = await listContracts();
  for (const c of rows) {
    console.log(`■ ${c.provider}／${c.apiName}`);
    console.log(`    いまの段階 ： ${CONTRACT_STATUS_LABEL[c.status]}`);
    console.log(`    公式資料   ： ${c.officialDocumentUrl ?? '（無し。なので使いません）'}`);
    console.log(`    確認した日 ： ${c.verifiedDate ?? '未確認'}`);
    console.log(`    必要な権限 ： ${c.requiredPermission ?? '不明'}`);
    console.log(`    必要な鍵   ： ${c.requiredCredentials.join(' / ') || '無し'}`);
    console.log(`    送る項目   ： ${c.requestFields.length}個`);
    console.log(`    返る項目   ： ${c.responseFields.length}個`);
    console.log(`    メモ       ： ${c.statusNote}`);
    console.log('');
  }

  const sum = await contractSummary();
  console.log('--- まとめ ---');
  console.log(`  ${sum.headline}`);
  for (const [status, n] of Object.entries(sum.byStatus)) {
    if (!n) continue;
    console.log(`    ${CONTRACT_STATUS_LABEL[status as keyof typeof CONTRACT_RANK]}：${n}件`);
  }

  console.log('\n--- いま何が足りないか ---');
  if (!sum.verifiedApis.length) {
    console.log('  実データまで確認できたAPIは0件です。');
    console.log('  ★理由：AliExpressの鍵（APP_KEY / APP_SECRET）がまだ無いため、');
    console.log('    「権限を取得した」「認証に成功した」「実商品を取得した」の3段階へ進めません。');
    console.log('    段階を飛ばすことはできない決まりなので、ここで正しく止まっています。');
    console.log('  → LIVE_DISCOVERY_READY は false のままです。');
    console.log('  → 次にやること：事業Vault/Amazon AI Seller OS/13_AliExpress申請手順.md の手順で鍵を取得');
  } else {
    console.log(`  実データまで確認できたAPI：${sum.verifiedApis.join(' / ')}`);
  }
}

main().catch((e) => {
  console.error('失敗しました：', e?.message ?? e);
  process.exit(1);
});
