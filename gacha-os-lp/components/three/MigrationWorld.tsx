"use client";

/**
 * すでにガチャサイトを運営している方向けの3D。
 *
 *   左：今お使いの管理画面      中央：お客様のスマートフォン      右：AI GACHA OS
 *
 *   ① 今のサイトは、今日も動いている
 *   ② 見るのはIPアドレスだけではない（ドメイン・DNS・決済・会員…）
 *   ③ 積み上げたデータが、右へ移っていく
 *   ④ 管理側だけがAI GACHA OSになる
 *   ⑤ お客様のURLは、最初から最後まで変わらない
 *
 * ★このシーンの主張は「手前のスマホが、最初から最後まで一度も変わらない」ことです。
 *   演出を足すときも、スマホの画面と位置だけは絶対に動かさないでください。
 *   ここが動くと「お客様側は変わらない」という一番大事な話が壊れます。
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
import { AdminLaptop, CustomerPhone, LegacyLaptop } from "./world/screens";
import StaticCore from "../hero/StaticCore";

/* ────────────────────────────────────────────
   台本
   ──────────────────────────────────────────── */

export type MigrationBeat = {
  at: number;
  title: string;
  body: string;
  /** 画面外に出す小さな見出し */
  tag: string;
};

export const MIGRATION_BEATS: MigrationBeat[] = [
  {
    at: 0,
    tag: "NOW",
    title: "今のサイトは、今日も動いている",
    body: "お客様がいて、ポイントがあって、発送待ちがある。まずはそれを止めないことが前提です。",
  },
  {
    at: 0.2,
    tag: "CHECK",
    title: "見るのは、IPアドレスだけではありません",
    body: "ドメイン・DNS・サーバー・SSL・会員・ポイント・決済・配送・メールまで、現在の構成を一つずつ確認します。",
  },
  {
    at: 0.4,
    tag: "MIGRATION",
    title: "積み上げたものを、できるだけ残す",
    body: "会員・ポイント残高・購入履歴・発送待ちなどを引き継ぐ前提で設計します。移せる範囲は現在の構成によって変わります。",
  },
  {
    at: 0.62,
    tag: "NEW ADMIN",
    title: "変わるのは、管理側だけ",
    body: "AIガチャ設計・公開前バックテスト・実還元率・価格監視・発送管理・AI問い合わせが、そのまま使えるようになります。",
  },
  {
    at: 0.82,
    tag: "CUSTOMER",
    title: "お客様から見えるURLは、変わらない",
    body: "手前のスマートフォンは、最初から最後まで同じアドレスのままです。お客様は今までどおりアクセスできます。",
  },
];

export function migrationBeatIndex(p: number) {
  let i = 0;
  for (let k = 0; k < MIGRATION_BEATS.length; k++)
    if (p >= MIGRATION_BEATS[k].at) i = k;
  return i;
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function seg(p: number, from: number, to: number) {
  return clamp01((p - from) / (to - from));
}

/**
 * 引き継ぐデータ。左から右へ、この順番で流れていく。
 *
 * ★英語の見出しにしないこと。
 *   ここで見ていただきたいのは、
 *   「いま積み上がっているものが、そのまま移る」という一点だけです。
 *   USERS と書いてあると、システムの用語として読み流されます。
 *   「会員」と書いてあれば、ご自分のお客様の顔が浮かびます。
 */
const CARDS = [
  { title: "会員", accent: "#1B4BD8" },
  { title: "ポイント残高", accent: "#0891B2" },
  { title: "ガチャ", accent: "#1B4BD8" },
  { title: "購入履歴", accent: "#0891B2" },
  { title: "発送待ち", accent: "#1B4BD8" },
] as const;

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
  const now = useRef({ p: 0, t: 0 });

  const oldG = useRef<THREE.Group>(null);
  const newG = useRef<THREE.Group>(null);

  // ★機械は大きく置くこと。小さく並べると「ただの図解」になり、
  //   この章で一番見せたい「今の管理画面」と「新しい管理画面」の対比が弱まる。
  const L = compact
    ? {
        old: [-1.02, 1.35, -0.4] as const,
        neo: [1.02, 1.35, -0.4] as const,
        deviceW: 1.95,
        phone: [0, -0.78, 1.15] as const,
        phoneW: 0.84,
        // 札が通る帯（2台のあいだの、何も置いていないところ）
        flowX: 0.6,
        flowY: 0.45,
        // スマートフォンの真下に敷く、浮いて見せるための影の高さ
        phoneShadowY: -1.02,
      }
    : {
        old: [-2.65, 0.75, -0.4] as const,
        neo: [2.65, 0.75, -0.4] as const,
        deviceW: 3.5,
        phone: [0, -1.15, 2.1] as const,
        phoneW: 1.28,
        flowX: 1.35,
        flowY: 0.8,
        phoneShadowY: -1.56,
      };

  /*
    データが通る道。
    ★機械の頭の上を通さないこと。上へ回すと札が画面の上端やヘッダーに
      かぶって読めなくなります（一度そうなりました）。
      2台のあいだの空いている帯を、スマホの奥側を通して渡します。
  */
  const curve = useMemo(
    () =>
      beamCurve(
        [L.old[0] + L.flowX, L.flowY, L.old[2] + 1.1],
        [L.neo[0] - L.flowX, L.flowY, L.neo[2] + 1.1],
        compact ? 0.28 : 0.42
      ),
    [L.old, L.neo, L.flowX, L.flowY, compact]
  );

  const baseZ = compact ? 6.4 : 8.4;

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    now.current.t += d;
    const k = Math.min(1, dt * 4.2);
    now.current.p += (progress.current - now.current.p) * k;
    const p = now.current.p;

    const bi = migrationBeatIndex(progress.current);
    if (bi !== lastBeat.current) {
      lastBeat.current = bi;
      onBeat(bi);
    }

    // カメラ。前半は今の管理画面、後半は新しい管理画面へ。
    // ★左右に振りすぎると、中央のスマホが端に寄って主役でなくなる。
    //   0.9 は「両方の機械が画面に残る」上限。
    const toNew = seg(p, 0.42, 0.86);
    const targetX = compact ? 0 : -0.9 + toNew * 1.8;
    const targetY = 0.2;
    const targetZ = baseZ - toNew * (compact ? 0.5 : 0.9);

    camera.position.x += (targetX - camera.position.x) * k;
    camera.position.y += (targetY * 0.5 - camera.position.y) * k;
    camera.position.z += (targetZ - camera.position.z) * k;
    camera.lookAt(targetX * 0.45, targetY, 0);

    // 今の管理画面は、移行が進むと少しだけ奥へ下がる（消しはしない）
    const back = seg(p, 0.55, 1);
    if (oldG.current) {
      oldG.current.position.z = L.old[2] - back * 1.0;
      const s = 1 - back * 0.1;
      oldG.current.scale.setScalar(s);
    }
    // 新しい管理画面は、移行が進むと手前に出てくる
    const fore = seg(p, 0.45, 0.95);
    if (newG.current) {
      newG.current.position.z = L.neo[2] - 0.9 + fore * 0.9;
      newG.current.scale.setScalar(0.9 + fore * 0.1);
    }
  });

  /* ── 新しい管理画面：移行が終わるまでは、画面はついていない ── */
  const newDriver = () => {
    const v = now.current.p;
    // time=0 は暗転そのもの＝「まだ何も映っていない」状態。
    // ★暗いままの時間を長く取らないこと。真っ黒な画面が長いと
    //   「壊れている機械」に見えます。データが着き始める 0.42 で点灯させます。
    if (v < 0.42) return { key: "dashboard" as const, time: 0 };
    if (v < 0.78) return { key: "dashboard" as const, time: seg(v, 0.42, 0.78) * 3.6 };
    return { key: "design" as const, time: seg(v, 0.78, 1) * 4.2 };
  };

  /* ── お客様のスマホ：★最初から最後まで、同じ画面のまま ──
     スクロールに一切連動させないこと。ここが動かないのが、この節の主張。 */
  const phoneDriver = () =>
    ({ key: "home" as const, time: 1.6 + now.current.t * 0.35 });

  return (
    <group>
      <Lighting tier={tier} />

      {/* ── 左：今お使いの管理画面 ── */}
      <group
        ref={oldG}
        position={[L.old[0], L.old[1], L.old[2]]}
        rotation={[0.05, compact ? 0.16 : 0.3, 0]}
      >
        <Drift amount={0.035} speed={0.36}>
          <LegacyLaptop tier={tier} width={L.deviceW} />
          <Label
            title="いまお使いの"
            value="管理画面"
            accent="#8A94A8"
            position={[0, -0.42, L.deviceW / 3.6]}
            scale={compact ? 0.7 : 0.82}
          />
        </Drift>
        <FloatShadow
          position={[0, -0.78, 0.2]}
          scale={[L.deviceW * 1.7, L.deviceW * 1.1]}
          opacity={0.6}
        />
      </group>

      {/* ── 右：AI GACHA OS ── */}
      <group
        ref={newG}
        position={[L.neo[0], L.neo[1], L.neo[2]]}
        rotation={[0.05, compact ? -0.16 : -0.3, 0]}
      >
        <Drift amount={0.045} speed={0.42} phase={1.9}>
          <AdminLaptop tier={tier} width={L.deviceW} driver={newDriver} />
          <Label
            title="入れ替える"
            value="管理サイト"
            accent="#1B4BD8"
            position={[0, -0.42, L.deviceW / 3.6]}
            scale={compact ? 0.7 : 0.82}
          />
        </Drift>
        <FloatShadow
          position={[0, -0.78, 0.2]}
          scale={[L.deviceW * 1.7, L.deviceW * 1.1]}
          opacity={0.8}
        />
      </group>

      {/* ── 中央手前：お客様のスマートフォン（最後まで変わらない） ── */}
      <group position={[L.phone[0], L.phone[1], L.phone[2]]} rotation={[0.02, 0, 0]}>
        <Drift amount={0.05} speed={0.4} phase={0.8}>
          <CustomerPhone tier={tier} width={L.phoneW} driver={phoneDriver} />
        </Drift>
        {/*
          ★このスマートフォンの下に、3Dの札を置かないこと。
            手前に置いたものは遠近で大きく映るため、下に付けた札は
            PCでもスマホでも必ず画面の外へはみ出します（両方で切れました）。
            URL（example-gacha.jp）は
              ・スマホ本体の画面の中（アドレスバー）
              ・説明文の下のHTMLの一行
            の2か所で見せています。3Dで足す必要はありません。
        */}
        <FloatShadow
          position={[0, L.phoneShadowY, 0]}
          scale={[2.2, 1.3]}
          opacity={0.55}
        />
      </group>

      {/* ── 引き継ぐデータ ── */}
      <MigrationFlow curve={curve} p={() => now.current.p} compact={compact} />
    </group>
  );
}

/**
 * 会員・ポイント・ガチャ・受注・発送が、左から右へ渡っていく。
 * 「全部必ず移せる」と読ませないため、札は5枚だけにして、
 * 移せる範囲の話は必ずHTML側の本文で補うこと。
 */
function MigrationFlow({
  curve,
  p,
  compact,
}: {
  curve: THREE.Curve<THREE.Vector3>;
  p: () => number;
  compact: boolean;
}) {
  const line = useRef<THREE.Line | null>(null);
  const wrap = useRef<THREE.Group>(null);
  const cards = useRef<(THREE.Group | null)[]>([]);
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const val = p();
    const on = val > 0.24 && val < 0.84;
    if (wrap.current) wrap.current.visible = on;
    if (!on) return;

    const strength = seg(val, 0.24, 0.36) * (1 - seg(val, 0.74, 0.84) * 0.85);
    const l = line.current;
    if (l) (l.material as THREE.LineBasicMaterial).opacity = 0.32 * strength;

    // 札は1枚ずつ出発する。
    // ★間隔を詰めないこと。5枚が同時に空にいると札が重なって、
    //   何が移ったのか読めなくなります（一度そうなりました）。
    CARDS.forEach((_, i) => {
      const g = cards.current[i];
      if (!g) return;
      const from = 0.3 + i * 0.075;
      const u = seg(val, from, from + 0.145);
      g.visible = u > 0.001 && u < 0.999;
      if (!g.visible) return;
      curve.getPointAt(u, v);
      g.position.copy(v);
      const fade = Math.min(1, Math.sin(u * Math.PI) * 2.6);
      g.scale.setScalar((compact ? 0.8 : 1.18) * (0.88 + fade * 0.12));
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m && "opacity" in m) (m as THREE.MeshBasicMaterial).opacity = fade;
      });
    });
  });

  return (
    <group ref={wrap} visible={false}>
      <Beam curve={curve} color="#1B4BD8" opacity={0.32} lineRef={line} />
      <BeamFlow curve={curve} count={4} speed={0.4} size={0.2} color="91,140,255" />
      {CARDS.map((c, i) => (
        <group
          key={c.title}
          ref={(el) => {
            cards.current[i] = el;
          }}
        >
          <Label
            title={c.title}
            accent={c.accent}
            position={[0, 0, 0]}
            scale={compact ? 0.68 : 0.8}
          />
        </group>
      ))}
    </group>
  );
}

/* ────────────────────────────────────────────
   出口
   ──────────────────────────────────────────── */

export default function MigrationWorld({
  compact = false,
  onBeat,
  trackRef,
}: {
  compact?: boolean;
  onBeat?: (i: number) => void;
  trackRef?: MutableRefObject<HTMLElement | null>;
}) {
  return (
    <Stage3D
      className="h-full w-full"
      track
      trackRef={trackRef}
      trackMode="sticky"
      /* ★この初期値は Scene の baseZ と必ず同じにすること。
         ずれていると、表示された瞬間にカメラがすっと寄る動きが出ます。 */
      camera={{ position: [0, 0.1, compact ? 6.4 : 8.4], fov: compact ? 44 : 36 }}
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
