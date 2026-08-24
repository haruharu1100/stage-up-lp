import { isOverseas, type ComplianceItem, type ProductCore, type SupplierQuote } from './types';

/**
 * 輸入規制チェック（事業Vault/Amazon AI Seller OS/05）。
 *
 * ★設計方針
 *   ここもLLMを使わない純粋な辞書判定。毎日1万商品を回すため。
 *   判定は「販売可 / 要確認(warning) / 販売不可(blocking)」の3段階で、
 *   「要確認」以上は仕入れ承認画面に赤字で出す。
 *
 *   海外仕入（eBay / Alibaba / その他海外）のときは必ず発火する。
 *   国内の問屋・メーカー仕入は輸入者が相手側なので原則スルーするが、
 *   「並行輸入」「海外正規品」等の表記がある場合だけ確認を出す。
 *
 *   ここで出るのは「調べるべき論点」であって法的助言ではない。
 *   最終判断は必ず人間が所轄官庁（厚労省検疫所・経産省・総務省）に確認する。
 */

interface Rule {
  category: string;
  law: string;
  /** 商品名・カテゴリのどちらかに当たれば発火 */
  match: RegExp;
  /** 海外仕入のときの重さ */
  overseas: 'blocking' | 'warning';
  detail: string;
}

const RULES: Rule[] = [
  {
    category: '食品衛生法',
    law: '食品衛生法 第27条（輸入届出）',
    match:
      /食品|飲料|お菓子|菓子|グルメ|調味料|サプリ|健康食品|茶|コーヒー|食器|皿|カトラリー|箸|カップ|マグ|タンブラー|哺乳|おしゃぶり|ベビー|乳幼児|離乳/,
    overseas: 'blocking',
    detail:
      '食品・食器・乳幼児用玩具の輸入には検疫所への「食品等輸入届出」が必要です。届出なしの販売は食品衛生法違反になります',
  },
  {
    category: '薬機法（輸入）',
    law: '医薬品医療機器等法',
    match:
      /化粧品|コスメ|美容液|クリーム|化粧水|石鹸|シャンプー|サプリメント|医薬部外品|マスク|絆創膏|体温計|血圧計|コンタクト|歯ブラシ|育毛|日焼け止め|UVケア/,
    overseas: 'blocking',
    detail:
      '化粧品・医薬部外品・医療機器の輸入販売には「製造販売業許可」または「化粧品製造販売届」が必要です。個人輸入品をそのまま販売することはできません',
  },
  {
    category: 'PSEマーク',
    law: '電気用品安全法',
    match:
      /充電|バッテリー|モバイルバッテリー|電源|ACアダプタ|アダプター|コンセント|延長コード|電池|LED|ライト|ランタン|ドライヤー|加湿器|扇風機|ヒーター|炊飯|電気|家電|プラグ/,
    overseas: 'blocking',
    detail:
      '電源につなぐ機器・リチウム蓄電池はPSEマークと届出事業者名の表示が必要です。マークのない製品を輸入して販売することはできません',
  },
  {
    category: '技適マーク',
    law: '電波法',
    match: /bluetooth|ブルートゥース|wi-?fi|ワイヤレス|無線|スマートウォッチ|イヤホン|スピーカー|リモコン|トラッカー|ドローン/i,
    overseas: 'blocking',
    detail:
      '電波を出す機器は技術基準適合証明（技適マーク）が必要です。技適のない機器を国内で使わせる形で販売すると電波法違反になります',
  },
  {
    category: '商標（並行輸入）',
    law: '商標法',
    match:
      /正規品|並行輸入|海外限定|ブランド|nike|adidas|disney|sanrio|ポケモン|キャラクター|ディズニー|サンリオ|ジブリ|apple|iphone/i,
    overseas: 'warning',
    detail:
      'ブランド品・キャラクター商品は真正品であることの証明（仕入請求書・流通経路）が必要です。証明できない場合は知的財産権侵害の申立てでアカウントが停止されます',
  },
  {
    category: 'ワシントン条約・動植物検疫',
    law: 'ワシントン条約 / 植物防疫法 / 家畜伝染病予防法',
    match: /皮|レザー|毛皮|羽毛|木製|竹|籐|種子|苗|ドライフラワー|貝|珊瑚|象牙|べっ甲/,
    overseas: 'warning',
    detail:
      '動植物由来の素材は検疫・ワシントン条約の対象になることがあります。素材名を仕入先に確認し、必要なら輸入許可を取得してください',
  },
  {
    category: '有害物質規制',
    law: '化審法 / 有害物質を含有する家庭用品の規制に関する法律',
    match: /塗料|接着剤|洗剤|漂白|殺虫|防虫|芳香|消臭|スプレー|ライター|燃料|アルコール/,
    overseas: 'warning',
    detail:
      '化学製品は含有成分の規制対象になることがあります。またスプレー・ライター等は危険物としてFBA納品できない場合があります',
  },
];

/** 商品名＋カテゴリを1本の文字列にして判定にかける */
function haystack(p: ProductCore): string {
  return [p.title, p.category, p.subcategory, p.brand, p.storageMethod].filter(Boolean).join(' ');
}

/** 国内仕入でも「海外品を扱っている」と読める表記 */
const OVERSEAS_HINT = /並行輸入|海外正規|輸入品|import|海外直送|海外製/i;

/**
 * 輸入規制チェック本体。
 * @param product 商品
 * @param quote   仕入先見積（null = 仕入先未確定）
 */
export function checkImportRegulations(
  product: ProductCore,
  quote: SupplierQuote | null | undefined,
): ComplianceItem[] {
  const items: ComplianceItem[] = [];
  const text = haystack(product);
  const overseasQuote = !!quote && isOverseas(quote.channel);
  const hinted = OVERSEAS_HINT.test(text);
  const overseas = overseasQuote || hinted;

  // 仕入先が未確定のときは、まだ輸入かどうか決まっていないので確認扱いにする
  const undecided = !quote;

  if (!overseas && !undecided) {
    items.push({
      category: '輸入規制',
      check: '輸入該当性',
      severity: 'info',
      passed: true,
      detail: `仕入先「${quote!.supplier}」は国内仕入のため、輸入手続きは仕入先側で完了しています`,
      law: '—',
    });
    return items;
  }

  const hits = RULES.filter((r) => r.match.test(text));

  if (!hits.length) {
    items.push({
      category: '輸入規制',
      check: '規制品目の該当',
      severity: 'info',
      passed: true,
      detail: overseas
        ? '海外仕入ですが、食品・化粧品・電気製品・無線機器のいずれにも該当しませんでした（最終確認は税関に）'
        : '仕入先が未確定のため輸入かどうか未判定ですが、規制品目には該当しませんでした',
      law: '—',
    });
    return items;
  }

  for (const r of hits) {
    // 海外仕入が確定しているときだけ blocking。未確定なら「要確認」に落とす。
    const severity = overseasQuote ? r.overseas : 'warning';
    items.push({
      category: r.category,
      check: `${r.category}の該当確認`,
      severity,
      passed: false,
      detail: overseasQuote
        ? `${r.detail}（仕入先「${quote!.supplier}」は海外です）`
        : `${r.detail}（海外から仕入れる場合に必要。国内の問屋・メーカーから買うならこの手続きは不要です）`,
      evidence: product.title,
      law: r.law,
    });
  }

  return items;
}

/** 画面に赤字で出すべきか（要確認以上が1つでもあるか） */
export function needsImportReview(items: ComplianceItem[]): boolean {
  return items.some((i) => !i.passed && (i.severity === 'blocking' || i.severity === 'warning'));
}

/** 承認画面用の1行サマリ */
export function importSummary(items: ComplianceItem[]): string {
  const blocking = items.filter((i) => !i.passed && i.severity === 'blocking');
  const warning = items.filter((i) => !i.passed && i.severity === 'warning');
  if (blocking.length) return `販売不可：${blocking.map((i) => i.category).join('・')}の手続きが必要です`;
  if (warning.length) return `要確認：${warning.map((i) => i.category).join('・')}`;
  return '販売可（輸入規制の該当なし）';
}
