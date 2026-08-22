"use client";

/**
 * ファーストビューの3D。
 *
 *   左  … OPERATOR（運営するあなた）
 *   中央 … AI GACHA OS（浮かんでいるノートPC。中で本物の管理画面が動く）
 *   右  … CUSTOMER（お客様のスマートフォン）
 *
 * 左から「商品相場・会員・注文・問い合わせ」が光の線で入ってきて、
 * OSの中で処理され、右へ「公開されたガチャ・発送通知・AIの回答」として出ていきます。
 *
 * スクロールすると、カメラが画面へ近づいていきます。
 * ページを読んでいるのではなく、AI GACHA OS の中へ入っていく感じにするためです。
 */

import { useMemo, useRef, useState, type MutableRefObject } from "react";
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
import { ADMIN_SCREENS, type AdminScreenKey } from "./screen/admin";
import StaticCore from "../hero/StaticCore";

/** 右へ出ていくもの＝お客様に届くもの */
const OUTPUTS = [
  { label: "販売中のガチャ", y: 1.15, accent: "#0891B2" },
  { label: "発送のお知らせ", y: 0.2, accent: "#0891B2" },
  { label: "問い合わせの返信", y: -0.75, accent: "#0891B2" },
];

function Scene({
  tier,
  progress,
  compact,
  onScreen,
}: {
  tier: Tier;
  progress: MutableRefObject<number>;
  compact: boolean;
  onScreen: (k: AdminScreenKey, i: number) => void;
}) {
  const { camera } = useThree();
  const rig = useRef<THREE.Group>(null);

  // レイアウト。狭い画面ではノートPCだけを大きく見せる。
  // 横に並べたときに、左端（PC）と右端（スマホ）が画面からはみ出さない位置にしている。
  const L = compact
    ? { pc: [0, -0.5, 0] as const, pcW: 3.4, phone: null, rotY: -0.14 }
    : { pc: [-0.72, -0.6, 0] as const, pcW: 3.8, phone: [2.32, 0.4, 0.9] as const, rotY: -0.22 };

  // 管理画面から、お客様のスマホへ出ていく光の線
  const outCurves = useMemo(() => {
    if (!L.phone) return [];
    return OUTPUTS.map((n) =>
      beamCurve(
        [L.pc[0] + 1.55, L.pc[1] + 1.5, 0.2],
        [L.phone![0] - 0.42, n.y * 0.6, L.phone![2]],
        0.34
      )
    );
  }, [L.pc, L.phone]);

  const baseZ = compact ? 5.6 : 8.0;

  useFrame((_, dt) => {
    // スクロールに合わせて、画面の中へ近づく
    const p = progress.current;
    // 0.42（画面の真ん中あたり）から先で寄っていく
    const zoom = Math.max(0, (p - 0.42) / 0.58);
    const targetZ = baseZ - zoom * baseZ * 0.42;
    const targetY = zoom * 0.5;
    camera.position.z += (targetZ - camera.position.z) * Math.min(1, dt * 3.4);
    camera.position.y += (targetY - camera.position.y) * Math.min(1, dt * 3.4);
    camera.lookAt(compact ? 0 : 0.15, 0.02 + zoom * 0.7, 0);

    // 全体をほんの少しだけ傾ける（生きている感じを出すため）
    if (rig.current) {
      rig.current.rotation.y = -0.02 + zoom * 0.03;
    }
  });

  return (
    <group ref={rig}>
      <Lighting tier={tier} />

      {/* ── 中央：AI GACHA OS（ノートPC） ── */}
      <group position={[L.pc[0], L.pc[1], L.pc[2]]} rotation={[0.045, L.rotY, 0]}>
        <Drift amount={0.05} speed={0.42}>
          <AdminLaptop tier={tier} width={L.pcW} onScreen={onScreen} />
          {/* ★英語のままにしないこと。
              この画面をご覧になるのは、ガチャを運営される方です。
              「AI GACHA OS」と書いてあっても、
              それが自分が毎日開く画面なのか、
              お客様に見える画面なのかは分かりません。
              左右の関係が伝わらないなら、3Dで見せている意味がありません */}
          <Label
            title="運営が使う"
            value="管理サイト"
            accent="#1B4BD8"
            position={[-L.pcW / 2 + 1.05, -0.42, L.pcW / 3.6]}
            scale={compact ? 0.88 : 0.96}
          />
        </Drift>
        <FloatShadow
          position={[0, -0.72, 0.2]}
          scale={[L.pcW * 1.7, L.pcW * 1.12]}
          opacity={0.9}
        />
      </group>

      {/* ── 右：お客様のスマートフォン ── */}
      {L.phone && (
        <group position={[L.phone[0], L.phone[1], L.phone[2]]} rotation={[0.02, -0.4, 0.02]}>
          <Drift amount={0.07} speed={0.5} phase={1.6}>
            <CustomerPhone tier={tier} width={1.16} />
            <Label
              title="お客様が使う"
              value="ユーザー側"
              accent="#0891B2"
              position={[0.1, -1.7, 0.1]}
              scale={0.8}
            />
          </Drift>
          <FloatShadow position={[0, -1.9, 0]} scale={[2.6, 1.5]} opacity={0.75} />
        </group>
      )}

      {/* ── 右へ出ていくもの ── */}
      {outCurves.map((cv, i) => (
        <group key={OUTPUTS[i].label}>
          <Beam curve={cv} color="#0891B2" opacity={0.2} />
          <BeamFlow
            curve={cv}
            count={2}
            speed={0.3 + i * 0.04}
            offset={0.4 + i * 0.3}
            size={0.2}
            color="34,211,238"
          />
        </group>
      ))}

    </group>
  );
}

export default function HeroWorld({ compact = false }: { compact?: boolean }) {
  const [screen, setScreen] = useState<{ key: AdminScreenKey; i: number }>({
    key: "dashboard",
    i: 0,
  });

  return (
    <div className="relative h-full w-full">
      <Stage3D
        className="h-full w-full"
        track
        camera={{ position: [0, 0, compact ? 5.6 : 8.0], fov: compact ? 40 : 34 }}
        fallback={<StaticCore />}
      >
        {({ tier, progress }) => (
          <Scene
            tier={tier}
            progress={progress}
            compact={compact}
            onScreen={(key, i) => setScreen({ key, i })}
          />
        )}
      </Stage3D>

      {/*
        いま画面に何が映っているかを、3Dの外にも出す。
        3Dの中の文字は小さくなるので、読ませたい言葉はHTML側に置く。
      */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 px-2 sm:justify-start sm:px-1">
        {ADMIN_SCREENS.map((s, i) => {
          const on = i === screen.i;
          return (
            <span
              key={s.key}
              className={`num whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] tracking-[0.14em] transition-all duration-500 sm:px-3 sm:py-1.5 sm:text-[12px] ${
                on
                  ? "border-blue-ink/30 bg-white text-blue-ink shadow-lift"
                  : "border-edge2 bg-white/60 text-slate3"
              }`}
            >
              {s.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
