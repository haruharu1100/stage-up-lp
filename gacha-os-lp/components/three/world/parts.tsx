"use client";

/**
 * 3Dの共通部品。
 *
 * ★ここが「サイト全体で同じ世界に見える」ことの土台です。
 *   ライト・材質・影・光の線は、どのセクションでも必ずこのファイルのものを使うこと。
 *   セクションごとに別々の3Dを置くと、ページがバラバラに見えます。
 */

import {
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { makeShadowTexture, makeSparkTexture } from "./screenTexture";

export type Tier = "high" | "medium";

/* ═══════════════ 光 ═══════════════ */

/**
 * 明るい白背景のうえに置く前提の照明。
 * HDR画像は読み込まず、板状のライトを自分で並べています（通信ゼロ・起動が速い）。
 */
export function Lighting({ tier }: { tier: Tier }) {
  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[4, 7, 5]} intensity={1.25} color="#FFFFFF" />
      <directionalLight position={[-6, 3, -4]} intensity={0.5} color="#BBD3FF" />
      <Environment resolution={tier === "high" ? 256 : 128}>
        {/* 上からの帯（アルミの天面に細長い映り込みを作る） */}
        <Lightformer
          form="rect"
          intensity={2.4}
          position={[0, 6, 2]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[12, 5, 1]}
          color="#FFFFFF"
        />
        {/* 左からの青 */}
        <Lightformer
          form="rect"
          intensity={1.5}
          position={[-7, 2, 3]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[9, 6, 1]}
          color="#CFE0FF"
        />
        {/* 右からの水色 */}
        <Lightformer
          form="rect"
          intensity={1.2}
          position={[7, 1.5, 2]}
          rotation={[0, -Math.PI / 2, 0]}
          scale={[8, 6, 1]}
          color="#D5F4FA"
        />
        {/* 手前からの起こし光 */}
        <Lightformer
          form="rect"
          intensity={0.9}
          position={[0, 0, 8]}
          scale={[10, 6, 1]}
          color="#FFFFFF"
        />
      </Environment>
    </>
  );
}

/* ═══════════════ 影 ═══════════════ */

/** 空中に浮いていることを示す、下のやわらかい影 */
export function FloatShadow({
  position = [0, -1.4, 0],
  scale = 5,
  opacity = 1,
}: {
  position?: [number, number, number];
  scale?: number | [number, number];
  opacity?: number;
}) {
  const tex = useMemo(() => makeShadowTexture(), []);
  const s: [number, number] = Array.isArray(scale) ? scale : [scale, scale * 0.62];
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[s[0], s[1]]} />
      <meshBasicMaterial
        map={tex}
        transparent
        opacity={opacity}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/* ═══════════════ 材質 ═══════════════ */

/** 本体のアルミ */
export function bodyMaterialProps(tier: Tier) {
  return tier === "high"
    ? { color: "#C7CEDA", metalness: 0.94, roughness: 0.24, envMapIntensity: 1.35 }
    : { color: "#C9D0DC", metalness: 0.65, roughness: 0.4, envMapIntensity: 1.0 };
}

/* ═══════════════ ノートPC ═══════════════ */

type LaptopProps = {
  tier: Tier;
  /** 画面に貼るテクスチャ */
  screen: THREE.Texture;
  /** 画面の横縦比（1600/1000 = 1.6） */
  aspect?: number;
  /** 画面の横幅（3D空間の単位） */
  width?: number;
  /** ふたの開き具合（0 = 閉じている / 1 = 開ききっている） */
  open?: number;
  children?: ReactNode;
};

/**
 * ノートパソコン。
 * 円柱のヒンジ・面取りした天板・キーボードの窪みまで作っています。
 */
export function Laptop({
  tier,
  screen,
  aspect = 1.6,
  width = 3.3,
  open = 1,
  children,
}: LaptopProps) {
  const bodyW = width;
  const bodyD = bodyW / 1.44;
  const lidH = bodyW / aspect;
  const mat = bodyMaterialProps(tier);
  // ふたの角度。open=1 で「開いて少しだけ後ろに倒れている」、open=0 で閉じる。
  // ふたの中身は最初から立っている（+Y方向にずらしてある）ので、
  // 閉じるときだけ +90度ぶん手前へ倒す。
  const LEAN = 0.17; // 開いているときの後ろへの傾き
  const lidAngle = (1 - open) * (Math.PI * 0.5 + LEAN) - LEAN;

  return (
    <group>
      {/* ── 下側（キーボード側） ── */}
      <RoundedBox
        args={[bodyW, 0.1, bodyD]}
        radius={0.032}
        smoothness={4}
        position={[0, -0.05, 0]}
        castShadow={false}
      >
        <meshStandardMaterial {...mat} />
      </RoundedBox>

      {/* キーボードの窪み */}
      <mesh position={[0, 0.002, bodyD * 0.06]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[bodyW * 0.86, bodyD * 0.5]} />
        <meshStandardMaterial
          color="#2A3242"
          roughness={0.85}
          metalness={0.1}
        />
      </mesh>
      {/* キーの列（板1枚に見せず、行を刻む） */}
      {tier === "high" &&
        Array.from({ length: 5 }).map((_, r) => (
          <mesh
            key={r}
            position={[0, 0.004, bodyD * 0.06 - bodyD * 0.2 + r * bodyD * 0.1]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[bodyW * 0.845, bodyD * 0.012]} />
            <meshBasicMaterial color="#4A5468" transparent opacity={0.5} />
          </mesh>
        ))}
      {/* トラックパッド */}
      <mesh position={[0, 0.003, bodyD * 0.33]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[bodyW * 0.3, bodyD * 0.2]} />
        <meshStandardMaterial color="#B9C1CE" roughness={0.35} metalness={0.5} />
      </mesh>

      {/* ── ヒンジ ── */}
      <mesh
        position={[0, -0.012, -bodyD / 2 + 0.045]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <cylinderGeometry args={[0.045, 0.045, bodyW * 0.92, 20]} />
        <meshStandardMaterial color="#8E97A8" metalness={0.9} roughness={0.35} />
      </mesh>

      {/* ── ふた（画面側） ── */}
      <group position={[0, 0, -bodyD / 2 + 0.045]} rotation={[lidAngle, 0, 0]}>
        <group position={[0, lidH / 2 + 0.05, 0]}>
          {/* 背面 */}
          <RoundedBox
            args={[bodyW, lidH + 0.14, 0.055]}
            radius={0.03}
            smoothness={4}
            position={[0, 0, -0.03]}
          >
            <meshStandardMaterial {...mat} />
          </RoundedBox>
          {/* 黒いふち */}
          <mesh position={[0, 0, 0.001]}>
            <planeGeometry args={[bodyW - 0.02, lidH + 0.12]} />
            <meshStandardMaterial color="#0A0E18" roughness={0.5} metalness={0.2} />
          </mesh>
          {/* 画面そのもの */}
          <mesh position={[0, 0, 0.004]}>
            <planeGeometry args={[bodyW - 0.13, lidH]} />
            <meshBasicMaterial map={screen} toneMapped={false} />
          </mesh>
          {/* 画面のガラスの映り込み（斜めの淡い帯） */}
          <mesh position={[0, 0, 0.006]}>
            <planeGeometry args={[bodyW - 0.13, lidH]} />
            <meshBasicMaterial
              map={glassTexture()}
              transparent
              opacity={tier === "high" ? 0.1 : 0.06}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          {/* カメラ */}
          <mesh position={[0, lidH / 2 + 0.035, 0.006]}>
            <circleGeometry args={[0.012, 12]} />
            <meshBasicMaterial color="#1B2434" />
          </mesh>
          {children}
        </group>
      </group>
    </group>
  );
}

/**
 * 画面ガラスの映り込み用グラデーション。
 * 1枚だけ作って全デバイスで使い回す（デバイスの数だけ作らない）。
 */
let _glass: THREE.CanvasTexture | null = null;
function glassTexture() {
  if (_glass) return _glass;
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 160;
  const c = cv.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, 256, 160);
  g.addColorStop(0, "rgba(255,255,255,0.55)");
  g.addColorStop(0.32, "rgba(255,255,255,0.06)");
  g.addColorStop(0.52, "rgba(160,200,255,0.16)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 160);
  _glass = new THREE.CanvasTexture(cv);
  _glass.colorSpace = THREE.SRGBColorSpace;
  return _glass;
}

/* ═══════════════ スマートフォン ═══════════════ */

type PhoneProps = {
  tier: Tier;
  screen: THREE.Texture;
  /** 画面の横幅（3D空間の単位） */
  width?: number;
  aspect?: number; // 720/1560
  children?: ReactNode;
};

export function Phone({
  tier,
  screen,
  width = 1.0,
  aspect = 720 / 1560,
  children,
}: PhoneProps) {
  const w = width;
  const h = w / aspect;
  const mat = bodyMaterialProps(tier);

  return (
    <group>
      {/* 本体 */}
      <RoundedBox
        args={[w, h, 0.085]}
        radius={0.1}
        smoothness={tier === "high" ? 6 : 3}
        position={[0, 0, 0]}
      >
        <meshStandardMaterial {...mat} />
      </RoundedBox>
      {/* 黒いふち */}
      <mesh position={[0, 0, 0.0435]}>
        <planeGeometry args={[w - 0.02, h - 0.02]} />
        <meshStandardMaterial color="#070B14" roughness={0.45} metalness={0.25} />
      </mesh>
      {/* 画面 */}
      <mesh position={[0, 0, 0.046]}>
        <planeGeometry args={[w - 0.075, h - 0.075]} />
        <meshBasicMaterial map={screen} toneMapped={false} />
      </mesh>
      {/* ガラスの映り込み */}
      <mesh position={[0, 0, 0.048]}>
        <planeGeometry args={[w - 0.075, h - 0.075]} />
        <meshBasicMaterial
          map={glassTexture()}
          transparent
          opacity={tier === "high" ? 0.09 : 0.05}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* 上部の黒い島 */}
      <mesh position={[0, h / 2 - 0.115, 0.049]}>
        <planeGeometry args={[w * 0.26, 0.052]} />
        <meshBasicMaterial color="#05070C" />
      </mesh>
      {/* 側面のボタン */}
      <mesh position={[w / 2 + 0.005, h * 0.16, 0]}>
        <boxGeometry args={[0.012, 0.14, 0.05]} />
        <meshStandardMaterial color="#AEB6C4" metalness={0.9} roughness={0.3} />
      </mesh>
      <mesh position={[-w / 2 - 0.005, h * 0.2, 0]}>
        <boxGeometry args={[0.012, 0.09, 0.05]} />
        <meshStandardMaterial color="#AEB6C4" metalness={0.9} roughness={0.3} />
      </mesh>
      {children}
    </group>
  );
}

/* ═══════════════ 光の線（データの流れ） ═══════════════ */

/**
 * 2点をゆるいカーブでつなぐ線。
 * 「どこから入って、どこへ出ていくのか」を目で追えるようにするための部品。
 */
export function Beam({
  curve,
  color = "#5B8CFF",
  opacity = 0.28,
  lineRef,
}: {
  curve: THREE.Curve<THREE.Vector3>;
  color?: string;
  opacity?: number;
  /** 濃さを毎フレーム変えたいときに、線そのものを受け取るための口 */
  lineRef?: MutableRefObject<THREE.Line | null>;
}) {
  const line = useMemo(() => {
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(44));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      depthWrite: false,
    });
    return new THREE.Line(geo, mat);
  }, [curve, color, opacity]);

  useEffect(() => {
    if (lineRef) lineRef.current = line;
  }, [line, lineRef]);

  return <primitive object={line} />;
}

export function beamCurve(
  from: [number, number, number],
  to: [number, number, number],
  bend = 0.5
) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const mid = a.clone().lerp(b, 0.5);
  mid.y += bend;
  mid.z += bend * 0.35;
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

/**
 * 線の上を流れる光の粒。
 * count を増やすほど「たくさん処理している」ように見えますが、
 * 増やしすぎると意味が読み取れなくなるので 3〜5 個までにしています。
 */
export function BeamFlow({
  curve,
  count = 3,
  speed = 0.32,
  size = 0.17,
  color = "91,140,255",
  offset = 0,
  active = true,
}: {
  curve: THREE.Curve<THREE.Vector3>;
  count?: number;
  speed?: number;
  size?: number;
  color?: string;
  offset?: number;
  active?: boolean;
}) {
  const tex = useMemo(() => makeSparkTexture(color), [color]);
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    if (!active) return;
    const t = clock.elapsedTime;
    refs.current.forEach((s, i) => {
      if (!s) return;
      const p = ((t * speed + offset + i / count) % 1 + 1) % 1;
      curve.getPointAt(p, v);
      s.position.copy(v);
      // 出はじめと終わりは薄くする
      const fade = Math.sin(p * Math.PI);
      const m = s.material as THREE.SpriteMaterial;
      m.opacity = fade * 0.95;
      const sc = size * (0.7 + fade * 0.5);
      s.scale.set(sc, sc, sc);
    });
  });

  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <sprite
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
        >
          <spriteMaterial
            map={tex}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </sprite>
      ))}
    </>
  );
}

/* ═══════════════ 3D空間に置く札 ═══════════════ */

const labelCache = new Map<string, THREE.CanvasTexture>();

/**
 * 3Dの中に置く小さな札。
 * HTMLを重ねるのではなく3Dの板として置くので、奥行きと一緒に動きます。
 */
function labelTexture(
  title: string,
  value: string,
  accent: string,
  dark: boolean
) {
  const key = `${title}|${value}|${accent}|${dark}`;
  const hit = labelCache.get(key);
  if (hit) return hit;

  const W = 512;
  const H = value ? 176 : 108;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;

  const r = H * 0.28;
  const rrPath = () => {
    c.beginPath();
    c.moveTo(r + 4, 4);
    c.arcTo(W - 4, 4, W - 4, H - 4, r);
    c.arcTo(W - 4, H - 4, 4, H - 4, r);
    c.arcTo(4, H - 4, 4, 4, r);
    c.arcTo(4, 4, W - 4, 4, r);
    c.closePath();
  };
  rrPath();
  c.fillStyle = dark ? "rgba(9,14,26,0.86)" : "rgba(255,255,255,0.9)";
  c.fill();
  c.strokeStyle = dark ? "rgba(255,255,255,0.16)" : "rgba(11,18,32,0.12)";
  c.lineWidth = 3;
  c.stroke();

  // 左の色帯
  c.save();
  rrPath();
  c.clip();
  c.fillStyle = accent;
  c.fillRect(4, 4, 9, H - 8);
  c.restore();

  const JPF =
    '"Hiragino Sans","Noto Sans JP","Yu Gothic",system-ui,sans-serif';
  const MONOF = '"JetBrains Mono","SFMono-Regular",Menlo,monospace';

  if (value) {
    c.font = `600 30px ${MONOF}`;
    c.fillStyle = dark ? "rgba(233,241,255,0.5)" : "rgba(99,112,138,0.95)";
    c.fillText(title, 44, 62);
    c.font = `700 54px ${JPF}`;
    c.fillStyle = dark ? "#EAF1FF" : "#0B1220";
    c.fillText(value, 44, 126);
  } else {
    c.font = `700 40px ${MONOF}`;
    c.fillStyle = dark ? "#EAF1FF" : "#0B1220";
    c.textBaseline = "middle";
    c.fillText(title, 44, H / 2 + 2);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  labelCache.set(key, tex);
  return tex;
}

export function Label({
  title,
  value = "",
  accent = "#1B4BD8",
  dark = false,
  position,
  rotation = [0, 0, 0],
  scale = 1,
  opacity = 1,
}: {
  title: string;
  value?: string;
  accent?: string;
  dark?: boolean;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  opacity?: number;
}) {
  const tex = useMemo(
    () => labelTexture(title, value, accent, dark),
    [title, value, accent, dark]
  );
  const h = value ? 176 : 108;
  const w = 512;
  const unit = 0.0026 * scale;
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[w * unit, h * unit]} />
      <meshBasicMaterial
        map={tex}
        transparent
        opacity={opacity}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** ふわっと浮かせる（上下にゆっくり動かす） */
export function Drift({
  children,
  amount = 0.06,
  speed = 0.5,
  phase = 0,
  rotate = 0.015,
}: {
  children: ReactNode;
  amount?: number;
  speed?: number;
  phase?: number;
  rotate?: number;
}) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!g.current) return;
    const t = clock.elapsedTime * speed + phase;
    g.current.position.y = Math.sin(t) * amount;
    g.current.rotation.z = Math.sin(t * 0.7) * rotate;
  });
  return <group ref={g}>{children}</group>;
}
