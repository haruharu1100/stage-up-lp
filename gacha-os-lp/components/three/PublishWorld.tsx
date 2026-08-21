"use client";

/**
 * このサイトの代表シーン。
 *
 * 「あなたが承認したら、こうなる」を、ひと続きの3Dで見せます。
 *
 *   左：AI GACHA OS（管理画面）        右：お客様のスマートフォン
 *
 *   ① 公開前バックテストの結果を確認する      （あなたの仕事）
 *   ② 承認する                                （あなたの仕事）
 *   ③ 公開処理が走る                          （システムの仕事）
 *   ④ 光がスマホへ飛ぶ ＝ お客様の画面に出る
 *   ⑤ お客様が引く
 *   ⑥ 当たる
 *   ⑦ 発送を依頼する
 *
 * スクロールがそのまま「時間」になります。
 * ページを下へ送ると、話が前に進みます。
 */

import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import Stage3D from "./world/Stage3D";
import {
  Beam,
  BeamFlow,
  Drift,
  FloatShadow,
  Label,
  Lighting,
  beamCurve,
  type Tier,
} from "./world/parts";
import { AdminLaptop, CustomerPhone } from "./world/screens";
import type { PhoneScreenKey } from "./screen/customer";
import StaticCore from "../hero/StaticCore";

/* ────────────────────────────────────────────
   台本。0→1 のスクロール位置に、話の場面を割り当てる
   ──────────────────────────────────────────── */

export type Beat = {
  /** この場面が始まるスクロール位置 */
  at: number;
  /** 画面の外に出す見出し（3Dの中の字は小さいので、読ませたい言葉はHTML側） */
  title: string;
  body: string;
  /** だれの仕事か */
  who: "HUMAN" | "AI" | "CUSTOMER";
};

export const BEATS: Beat[] = [
  {
    at: 0,
    title: "AIが出した結果を、あなたが見る",
    body: "1万回ぶんの結果と、赤字になる確率。公開してよいかどうかの材料がそろっています。",
    who: "HUMAN",
  },
  {
    at: 0.2,
    title: "承認する",
    body: "ここだけは、人が決めます。AIは候補と試算を出すところまでです。",
    who: "HUMAN",
  },
  {
    at: 0.38,
    title: "公開の作業は、システムがやる",
    body: "保存・在庫の引き当て・サイトへの掲載・監視の開始まで、続けて進みます。",
    who: "AI",
  },
  {
    at: 0.56,
    title: "お客様の画面に、すぐ出る",
    body: "いま公開したガチャが、お客様のスマートフォンに並びます。",
    who: "CUSTOMER",
  },
  {
    at: 0.74,
    title: "お客様が引く",
    body: "ポイントで引いて、その場で結果が出ます。",
    who: "CUSTOMER",
  },
  {
    at: 0.88,
    title: "当たったら、発送を依頼できる",
    body: "お客様は「発送」か「ポイントに戻す」かを選べます。選ばれた発送は、管理画面の発送待ちに入ります。",
    who: "CUSTOMER",
  },
];

/** 進み具合 p から、いま何場面目か */
export function beatIndex(p: number) {
  let i = 0;
  for (let k = 0; k < BEATS.length; k++) if (p >= BEATS[k].at) i = k;
  return i;
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** from→to の区間を 0→1 にする */
function seg(p: number, from: number, to: number) {
  return clamp01((p - from) / (to - from));
}

/* ────────────────────────────────────────────
   3Dの中身
   ──────────────────────────────────────────── */

function Scene({
  tier,
  progress,
  compact,
  onBeat,
}: {
  tier: Tier;
  progress: MutableRefObject<number>;
  compact: boolean;
  onBeat: (i: number) => void;
}) {
  const { camera } = useThree();
  const lastBeat = useRef(-1);

  // なめらかに追いかけるための現在値
  const now = useRef({ p: 0 });

  // ここはサイトの代表シーン。機械を小さく置くと「ただの挿絵」になるので、
  // 画面の高さいっぱいを使う大きさにしている。
  const L = compact
    ? {
        // スマホは横が狭いので、左右ではなく「奥に管理画面／手前にスマホ」で置く。
        // 重ねすぎると両方読めなくなるため、必ず斜めにずらすこと。
        pc: [-0.5, 0.85, -0.4] as const,
        pcW: 3.0,
        phone: [0.72, -0.75, 1.6] as const,
        phoneW: 1.0,
      }
    : {
        pc: [-1.2, -0.4, 0] as const,
        pcW: 4.4,
        phone: [2.5, 0.4, 0.8] as const,
        phoneW: 1.48,
      };

  // 公開の光が通る道
  const publishCurve = useMemo(
    () =>
      beamCurve(
        [L.pc[0] + 1.45, L.pc[1] + 1.35, 0.25],
        [L.phone[0] - 0.4, L.phone[1] + 0.2, L.phone[2]],
        compact ? 0.7 : 0.55
      ),
    [L.pc, L.phone, compact]
  );

  const baseZ = compact ? 6.2 : 8.2;

  useFrame((_, dt) => {
    // スクロール位置をなめらかに追う（カクつかせない）
    const k = Math.min(1, dt * 4.2);
    now.current.p += (progress.current - now.current.p) * k;
    const p = now.current.p;

    // 場面が変わったら外へ知らせる
    const bi = beatIndex(progress.current);
    if (bi !== lastBeat.current) {
      lastBeat.current = bi;
      onBeat(bi);
    }

    // カメラ。前半は管理画面へ、後半はスマホへ寄る
    const toPhone = seg(p, 0.5, 0.82);
    // 寄りすぎると管理画面が画面の外に切れる。1.55 はラベルが残る上限
    const targetX = compact ? 0 : -0.5 + toPhone * 1.55;
    const targetY = (compact ? 0.35 : 0.35) - toPhone * 0.1;
    const targetZ = baseZ - toPhone * (compact ? 1.4 : 2.3);

    camera.position.x += (targetX * 0.55 - camera.position.x) * k;
    camera.position.y += (targetY * 0.4 - camera.position.y) * k;
    camera.position.z += (targetZ - camera.position.z) * k;
    camera.lookAt(targetX, targetY, 0);
  });

  /* ── 管理画面：承認前はバックテスト、承認後は公開画面 ── */
  const adminDriver = () => {
    const v = now.current.p;
    if (v < 0.2) {
      // 結果を見ている（計算し終わった状態）
      return { key: "backtest" as const, time: 2.4 + seg(v, 0, 0.2) * 2 };
    }
    // 0.20→0.56 を、公開画面の 0→3.6秒 に伸ばす
    return { key: "publish" as const, time: seg(v, 0.2, 0.56) * 3.6 };
  };

  /* ── お客様のスマホ：公開されるまで新しいガチャは出ない ──
     ★画面の切り替わりは、必ず BEATS の区切りに合わせること。
       見出しが「引く」なのに画面が一覧のまま、という食い違いを作らない。
       0.56 …「お客様の画面に、すぐ出る」（一覧 → 中身を見る）
       0.74 …「お客様が引く」
       0.88 …「当たったら、発送を依頼できる」                        */
  const phoneDriver = (): { key: PhoneScreenKey; time: number } => {
    const v = now.current.p;
    // まだ公開していない：いつもの一覧のまま止めておく
    if (v < 0.56) return { key: "home", time: 0.9 };
    // 公開された：新しいガチャが一覧に出る → 中身を見る
    if (v < 0.66) return { key: "home", time: seg(v, 0.56, 0.66) * 4.0 };
    if (v < 0.74) return { key: "detail", time: seg(v, 0.66, 0.74) * 4.8 };
    // 引く
    if (v < 0.88) return { key: "play", time: seg(v, 0.74, 0.88) * 3.1 };
    // 当たる
    return { key: "result", time: seg(v, 0.88, 1) * 4.5 };
  };

  return (
    <group>
      <Lighting tier={tier} />

      {/* ── 左：AI GACHA OS ── */}
      <group position={[L.pc[0], L.pc[1], L.pc[2]]} rotation={[0.04, -0.2, 0]}>
        <Drift amount={0.04} speed={0.4}>
          <AdminLaptop tier={tier} width={L.pcW} driver={adminDriver} />
          <Label
            title="AI GACHA OS"
            accent="#1B4BD8"
            // 終盤はカメラがスマホ側へ寄るので、ラベルは本体寄りに置いて切れを防ぐ
            position={[-L.pcW / 2 + 1.55, -0.34, L.pcW / 3.6]}
            scale={compact ? 0.84 : 0.94}
          />
        </Drift>
        <FloatShadow
          position={[0, -0.72, 0.2]}
          scale={[L.pcW * 1.7, L.pcW * 1.12]}
          opacity={0.85}
        />
      </group>

      {/* ── 右：お客様のスマートフォン ── */}
      <group
        position={[L.phone[0], L.phone[1], L.phone[2]]}
        rotation={[0.02, compact ? -0.1 : -0.36, 0.02]}
      >
        <Drift amount={0.06} speed={0.48} phase={1.6}>
          <CustomerPhone tier={tier} width={L.phoneW} driver={phoneDriver} />
          <Label
            title="CUSTOMER"
            accent="#0891B2"
            position={[0.1, -1.5, 0.1]}
            scale={0.78}
          />
        </Drift>
        <FloatShadow position={[0, -1.8, 0]} scale={[2.6, 1.5]} opacity={0.7} />
      </group>

      {/* ── 公開の光。承認したあとだけ流れる ── */}
      <PublishBeam curve={publishCurve} p={() => now.current.p} />
    </group>
  );
}

/**
 * 承認したあとだけ、光が管理画面からスマホへ飛ぶ。
 * 「公開した瞬間に、お客様の画面へ届いた」ことを、文字なしで見せるための線です。
 */
function PublishBeam({
  curve,
  p,
}: {
  curve: THREE.Curve<THREE.Vector3>;
  p: () => number;
}) {
  const g = useRef<THREE.Group>(null);
  const line = useRef<THREE.Line | null>(null);

  useFrame(() => {
    const v = p();
    const on = v > 0.34 && v < 0.8;
    if (g.current) g.current.visible = on;
    if (!on) return;
    // 出はじめは強く、届いたら静かになる
    const strength = seg(v, 0.34, 0.5) * (1 - seg(v, 0.72, 0.8) * 0.75);
    const l = line.current;
    if (l) {
      const m = l.material as THREE.LineBasicMaterial;
      m.opacity = 0.3 * strength;
    }
  });

  return (
    <group ref={g} visible={false}>
      <Beam curve={curve} color="#0891B2" opacity={0.3} lineRef={line} />
      <BeamFlow
        curve={curve}
        count={4}
        speed={0.55}
        size={0.26}
        color="34,211,238"
      />
    </group>
  );
}

/* ────────────────────────────────────────────
   出口
   ──────────────────────────────────────────── */

export default function PublishWorld({
  compact = false,
  onBeat,
  trackRef,
}: {
  compact?: boolean;
  onBeat?: (i: number) => void;
  /** 進み具合を測る「長い外側」。これがスクロール＝時間になる */
  trackRef?: MutableRefObject<HTMLElement | null>;
}) {
  return (
    <Stage3D
      className="h-full w-full"
      track
      trackRef={trackRef}
      trackMode="sticky"
      camera={{ position: [0, 0.2, compact ? 6.2 : 8.2], fov: compact ? 42 : 36 }}
      fallback={<StaticCore />}
    >
      {({ tier, progress }) => (
        <Scene
          tier={tier}
          progress={progress}
          compact={compact}
          onBeat={(i) => onBeat?.(i)}
        />
      )}
    </Stage3D>
  );
}
