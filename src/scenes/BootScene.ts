import Phaser from 'phaser';

interface ManifestFrame {
  frameW: number;
  frameH: number;
  frames: string[];
}

interface Manifest {
  files: string[];
  images: Record<string, { w: number; h: number }>;
  spritesheets: { players: ManifestFrame };
  palettes: Record<string, { shirt: string; shorts: string; skin: string }>;
}

/** Manifest filename inside public/assets. Loaded first, everything else keys off it. */
const MANIFEST_URL = 'assets/manifest.json';

/**
 * BootScene — two-phase loader.
 *
 * Phase 1 (preload): fetch manifest.json only.
 * Phase 2 (create): with the manifest cached, queue every image and the players
 * spritesheet (frame dims come from the manifest — single source of truth),
 * start a second load, and move to MatchScene when it completes.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    this.load.json('manifest', MANIFEST_URL);
  }

  create(): void {
    const manifest = this.cache.json.get('manifest') as Manifest;
    const sheet = manifest.spritesheets.players;

    this.load.image('pitch', 'assets/pitch.png');
    this.load.image('ball', 'assets/ball.png');
    this.load.image('ballShadow', 'assets/ball-shadow.png');
    this.load.spritesheet('players', 'assets/players.png', {
      frameWidth: sheet.frameW,
      frameHeight: sheet.frameH,
    });

    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.scene.start('MatchScene');
    });
    this.load.start();
  }
}
