"use client";

/**
 * GACHA OPERATING CORE
 *
 * 透明なガラスのコアの中に、運営の6つのはたらきが入っている。
 * 6つは光る線でつながっていて、光の粒がその線の上を流れていく。
 * 「1つのシステムの中で、運営がひとつながりに動いている」ことを絵で見せるための3D。
 *
 * 飾りではなく説明のための3Dにするため、
 *  ・6つの点＝画面のセクションと1対1で対応させる
 *  ・線の上を流れる光＝処理が次へ渡っていくこと
 *  ・裏に回った点はラベルを薄くする（奥行きを分かるようにする）
 * という決まりで作っている。
 */

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Html, Lightformer, Line } from "@react-three/drei";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";

export type CoreModule = {
  id: string;
  label: string;
  ja: string;
  color: string;
};

export const CORE_MODULES: CoreModule[] = [
  { id: "gacha", label: "AI GACHA", ja: "ガチャ設計", color: "#2563EB" },
  { id: "price", label: "PRICE", ja: "市場価格", color: "#0891B2" },
  { id: "backtest", label: "BACKTEST", ja: "事前検証", color: "#4F46E5" },
  { id: "rtp", label: "REAL RTP", ja: "実還元率", color: "#0284C7" },
  { id: "shipping", label: "SHIPPING", ja: "発送", color: "#0D9488" },
  { id: "support", label: "SUPPORT", ja: "問い合わせ", color: "#7C3AED" },
];

const RADIUS = 1.5;
/** ラベルを置く位置。ガラスの外まで引き出して、文字が重ならないようにする。 */
const LABEL_RADIUS = 2.32;

/**
 * 6モジュールの立ち位置。
 * 画面と同じ向きの面に六角形で並べる。奥行き方向の輪にすると、
 * 正面から見たとき6つが重なってラベルが読めなくなるため。
 * 奥行きは z を少しずつ変えて出す。
 */
const POSITIONS: THREE.Vector3[] = CORE_MODULES.map((_, i) => {
  const a = -Math.PI / 2 + (i / CORE_MODULES.length) * Math.PI * 2;
  return new THREE.Vector3(
    Math.cos(a) * RADIUS,
    Math.sin(a) * RADIUS,
    Math.sin(a * 3) * 0.34
  );
});

/** モジュールから見た、ラベルまでの相対位置（引き出し線の長さ）。 */
const LABEL_OFFSETS: THREE.Vector3[] = POSITIONS.map((p) => {
  const dir = new THREE.Vector3(p.x, p.y, 0).normalize();
  return dir.multiplyScalar(LABEL_RADIUS).sub(new THREE.Vector3(p.x, p.y, 0));
});

/** 6点を通る閉じた曲線。光の粒はこの上を流れる。 */
const RING_CURVE = new THREE.CatmullRomCurve3(POSITIONS, true, "catmullrom", 0.4);

type Quality = "high" | "medium";

/* ───────────────────────── モジュール1つ ───────────────────────── */

function ModuleNode({
  module,
  position,
  index,
  quality,
}: {
  module: CoreModule;
  position: THREE.Vector3;
  index: number;
  quality: Quality;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const world = useRef(new THREE.Vector3());

  useFrame(({ clock, camera }) => {
    const t = clock.getElapsedTime();
    // 1つずつずらして呼吸させる。全部同時に光ると機械っぽくなる
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.15 + index * 1.05);

    if (meshRef.current) {
      meshRef.current.rotation.x = t * 0.35 + index;
      meshRef.current.rotation.y = t * 0.28 + index;
      const s = 1 + pulse * 0.09;
      meshRef.current.scale.setScalar(s);
    }
    if (glowRef.current) {
      glowRef.current.scale.setScalar(1.9 + pulse * 0.5);
      const m = glowRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.1 + pulse * 0.14;
    }

    // 奥に沈んだモジュールはラベルを少し薄く・小さくして、奥行きを分かるようにする
    if (labelRef.current && meshRef.current) {
      meshRef.current.getWorldPosition(world.current);
      const depth = world.current.distanceTo(camera.position);
      const front = THREE.MathUtils.clamp((8.6 - depth) / 1.1, 0, 1);
      labelRef.current.style.opacity = String(0.68 + front * 0.32);
      labelRef.current.style.transform = `translate(-50%,-50%) scale(${0.95 + front * 0.07})`;
    }
  });

  return (
    <group position={position}>
      <mesh ref={meshRef}>
        <octahedronGeometry args={[0.135, 0]} />
        <meshStandardMaterial
          color={module.color}
          emissive={module.color}
          emissiveIntensity={quality === "high" ? 1.5 : 1.1}
          roughness={0.18}
          metalness={0.5}
        />
      </mesh>

      {/* にじみ。ガラス越しに見たときの光の広がり */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.13, 16, 16]} />
        <meshBasicMaterial
          color={module.color}
          transparent
          opacity={0.16}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* モジュールからラベルへの引き出し線 */}
      <Line
        points={[new THREE.Vector3(0, 0, 0), LABEL_OFFSETS[index]]}
        color={module.color}
        lineWidth={1}
        transparent
        opacity={0.28}
      />

      <Html
        center
        position={LABEL_OFFSETS[index]}
        zIndexRange={[20, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div
          ref={labelRef}
          className="whitespace-nowrap rounded-xl border border-[rgba(11,18,32,0.09)] bg-white/95 px-3 py-1.5 shadow-[0_2px_12px_-3px_rgba(11,18,32,0.22)] backdrop-blur-sm"
          style={{ transform: "translate(-50%,-50%)" }}
        >
          <span
            className="num block text-[10px] font-bold tracking-[0.13em]"
            style={{ color: module.color }}
          >
            {module.label}
          </span>
          <span className="block text-[12px] font-semibold leading-tight text-slate">
            {module.ja}
          </span>
        </div>
      </Html>
    </group>
  );
}

/* ───────────────────────── つなぐ線と流れる光 ───────────────────────── */

function Connections({ quality }: { quality: Quality }) {
  const ringPoints = useMemo(() => RING_CURVE.getPoints(160), []);

  return (
    <group>
      {/* 6つを一周つなぐ線 */}
      <Line
        points={ringPoints}
        color="#1B4BD8"
        lineWidth={quality === "high" ? 1.6 : 1.2}
        transparent
        opacity={0.34}
      />
      {/* 中心から各モジュールへ伸びる線 */}
      {POSITIONS.map((p, i) => (
        <Line
          key={i}
          points={[new THREE.Vector3(0, 0, 0), p]}
          color={CORE_MODULES[i].color}
          lineWidth={1}
          transparent
          opacity={0.2}
        />
      ))}
    </group>
  );
}

/** 線の上を流れる光の粒。処理が次の工程へ渡っていく様子。 */
function Packets({ count }: { count: number }) {
  const group = useRef<THREE.Group>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.getElapsedTime();
    group.current.children.forEach((child, i) => {
      const offset = i / count;
      const u = (t * 0.11 + offset) % 1;
      RING_CURVE.getPointAt(u, tmp);
      child.position.copy(tmp);
      // 進むほど少し明るくなる
      const m = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      m.opacity = 0.45 + 0.4 * Math.sin(u * Math.PI);
    });
  });

  return (
    <group ref={group}>
      {Array.from({ length: count }).map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.035, 10, 10]} />
          <meshBasicMaterial
            color="#38BDF8"
            transparent
            opacity={0.7}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ───────────────────────── 背後のにじみ ───────────────────────── */

/**
 * ガラスの後ろに置く、やわらかい色の面。
 * 真っ白な背景のままだと、透明なガラスはただの白い円にしか見えない。
 * 後ろに色があると、そこが歪んで「ガラスがある」と分かるようになる。
 */
function Backdrop() {
  const texture = useMemo(() => {
    const size = 512;
    const cv = document.createElement("canvas");
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;

    // 白で塗りつぶすと円の輪郭が出てしまうので、色だけを重ねる
    const blobs: [number, number, number, string][] = [
      [0.34, 0.3, 0.44, "rgba(59,130,246,0.62)"],
      [0.72, 0.42, 0.38, "rgba(34,211,238,0.5)"],
      [0.5, 0.78, 0.42, "rgba(99,102,241,0.4)"],
      [0.16, 0.68, 0.32, "rgba(14,165,233,0.34)"],
    ];
    for (const [x, y, r, color] of blobs) {
      const g = ctx.createRadialGradient(
        x * size,
        y * size,
        0,
        x * size,
        y * size,
        r * size
      );
      g.addColorStop(0, color);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }

    // 外周に向かって消していく。面の縁が見えないようにするため
    ctx.globalCompositeOperation = "destination-in";
    const fade = ctx.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.1,
      size / 2,
      size / 2,
      size * 0.5
    );
    fade.addColorStop(0, "rgba(0,0,0,1)");
    fade.addColorStop(0.62, "rgba(0,0,0,0.85)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = "source-over";

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    // ごくゆっくり回して、ガラスの中の色がずっと動いているようにする
    ref.current.rotation.z = clock.getElapsedTime() * 0.03;
  });

  if (!texture) return null;

  return (
    <mesh ref={ref} position={[0, 0, -2.6]}>
      <circleGeometry args={[4.2, 64]} />
      <meshBasicMaterial map={texture} transparent opacity={0.95} depthWrite={false} />
    </mesh>
  );
}

/* ───────────────────────── ガラスのコア本体 ───────────────────────── */

function GlassShell({ quality }: { quality: Quality }) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    // ごくゆっくり呼吸させる。速いと安っぽくなる
    ref.current.scale.setScalar(1 + Math.sin(t * 0.5) * 0.012);
  });

  if (quality === "high") {
    return (
      <mesh ref={ref}>
        <icosahedronGeometry args={[1.78, 12]} />
        <meshPhysicalMaterial
          transmission={1}
          thickness={2.2}
          roughness={0.05}
          ior={1.46}
          clearcoat={1}
          clearcoatRoughness={0.04}
          transparent
          opacity={1}
          color="#FFFFFF"
          attenuationColor="#9EC2FF"
          attenuationDistance={2.4}
          envMapIntensity={1.7}
          specularIntensity={1}
          /* 縁にうっすら色が乗る。白背景でもガラスの輪郭が分かるようになる */
          iridescence={1}
          iridescenceIOR={1.32}
          iridescenceThicknessRange={[120, 460]}
        />
      </mesh>
    );
  }

  // スマホ用。屈折をやめて、薄い膜のような見え方にする
  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[1.78, 6]} />
      <meshPhysicalMaterial
        color="#DCE9FF"
        roughness={0.12}
        metalness={0.15}
        transparent
        opacity={0.3}
        clearcoat={1}
        clearcoatRoughness={0.08}
        envMapIntensity={1.3}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** ガラスの縁。輪郭が出ると「球がそこにある」ことが伝わる。 */
function ShellEdge() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.getElapsedTime() * 0.045;
  });
  return (
    <group>
      {/* 面のつなぎ目。ガラスの立体感を出す */}
      <mesh ref={ref}>
        <icosahedronGeometry args={[1.79, 2]} />
        <meshBasicMaterial
          color="#6E9BE8"
          wireframe
          transparent
          opacity={0.18}
          depthWrite={false}
        />
      </mesh>
      {/* いちばん外の輪郭。白背景に対して「ここまでが球」と示す */}
      <mesh scale={1.008}>
        <sphereGeometry args={[1.78, 64, 64]} />
        <meshBasicMaterial
          color="#4B7FE0"
          transparent
          opacity={0.16}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/* ───────────────────────── シーン ───────────────────────── */

function Scene({ quality }: { quality: Quality }) {
  const orbit = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const pointer = useRef({ x: 0, y: 0 });

  useFrame(({ clock, pointer: p }) => {
    const t = clock.getElapsedTime();
    // 画面と同じ向きの面で、ごくゆっくり回す（1周およそ100秒）
    if (orbit.current) orbit.current.rotation.z = t * 0.062;

    // マウスに合わせてわずかに傾ける。追いかけすぎないよう鈍くする
    pointer.current.x += (p.x - pointer.current.x) * 0.04;
    pointer.current.y += (p.y - pointer.current.y) * 0.04;
    if (tilt.current) {
      tilt.current.rotation.x = -pointer.current.y * 0.13;
      tilt.current.rotation.y = pointer.current.x * 0.18;
      tilt.current.position.y = Math.sin(t * 0.45) * 0.045;
    }
  });

  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[4, 6, 5]} intensity={1.5} />
      <directionalLight position={[-5, -2, -4]} intensity={0.5} color="#BBD4FF" />

      {/* 反射用の光源。外部ファイルを取りに行かないので表示が遅れない */}
      <Environment resolution={quality === "high" ? 256 : 128}>
        <Lightformer
          intensity={2.2}
          position={[0, 4, 2]}
          scale={[8, 3, 1]}
          color="#FFFFFF"
        />
        <Lightformer
          intensity={1.1}
          position={[-4, 1, 2]}
          scale={[3, 6, 1]}
          color="#DCE9FF"
        />
        <Lightformer
          intensity={0.9}
          position={[4, -1, 3]}
          scale={[3, 5, 1]}
          color="#CFF3FF"
        />
        <Lightformer
          intensity={1.4}
          position={[0, -4, -2]}
          scale={[8, 3, 1]}
          color="#F2F6FF"
        />
      </Environment>

      <Backdrop />

      <group ref={tilt}>
        {/* 中心の芯。ここが「OS本体」 */}
        <mesh>
          <sphereGeometry args={[0.2, 32, 32]} />
          <meshStandardMaterial
            color="#1B4BD8"
            emissive="#2E6BFF"
            emissiveIntensity={1.4}
            roughness={0.2}
            metalness={0.6}
          />
        </mesh>

        <group ref={orbit}>
          <Connections quality={quality} />
          <Packets count={quality === "high" ? 9 : 5} />
          {CORE_MODULES.map((m, i) => (
            <ModuleNode
              key={m.id}
              module={m}
              position={POSITIONS[i]}
              index={i}
              quality={quality}
            />
          ))}
        </group>

        <ShellEdge />
        <GlassShell quality={quality} />
      </group>
    </>
  );
}

export default function OperatingCore({
  quality = "high",
  className = "",
}: {
  quality?: Quality;
  className?: string;
}) {
  return (
    <div className={`h-full w-full ${className}`}>
      <Canvas
        dpr={quality === "high" ? [1, 2] : [1, 1.5]}
        camera={{ position: [0, 0.3, 7.9], fov: 40 }}
        gl={{
          alpha: true,
          antialias: quality === "high",
          powerPreference: "high-performance",
        }}
        style={{ background: "transparent" }}
      >
        <Suspense fallback={null}>
          <Scene quality={quality} />
        </Suspense>
      </Canvas>
    </div>
  );
}
