import { all, nowIso, one, upsert, type Row } from '../db/client';
import { checkExpression, pickVariant as variant, similarity } from '../text';
import { num } from '../settings';
import { READINESS_CLAIM } from '../catalog/definitions';
import type { JobAnalysis } from './analyze';
import type { JobScore } from './score';
import { extractJobFacts, type JobFactSheet } from './facts';

/**
 * 応募文。
 *
 * ★テンプレの使い回しは禁止。
 *   その案件の本文から拾った言葉が入っていなければ作らない。
 *   他の応募文と似すぎていたら止める。
 * ★誇大な表現（必ず・絶対・No.1 など）が入ったら止める。
 * ★出せる金額・納期は、見積もった時間から計算した数字だけを書く。
 */

export type Proposal = {
  jobId: number;
  body: string;
  /** その案件について書いた部分だけ。使い回しの判定はここだけで行う。 */
  personalText: string;
  price: number | null;
  deliveryDays: number | null;
  evidenceUsed: string[];
  similarityMax: number;
  expressionNg: { code: string; why: string; matched: string }[];
  status: 'READY' | 'BLOCKED';
  blockedReason: string | null;
};

/** 案件本文から、実際に読んだ証拠になる言葉を拾う。 */
export function evidenceFromJob(job: Row, analysis: JobAnalysis): string[] {
  const out: string[] = [];
  const title = String(job.title ?? '');
  const desc = String(job.description ?? '');
  if (title) out.push(`件名「${title.slice(0, 40)}」`);
  for (const t of analysis.tasks.slice(0, 3)) out.push(`作業内容：${t}`);
  const qty = desc.match(/([0-9０-９]{1,3})\s*(本|記事|件|ページ|枚)/);
  if (qty) out.push(`分量：${qty[0]}`);
  const deadline = job.deadline ? `納期：${job.deadline}` : desc.match(/(納期|締切|希望日).{0,12}/)?.[0];
  if (deadline) out.push(String(deadline));
  return out;
}

/** 見積もり時間と時給目標から、出す金額を決める。予算が書いてあればその範囲に収める。 */
export async function proposePrice(job: Row, analysis: JobAnalysis): Promise<number | null> {
  const target = await num('job.target_hourly');
  const wanted = Math.round(analysis.estHours * target);
  const lo = job.budget_min === null || job.budget_min === undefined ? null : Number(job.budget_min);
  const hi = job.budget_max === null || job.budget_max === undefined ? null : Number(job.budget_max);
  if (lo === null && hi === null) return wanted > 0 ? wanted : null;
  const max = hi ?? lo!;
  const min = lo ?? hi!;
  return Math.max(min, Math.min(max, wanted));
}

export function proposeDeliveryDays(analysis: JobAnalysis): number {
  // AIが肩代わりする割合が高いほど早い。ただし最低2日は見る（人間の確認が必ず入るため）。
  const raw = Math.ceil(analysis.estHours / 4) + (analysis.automationRate >= 0.7 ? 1 : 3);
  return Math.max(2, raw);
}

/**
 * 案件本文から、そのまま引ける一文。読んだ証拠として応募文に入れる。
 *
 * ★「本文の2文目」のような固定の位置から取ってはいけない。
 *   募集文の出だしは「〇〇をお願いします」「固定報酬でお支払いします」のように
 *   どの案件でも同じになりやすく、そこを引用しても読んだ証拠にならないうえ、
 *   別の案件への応募文と同じ一文になってしまう。
 *
 * ★もう一つ、件名で既に分かることを引用してもいけない。
 *   件名が「サムネイル画像の作成」で、引用が「サムネイルのデザインをお願いします」では、
 *   件名を読み直しただけで、本文を読んだことにはならない。
 *   だから「定型句」と「件名で既に言っている言葉」の両方を外し、残りが一番多い一文を選ぶ。
 */
const BOILERPLATE_RE = /固定報酬|お支払い|ご相談ください|よろしくお願い|募集(します|しています)|(して|し)ください|お願いします|報酬は|納期は|分量は|[のでにをはがともや、]/g;

export function quoteFromDescription(job: Row): string | null {
  const desc = String(job.description ?? '').replace(/\s+/g, '');
  if (desc.length < 20) return null;
  const parts = desc.split(/[。、]/).filter((s) => s.length >= 12);
  if (parts.length === 0) return null;

  // 件名に出てくる2文字のかたまりを「既に分かっていること」として持っておく。
  const title = String(job.title ?? '').replace(/\s+/g, '');
  const known = new Set<string>();
  for (let i = 0; i + 2 <= title.length; i++) known.add(title.slice(i, i + 2));

  const newness = (s: string): number => {
    const t = s.replace(BOILERPLATE_RE, '');
    let n = 0;
    for (let i = 0; i + 2 <= t.length; i++) if (!known.has(t.slice(i, i + 2))) n++;
    return n;
  };

  // 残りが一番多い一文を選ぶ。同点なら先に出てくるほうを使う。
  let best = parts[0];
  let bestScore = -1;
  for (const s of parts) {
    const score = newness(s);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best.slice(0, 50);
}

/**
 * 応募文を組み立てる。
 *
 * body     … 実際に送る全文
 * personal … そのうち「この案件について書いた部分」だけ
 *
 * 使い回しの判定に全文を使うと、見積り・納期・締めの挨拶といった
 * どの応募文でも同じになる部分だけで似た判定になり、
 * ちゃんと個別に書けている文まで止まってしまう。だから比べるのは personal だけにする。
 */
/**
 * 応募文に必ず入れる6つの要素。
 *
 * ★1つでも欠けたら送らない。
 *   欠けた応募文は「読んでいないのに応募だけしてきた人」に見える。
 *   特に「どう進めるか」と「何を渡すか」が無い応募文は、受注してから話が食い違う。
 *
 * ★ここで見るのは「書いてあるか」だけ。書いてある中身が本当かは
 *   audit.ts の別の検査（引用の照合・実績の言い切り）が見る。
 */
export const PROPOSAL_ELEMENTS: { key: string; ja: string; test: (body: string) => boolean }[] = [
  { key: 'UNDERSTAND', ja: '案件内容を理解している具体的な一文', test: (b) => /「[^」]{4,}」/.test(b) },
  { key: 'PLAN', ja: 'どう進めるか', test: (b) => b.includes('【進め方】') },
  { key: 'DELIVERABLE', ja: '成果物（何をお渡しするか）', test: (b) => b.includes('【お渡しするもの】') },
  { key: 'DEADLINE', ja: '納期への考え方', test: (b) => b.includes('【納期】') && b.includes('前提で出しています') },
  { key: 'CAPABILITY', ja: '使える既存の道具', test: (b) => b.includes('【できること】') },
  { key: 'HUMAN_CHECK', ja: '人が確認する工程', test: (b) => /(確認して|見直し|点検)/.test(b) },
];

/** 応募文に足りない要素の名前（日本語）を返す。すべてそろっていれば空。 */
export function missingProposalElements(body: string): string[] {
  return PROPOSAL_ELEMENTS.filter((e) => !e.test(body)).map((e) => e.ja);
}

/**
 * 「何をお渡しするか」の一文。
 * ★本文に成果物の形が書いていなければ、勝手に決めない。
 *   「Wordで納品します」と書いて実はスプレッドシート希望だった、が起きる。
 *   書いていないなら「書いていないので確認させてください」とそのまま書くほうが誠実で、
 *   本文を読んでいる証拠にもなる。
 */
function deliverableLine(sheet: JobFactSheet): string {
  const f = sheet.facts.find((x) => x.field === 'DELIVERABLE');
  if (f && f.status === 'FOUND' && f.value) {
    return `【お渡しするもの】本文に「${f.value.slice(0, 40)}」とありましたので、その形でお渡しします。`;
  }
  return '【お渡しするもの】本文に成果物の形（ファイル形式・本数など）の記載が見当たりませんでした。着手前に確認させてください。';
}

function buildBody(job: Row, analysis: JobAnalysis, price: number | null, days: number, sheet: JobFactSheet): { body: string; personal: string } {
  const seed = Number(job.id) || 1;
  const title = String(job.title ?? '').slice(0, 40);
  const quote = quoteFromDescription(job);
  const qty = String(job.description ?? '').match(/([0-9０-９]{1,3})\s*(本|記事|件|ページ|枚)/);
  const lines: string[] = [];
  const personal: string[] = [];

  lines.push(
    variant(
      [
        'はじめまして。ご依頼を拝見しました。',
        'はじめてご連絡します。募集内容を読ませていただきました。',
        'ご依頼の内容を拝見し、応募いたします。',
        '募集を拝見しました。お力になれそうでしたのでご連絡します。',
      ],
      seed,
      0,
    ),
  );
  lines.push('');
  const taskLine = variant(
    [
      `「${title}」について、${analysis.tasks.join('・')}の部分を担当できます。`,
      `「${title}」のうち、${analysis.tasks.join('と')}をお引き受けできます。`,
      `${analysis.tasks.join('・')}が中心と読みました。「${title}」であればお手伝いできます。`,
      `ご依頼「${title}」は、${analysis.tasks.join('・')}が要になると理解しています。そこを担当できます。`,
    ],
    seed,
    1,
  );
  lines.push(taskLine);
  personal.push(taskLine);
  if (quote) {
    const quoteLine = variant(
      [
        `本文にある「${quote}」という点は、特に注意して進めます。`,
        `「${quote}」と書かれていた部分を、いちばん外せない条件として扱います。`,
        `「${quote}」というご要望に沿う形でお出しします。`,
      ],
      seed,
      2,
    );
    lines.push(quoteLine);
    personal.push(quoteLine);
  }
  if (qty) {
    const qtyLine = `${qty[0]}という分量で承知しています。`;
    lines.push(qtyLine);
    personal.push(qtyLine);
  }
  lines.push('【できること】');
  // ★書き添える一言は、その道具の仕上がり具合で決まっているものだけを使う。
  //   全部に「実際に運用しています」と書くと、試作しかない道具まで実績になってしまう（優良誤認）。
  for (const m of analysis.matchedCaps.slice(0, 3)) {
    lines.push(`・${m.name}（${READINESS_CLAIM[m.readiness]}）`);
    // どの道具を当てたかは案件ごとに変わるので、個別に書いた部分として数える。
    personal.push(m.name);
  }
  lines.push('');

  // ★どう進めるか。ここが無い応募文は、受注してから話が食い違う。
  //   工程は analyze.ts で時間を積んだ7工程と同じ並びにする（見積り時間と説明が食い違わないため）。
  lines.push('【進め方】');
  lines.push('1. ご依頼内容と、お預かりする素材（資料・画像・アカウントなど）を確認します。');
  lines.push('2. 上に挙げた道具で初稿を作ります。');
  lines.push('3. できたものを私が読み直し、事実関係と表現を点検します。');
  lines.push('4. 初稿をお送りし、ご指摘をいただいて直します。');
  lines.push('5. 形式をそろえてお渡しします。');
  lines.push('');

  const deliv = deliverableLine(sheet);
  lines.push(deliv);
  // 本文から読み取れたときだけ、その案件について書いた部分として数える。
  // 読み取れなかったときの文はどの案件でも同じなので、個別に書いた部分には入れない。
  if (deliv.includes('とありましたので')) personal.push(deliv);
  lines.push('');

  if (price !== null) lines.push(`【お見積り】${price.toLocaleString()}円`);
  lines.push(`【納期】ご依頼確定から${days}日`);
  lines.push(
    `納期は、作る時間だけでなく、内容の確認と手直しにかかる時間を入れて合計${analysis.estHours}時間かかる前提で出しています。`
    + 'お急ぎのご事情があれば、範囲を相談させてください。',
  );
  lines.push('');
  lines.push(
    variant(
      [
        '作ったものは、そのまま出さずに一度こちらで内容を確認してからお渡しします。',
        '納品前に必ず自分で見直し、確認してからお渡しします。',
        'お渡しする前に、事実関係と表現を一度点検します。',
      ],
      seed,
      3,
    ),
  );
  lines.push(
    variant(
      [
        'ご希望と違う部分があれば、着手前に擦り合わせさせてください。',
        '認識がずれていそうな点があれば、先に確認させてください。',
        '進め方のご希望があれば、着手前に合わせます。',
      ],
      seed,
      4,
    ),
  );
  lines.push('');
  lines.push('よろしくお願いいたします。');
  return { body: lines.join('\n'), personal: personal.join('\n') };
}

/**
 * 他の応募文とどれだけ似ているか。
 * 比べるのは「その案件について書いた部分」だけ。見積り・納期・挨拶は比べない。
 * 比較相手は READY のものだけにする（止めた文まで相手にすると、1本の似た文で連鎖的に全部止まる）。
 */
async function maxSimilarityAgainstExisting(jobId: number, personal: string): Promise<number> {
  const rows = await all("SELECT personal_text FROM proposals WHERE job_id <> ? AND status = 'READY' ORDER BY id DESC LIMIT 200", [jobId]);
  let max = 0;
  for (const r of rows) {
    const s = similarity(personal, String(r.personal_text ?? ''));
    if (s > max) max = s;
  }
  return Number(max.toFixed(3));
}

export async function buildProposal(job: Row, analysis: JobAnalysis, score: JobScore): Promise<Proposal> {
  const jobId = Number(job.id);

  const empty = { jobId, body: '', personalText: '', price: null, deliveryDays: null, evidenceUsed: [], similarityMax: 0, expressionNg: [] };

  if (score.verdict === 'EXCLUDE') {
    return { ...empty, status: 'BLOCKED', blockedReason: `応募しない案件なので文面を作らない（${score.verdictReason}）` };
  }

  // ★同じ中身の依頼が既に入っているときは、文面を作らずここで止める。
  //   同じ依頼主に同じ応募文を何通も出すのは、こちらの落ち度になる。
  //   これまでは「他の応募文と似すぎている」として止まっていたが、
  //   それだと『文章の書き方が悪い』と読めてしまい、直しようのない指摘になっていた。
  //   本当の理由は『同じ依頼が2回入っている』なので、そう出す。
  if (job.duplicate_of !== null && job.duplicate_of !== undefined) {
    const orig = await one('SELECT id, site_code, url FROM jobs WHERE id = ?', [Number(job.duplicate_of)]);
    const where = orig ? `案件ID ${orig.id}／${orig.site_code}` : `案件ID ${job.duplicate_of}`;
    return { ...empty, status: 'BLOCKED', blockedReason: `同じ内容の依頼が既にある（${where}）。重複応募になるので、応募はそちら1件に絞る。` };
  }

  const evidence = evidenceFromJob(job, analysis);
  const price = await proposePrice(job, analysis);
  const days = proposeDeliveryDays(analysis);
  const sheet = extractJobFacts(job);
  const { body, personal } = buildBody(job, analysis, price, days, sheet);

  const expressionNg = checkExpression(body);
  const similarityMax = await maxSimilarityAgainstExisting(jobId, personal);
  const maxSim = await num('draft.max_similarity');

  let status: Proposal['status'] = 'READY';
  let blockedReason: string | null = null;
  if (expressionNg.length > 0) {
    status = 'BLOCKED';
    blockedReason = `使えない表現が入っている: ${expressionNg.map((e) => `「${e.matched}」`).join('、')}`;
  } else if (missingProposalElements(body).length > 0) {
    // ★6要素のどれかが欠けた応募文は出さない。欠けたまま出すと、
    //   読んでいない応募に見えるうえ、受注後に「何を渡すか」で揉める。
    status = 'BLOCKED';
    blockedReason = `応募文に必要な要素が足りない（${missingProposalElements(body).join('・')}）。`;
  } else if (evidence.length < 2) {
    status = 'BLOCKED';
    blockedReason = '案件本文から読み取れた内容が少なすぎる。テンプレ文になるので応募しない。';
  } else if (similarityMax > maxSim) {
    status = 'BLOCKED';
    blockedReason = `他の応募文と似すぎている（類似度${similarityMax}／上限${maxSim}）`;
  }

  return { jobId, body, personalText: personal, price, deliveryDays: days, evidenceUsed: evidence, similarityMax, expressionNg, status, blockedReason };
}

export async function saveProposal(p: Proposal): Promise<void> {
  await upsert(
    'proposals',
    {
      job_id: p.jobId,
      body: p.body,
      personal_text: p.personalText,
      price: p.price,
      delivery_days: p.deliveryDays,
      evidence_used: JSON.stringify(p.evidenceUsed),
      similarity_max: p.similarityMax,
      expression_ng: JSON.stringify(p.expressionNg),
      status: p.status,
      blocked_reason: p.blockedReason,
      created_at: nowIso(),
    },
    ['job_id'],
  );
}
