"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  makeDashboardTexture,
  makeDataChipTexture,
  makeModuleTexture,
} from "./textures";

const MODULES: { label: string; sub: string; accent: string; pos: [number, number, number] }[] =
  [
    { label: "AIガチャ設計", sub: "AI ENGINE", accent: "#60A5FA", pos: [-4.05, 1.72, 1.5] },
    { label: "実還元率", sub: "REAL TIME RTP", accent: "#EAB308", pos: [4.15, 1.15, 1.15] },
    { label: "市場価格更新", sub: "PRICE ENGINE", accent: "#22D3EE", pos: [-4.35, -0.62, 0.6] },
    { label: "発送自動化", sub: "SHIPPING ENGINE", accent: "#34D399", pos: [4.0, -1.05, 1.7] },
    { label: "AI顧客対応", sub: "AI CUSTOMER SUPPORT", accent: "#C8A96A", pos: [-1.1, -2.55, 2.2] },
  ];

/**
 * データが流れる順路。
 * ガチャ設計 → 市場価格 → 実還元率 → 発送 → AI顧客対応。
 * 読ませる情報ではなく「つながって動いている」ことだけを伝える。
 */
const CHAIN: { from: number; to: number; label: string; accent: string }[] = [
  { from: 0, to: 2, label: "500 / ¥1,500", accent: "#60A5FA" },
  { from: 2, to: 1, label: "¥51,800 +23.3%", accent: "#22D3EE" },
  { from: 1, to: 3, label: "RTP 108.7%", accent: "#EAB308" },
  { from: 3, to: 4, label: "SHIP 26", accent: "#34D399" },
];

const CHAIN_CYCLE = 9;
const HOP_SLOT = 0.19;
const HOP_SPAN = 0.22;

function Panel({
  texture,
  width,
  position,
  rotation = [0, 0, 0],
  floatSpeed = 1,
  floatAmp = 0.08,
  phase = 0,
}: {
  texture: THREE.Texture;
  width: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  floatSpeed?: number;
  floatAmp?: number;
  phase?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const img = texture.image as HTMLCanvasElement;
  const height = (width * img.height) / img.width;

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.position.y =
      position[1] + Math.sin(t * 0.45 * floatSpeed + phase) * floatAmp;
  });

  return (
    <mesh ref={ref} position={position} rotation={rotation}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  );
}

function curveTo(to: [number, number, number]) {
  const from = new THREE.Vector3(0, 0, 0.05);
  const target = new THREE.Vector3(...to);
  const mid = from.clone().lerp(target, 0.5).add(new THREE.Vector3(0, 0.25, 0.6));
  return new THREE.QuadraticBezierCurve3(from, mid, target);
}

function Connector({ to }: { to: [number, number, number] }) {
  const line = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints(
      curveTo(to).getPoints(48)
    );
    const mat = new THREE.LineBasicMaterial({
      color: "#60A5FA",
      transparent: true,
      opacity: 0.18,
    });
    return new THREE.Line(geom, mat);
  }, [to]);

  useEffect(() => {
    return () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    };
  }, [line]);

  useFrame((state) => {
    const mat = line.material as THREE.LineBasicMaterial;
    mat.opacity =
      0.12 + 0.1 * (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 1.1 + to[0]));
  });

  return <primitive object={line} />;
}

function Pulse({ to, delay }: { to: [number, number, number]; delay: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const curve = useMemo(() => curveTo(to), [to]);

  useFrame((state) => {
    if (!ref.current) return;
    const t = ((state.clock.elapsedTime * 0.32 + delay) % 1 + 1) % 1;
    const p = curve.getPoint(t);
    ref.current.position.copy(p);
    const m = ref.current.material as THREE.MeshBasicMaterial;
    m.opacity = Math.sin(t * Math.PI) * 0.9;
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.038, 10, 10]} />
      <meshBasicMaterial color="#8CC5FF" transparent opacity={0.8} toneMapped={false} />
    </mesh>
  );
}

function hopCurve(
  from: [number, number, number],
  to: [number, number, number]
) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const mid = a.clone().lerp(b, 0.5);
  mid.z += 1.15;
  mid.y += a.y > b.y ? -0.3 : 0.3;
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

function ChainHop({
  hop,
  index,
  progress,
}: {
  hop: (typeof CHAIN)[number];
  index: number;
  progress: React.MutableRefObject<number>;
}) {
  const curve = useMemo(
    () => hopCurve(MODULES[hop.from].pos, MODULES[hop.to].pos),
    [hop]
  );

  const line = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
    const mat = new THREE.LineBasicMaterial({
      color: hop.accent,
      transparent: true,
      opacity: 0.08,
    });
    return new THREE.Line(geom, mat);
  }, [curve, hop.accent]);

  const tex = useMemo(
    () => makeDataChipTexture(hop.label, hop.accent),
    [hop.label, hop.accent]
  );

  const chip = useRef<THREE.Mesh>(null);
  const img = tex.image as HTMLCanvasElement;
  const w = 1.12;
  const h = (w * img.height) / img.width;

  useEffect(() => {
    return () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      tex.dispose();
    };
  }, [line, tex]);

  useFrame((state) => {
    const u = (state.clock.elapsedTime % CHAIN_CYCLE) / CHAIN_CYCLE;
    const local = (u - index * HOP_SLOT) / HOP_SPAN;
    const on = local >= 0 && local <= 1;

    const mat = line.material as THREE.LineBasicMaterial;
    mat.opacity = 0.07 + (on ? 0.2 * Math.sin(local * Math.PI) : 0);

    if (!chip.current) return;
    chip.current.visible = on;
    if (!on) return;

    chip.current.position.copy(curve.getPoint(local));
    // 親グループの横スケール（スクロールで広がる）を打ち消して文字を歪ませない
    chip.current.scale.x = 1 / (1 + progress.current * 0.55);
    (chip.current.material as THREE.MeshBasicMaterial).opacity =
      Math.sin(local * Math.PI) * 0.95;
  });

  return (
    <group>
      <primitive object={line} />
      <mesh ref={chip} visible={false}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={tex} transparent opacity={0} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Chain({ progress }: { progress: React.MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (!group.current) return;
    const p = progress.current;
    const k = Math.min(1, delta * 3.2);
    // モジュールと同じ広がり方に追従させる
    group.current.scale.x += (1 + p * 0.55 - group.current.scale.x) * k;
    group.current.position.z += (p * 2.4 - group.current.position.z) * k;
  });

  return (
    <group ref={group}>
      {CHAIN.map((hop, i) => (
        <ChainHop key={hop.label} hop={hop} index={i} progress={progress} />
      ))}
    </group>
  );
}

function Particles({ count = 760 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 26;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 16;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 18 - 4;
    }
    return arr;
  }, [count]);

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.014;
      ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.08) * 0.04;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.032}
        color="#6EA8FF"
        transparent
        opacity={0.55}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function Rig({ progress }: { progress: React.MutableRefObject<number> }) {
  const { camera } = useThree();
  const group = useRef<THREE.Group>(null);

  const dash = useMemo(() => makeDashboardTexture(), []);
  const mods = useMemo(
    () => MODULES.map((m) => makeModuleTexture(m.label, m.sub, m.accent)),
    []
  );

  useEffect(() => {
    return () => {
      dash.dispose();
      mods.forEach((m) => m.dispose());
    };
  }, [dash, mods]);

  useFrame((state, delta) => {
    const p = progress.current;
    const k = Math.min(1, delta * 3.2);

    camera.position.z += (9.2 - p * 5.6 - camera.position.z) * k;
    camera.position.y += (p * 0.9 - camera.position.y) * k;

    if (group.current) {
      const px = state.pointer.x;
      const py = state.pointer.y;
      group.current.rotation.y += (px * 0.16 - 0.06 - group.current.rotation.y) * k;
      group.current.rotation.x += (-py * 0.1 + 0.02 - group.current.rotation.x) * k;
      const spread = 1 + p * 0.55;
      group.current.scale.setScalar(1 + p * 0.16);
      group.current.children.forEach((child) => {
        const base = child.userData.basePos as THREE.Vector3 | undefined;
        if (base) {
          child.position.x += (base.x * spread - child.position.x) * k;
          child.position.z += (base.z + p * 2.4 - child.position.z) * k;
        }
      });
    }
  });

  return (
    <group ref={group}>
      <Panel texture={dash} width={6.6} position={[0.15, 0.1, 0]} rotation={[0, -0.06, 0]} />
      {MODULES.map((m, i) => (
        <group
          key={m.label}
          userData={{ basePos: new THREE.Vector3(...m.pos) }}
          position={m.pos}
        >
          <Panel
            texture={mods[i]}
            width={2.35}
            position={[0, 0, 0]}
            rotation={[0, m.pos[0] > 0 ? -0.24 : 0.24, 0]}
            phase={i * 1.3}
            floatAmp={0.13}
            floatSpeed={0.8 + i * 0.12}
          />
        </group>
      ))}
      {MODULES.map((m, i) => (
        <group key={`c-${m.label}`}>
          <Connector to={m.pos} />
          <Pulse to={m.pos} delay={i * 0.19} />
        </group>
      ))}
      <Chain progress={progress} />
      <Particles />
    </group>
  );
}

export default function HeroScene() {
  const progress = useRef(0);
  const [active, setActive] = useState(true);
  /**
   * 端末の負荷対策。
   * ・「視差効果を減らす」を設定している人には、動く3Dを止めて静止画像のように見せる
   * ・スマホでは描画解像度の上限を下げ、発熱とバッテリー消費を抑える
   */
  const [reduced, setReduced] = useState(false);
  const [maxDpr, setMaxDpr] = useState(1.75);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    setMaxDpr(window.innerWidth < 768 ? 1.25 : 1.75);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const h = window.innerHeight;
      progress.current = Math.max(0, Math.min(1, window.scrollY / (h * 0.95)));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setActive(e.isIntersecting),
      { rootMargin: "80px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={wrap} className="absolute inset-0">
      <Canvas
        frameloop={reduced ? "demand" : active ? "always" : "never"}
        dpr={[1, maxDpr]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ fov: 42, position: [0, 0, 9.2], near: 0.1, far: 100 }}
      >
        <Rig progress={progress} />
      </Canvas>
    </div>
  );
}
