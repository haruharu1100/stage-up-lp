"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";

/**
 * 「3Dデバイスの画面」を1枚のキャンバスとして用意する。
 *
 * 毎フレーム描き直すと重くなるので、描き直す回数は秒間15回程度に抑えます。
 * 目で見るぶんには十分なめらかで、GPUへの転送量は1/4になります。
 */
export function useScreenTexture(width: number, height: number, scale = 1) {
  const kit = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d", { alpha: false })!;
    ctx.scale(scale, scale);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return { canvas, ctx, texture, last: { t: -1 } };
  }, [width, height, scale]);

  useEffect(() => {
    const t = kit.texture;
    return () => {
      t.dispose();
    };
  }, [kit]);

  /** fps を超えない範囲で描き直す。draw が false を返したら転送しない */
  const paint = (now: number, fps: number, draw: () => void) => {
    if (now - kit.last.t < 1 / fps) return;
    kit.last.t = now;
    draw();
    kit.texture.needsUpdate = true;
  };

  return { ...kit, paint };
}

/** 下に敷く「浮いている影」。放射状のぼかしを1枚のテクスチャで作る */
export function makeShadowTexture(tint = "rgba(21,38,86,") {
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = S;
  cv.height = S;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, tint + "0.30)");
  g.addColorStop(0.42, tint + "0.14)");
  g.addColorStop(1, tint + "0)");
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 光の粒。加算合成で使う小さな丸 */
export function makeSparkTexture(color = "255,255,255") {
  const S = 128;
  const cv = document.createElement("canvas");
  cv.width = S;
  cv.height = S;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, `rgba(${color},1)`);
  g.addColorStop(0.25, `rgba(${color},0.55)`);
  g.addColorStop(1, `rgba(${color},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
