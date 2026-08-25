import { all, nowIso, run } from './db/client';

export type SettingType = 'int' | 'rate' | 'text';

export type SettingDef = {
  key: string;
  value: string;
  value_type: SettingType;
  label: string;
  group_key: string;
  hint?: string;
};

/**
 * 既定値。すべて管理画面から変更できる。
 * AIはこの値を書き換えられない（変更は人間のみ）。
 */
export const SETTING_DEFS: SettingDef[] = [
  // --- 利益 ---
  {
    key: 'TARGET_NET_MARGIN',
    value: '0.15',
    value_type: 'rate',
    label: '目標利益率',
    group_key: '利益',
    hint: '全費用を差し引いた後、投じたお金に対して何%残したいか。仕入価格×1.15ではない。',
  },
  {
    key: 'MIN_NET_PROFIT',
    value: '3000',
    value_type: 'int',
    label: '最低純利益（円）',
    group_key: '利益',
    hint: 'これを下回る商品は利益不足として除外する。',
  },
  {
    key: 'MIN_ROI',
    value: '0.15',
    value_type: 'rate',
    label: '最低ROI',
    group_key: '利益',
    hint: '投じたお金に対する利益率の下限。',
  },

  // --- 相場 ---
  {
    key: 'MAX_MARKET_PREMIUM_RATIO',
    value: '1.05',
    value_type: 'rate',
    label: '必要販売価格の相場超過 上限',
    group_key: '相場',
    hint: '必要販売価格 ÷ 市場価格 がこれを超えたら「相場で成立しない」として除外する。',
  },
  {
    key: 'MARKET_DATA_MAX_AGE_HOURS',
    value: '168',
    value_type: 'int',
    label: '相場データの有効期限（時間）',
    group_key: '相場',
    hint: 'これより古い相場は信頼度を下げる。Phase 1 は既定7日。',
  },

  // --- 異常検知 ---
  {
    key: 'ANOMALY_LOW_RATIO',
    value: '0.15',
    value_type: 'rate',
    label: '安すぎ判定（仕入価格÷市場価格）',
    group_key: '異常検知',
    hint: '市場価格に対してこれ未満の仕入価格は、データ誤り／偽物の疑いとして人間確認へ回す。自動では買わない。',
  },
  {
    key: 'ANOMALY_HIGH_RATIO',
    value: '3.0',
    value_type: 'rate',
    label: '高すぎ判定（仕入価格÷市場価格）',
    group_key: '異常検知',
    hint: '市場価格に対してこれを超える仕入価格は、データ誤りの疑いとして除外する。',
  },

  // --- スコア判定 ---
  { key: 'SCORE_STRONG_BUY', value: '90', value_type: 'int', label: 'STRONG BUY の下限点', group_key: 'スコア判定' },
  { key: 'SCORE_BUY', value: '80', value_type: 'int', label: 'BUY の下限点', group_key: 'スコア判定' },
  { key: 'SCORE_WATCH', value: '70', value_type: 'int', label: 'WATCH の下限点', group_key: 'スコア判定' },
  { key: 'SCORE_LOW_PRIORITY', value: '60', value_type: 'int', label: 'LOW PRIORITY の下限点', group_key: 'スコア判定' },

  // --- AI利用 ---
  {
    key: 'AI_REVIEW_MIN_SCORE',
    value: '70',
    value_type: 'int',
    label: 'AI判定にかける最低スコア',
    group_key: 'AI利用',
    hint: 'これ未満の商品はAIに投げない。AI費用を抑えるための関門。',
  },
  {
    key: 'AI_UNIT_COST_JPY',
    value: '15',
    value_type: 'int',
    label: 'AI 1商品あたりの想定費用（円）',
    group_key: 'AI利用',
  },
  {
    key: 'AI_PROFIT_MULTIPLE',
    value: '20',
    value_type: 'int',
    label: 'AIを呼ぶのに必要な粗利倍率',
    group_key: 'AI利用',
    hint: '想定純利益が「AI費用 × この倍率」以上のときだけAIを呼ぶ。',
  },

  // --- 価格戦略（Phase 1 は記録のみ・自動実行しない） ---
  {
    key: 'PRICE_STEP_UP_RATE',
    value: '0.05',
    value_type: 'rate',
    label: '値上げ幅（新品・型番商品）',
    group_key: '価格戦略',
    hint: '売れたら次回候補価格を何%上げるか。Phase 1 では提案値を出すだけで自動実行しない。',
  },
  {
    key: 'MAX_STEP_UPS',
    value: '6',
    value_type: 'int',
    label: '値上げ回数の上限',
    group_key: '価格戦略',
  },
  {
    key: 'DEFAULT_PREMIUM_RATIO',
    value: '1.00',
    value_type: 'rate',
    label: '初期の相場倍率（中古一点物）',
    group_key: '価格戦略',
    hint: '実績が貯まるまでの暫定値。市場価格の何倍で出すか。',
  },
  {
    key: 'PREMIUM_RATIO_MIN_SAMPLES',
    value: '5',
    value_type: 'int',
    label: '相場倍率を採用する最低件数',
    group_key: '価格戦略',
    hint: 'この件数未満の実績しかないセグメントは、学習値を使わず初期値を使う。',
  },

  // --- 在庫 ---
  {
    key: 'MAX_STOCK_FOR_ONE_OF_A_KIND',
    value: '1',
    value_type: 'int',
    label: '一点物とみなす在庫数',
    group_key: '在庫',
    hint: 'これ以下の在庫かつ中古なら「一点物」として相場倍率方式で価格を学習する。',
  },

  // --- ルート（どこで買ってどこで売るか） ---
  {
    key: 'ROUTE_MIN_NET_PROFIT',
    value: '3000',
    value_type: 'int',
    label: 'ルートの最低純利益（円）',
    group_key: 'ルート',
    hint: '仕入から販売までの費用を全部引いた後、これを下回るルートは候補にしない。',
  },
  {
    key: 'ROUTE_MIN_ROI',
    value: '0.15',
    value_type: 'rate',
    label: 'ルートの最低ROI',
    group_key: 'ルート',
    hint: '仕入総額に対する利益率の下限。',
  },
  {
    key: 'ROUTE_MIN_SELL_PROBABILITY',
    value: '0.2',
    value_type: 'rate',
    label: '30日で売れる確率の下限',
    group_key: 'ルート',
    hint: '利益が出ても、売れなければ現金にならない。これを下回るルートは候補にしない。',
  },
  {
    key: 'ROUTE_MAX_PER_PRODUCT',
    value: '12',
    value_type: 'int',
    label: '1商品あたりのルート保存上限',
    group_key: 'ルート',
    hint: '全市場×全市場を計算した上で、点数の高い順にこの件数だけ保存する。',
  },
  {
    key: 'LIQUIDITY_DEFAULT',
    value: '40',
    value_type: 'int',
    label: '流動性の既定値（実データが無いとき）',
    group_key: 'ルート',
    hint: '成約実績が無い市場に使う控えめな仮の値。実データが入れば使われなくなる。',
  },
  {
    key: 'DEFAULT_DAYS_TO_SELL',
    value: '45',
    value_type: 'int',
    label: '売却までの想定日数（実データが無いとき）',
    group_key: 'ルート',
  },
  {
    key: 'MIN_DAYS_FOR_ANNUALIZED',
    value: '7',
    value_type: 'int',
    label: '年率計算に使う最短日数',
    group_key: 'ルート',
    hint: '「3日で売れる想定」で年率を出すと現実離れした数字になる。下限を置いて過大表示を防ぐ。',
  },
  {
    key: 'CAPITAL_MAX_PER_BRAND_RATIO',
    value: '0.3',
    value_type: 'rate',
    label: '資金配分：同一ブランドの上限比率',
    group_key: 'ルート',
    hint: '1つのブランドに資金が偏らないようにする。',
  },
  {
    key: 'CAPITAL_MAX_PER_VENUE_RATIO',
    value: '0.5',
    value_type: 'rate',
    label: '資金配分：同一販売市場の上限比率',
    group_key: 'ルート',
    hint: '1つの販売先に依存しないようにする。',
  },

  // --- データ品質（Phase 3） ---
  {
    key: 'MIN_CONFIDENCE_STRONG_BUY',
    value: '65',
    value_type: 'int',
    label: 'STRONG BUY に必要なデータ信頼度',
    group_key: 'データ品質',
    hint: '相場・手数料・同一商品特定のうち一番低い値がこれ未満なら、利益がいくら大きくても STRONG BUY にしない。',
  },
  {
    key: 'MIN_CONFIDENCE_BUY',
    value: '30',
    value_type: 'int',
    label: 'BUY に必要なデータ信頼度',
    group_key: 'データ品質',
    hint: 'これ未満なら BUY にもしない（WATCH まで下げる）。数字の出どころが弱すぎる状態で買う判断をしないための下限。',
  },
  {
    key: 'MARKET_FRESH_HOURS',
    value: '24',
    value_type: 'int',
    label: '相場データが「新しい」とみなす時間',
    group_key: 'データ品質',
    hint: 'これ以内に取得した相場は減点しない。',
  },
  {
    key: 'MARKET_NORMAL_HOURS',
    value: '72',
    value_type: 'int',
    label: '相場データが「通常」とみなす時間',
    group_key: 'データ品質',
    hint: 'これを超えた相場は古いとみなし、経過日数に応じて信頼度を下げる。',
  },

  // --- 学習（Phase 3・SHADOW の答え合わせ） ---
  {
    key: 'SHADOW_MIN_ROUTE_SCORE',
    value: '70',
    value_type: 'int',
    label: 'SHADOW に記録する最低ルート点数',
    group_key: '学習',
    hint: 'この点数以上のルートは、買うと判断しなくても仮想取引として記録し、後で答え合わせする。迷ったものこそ学習の材料になる。',
  },
  {
    key: 'ACCURACY_MIN_SAMPLES',
    value: '5',
    value_type: 'int',
    label: '実績補正を始める最低件数',
    group_key: '学習',
    hint: 'これ未満の実績しかない組み合わせは、点数を一切補正しない。数件の偶然で順位を動かさないため。',
  },
  {
    key: 'ACCURACY_MID_SAMPLES',
    value: '20',
    value_type: 'int',
    label: '中程度の補正に切り替える件数',
    group_key: '学習',
    hint: 'これ以上で補正の効きを強める。',
  },
  {
    key: 'ACCURACY_FULL_SAMPLES',
    value: '50',
    value_type: 'int',
    label: '通常の補正に切り替える件数',
    group_key: '学習',
    hint: 'これ以上たまってはじめて、実績を全幅で点数へ反映する。',
  },
  {
    key: 'OPPORTUNITY_FAST_HOURS',
    value: '24',
    value_type: 'int',
    label: '「短時間で消える」とみなす時間',
    group_key: '学習',
    hint: '利益が出る状態がこれ以内で消えた価格差は、速度スコアを高くする（見つけても間に合わない可能性が高い）。',
  },

  // --- 予測の3本立て（Phase 3.5） ---
  {
    key: 'CONSERVATIVE_HAIRCUT',
    value: '0.15',
    value_type: 'rate',
    label: '保守見積りの控えめ幅',
    group_key: '予測',
    hint: '実績がまだ無いあいだ、保守的な販売価格を出すために理論値から何割引くか。実市場の実績がたまったら、この既定値ではなく実際の下振れを使う。',
  },
  {
    key: 'FORECAST_DEFAULT_BAND',
    value: '0.15',
    value_type: 'rate',
    label: '予測レンジの既定の広がり',
    group_key: '予測',
    hint: 'その市場の価格のばらつきが分からないときに使う仮の幅。実測のばらつきがあればそちらを使う。',
  },
  {
    key: 'HUMAN_REACH_HOURS',
    value: '24',
    value_type: 'int',
    label: '人間が承認して間に合う時間',
    group_key: '予測',
    hint: '価格差の半減期がこれ以上なら「人間が確認してから買っても間に合う」と判断する。これ未満は自動でないと間に合わない。',
  },

  // --- 精度（Phase 3.5・§17〜§19） ---
  {
    key: 'FALSE_POSITIVE_WEIGHT',
    value: '3',
    value_type: 'int',
    label: '見込み違いの重み（買うと言って外した側）',
    group_key: '精度',
    hint: '「買うと判断したのに儲からなかった」を「見送ったのに儲かった」の何倍重く数えるか。赤字商品を大量に買う方が、良い商品を1件逃すよりはるかに危険なため。',
  },

  // --- Phase 4 卒業条件（Phase 3.5・§20） ---
  // ここはAIが書き換えてはいけない。変更は人間のみ（CLAUDE.md ルール9）。
  {
    key: 'GATE_MIN_REAL_SHADOW',
    value: '100',
    value_type: 'int',
    label: '必要な実市場の仮想取引 件数',
    group_key: '卒業条件',
    hint: 'テストデータは1件も数えない。実際の市場データで判断した記録だけを数える。',
  },
  {
    key: 'GATE_MIN_EVALUATED',
    value: '100',
    value_type: 'int',
    label: '答え合わせが終わった件数',
    group_key: '卒業条件',
    hint: '記録しただけでは何も証明していない。30日後の答え合わせまで終わった件数で数える。',
  },
  {
    key: 'GATE_MIN_STRONG_BUY_SAMPLES',
    value: '30',
    value_type: 'int',
    label: 'STRONG BUY の必要件数',
    group_key: '卒業条件',
    hint: '100件のうちSTRONG BUYが3件しかなければ、その精度は偶然と区別できない。STRONG BUYだけで最低これだけ要る。',
  },
  {
    key: 'GATE_MIN_STRONG_BUY_PRECISION',
    value: '0.90',
    value_type: 'rate',
    label: 'STRONG BUY の的中率',
    group_key: '卒業条件',
    hint: 'STRONG BUYと判断したもののうち、実際に利益が出た割合。',
  },
  {
    key: 'GATE_MIN_STRONG_BUY_PRECISION_LOWER',
    value: '0.75',
    value_type: 'rate',
    label: 'STRONG BUY 的中率の下限（悪く見積もった場合）',
    group_key: '卒業条件',
    hint: '件数が少ないと的中率はブレる。統計的に最も悪く見積もってもこれを下回らないことを条件にする。',
  },
  {
    key: 'GATE_MIN_BUY_PRECISION',
    value: '0.80',
    value_type: 'rate',
    label: 'BUY以上の的中率',
    group_key: '卒業条件',
  },
  {
    key: 'GATE_MAX_FALSE_POSITIVE_RATE',
    value: '0.10',
    value_type: 'rate',
    label: '見込み違いの上限（買うと言って外した割合）',
    group_key: '卒業条件',
    hint: 'STRONG BUYのうち儲からなかった割合の上限。的中率90%と同じことを裏から言っている。',
  },
  {
    key: 'GATE_MIN_VERIFIED_FEE_RATIO',
    value: '0.90',
    value_type: 'rate',
    label: '手数料が確認済みの割合',
    group_key: '卒業条件',
  },
  {
    key: 'GATE_MIN_MARKET_CONFIDENCE',
    value: '90',
    value_type: 'int',
    label: '相場データの信頼度（平均）',
    group_key: '卒業条件',
  },
  {
    key: 'GATE_MIN_MARKET_CONFIDENCE_WORST',
    value: '70',
    value_type: 'int',
    label: '相場データの信頼度（最低値）',
    group_key: '卒業条件',
    hint: '平均だけ見ると、1件のひどいデータが良いデータに隠される。一番低い件も条件に入れる。',
  },
  {
    key: 'GATE_MAX_UNCONFIRMED_RATIO',
    value: '0.30',
    value_type: 'rate',
    label: '判定保留の上限割合',
    group_key: '卒業条件',
    hint: '100件のうち90件が「売れたか分からない」なら、的中率は残り10件だけで測ったことになる。',
  },
  {
    key: 'GATE_MIN_VENUE_DIVERSITY',
    value: '3',
    value_type: 'int',
    label: '必要な市場の種類数',
    group_key: '卒業条件',
    hint: '同じRouteばかり100件集めても、他の市場で通用する証明にならない。',
  },
  {
    key: 'GATE_MIN_CATEGORY_DIVERSITY',
    value: '3',
    value_type: 'int',
    label: '必要な商品カテゴリの種類数',
    group_key: '卒業条件',
  },
  {
    key: 'PHASE4_UNLOCKED',
    value: 'false',
    value_type: 'text',
    label: 'Phase 4（少額の実取引）の解禁',
    group_key: '卒業条件',
    hint: 'AIはこの値を書き換えない。卒業条件を全部満たしても、人間がここを true にしない限り実取引には進まない。なお Phase 3.5 時点では、true にしても実購入のコード自体が存在しない。',
  },

  // --- 費用（Phase 3.7） ---
  {
    key: 'DEFAULT_MERCARI_BUY_PAYMENT_METHOD',
    value: 'CREDIT_CARD',
    value_type: 'text',
    label: 'メルカリで仕入れるときの支払方法',
    group_key: '費用',
    hint:
      '実際に当社が使う支払方法を選ぶ。安い方法をAIが勝手に選ぶことはしない。'
      + 'CREDIT_CARD / MERCARI_BALANCE / APPLE_PAY / FAMIPAY / CONVENIENCE_STORE / ATM / CARRIER_PAYMENT / OTHER。'
      + 'コンビニ・ATM・キャリア決済は金額に応じた手数料があり、その実額をまだ確認できていない。'
      + 'それらを選ぶと仕入総額が確定しないため、STRONG BUY まで上げない。',
  },
  {
    key: 'PAYOUT_ITEMS_PER_REQUEST',
    value: '1',
    value_type: 'int',
    label: '振込申請1回でまとめる件数',
    group_key: '費用',
    hint:
      '売上金の振込手数料（メルカリは1回200円）を1商品あたりに割るときの分母。'
      + '例：1回で100件分まとめて申請するなら100と入れる（1商品あたり2円）。'
      + 'この数字は「参考表示」にしか使わない。買う／買わないの判定には一切入れない。'
      + '実績が出るまでは1（＝1件ずつ申請した場合）のままにしておく。',
  },
  {
    key: 'PILOT_SIZE',
    value: '10',
    value_type: 'int',
    label: '操作性テスト（PILOT）の件数',
    group_key: '検証',
    hint: 'いきなり100件入力しない。まずこの件数だけ入れて、入力の手間と詰まりを実測する。',
  },
  {
    key: 'VALIDATION_TARGET',
    value: '100',
    value_type: 'int',
    label: '検証可能商品の目標件数',
    group_key: '検証',
    hint:
      '「100件登録した」ではなく「100件のうち何件が実際に検証できたか」を見る。'
      + 'この数字だけを追いかけないこと。',
  },

  // --- 仕入→Amazonのルート（Phase 4） ---
  // ご本人の指示（原文・§14）：「閾値は既存設定から管理可能にしてください。」
  // ★頭に SUPPLIER_ROUTE_ を付けているのは、既存の PHASE4_UNLOCKED（卒業条件のほう）と
  //   紛らわしくならないようにするため。同じ「Phase 4」でも別の話である。
  {
    key: 'SUPPLIER_ROUTE_MIN_NET_PROFIT',
    value: '3000',
    value_type: 'int',
    label: '買う候補にする最低の純利益（保守）',
    group_key: '仕入ルート',
    hint:
      '保守で見た純利益がこの額に届かなければ買う候補にしない。'
      + '★候補を増やしたいときに、この数字を下げないこと（ルール13）。下げれば必ず増えるが、'
      + '増えたぶんは「基準を満たした商品」ではない。仕入先を増やす方で増やす。',
  },
  {
    key: 'SUPPLIER_ROUTE_MIN_ROI',
    value: '0.15',
    value_type: 'rate',
    label: '買う候補にする最低のROI（保守）',
    group_key: '仕入ルート',
    hint: '仕入総額に対する純利益の割合。0.15＝15%。保守で見た値だけを使う。',
  },
  {
    key: 'SUPPLIER_ROUTE_MIN_RANK_DROPS_30',
    value: '3',
    value_type: 'int',
    label: '売れている証拠とみなす30日の順位下がり回数',
    group_key: '仕入ルート',
    hint:
      '直近30日で売れ筋順位が下がった回数。これ未満なら「売れている証拠が弱い」とする。'
      + '★順位の下がり回数は販売数そのものではない（ルール78）。1回の注文で2個売れても1回のことがある。',
  },
  {
    key: 'SUPPLIER_ROUTE_MAX_DATA_AGE_HOURS',
    value: '168',
    value_type: 'int',
    label: 'Amazon側データを新しいとみなす上限（時間）',
    group_key: '仕入ルート',
    hint: 'これより古いデータで買う判断をしない。既定は168時間（7日）。',
  },
  {
    key: 'SUPPLIER_ROUTE_WATCH_MAX_GAP',
    value: '20000',
    value_type: 'int',
    label: '値下がりを待つと判断する差額の上限（円）',
    group_key: '仕入ルート',
    hint:
      '「買ってよい上限」まであといくらなら待つ価値があるか。'
      + 'これを超えて離れているものは見送りにする。見送りにしたものは画面に出なくなるので、'
      + '大きくしすぎると、いつまでも下がらない商品が一覧に溜まる。',
  },
  {
    key: 'SUPPLIER_ROUTE_INBOUND_SHIPPING',
    value: '500',
    value_type: 'int',
    label: 'Amazonへ送る送料（1商品あたり・円）',
    group_key: '仕入ルート',
    hint: '実測が出るまでの仮置き。★安く見積もると必ず買いすぎるので、やや厚めに置いてある。',
  },
  {
    key: 'SUPPLIER_ROUTE_SUPPLIER_SHIPPING',
    value: '0',
    value_type: 'int',
    label: '仕入先から届く送料の既定値（円）',
    group_key: '仕入ルート',
    hint:
      '仕入先データに送料が入っていればそちらが優先される。ここは入っていなかった場合の値。'
      + '★0のまま使うと送料ぶん利益が多く見えるので、画面には「仮置き」と表示される。',
  },
  {
    key: 'SUPPLIER_ROUTE_PACKAGING',
    value: '150',
    value_type: 'int',
    label: '梱包代（1商品あたり・円）',
    group_key: '仕入ルート',
    hint: '実測が出るまでの仮置き。',
  },
  {
    key: 'SUPPLIER_ROUTE_STORAGE',
    value: '100',
    value_type: 'int',
    label: '保管代（1商品あたり・円）',
    group_key: '仕入ルート',
    hint: '実測が出るまでの仮置き。長く売れ残るほど実際は増える。',
  },
  {
    key: 'SUPPLIER_ROUTE_OTHER_COST',
    value: '0',
    value_type: 'int',
    label: 'その他の費用（1商品あたり・円）',
    group_key: '仕入ルート',
    hint: '上のどれにも入らない費用。',
  },
  {
    key: 'SUPPLIER_ROUTE_RETURN_LOSS_RATE',
    value: '0.02',
    value_type: 'rate',
    label: '返品で失う見込みの割合',
    group_key: '仕入ルート',
    hint:
      '販売価格に対する割合。0.02＝2%。額ではなく率で置くのは、高い商品ほど損も大きいため。'
      + '★実測ではない。実際に売買した記録が貯まったら差し替える。',
  },
  {
    key: 'SUPPLIER_ROUTE_OFFER_LIMIT',
    value: '10',
    value_type: 'int',
    label: '仕入先商品の登録上限（件）',
    group_key: '仕入ルート',
    hint:
      'ご本人の指示：「いきなり100商品を入れないでください。」'
      + 'まず10件でファネルを一度通し、どこで落ちるかを見てから増やす。'
      + '★この数字はAIが自分で書き換えない。増やすのは人。',
  },

  /* --- 自動リサーチ（Phase 5・2026-08-25）---
   *
   * ご本人の指示（原文・§12）：「需要強い / 競合少ない / 価格安定 / Amazon本体なし 商品を抽出。」
   *
   * ★ここは「買ってよい条件」ではない（ルール124）。
   *   選ぶのは **先に仕入先を探す価値がある商品** であって、買ってよい商品ではない。
   *   買ってよいかは、仕入価格が入ってから Phase 4 の判定が決める。
   */
  {
    key: 'RESEARCH_DEMAND_MIN_RANK_DROPS_30',
    value: '10',
    value_type: 'int',
    label: '自動リサーチ：30日の値下がり回数の下限',
    group_key: '自動リサーチ',
    hint:
      '売れ筋順位が30日で何回下がったか。多いほどよく売れている合図。★これは販売数ではない（ルール78）。'
      + '仕入ルート判定の同名設定（既定3回）より厳しくしてあるのは、'
      + 'ここが「これから費用をかけて調べる相手を選ぶ」段だから。',
  },
  {
    key: 'RESEARCH_DEMAND_MAX_OFFER_COUNT',
    value: '15',
    value_type: 'int',
    label: '自動リサーチ：出品者数の上限（人）',
    group_key: '自動リサーチ',
    hint: '競合が多い商品は、売れても値下げ合戦になりやすいので後回しにする。人数が分からない商品は選ばない。',
  },
  {
    key: 'RESEARCH_DEMAND_MAX_DATA_AGE_HOURS',
    value: '720',
    value_type: 'int',
    label: '自動リサーチ：使ってよいデータの古さ（時間）',
    group_key: '自動リサーチ',
    hint: '720時間＝30日。これより古いデータからは候補を選ばない。',
  },
  {
    key: 'RESEARCH_AI_DAILY_LIMIT_JPY',
    value: '500',
    value_type: 'int',
    label: '自動リサーチ：1日のAI・API費用の上限（円）',
    group_key: '自動リサーチ',
    hint:
      'ここに達したらその日は止まる。★止まったときに勝手に上げないこと。'
      + '上げてよいのは「1件あたりの費用に見合っている」と数字で確かめられたときだけ。',
  },
  {
    key: 'RESEARCH_AI_PER_PRODUCT_LIMIT_JPY',
    value: '20',
    value_type: 'int',
    label: '自動リサーチ：商品1件あたりの費用上限（円）',
    group_key: '自動リサーチ',
    hint: '1件にこれ以上かかる調べ方はしない。高い調べ方は、見込み利益の大きい候補だけに使う。',
  },
];

let cache: Map<string, string> | null = null;

export async function ensureSettings(): Promise<void> {
  const rows = await all('SELECT key FROM settings');
  const existing = new Set(rows.map((r) => String(r.key)));
  const now = nowIso();
  for (const d of SETTING_DEFS) {
    if (existing.has(d.key)) continue;
    await run(
      'INSERT INTO settings (key, value, value_type, label, group_key, hint, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [d.key, d.value, d.value_type, d.label, d.group_key, d.hint ?? null, now],
    );
  }
  cache = null;
}

export async function loadSettings(): Promise<Map<string, string>> {
  if (cache) return cache;
  await ensureSettings();
  const rows = await all('SELECT key, value FROM settings');
  const m = new Map<string, string>();
  for (const d of SETTING_DEFS) m.set(d.key, d.value);
  for (const r of rows) m.set(String(r.key), String(r.value));
  cache = m;
  return m;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await run('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?', [value, nowIso(), key]);
  cache = null;
}

export async function listSettings() {
  await ensureSettings();
  return all('SELECT * FROM settings ORDER BY group_key, key');
}

export type Thresholds = {
  targetNetMargin: number;
  minNetProfit: number;
  minRoi: number;
  maxMarketPremiumRatio: number;
  marketDataMaxAgeHours: number;
  anomalyLowRatio: number;
  anomalyHighRatio: number;
  scoreStrongBuy: number;
  scoreBuy: number;
  scoreWatch: number;
  scoreLowPriority: number;
  aiReviewMinScore: number;
  aiUnitCostJpy: number;
  aiProfitMultiple: number;
  priceStepUpRate: number;
  maxStepUps: number;
  defaultPremiumRatio: number;
  premiumRatioMinSamples: number;
  maxStockForOneOfAKind: number;
  routeMinNetProfit: number;
  routeMinRoi: number;
  routeMinSellProbability: number;
  routeMaxPerProduct: number;
  liquidityDefault: number;
  defaultDaysToSell: number;
  minDaysForAnnualized: number;
  capitalMaxPerBrandRatio: number;
  capitalMaxPerVenueRatio: number;
  minConfidenceStrongBuy: number;
  minConfidenceBuy: number;
  marketFreshHours: number;
  marketNormalHours: number;
  shadowMinRouteScore: number;
  accuracyMinSamples: number;
  accuracyMidSamples: number;
  accuracyFullSamples: number;
  opportunityFastHours: number;
  // ---- Phase 3.5 ----
  conservativeHaircut: number;
  forecastDefaultBand: number;
  humanReachHours: number;
  falsePositiveWeight: number;
};

/** Phase 4 の卒業条件（§20）。AIは変更しない。人間だけが変える。 */
export type GateThresholds = {
  minRealShadow: number;
  minEvaluated: number;
  minStrongBuySamples: number;
  minStrongBuyPrecision: number;
  minStrongBuyPrecisionLower: number;
  minBuyPrecision: number;
  maxFalsePositiveRate: number;
  minVerifiedFeeRatio: number;
  minMarketConfidence: number;
  minMarketConfidenceWorst: number;
  maxUnconfirmedRatio: number;
  minVenueDiversity: number;
  minCategoryDiversity: number;
};

export async function getGateThresholds(): Promise<GateThresholds> {
  const s = await loadSettings();
  const num = (k: string) => Number(s.get(k));
  return {
    minRealShadow: num('GATE_MIN_REAL_SHADOW'),
    minEvaluated: num('GATE_MIN_EVALUATED'),
    minStrongBuySamples: num('GATE_MIN_STRONG_BUY_SAMPLES'),
    minStrongBuyPrecision: num('GATE_MIN_STRONG_BUY_PRECISION'),
    minStrongBuyPrecisionLower: num('GATE_MIN_STRONG_BUY_PRECISION_LOWER'),
    minBuyPrecision: num('GATE_MIN_BUY_PRECISION'),
    maxFalsePositiveRate: num('GATE_MAX_FALSE_POSITIVE_RATE'),
    minVerifiedFeeRatio: num('GATE_MIN_VERIFIED_FEE_RATIO'),
    minMarketConfidence: num('GATE_MIN_MARKET_CONFIDENCE'),
    minMarketConfidenceWorst: num('GATE_MIN_MARKET_CONFIDENCE_WORST'),
    maxUnconfirmedRatio: num('GATE_MAX_UNCONFIRMED_RATIO'),
    minVenueDiversity: num('GATE_MIN_VENUE_DIVERSITY'),
    minCategoryDiversity: num('GATE_MIN_CATEGORY_DIVERSITY'),
  };
}

/**
 * Phase 4 が人間の手で解禁されているか（§25）。
 *
 * 【AIはここを書き換えない】
 * 卒業条件をすべて満たしても、この値が true にならない限り次へ進まない。
 * そして Phase 3.5 時点では、true にしたところで実購入のコードが存在しない。
 * 二重に止めてある。
 */
/**
 * 費用まわりの設定（Phase 3.7）。
 *
 * 【なぜ Thresholds に混ぜないのか】
 * Thresholds は判定のしきい値。ここに支払方法や振込のまとめ件数を混ぜると、
 * 「運用の都合」で routeRuleVersion（判定ルールの版）が変わってしまう。
 * 版が変われば過去の判断と比べられなくなる。だから別の箱に置く。
 */
export type CostSettings = {
  /** 実際に使う仕入の支払方法。AIが安い方法を選び直すことはしない。 */
  mercariBuyPaymentMethod: string;
  /** 振込申請1回でまとめる件数（按分表示専用）。 */
  payoutItemsPerRequest: number;
  pilotSize: number;
  validationTarget: number;
};

export async function getCostSettings(): Promise<CostSettings> {
  const s = await loadSettings();
  const n = (k: string, fallback: number) => {
    const v = Number(s.get(k));
    return Number.isFinite(v) && v >= 1 ? Math.floor(v) : fallback;
  };
  return {
    mercariBuyPaymentMethod: String(s.get('DEFAULT_MERCARI_BUY_PAYMENT_METHOD') ?? 'CREDIT_CARD'),
    payoutItemsPerRequest: n('PAYOUT_ITEMS_PER_REQUEST', 1),
    pilotSize: n('PILOT_SIZE', 10),
    validationTarget: n('VALIDATION_TARGET', 100),
  };
}

/**
 * 【仕入→Amazonルートの設定】（Phase 4）
 *
 * ★既存の `isPhase4Unlocked()`（卒業条件のほう）とは別物。
 *   同じ「Phase 4」という言葉だが、あちらは「実運用へ進んでよいか」、
 *   こちらは「仕入価格からAmazon販売までの採算をどう見るか」である。
 *   紛らわしいので、キー名にも関数名にも SupplierRoute を付けている。
 */
export type SupplierRouteSettings = {
  minNetProfit: number;
  minRoi: number;
  minRankDrops30: number;
  maxDataAgeHours: number;
  watchMaxGap: number;
  inboundShipping: number;
  supplierShipping: number;
  packaging: number;
  storage: number;
  otherCost: number;
  returnLossRate: number;
  offerLimit: number;
};

export async function getSupplierRouteSettings(): Promise<SupplierRouteSettings> {
  const s = await loadSettings();
  // ★見つからない設定を0で埋めない。既定値に落とす（0にすると費用が消えて利益が増える）。
  const int = (k: string, fallback: number) => {
    const v = Number(s.get(k));
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
  };
  const rate = (k: string, fallback: number) => {
    const v = Number(s.get(k));
    return Number.isFinite(v) && v >= 0 && v < 1 ? v : fallback;
  };
  return {
    minNetProfit: int('SUPPLIER_ROUTE_MIN_NET_PROFIT', 3000),
    minRoi: rate('SUPPLIER_ROUTE_MIN_ROI', 0.15),
    minRankDrops30: int('SUPPLIER_ROUTE_MIN_RANK_DROPS_30', 3),
    maxDataAgeHours: int('SUPPLIER_ROUTE_MAX_DATA_AGE_HOURS', 168),
    watchMaxGap: int('SUPPLIER_ROUTE_WATCH_MAX_GAP', 20000),
    inboundShipping: int('SUPPLIER_ROUTE_INBOUND_SHIPPING', 500),
    supplierShipping: int('SUPPLIER_ROUTE_SUPPLIER_SHIPPING', 0),
    packaging: int('SUPPLIER_ROUTE_PACKAGING', 150),
    storage: int('SUPPLIER_ROUTE_STORAGE', 100),
    otherCost: int('SUPPLIER_ROUTE_OTHER_COST', 0),
    returnLossRate: rate('SUPPLIER_ROUTE_RETURN_LOSS_RATE', 0.02),
    offerLimit: int('SUPPLIER_ROUTE_OFFER_LIMIT', 10),
  };
}

/**
 * 仕入ルート判定の版。Phase 1（`v1-`）・Phase 3（`r2-`）とは別に `s1-` を使う。
 * 混ぜると、ルート用のしきい値を触っただけで過去の仕入判断の版まで変わる（ルール24）。
 */
export async function supplierRouteRuleVersion(): Promise<string> {
  const t = await getSupplierRouteSettings();
  const sig = [
    t.minNetProfit,
    t.minRoi,
    t.minRankDrops30,
    t.maxDataAgeHours,
    t.watchMaxGap,
    t.inboundShipping,
    t.packaging,
    t.storage,
    t.otherCost,
    t.returnLossRate,
  ].join('|');
  let h = 0;
  for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) >>> 0;
  return `s1-${h.toString(16)}`;
}

export async function isPhase4Unlocked(): Promise<boolean> {
  const s = await loadSettings();
  return String(s.get('PHASE4_UNLOCKED') ?? 'false').toLowerCase() === 'true';
}

/* ================================================================
 * 自動リサーチ（Phase 5）
 * ================================================================ */

export type ResearchSettings = {
  minRankDrops30: number;
  maxOfferCount: number;
  maxDataAgeHours: number;
  aiDailyLimitJpy: number;
  aiPerProductLimitJpy: number;
};

export async function getResearchSettings(): Promise<ResearchSettings> {
  const s = await loadSettings();
  // ★見つからない設定を0で埋めない（0にすると上限が消えて、費用が止まらなくなる）。
  const int = (k: string, fallback: number) => {
    const v = Number(s.get(k));
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
  };
  return {
    minRankDrops30: int('RESEARCH_DEMAND_MIN_RANK_DROPS_30', 10),
    maxOfferCount: int('RESEARCH_DEMAND_MAX_OFFER_COUNT', 15),
    maxDataAgeHours: int('RESEARCH_DEMAND_MAX_DATA_AGE_HOURS', 720),
    aiDailyLimitJpy: int('RESEARCH_AI_DAILY_LIMIT_JPY', 500),
    aiPerProductLimitJpy: int('RESEARCH_AI_PER_PRODUCT_LIMIT_JPY', 20),
  };
}

/**
 * 自動リサーチの版。`a1-` を使う。
 *
 * ★Phase 1（`v1-`）・Phase 3（`r2-`）・Phase 4（`s1-`）と分けるのは、
 *   リサーチのしきい値を触っただけで、過去の仕入判断の版まで変わってしまうのを防ぐため。
 *   版が変わると、その版で出した候補は全部見直す決まりになっている（§45）。
 */
export async function researchRuleVersion(): Promise<string> {
  const t = await getResearchSettings();
  const sig = [t.minRankDrops30, t.maxOfferCount, t.maxDataAgeHours].join('|');
  let h = 0;
  for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) >>> 0;
  return `a1-${h.toString(16)}`;
}

export async function getThresholds(): Promise<Thresholds> {
  const s = await loadSettings();
  const num = (k: string) => Number(s.get(k));
  return {
    targetNetMargin: num('TARGET_NET_MARGIN'),
    minNetProfit: num('MIN_NET_PROFIT'),
    minRoi: num('MIN_ROI'),
    maxMarketPremiumRatio: num('MAX_MARKET_PREMIUM_RATIO'),
    marketDataMaxAgeHours: num('MARKET_DATA_MAX_AGE_HOURS'),
    anomalyLowRatio: num('ANOMALY_LOW_RATIO'),
    anomalyHighRatio: num('ANOMALY_HIGH_RATIO'),
    scoreStrongBuy: num('SCORE_STRONG_BUY'),
    scoreBuy: num('SCORE_BUY'),
    scoreWatch: num('SCORE_WATCH'),
    scoreLowPriority: num('SCORE_LOW_PRIORITY'),
    aiReviewMinScore: num('AI_REVIEW_MIN_SCORE'),
    aiUnitCostJpy: num('AI_UNIT_COST_JPY'),
    aiProfitMultiple: num('AI_PROFIT_MULTIPLE'),
    priceStepUpRate: num('PRICE_STEP_UP_RATE'),
    maxStepUps: num('MAX_STEP_UPS'),
    defaultPremiumRatio: num('DEFAULT_PREMIUM_RATIO'),
    premiumRatioMinSamples: num('PREMIUM_RATIO_MIN_SAMPLES'),
    maxStockForOneOfAKind: num('MAX_STOCK_FOR_ONE_OF_A_KIND'),
    routeMinNetProfit: num('ROUTE_MIN_NET_PROFIT'),
    routeMinRoi: num('ROUTE_MIN_ROI'),
    routeMinSellProbability: num('ROUTE_MIN_SELL_PROBABILITY'),
    routeMaxPerProduct: num('ROUTE_MAX_PER_PRODUCT'),
    liquidityDefault: num('LIQUIDITY_DEFAULT'),
    defaultDaysToSell: num('DEFAULT_DAYS_TO_SELL'),
    minDaysForAnnualized: num('MIN_DAYS_FOR_ANNUALIZED'),
    capitalMaxPerBrandRatio: num('CAPITAL_MAX_PER_BRAND_RATIO'),
    capitalMaxPerVenueRatio: num('CAPITAL_MAX_PER_VENUE_RATIO'),
    minConfidenceStrongBuy: num('MIN_CONFIDENCE_STRONG_BUY'),
    minConfidenceBuy: num('MIN_CONFIDENCE_BUY'),
    marketFreshHours: num('MARKET_FRESH_HOURS'),
    marketNormalHours: num('MARKET_NORMAL_HOURS'),
    shadowMinRouteScore: num('SHADOW_MIN_ROUTE_SCORE'),
    accuracyMinSamples: num('ACCURACY_MIN_SAMPLES'),
    accuracyMidSamples: num('ACCURACY_MID_SAMPLES'),
    accuracyFullSamples: num('ACCURACY_FULL_SAMPLES'),
    opportunityFastHours: num('OPPORTUNITY_FAST_HOURS'),
    conservativeHaircut: num('CONSERVATIVE_HAIRCUT'),
    forecastDefaultBand: num('FORECAST_DEFAULT_BAND'),
    humanReachHours: num('HUMAN_REACH_HOURS'),
    falsePositiveWeight: num('FALSE_POSITIVE_WEIGHT'),
  };
}

/**
 * 判定ルールの版。分析結果に必ず記録し、後からバックテストできるようにする。
 * しきい値を変えたら版も上げる。
 */
export async function ruleVersion(): Promise<string> {
  const t = await getThresholds();
  const sig = [
    t.targetNetMargin,
    t.minNetProfit,
    t.minRoi,
    t.maxMarketPremiumRatio,
    t.anomalyLowRatio,
    t.anomalyHighRatio,
    t.scoreStrongBuy,
    t.scoreBuy,
    t.scoreWatch,
    t.scoreLowPriority,
  ].join('|');
  let h = 0;
  for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) >>> 0;
  return `v1-${h.toString(16)}`;
}

/**
 * ルート判定の版。Phase 1 の rule_version とは別に持つ。
 * ここを Phase 1 と共有すると、ルート用のしきい値を触っただけで
 * 過去の仕入判断の版まで変わってしまい、判断履歴が追えなくなる。
 */
export async function routeRuleVersion(): Promise<string> {
  const t = await getThresholds();
  const sig = [
    t.routeMinNetProfit,
    t.routeMinRoi,
    t.routeMinSellProbability,
    t.liquidityDefault,
    t.defaultDaysToSell,
    t.minDaysForAnnualized,
    t.scoreStrongBuy,
    t.scoreBuy,
    t.scoreWatch,
    t.scoreLowPriority,
    // Phase 3。データ品質の天井と鮮度は判定そのものを変えるので、版に必ず含める。
    t.minConfidenceStrongBuy,
    t.minConfidenceBuy,
    t.marketFreshHours,
    t.marketNormalHours,
  ].join('|');
  let h = 0;
  for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) >>> 0;
  // Phase 3 で判定式が変わった（データ品質による上限・実績補正）。
  // 過去の r1- 記録と混ざると「同じ条件で出した判断」と誤解するので版を上げる。
  return `r2-${h.toString(16)}`;
}
