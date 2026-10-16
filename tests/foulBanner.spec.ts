import { describe, it, expect, vi } from 'vitest';
import { BALANCE_CONFIG } from '../src/data/balance';
import { FoulBanner, foulBannerData } from '../src/ui/FoulBanner';

// Batch C-B: transient foul signal reusing the HalftimeBanner overlay pattern.
// TDD RED: FoulBanner module does not exist yet.

function fakeText() {
  return {
    text: '',
    visible: false,
    x: 0,
    y: 0,
    setText(t: string) {
      this.text = t;
      return this;
    },
    setOrigin() {
      return this;
    },
    setDepth() {
      return this;
    },
    setScrollFactor() {
      return this;
    },
    setVisible(v: boolean) {
      this.visible = v;
      return this;
    },
  };
}

function fakeScene() {
  const texts: ReturnType<typeof fakeText>[] = [];
  let delayedCb: (() => void) | null = null;
  return {
    texts,
    fireDelayed() {
      delayedCb?.();
    },
    scene: {
      add: {
        rectangle: vi.fn((x: number, y: number) => ({ x, y, setDepth: vi.fn(), setScrollFactor: vi.fn() })),
        text: vi.fn((_x: number, _y: number, t: string) => {
          const ft = fakeText();
          ft.text = t;
          texts.push(ft);
          return ft;
        }),
        container: vi.fn((_x: number, _y: number) => {
          let v = false;
          return {
            get visible() {
              return v;
            },
            setVisible: vi.fn((nv: boolean) => {
              v = nv;
            }),
            setDepth: vi.fn(),
            setScrollFactor: vi.fn(),
            setPosition: vi.fn(),
            setScale: vi.fn(),
          };
        }),
      },
      time: {
        delayedCall: vi.fn((_ms: number, cb: () => void) => {
          delayedCb = cb;
          return { remove: vi.fn() };
        }),
      },
    } as any,
  };
}

describe('foul banner payload — correct copy per award type', () => {
  it('FREE_KICK shows the configured FALTA copy, PENALTY the PENAL copy', () => {
    const cfg = BALANCE_CONFIG.FOUL_BANNER;
    expect(cfg.FREE_KICK_TEXT.length).toBeGreaterThan(0);
    expect(cfg.PENALTY_TEXT.length).toBeGreaterThan(0);
    expect(cfg.FREE_KICK_TEXT).not.toBe(cfg.PENALTY_TEXT);
    expect(foulBannerData('FREE_KICK').text).toBe(cfg.FREE_KICK_TEXT);
    expect(foulBannerData('PENALTY').text).toBe(cfg.PENALTY_TEXT);
  });

  it('payload duration comes from config and is transient (>0)', () => {
    const d = foulBannerData('FREE_KICK');
    expect(d.durationMs).toBe(BALANCE_CONFIG.FOUL_BANNER.DURATION_MS);
    expect(d.durationMs).toBeGreaterThan(0);
  });
});

describe('FoulBanner overlay — transient show/auto-hide', () => {
  it('show renders the award copy and auto-hides after the configured delay', () => {
    const { scene, texts, fireDelayed } = fakeScene();
    const banner = new FoulBanner(scene);
    expect(banner.visible).toBe(false);
    banner.show('FREE_KICK');
    expect(banner.visible).toBe(true);
    expect(texts.some((t) => t.text === BALANCE_CONFIG.FOUL_BANNER.FREE_KICK_TEXT)).toBe(true);
    fireDelayed();
    expect(banner.visible).toBe(false);
  });

  it('a second award replaces the copy while visible (no stacking)', () => {
    const { scene, texts } = fakeScene();
    const banner = new FoulBanner(scene);
    banner.show('FREE_KICK');
    banner.show('PENALTY');
    expect(banner.visible).toBe(true);
    expect(texts.some((t) => t.text === BALANCE_CONFIG.FOUL_BANNER.PENALTY_TEXT)).toBe(true);
  });
});
