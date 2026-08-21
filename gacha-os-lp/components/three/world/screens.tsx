"use client";

/**
 * 「画面の中身を動かす係」。
 *
 * 3Dのデバイスに、管理画面／お客様画面を映して、順番に切り替えます。
 * 切り替えは暗転を一瞬はさむだけにして、目が追いつくようにしています。
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useScreenTexture } from "./screenTexture";
import { Laptop, Phone, type Tier } from "./parts";
import {
  ADMIN_DURATION,
  ADMIN_H,
  ADMIN_SCREENS,
  ADMIN_W,
  paintAdmin,
  type AdminScreenKey,
} from "../screen/admin";
import {
  OLD_H,
  OLD_W,
  PHONE_DURATION,
  PHONE_H,
  PHONE_SCREENS,
  PHONE_W,
  paintOldAdmin,
  paintPhone,
  type PhoneScreenKey,
} from "../screen/customer";

/** 画面を切り替えるときの暗転（秒） */
const FADE = 0.34;

function fadeIn(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number
) {
  if (t >= FADE) return;
  ctx.save();
  ctx.globalAlpha = 1 - t / FADE;
  ctx.fillStyle = "#05070E";
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/* ═══════════════ 管理画面つきノートPC ═══════════════ */

type AdminLaptopProps = {
  tier: Tier;
  width?: number;
  open?: number;
  /** 順番に映す画面。省略すると6画面すべて */
  sequence?: readonly AdminScreenKey[];
  /** 画面が切り替わったら教える（画面の外の見出しと同期させるため） */
  onScreen?: (key: AdminScreenKey, index: number) => void;
  /** 固定したい画面がある場合 */
  fixed?: AdminScreenKey;
  /** 固定画面のときの再生位置（秒）。指定しなければ実時間 */
  fixedTime?: number;
  /**
   * 毎フレーム「いまどの画面の何秒目か」を決める係。
   * スクロールに合わせて画面を進めたいときに使う。
   * （React の再描画を待たずに切り替えたいので、props ではなく関数で受け取る）
   */
  driver?: () => { key: AdminScreenKey; time: number };
  speed?: number;
};

export function AdminLaptop({
  tier,
  width = 3.3,
  open = 1,
  sequence,
  onScreen,
  fixed,
  fixedTime,
  driver,
  speed = 1,
}: AdminLaptopProps) {
  const seq = sequence ?? ADMIN_SCREENS.map((s) => s.key);
  const scale = tier === "high" ? 1 : 0.7;
  const { ctx, texture, paint } = useScreenTexture(ADMIN_W, ADMIN_H, scale);
  const st = useRef({ i: 0, t: 0, total: 0, announced: -1 });

  useFrame((_, dt) => {
    const s = st.current;
    const d = Math.min(dt, 0.05) * speed;
    s.total += d;

    let key: AdminScreenKey;
    let time: number;

    if (driver) {
      const d = driver();
      key = d.key;
      time = d.time;
    } else if (fixed) {
      key = fixed;
      time = fixedTime ?? s.total;
    } else {
      s.t += d;
      key = seq[s.i];
      if (s.t > ADMIN_DURATION[key]) {
        s.t = 0;
        s.i = (s.i + 1) % seq.length;
        key = seq[s.i];
      }
      time = s.t;
      if (s.announced !== s.i) {
        s.announced = s.i;
        onScreen?.(key, s.i);
      }
    }

    paint(s.total, tier === "high" ? 16 : 11, () => {
      paintAdmin(ctx, key, time);
      fadeIn(ctx, ADMIN_W, ADMIN_H, time);
    });
  });

  return (
    <Laptop
      tier={tier}
      screen={texture}
      aspect={ADMIN_W / ADMIN_H}
      width={width}
      open={open}
    />
  );
}

/* ═══════════════ 今お使いの管理画面つきノートPC ═══════════════ */

/**
 * 移行セクションで使う「いま使っている管理画面」。
 *
 * ★ここは悪口を描く場所ではありません。
 *   よくある管理画面＋Excel＋メール＋電卓、という
 *   「道具が別々に分かれている状態」を描くだけにしてください。
 *   相手は現に売上を作っている事業者なので、けなす絵は逆効果です。
 */
export function LegacyLaptop({
  tier,
  width = 3.2,
}: {
  tier: Tier;
  width?: number;
}) {
  const scale = tier === "high" ? 1 : 0.72;
  const { ctx, texture, paint } = useScreenTexture(OLD_W, OLD_H, scale);
  const st = useRef({ total: 0 });

  useFrame((_, dt) => {
    st.current.total += Math.min(dt, 0.05);
    // 中身がほとんど動かない画面なので、描き直しは秒8回で十分
    paint(st.current.total, 8, () => paintOldAdmin(ctx, st.current.total));
  });

  return (
    <Laptop
      tier={tier}
      screen={texture}
      aspect={OLD_W / OLD_H}
      width={width}
      open={1}
    />
  );
}

/* ═══════════════ お客様画面つきスマートフォン ═══════════════ */

type CustomerPhoneProps = {
  tier: Tier;
  width?: number;
  sequence?: readonly PhoneScreenKey[];
  onScreen?: (key: PhoneScreenKey, index: number) => void;
  fixed?: PhoneScreenKey;
  fixedTime?: number;
  /** 画面の切り替わりを外から止める（PUBLISH を待つときなど） */
  hold?: boolean;
  /** 毎フレーム「いまどの画面の何秒目か」を決める係（スクロール連動用） */
  driver?: () => { key: PhoneScreenKey; time: number };
  speed?: number;
};

export function CustomerPhone({
  tier,
  width = 1.05,
  sequence,
  onScreen,
  fixed,
  fixedTime,
  hold = false,
  driver,
  speed = 1,
}: CustomerPhoneProps) {
  const seq = sequence ?? PHONE_SCREENS.map((s) => s.key);
  const scale = tier === "high" ? 1 : 0.72;
  const { ctx, texture, paint } = useScreenTexture(PHONE_W, PHONE_H, scale);
  const st = useRef({ i: 0, t: 0, total: 0, announced: -1 });

  useFrame((_, dt) => {
    const s = st.current;
    const d = Math.min(dt, 0.05) * speed;
    s.total += d;

    let key: PhoneScreenKey;
    let time: number;

    if (driver) {
      const d = driver();
      key = d.key;
      time = d.time;
    } else if (fixed) {
      key = fixed;
      time = fixedTime ?? s.total;
    } else {
      if (!hold) s.t += d;
      key = seq[s.i];
      if (s.t > PHONE_DURATION[key]) {
        s.t = 0;
        s.i = (s.i + 1) % seq.length;
        key = seq[s.i];
      }
      time = s.t;
      if (s.announced !== s.i) {
        s.announced = s.i;
        onScreen?.(key, s.i);
      }
    }

    paint(s.total, tier === "high" ? 18 : 12, () => {
      paintPhone(ctx, key, time);
      fadeIn(ctx, PHONE_W, PHONE_H, time);
    });
  });

  return <Phone tier={tier} screen={texture} width={width} />;
}
