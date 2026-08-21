"use client";

/**
 * ページのいちばん最後に出す3D。
 *
 *   左：運営するあなたのノートPC（AI GACHA OS の管理画面）
 *   中央：AI GACHA OS そのもの
 *   右：お客様のスマートフォン
 *
 * ★ここはファーストビューと同じ「絵」に戻す場所です。
 *   最初に見た2台がもう一度出てくることで、
 *   「最初から最後まで、同じ世界の中の話だった」と分かります。
 *   別の見た目にしないこと。戻ってこないと、ただの長いページになります。
 *
 * 左からは「あなたの指示」、右へは「お客様に届くもの」。
 * 光は必ず中央を通ります。あいだにあるのが AI GACHA OS だからです。
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
import StaticCore from "../hero/StaticCore";

/**
 * 中央で静かに光っている「AI GACHA OS」本体。
 *
 * 何かの機能の絵にはしないこと。
 * ここは「あいだにあって、両側をつないでいるもの」を表す場所です。
 */
function Core({ tier }: { tier: Tier }) {
  const g = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (g.current) {
      g.current.rotation.y = t * 0.18;
      g.current.rotation.x = Math.sin(t * 0.3) * 0.12;
    }
    if (inner.current) {
      // ゆっくり呼吸させる。速く点滅させると安っぽくなる
      const s = 1 + Math.sin(t * 0.9) * 0.045;
      inner.current.scale.setScalar(s);
    }
  });

  return (
    <group ref={g}>
      {/* 芯 */}
      <mesh ref={inner}>
        <icosahedronGeometry args={[0.34, tier === "high" ? 2 : 1]} />
        <meshStandardMaterial
          color="#1B4BD8"
          emissive="#2E6BFF"
          emissiveIntensity={1.25}
          roughness={0.28}
          metalness={0.35}
        />
      </mesh>

      {/* まわりの輪。2本だけ。増やすと「機械」に見えて重くなる */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.62, 0.011, 8, 72]} />
        <meshBasicMaterial color="#5B8CFF" transparent opacity={0.55} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0.62, 0.5]}>
        <torusGeometry args={[0.82, 0.008, 8, 72]} />
        <meshBasicMaterial color="#5B8CFF" transparent opacity={0.3} />
      </mesh>

      {/* にじみ。3Dの中で「光っている」ように見せるための板 */}
      <mesh>
        <sphereGeometry args={[0.52, 20, 20]} />
        <meshBasicMaterial color="#2E6BFF" transparent opacity={0.12} />
      </mesh>
    </group>
  );
}

function Scene({
  tier,
  progress,
  compact,
}: {
  tier: Tier;
  progress: MutableRefObject<number>;
  compact: boolean;
}) {
  const { camera } = useThree();
  const now = useRef(0);

  /*
    置き方。
    PC は「左＝あなた / 中央＝OS / 右＝お客様」の横一列。
    スマホは横幅が足りないので、上下に積んで、中央のOSをそのあいだに置く。
  */
  const L = compact
    ? {
        pc: [-0.35, 1.55, -0.2] as const,
        pcW: 2.7,
        core: [0.15, 0.0, 0.3] as const,
        phone: [0.55, -1.85, 1.0] as const,
        phoneW: 0.96,
      }
    : {
        pc: [-2.35, -0.35, 0] as const,
        pcW: 3.5,
        core: [0.25, 0.35, 0.4] as const,
        phone: [2.75, 0.3, 0.7] as const,
        phoneW: 1.24,
      };

  // 左（あなた）→ 中央（OS）→ 右（お客様）
  const inCurve = useMemo(
    () =>
      beamCurve(
        [L.pc[0] + 1.25, L.pc[1] + 1.3, 0.2],
        [L.core[0] - 0.42, L.core[1], L.core[2]],
        compact ? 0.5 : 0.34
      ),
    [L.pc, L.core, compact]
  );
  const outCurve = useMemo(
    () =>
      beamCurve(
        [L.core[0] + 0.42, L.core[1], L.core[2]],
        [L.phone[0] - 0.34, L.phone[1] + 0.35, L.phone[2]],
        compact ? 0.5 : 0.34
      ),
    [L.core, L.phone, compact]
  );

  /*
    カメラを引く距離は、固定値にしないこと。
    画面の横幅で「入る量」が変わるため、固定にすると
    1024px あたりで左の OPERATOR の文字が切れます（実際に切れていました）。

    下の半分の大きさ（中心から端までの距離）が必ず収まる距離を、毎回計算します。
      横一列のとき … 横に広い。左右が切れやすい
      縦積みのとき … 縦に長い。上下が切れやすい
  */
  const half = compact
    ? { w: 1.9, h: 3.2 } // 縦積み：上のPCから下のスマホまで
    : { w: 4.95, h: 2.3 }; // 横一列：左のPCから右のスマホまで

  useFrame((_, dt) => {
    const k = Math.min(1, dt * 3.2);
    now.current += (progress.current - now.current) * k;
    const p = now.current;

    /*
      ここは「まとめ」なので、寄せません。
      最後は必ず全体が入っている絵で終わらせること。
      2台とも見えている状態でCTAを読ませたいからです。
    */
    const cam = camera as THREE.PerspectiveCamera;
    const tanHalf = Math.tan(((cam.fov || 36) * Math.PI) / 360);
    const aspect = cam.aspect || 1;
    // 縦で入る距離と、横で入る距離。遠いほう（＝両方入るほう）を採る
    const baseZ = Math.max(half.h / tanHalf, half.w / (tanHalf * aspect));

    const ease = Math.sin(Math.min(1, Math.max(0, p)) * Math.PI); // 中央で最大
    camera.position.z += (baseZ - ease * 0.55 - camera.position.z) * k;
    camera.position.y += (0.12 + ease * 0.16 - camera.position.y) * k;
    camera.lookAt(compact ? 0.1 : 0.2, compact ? -0.1 : 0.1, 0);
  });

  return (
    <group>
      <Lighting tier={tier} />

      {/* ── 左：運営するあなた（AI GACHA OS の管理画面） ── */}
      <group
        position={[L.pc[0], L.pc[1], L.pc[2]]}
        rotation={[0.04, compact ? -0.12 : 0.26, 0]}
      >
        <Drift amount={0.05} speed={0.4}>
          <AdminLaptop tier={tier} width={L.pcW} />
          <Label
            title="OPERATOR"
            accent="#1B4BD8"
            dark
            position={[-L.pcW / 2 + 1.2, -0.34, L.pcW / 3.6]}
            scale={compact ? 0.8 : 0.9}
          />
        </Drift>
        <FloatShadow
          position={[0, -0.72, 0.2]}
          scale={[L.pcW * 1.7, L.pcW * 1.12]}
          opacity={0.55}
        />
      </group>

      {/* ── 中央：AI GACHA OS ── */}
      <group position={[L.core[0], L.core[1], L.core[2]]}>
        <Drift amount={0.06} speed={0.34} phase={0.8} rotate={0}>
          <Core tier={tier} />
          <Label
            title="AI GACHA OS"
            accent="#2E6BFF"
            dark
            /* 縦積みのときは真下にお客様のスマホが来るので、名前は左へ逃がす */
            position={compact ? [-1.15, -0.15, 0.1] : [0, -1.12, 0.1]}
            scale={compact ? 0.8 : 0.94}
          />
        </Drift>
      </group>

      {/* ── 右：お客様のスマートフォン ── */}
      <group
        position={[L.phone[0], L.phone[1], L.phone[2]]}
        rotation={[0.02, compact ? -0.14 : -0.34, 0.02]}
      >
        <Drift amount={0.07} speed={0.48} phase={1.7}>
          <CustomerPhone tier={tier} width={L.phoneW} />
          <Label
            title="CUSTOMER"
            accent="#0891B2"
            dark
            position={[0.1, -1.52, 0.1]}
            scale={compact ? 0.74 : 0.8}
          />
        </Drift>
        <FloatShadow
          position={[0, -1.82, 0]}
          scale={[2.4, 1.4]}
          opacity={0.45}
        />
      </group>

      {/* ── あなた → OS → お客様。光は必ず中央を通る ── */}
      <Beam curve={inCurve} color="#1B4BD8" opacity={0.22} />
      <BeamFlow
        curve={inCurve}
        count={3}
        speed={0.42}
        size={0.22}
        color="91,140,255"
      />
      <Beam curve={outCurve} color="#0891B2" opacity={0.22} />
      <BeamFlow
        curve={outCurve}
        count={3}
        speed={0.42}
        offset={0.5}
        size={0.22}
        color="34,211,238"
      />
    </group>
  );
}

export default function FinaleWorld({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <Stage3D
      className="h-full w-full"
      track
      camera={{
        position: [0, 0.12, compact ? 8.0 : 7.2],
        fov: compact ? 42 : 36,
      }}
      fallback={<StaticCore />}
    >
      {({ tier, progress }) => (
        <Scene tier={tier} progress={progress} compact={compact} />
      )}
    </Stage3D>
  );
}
