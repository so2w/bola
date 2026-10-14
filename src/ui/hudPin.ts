import type { FormationId } from '../data/formations';
import { BALANCE_CONFIG } from '../data/balance';

/** CAM-1: per-formation camera zoom (playtest: whole-pitch zoom 1.15 was illegible). */
export function zoomForFormation(id: FormationId): number {
  const c = BALANCE_CONFIG.CAMERA;
  switch (id) {
    case '5v5':
      return c.ZOOM_5V5;
    case '11v11':
      return c.ZOOM_11V11;
    case '3v3':
    default:
      return c.ZOOM_3V3;
  }
}

/** Minimal transform surface required to pin a HUD object (Text/Container). */
export interface PinnableHud {
  setScrollFactor(x: number, y?: number): unknown;
  setPosition(x: number, y: number): unknown;
  setScale(x: number, y?: number): unknown;
}

/**
 * HUD anti-zoom pin: makes a HUD object render at fixed SCREEN coordinates
 * with fixed on-screen size regardless of camera scroll/zoom (AGENTS.md §9 —
 * HUD text must never be pushed/clipped at screen edges).
 *
 * Phaser 3 (verified against 3.90 sources) has no per-object ignoreZoom, so
 * the reliable fallback is to undo the zoom around the viewport center: with
 * scrollFactor(0) an object at position P renders at
 * `center + (P - center) * zoom` with its scale multiplied by zoom. Solving
 * for the desired screen slot S: P = center + (S - center) / zoom and
 * scale = 1 / zoom. If a runtime ever ships setIgnoreZoom, we use it instead
 * (guarded by a typeof check).
 */
export function pinHudObject(
  obj: PinnableHud,
  screenX: number,
  screenY: number,
  zoom: number,
  viewW: number,
  viewH: number,
): void {
  obj.setScrollFactor(0);
  if (typeof (obj as unknown as { setIgnoreZoom?: unknown }).setIgnoreZoom === 'function') {
    (obj as unknown as { setIgnoreZoom: (v: boolean) => void }).setIgnoreZoom(true);
    obj.setPosition(screenX, screenY);
    return;
  }
  const cx = viewW / 2;
  const cy = viewH / 2;
  obj.setPosition(cx + (screenX - cx) / zoom, cy + (screenY - cy) / zoom);
  obj.setScale(1 / zoom);
}
