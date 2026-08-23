// Suzuho Awano Brand Bible をコード側の唯一の正として持つ。
// 出典: 事業Vault/AI YAMATO NADESHIKO/01_CHARACTER/SUZUHO_AWANO_PROFILE.md
// ★このファイルを1行変えると、生成される画像の条件とプロフィール文が変わる。

// 正式名称（2026-08-23 人間が決定）。
// 20語・5波の調査と日米の商標照会を通した結果として選ばれている。
// 経緯: 01_CHARACTER/名称候補調査.md
//
// ★名前そのものの定義は lib/identity.ts へ移した。
//   理由: 文字列1本で持ち回すと、受け取った側が勝手に姓を落としたり、
//   別の姓へ書き換えても誰も気付けない。Character Identity Object として渡す。
//   ここでは互換のために同じ値を再輸出しているだけで、正は identity.ts。
import {
  CHARACTER_IDENTITY,
  OPERATOR_BRAND,
  displayName,
  NAME_IS_PLACEHOLDER as IDENTITY_NAME_IS_PLACEHOLDER,
  NAME_IS_FULL_NAME as IDENTITY_NAME_IS_FULL_NAME,
} from "./identity.js";

export { CHARACTER_IDENTITY };

export const CHARACTER_NAME = CHARACTER_IDENTITY.full_name;
export const CHARACTER_NAME_JA = CHARACTER_IDENTITY.full_name_ja;
export const NAME_IS_PLACEHOLDER = IDENTITY_NAME_IS_PLACEHOLDER;

// Xなどの表示名。BRAND_IDENTITY_STRICT なので必ずフルネーム
export const DISPLAY_NAME = displayName();

// ★フルネーム運用が固有性の生命線（名称候補調査.md 第5波）。
//   20語を調べて分かったのは「日本人の下の名前は業界に埋め尽くされていて、
//   単独では必ず先客がいる」ということ。固有性はフルネームの組み合わせでしか作れない。
//   ただし固有性が要るのは「外から検索・照合される面」であって、本人が喋る本文ではない。
//   そのため下の名前だけの表記は、使用場所によって判定を変える
//   （compliance.ts の NAME_SHORT_FORM / lib/identity.ts の NAME_POLICY）。
export const CHARACTER_GIVEN_NAME = CHARACTER_IDENTITY.given_name;
export const CHARACTER_FAMILY_NAME = CHARACTER_IDENTITY.family_name;
export const NAME_IS_FULL_NAME = IDENTITY_NAME_IS_FULL_NAME;

// 運営者表記＝運営ブランド名。★キャラクターIPとは別物として lib/identity.ts で管理する。
//   本名ではなく屋号を使う。個人名を海外に永久に残さずに責任主体を示せるため。
//   2026-08-23 に "Slow Japan Guide" で確定（人間が決定）。
export const OPERATOR_NAME = OPERATOR_BRAND.name;
export { OPERATOR_BRAND };

export const BRAND_COLORS = {
  primary: "#26456E",
  base: "#F5F0E6",
  accent: "#C1552E",
  text: "#2B2B2B",
} as const;

export type BrandColor = (typeof BRAND_COLORS)[keyof typeof BRAND_COLORS];

// 4色以外を使えなくする。増やさない（BRAND_RULES.md）
export function assertBrandColor(hex: string): asserts hex is BrandColor {
  const allowed = Object.values(BRAND_COLORS) as string[];
  if (!allowed.includes(hex.toUpperCase())) {
    throw new Error(
      `ブランドカラー外の色です: ${hex} / 使えるのは ${allowed.join(", ")} の4色だけ`,
    );
  }
}

export const APPEARANCE = {
  age: "mid-20s (25)",
  hair: "long straight black hair, past the shoulder blades, thin see-through fringe",
  height: "163cm, slender, average-tall",
  build: "slim but not skinny",
  skin: "bright, natural skin texture, visible pores",
  eyes: "soft dark eyes, dark iris, subtle double eyelid",
  makeup: "natural makeup, sheer lip with some color, soft eyeliner",
  expression: "gentle expression, between a small smile and neutral",
} as const;

// 強調構図はXの成人向け判定（暗示的も対象）に触れるため、生成語に一切入れない
export const APPEARANCE_FORBIDDEN = [
  "cleavage",
  "revealing clothes",
  "lingerie",
  "nudity",
  "wet clothes",
  "underwear",
  "body emphasis",
  "child",
  "teen",
  "loli",
] as const;

export const OUTFITS = {
  kimono: {
    scenes: ["shrine", "japanese garden", "tea room", "new year", "festival"],
    prompt:
      "traditional japanese kimono in a calm ground color (indigo, moss green, persimmon, iron navy), fine komon pattern",
  },
  yukata: {
    scenes: ["summer", "festival", "fireworks", "engawa veranda"],
    // 着崩し表現は使わない
    prompt: "navy yukata with white botanical pattern, collar worn properly closed",
  },
  modern: {
    scenes: ["daily life", "cafe", "train", "street"],
    prompt: "shirt or knit with a long skirt, fully covered",
  },
} as const;

export const PHOTO_STYLE = {
  locations: [
    "kyoto",
    "nara",
    "kanazawa",
    "ryokan",
    "shrine",
    "japanese garden",
    "engawa veranda",
    "narrow alley",
    "tea room",
  ],
  timeOfDay: "early morning or late afternoon, backlight and raking light",
  // 接写のドアップは顔の一貫性が崩れやすいので距離を固定する
  framing: "bust-up to full body, no extreme close-up",
  light: "natural light only, no studio flash",
  promptTail:
    "photorealistic, DSLR, 85mm, shallow depth of field, natural light, film grain",
} as const;

// ai-influencer/generate_char.py と一致させる。ずれると顔が変わる
export const GENERATION_PARAMS = {
  checkpoint: "RealVisXL_V5.0.safetensors",
  width: 832,
  height: 1216,
  steps: 30,
  cfg: 5.0,
  sampler: "dpmpp_2m",
  scheduler: "karras",
  faceWeight: 0.9,
  faceIdV2Weight: 1.4,
} as const;

export const VOICE = {
  englishLevel: "intermediate: few grammar mistakes, plain phrasing, not native",
  emotion: "restrained. 'I like this season.' is fine, 'OMG AMAZING!!!' is not",
  role: "a guide introducing Japanese culture, not the main character",
  maxHashtags: 3,
} as const;

// EU AI Act 50条を根拠に最初から開示する（DECISION）。文言は固定
export function profileBio(): string {
  return [
    // 1行目: AI生成であることを最初に名乗る。EU AI Act 50条・FTCの観点で後出しにしない
    "AI-generated Japanese virtual creator.",
    // 2行目: 何のアカウントかを1行で。着物・文化・知られざる日本＝投稿テーマそのもの
    "Kimono, culture & hidden Japan.",
    // 3行目: 責任主体。★キャラ名ではなく運営ブランド名を書く（IPと運営の分離）
    `Run by ${OPERATOR_NAME}.`,
  ].join("\n");
}

// 完全自動運用へ進む段階で足す。今の段階では足さない
export const AUTOMATED_LABEL_LINE = "Automated account.";

export function basePrompt(): string {
  return [
    `beautiful ${APPEARANCE.age} japanese woman`,
    NAME_IS_PLACEHOLDER ? null : `named ${CHARACTER_NAME}`,
    "adult woman",
    APPEARANCE.hair,
    APPEARANCE.eyes,
    APPEARANCE.skin,
    APPEARANCE.makeup,
    APPEARANCE.expression,
    APPEARANCE.build,
  ]
    .filter(Boolean)
    .join(", ");
}

export function negativePrompt(): string {
  return [
    "cartoon, anime, illustration, 3d render, cgi, doll, plastic skin",
    "deformed, bad anatomy, extra fingers, mutated hands, blurry, low quality",
    "watermark, text, logo, multiple people, oversaturated, heavy makeup",
    ...APPEARANCE_FORBIDDEN,
  ].join(", ");
}

// 顔候補8枚。基準顔を選ぶための構図なので、服装と背景は素直なものに寄せる
export function faceCandidateScenes(): string[] {
  return [
    "head and shoulders portrait, looking at camera, front view, neutral background, soft morning light",
    "bust-up, slight three-quarter angle, wooden corridor of an old house, late afternoon backlight",
    "bust-up, looking slightly away, quiet shrine approach with trees, soft overcast light",
    "waist-up, standing on an engawa veranda, japanese garden behind, early morning light",
    "bust-up, seated at a low table in a tea room, soft raking light from a paper screen",
    "waist-up, walking in a narrow kyoto alley, gentle evening light",
    "bust-up, gentle small smile, plain indigo background, natural window light",
    "waist-up, standing in a japanese garden with moss and stone, soft diffused daylight",
  ];
}

export interface QaResult {
  ok: boolean;
  failures: string[];
}

/**
 * 顔の一致で見る項目としきい値。
 *
 * ★同一人物に見えないと、Xからは「毎日違うAI女性を投稿するアカウント」に見える。
 *   これは投稿数を増やすほど不利になるので、類似度スコア1本ではなく
 *   髪型・年齢感・目鼻・輪郭まで別々に機械で見る。
 *   スコアは高いのに髪の長さだけ毎回違う、という崩れ方を1本の数字では捕まえられない。
 */
export const FACE_QA = {
  /** 基準顔との類似度の下限。これを割ったら人に見せずに捨てる */
  minSimilarity: 0.8,
  /** 髪（長さ・前髪・分け目・色）の一致率の下限 */
  minHairMatch: 0.85,
  /** 顔の形（輪郭・縦横比・あご）の一致率の下限 */
  minFaceShapeMatch: 0.85,
  /** 目（形・間隔・二重幅）の一致率の下限。ここがずれると一番別人に見える */
  minEyesMatch: 0.85,
  /** 鼻（高さ・幅・位置）の一致率の下限 */
  minNoseMatch: 0.85,
  /** 口（形・厚み・口角）の一致率の下限 */
  minMouthMatch: 0.85,
  /** 肌の色みの一致率の下限。ライティングで転びやすいので少し緩める */
  minSkinToneMatch: 0.8,
  /** 見た目年齢の許容幅（歳）。基準顔は25歳想定 */
  baseAge: 25,
  ageTolerance: 4,
} as const;

/**
 * 顔の一致QAへ渡す実測値。測れなかった項目は null にする（0にしない）。
 *
 * ★以前は目と鼻を eyeNoseMatch の1本にまとめ、口と肌の色を見ていなかった。
 *   実際に別人化が起きるとき、まず口の形と肌の色みが転ぶ。
 *   1本の類似度スコアは平均なので、口だけ毎回違っても数値が下がりきらない。
 *   だから部位ごとに分けて、それぞれ独立に落とす。
 */
export interface FaceConsistencyInput {
  faceSimilarity: number | null;
  hairMatch: number | null;
  faceShapeMatch: number | null;
  eyesMatch: number | null;
  noseMatch: number | null;
  mouthMatch: number | null;
  skinToneMatch: number | null;
  /** 推定された見た目年齢 */
  estimatedAge: number | null;
}

/**
 * 基準顔が LOCKED になった後だけ意味を持つ検査。
 * ★測れなかった項目を「合格」にしない。null は未計測として落とす。
 */
export function qaFaceConsistency(input: FaceConsistencyInput): QaResult {
  const failures: string[] = [];
  const need = (
    label: string,
    value: number | null,
    min: number,
  ) => {
    if (value === null) {
      failures.push(`${label}が未計測（測れていないものを合格にしない）`);
      return;
    }
    if (value < min) failures.push(`${label}が基準未満 (${value.toFixed(2)} < ${min})`);
  };

  need("基準顔との類似度", input.faceSimilarity, FACE_QA.minSimilarity);
  need("髪の一致", input.hairMatch, FACE_QA.minHairMatch);
  need("顔の形の一致", input.faceShapeMatch, FACE_QA.minFaceShapeMatch);
  need("目の一致", input.eyesMatch, FACE_QA.minEyesMatch);
  need("鼻の一致", input.noseMatch, FACE_QA.minNoseMatch);
  need("口の一致", input.mouthMatch, FACE_QA.minMouthMatch);
  need("肌の色みの一致", input.skinToneMatch, FACE_QA.minSkinToneMatch);

  if (input.estimatedAge === null) {
    failures.push("見た目年齢が未計測");
  } else {
    const diff = Math.abs(input.estimatedAge - FACE_QA.baseAge);
    if (diff > FACE_QA.ageTolerance) {
      failures.push(
        `年齢感が基準顔から離れている (推定${input.estimatedAge}歳 / 基準${FACE_QA.baseAge}歳 ± ${FACE_QA.ageTolerance}歳)`,
      );
    }
  }

  return { ok: failures.length === 0, failures };
}

// 人間に見せる前に機械で落とす（HANA_PROFILE.md §7）。
// 迷う程度に未成年寄りなら捨てる＝しきい値ではなくフラグで扱う
export function qaImage(input: {
  faceSimilarity: number | null;
  fingerCountOk: boolean;
  hasGarbledText: boolean;
  exposureWithinLimit: boolean;
  looksUnderageOrUncertain: boolean;
  resemblesRealPerson: boolean | null;
  /** 基準顔が確定した後は、ここも必ず埋めて渡す */
  consistency?: FaceConsistencyInput;
  /** 基準顔の状態。LOCKED なら一致QAを必須にする */
  referenceFaceStatus?: string;
}): QaResult {
  const failures: string[] = [];
  if (input.faceSimilarity !== null && input.faceSimilarity < FACE_QA.minSimilarity) {
    failures.push(`基準顔との類似度が低い (${input.faceSimilarity.toFixed(2)})`);
  }
  if (!input.fingerCountOk) failures.push("指の本数が不正");
  if (input.hasGarbledText) failures.push("崩れた文字が写り込んでいる");
  if (!input.exposureWithinLimit) failures.push("露出面積または強調構図が基準外");
  if (input.looksUnderageOrUncertain) failures.push("未成年に見える（迷った時点でアウト）");
  if (input.resemblesRealPerson === null) {
    failures.push("実在人物との照合が未実施（人が画像検索で確認するまで通さない）");
  } else if (input.resemblesRealPerson) {
    failures.push("実在人物に酷似");
  }

  // 基準顔が決まっているのに一致QAを渡していない＝検査を素通りさせている
  if (input.referenceFaceStatus === "LOCKED") {
    if (!input.consistency) {
      failures.push("基準顔が確定済みなのに顔一致QAの実測値が渡されていない");
    } else {
      failures.push(...qaFaceConsistency(input.consistency).failures);
    }
  }

  return { ok: failures.length === 0, failures };
}
