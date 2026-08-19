'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 「この位置で正しいですか？」を目で確かめて、ずれていれば直せる地図。
 *
 * 住所から自動で出した位置は、同じ町名や似た建物名があるとよく1〜2ブロックずれる。
 * ずれた位置のまま天気を記録し続けると、あとから見直すこともできないので、
 * 開店前に一度だけ、人の目で確かめられるようにしておく。
 *
 * 地図は OpenStreetMap の画像をそのまま並べているだけで、
 * 追加の部品（ライブラリ）は使っていない。読み込みが軽く、
 * 提供元が変わってもこの1ファイルを直すだけで済むようにするため。
 */

const TILE = 256;
const MIN_ZOOM = 5;
const MAX_ZOOM = 18;

// 緯度経度 ↔ 地図上の点（世界地図をピクセルに直したもの）
function lngToX(lng, z) {
  return ((Number(lng) + 180) / 360) * TILE * 2 ** z;
}
function latToY(lat, z) {
  const r = (Number(lat) * Math.PI) / 180;
  const s = Math.log(Math.tan(r) + 1 / Math.cos(r));
  return ((1 - s / Math.PI) / 2) * TILE * 2 ** z;
}
function xToLng(x, z) {
  return (x / (TILE * 2 ** z)) * 360 - 180;
}
function yToLat(y, z) {
  const n = Math.PI - 2 * Math.PI * (y / (TILE * 2 ** z));
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
const round6 = (v) => Math.round(Number(v) * 1e6) / 1e6;

export default function MapPicker({ lat, lng, onChange, height = 320 }) {
  const boxRef = useRef(null);
  const dragRef = useRef(null);
  const [size, setSize] = useState({ w: 640, h: height });
  const [zoom, setZoom] = useState(17);
  // 地図の中心。ピンとは別に持つ（ピンを動かしても地図は動かさない）
  const [center, setCenter] = useState({ lat: Number(lat) || 34.702485, lng: Number(lng) || 135.495951 });
  const [moved, setMoved] = useState(false);

  // 外から位置が入ったとき（住所から探した直後など）は、そこへ寄せる
  useEffect(() => {
    const la = Number(lat);
    const ln = Number(lng);
    if (Number.isFinite(la) && Number.isFinite(ln) && la !== 0 && ln !== 0) {
      setCenter({ lat: la, lng: ln });
    }
  }, [lat, lng]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const fit = () => setSize({ w: el.clientWidth || 640, h: height });
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, [height]);

  const cx = lngToX(center.lng, zoom);
  const cy = latToY(center.lat, zoom);
  const left = cx - size.w / 2; // 画面の左端が、世界地図のどこにあたるか
  const top = cy - size.h / 2;

  // 画面に映っているぶんの画像だけを並べる
  const tiles = [];
  const max = 2 ** zoom;
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + size.w) / TILE); tx += 1) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + size.h) / TILE); ty += 1) {
      if (ty < 0 || ty >= max) continue;
      const wx = ((tx % max) + max) % max; // 東西はぐるりとつながっている
      tiles.push({
        key: `${zoom}/${tx}/${ty}`,
        url: `https://tile.openstreetmap.org/${zoom}/${wx}/${ty}.png`,
        x: tx * TILE - left,
        y: ty * TILE - top,
      });
    }
  }

  const hasPin = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Number(lat) !== 0;
  const pin = hasPin
    ? { x: lngToX(lng, zoom) - left, y: latToY(lat, zoom) - top }
    : null;

  const pointerAt = useCallback((e) => {
    const r = boxRef.current.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }, []);

  function onDown(e) {
    dragRef.current = { ...pointerAt(e), cLat: center.lat, cLng: center.lng, moved: false };
    setMoved(false);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const { px, py } = pointerAt(e);
    const dx = px - d.px;
    const dy = py - d.py;
    if (Math.abs(dx) + Math.abs(dy) > 4) { d.moved = true; setMoved(true); }
    if (!d.moved) return;
    const nx = lngToX(d.cLng, zoom) - dx;
    const ny = latToY(d.cLat, zoom) - dy;
    setCenter({ lat: yToLat(ny, zoom), lng: xToLng(nx, zoom) });
  }
  function onUp(e) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.moved) return; // 地図を動かしただけのときはピンを打たない
    // 押した場所にピンを移す
    const { px, py } = pointerAt(e);
    const la = round6(yToLat(top + py, zoom));
    const ln = round6(xToLng(left + px, zoom));
    onChange?.({ lat: la, lng: ln });
  }

  const btn = {
    width: 34, height: 34, lineHeight: '30px', fontSize: 20, fontWeight: 700,
    background: '#fff', border: '1px solid #cfd6dd', borderRadius: 8, cursor: 'pointer', padding: 0,
  };

  return (
    <div>
      <div
        ref={boxRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => { dragRef.current = null; }}
        style={{
          position: 'relative', height, width: '100%', overflow: 'hidden',
          border: '1px solid #dfe4ea', borderRadius: 10, background: '#e8eef3',
          cursor: moved ? 'grabbing' : 'crosshair', touchAction: 'none', userSelect: 'none',
        }}
      >
        {tiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={t.key}
            src={t.url}
            alt=""
            draggable={false}
            style={{ position: 'absolute', left: t.x, top: t.y, width: TILE, height: TILE, pointerEvents: 'none' }}
          />
        ))}

        {pin && pin.x > -40 && pin.x < size.w + 40 && pin.y > -60 && pin.y < size.h + 60 && (
          <div style={{ position: 'absolute', left: pin.x, top: pin.y, transform: 'translate(-50%,-100%)', pointerEvents: 'none' }}>
            <div style={{ fontSize: 34, lineHeight: '34px', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))' }}>📍</div>
          </div>
        )}

        <div style={{ position: 'absolute', right: 10, top: 10, display: 'grid', gap: 6 }}>
          <button type="button" style={btn} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 1))} aria-label="拡大">＋</button>
          <button type="button" style={btn} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 1))} aria-label="縮小">−</button>
        </div>

        <div style={{
          position: 'absolute', left: 0, bottom: 0, background: 'rgba(255,255,255,.82)',
          fontSize: 11, padding: '2px 8px', borderTopRightRadius: 8, color: '#555',
        }}>
          地図：© OpenStreetMap contributors
        </div>
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        地図を指でなぞると動かせます。お店の場所を押すと、そこにピンが移ります（＋−で拡大・縮小）。
      </div>
    </div>
  );
}
