import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MatchScene } from './scenes/MatchScene';

new Phaser.Game({
  type: Phaser.AUTO,
  pixelArt: true,
  physics: {
    default: 'arcade',
    arcade: {
      debug: false,
    },
  },
  scale: {
    width: 960,
    height: 540,
    parent: 'game',
  },
  scene: [BootScene, MatchScene],
});
