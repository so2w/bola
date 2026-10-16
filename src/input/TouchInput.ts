import type Phaser from 'phaser';
import type { Player, IPlayerController } from '../entities/Player';
import { BALANCE_CONFIG } from '../data/balance';
import { choosePassTarget } from './passTarget';
import { chooseAimedPassTarget } from './passAim';
import { pinHudObject, type PinnableHud } from '../ui/hudPin';
import type { PassContext, Point } from './HumanInputController';

type TouchCfg = typeof BALANCE_CONFIG.INPUT_TOUCH;

/** Narrow structural view of the scene surface the touch widgets need. */
interface WidgetFactory {
  zone(x: number, y: number, w: number, h: number): PinnableHud & {
    setInteractive(): unknown;
    setDepth(v: number): unknown;
    on(event: string, cb: (pointer: Phaser.Input.Pointer) => void): unknown;
  };
  circle(x: number, y: number, radius: number, color: number, alpha: number): PinnableHud & {
    setDepth(v: number): unknown;
  };
  text(
    x: number,
    y: number,
    content: string,
    style: { fontFamily: string; fontSize: string; color: string },
  ): PinnableHud & {
    setOrigin(x: number, y?: number): unknown;
    setDepth(v: number): unknown;
  };
}

/**
 * Touch proto controller — virtual left stick (360° movement) plus contextual
 * Button A (pass with ball / pressure without) and Button B (hold-to-charge
 * shot). Implements the SAME IPlayerController contract as
 * HumanInputController and resolves intents through the SAME Player APIs and
 * BALANCE_CONFIG gates (pickup radius, input buffer, charge caps), so keyboard
 * and touch produce identical gameplay intents (AGENTS.md section 33).
 *
 * The stick reports deflection as a fraction of STICK_RADIUS_PX. Intent is
 * dead-zoned, EMA-filtered once per update and quantized to STICK_DIRECTIONS
 * headings for stable control. All tuning lives in BALANCE_CONFIG.INPUT_TOUCH.
 *
 * Merge behavior: like the keyboard controller this class owns no input code
 * inside Player. When the stick is neutral and no pressure applies, update()
 * writes NOTHING, so a keyboard controller driving the same player keeps full
 * authority (MatchScene runs keyboard first, touch second). No Button C: the
 * spec allows it only if playtests prove necessity.
 */
export class TouchInput implements IPlayerController {
  private player?: Player;
  private scene?: Phaser.Scene;
  private context?: PassContext;
  private readonly cfg: TouchCfg = BALANCE_CONFIG.INPUT_TOUCH;
  /** Internal clock (ms), advanced by update(); button presses default to it. */
  private clockMs = 0;
  /** Raw stick deflection in units of STICK_RADIUS_PX (clamped to magnitude 1). */
  private stickTarget = { x: 0, y: 0 };
  /** EMA-filtered stick deflection; the intent is derived from this. */
  private stickFiltered = { x: 0, y: 0 };
  /** Buffered action (Button A) press state — mirrors the keyboard controller. */
  private actionDownAt: number | null = null;
  private actionConsumed = false;
  private actionHeld = false;
  /** Buffered shot (Button B) press state — mirrors the keyboard controller. */
  private shotDownAt: number | null = null;
  private shotDownInRadius = false;
  /**
   * Playtest final (directional passing): stick heading held at Button-A
   * press time — a quick buffered tap aims with it even if the stick recenters
   * before the release. The stick vector at pass time IS the aim.
   */
  private aimAtPress: Point | null = null;
  /** Touch widgets are built once; attach() retargets the player on swaps. */
  private widgetsBuilt = false;
  private widgets: PinnableHud[] = [];
  private stickThumb?: PinnableHud;
  private capturedPointerId: number | null = null;
  private lastPin: { zoom: number; viewW: number; viewH: number } | null = null;

  /** MatchScene wires ball/teammate providers once in create. */
  public setContext(context: PassContext): void {
    this.context = context;
  }

  public attach(scene: Phaser.Scene, player: Player): void {
    this.scene = scene;
    this.player = player;
    if (!this.widgetsBuilt) {
      this.buildWidgets();
    }
  }

  /**
   * Current movement intent: filtered stick deflection after dead-zone and
   * heading quantization. Zero when the stick rests inside the dead-zone.
   * Pure read of the filter state (Phaser-free, unit-testable).
   */
  public getStickIntent(): Point {
    const fx = this.stickFiltered.x;
    const fy = this.stickFiltered.y;
    if (Math.hypot(fx, fy) < this.cfg.STICK_DEAD_ZONE) {
      return { x: 0, y: 0 };
    }
    const step = (Math.PI * 2) / this.cfg.STICK_DIRECTIONS;
    const quantized = Math.round(Math.atan2(fy, fx) / step) * step;
    return { x: Math.cos(quantized), y: Math.sin(quantized) };
  }

  /**
   * Feeds raw stick deflection (fraction of STICK_RADIUS_PX per axis).
   * The Phaser stick zone calls this from pointer drag; tests call it directly.
   */
  public setStick(x: number, y: number): void {
    const mag = Math.hypot(x, y);
    if (mag > 1) {
      this.stickTarget = { x: x / mag, y: y / mag };
    } else {
      this.stickTarget = { x, y };
    }
  }

  /** Button A down: opens the contextual-action window (pass or pressure). */
  public pressActionDown(nowMs: number = this.clockMs): void {
    this.actionDownAt = nowMs;
    this.actionConsumed = false;
    this.actionHeld = true;
    const intent = this.getStickIntent();
    this.aimAtPress = intent.x !== 0 || intent.y !== 0 ? { ...intent } : null;
  }

  /**
   * Button A up: inside INPUT.BUFFER_MS with the ball in pickup radius this
   * fires the contextual pass; otherwise the press only meant pressure.
   */
  public pressActionUp(nowMs: number = this.clockMs): void {
    this.actionHeld = false;
    if (this.actionDownAt === null || this.actionConsumed) {
      return;
    }
    const elapsed = nowMs - this.actionDownAt;
    this.actionDownAt = null;
    if (elapsed > BALANCE_CONFIG.INPUT.BUFFER_MS) {
      return;
    }
    this.actionConsumed = true;
    if (this.ballDistance() > BALANCE_CONFIG.INPUT.PASS_PICKUP_RADIUS_PX) {
      // Keyboard parity (AGENTS.md section 33): without the ball the action
      // button is the pressure/tackle attempt — Batch B slide-tackle clip.
      this.player?.startTackle();
      return;
    }
    const target = this.pickAimedPassTarget() ?? this.pickPassTarget();
    if (target) {
      this.player?.passTo(target);
    }
  }

  /**
   * Playtest final: directional pass — the stick heading at pass time (or
   * the press-time snapshot for buffered taps) picks the best receiver inside
   * the aim cone, weighted by distance + openness. Neutral stick returns null
   * so the caller falls back to the forward-cone auto-choice.
   */
  public pickAimedPassTarget(): Point | null {
    const player = this.player;
    const ctx = this.context;
    if (!player || !ctx) {
      return null;
    }
    const intent = this.getStickIntent();
    const aim = intent.x !== 0 || intent.y !== 0 ? intent : this.aimAtPress;
    if (!aim) {
      return null;
    }
    return chooseAimedPassTarget(
      { x: player.sprite.x, y: player.sprite.y },
      aim,
      ctx.getTeammates(),
      ctx.getOpponents?.() ?? [],
    );
  }

  /** Button B down: starts the charge and samples ball proximity at press. */
  public pressShotDown(nowMs: number = this.clockMs): void {
    this.shotDownAt = nowMs;
    this.shotDownInRadius = this.ballDistance() <= BALANCE_CONFIG.INPUT.PASS_PICKUP_RADIUS_PX;
    this.player?.startCharge();
  }

  /**
   * Button B up: same release gate as the keyboard — fires when the ball is
   * in radius at release (or was at press for quick buffered taps), cancels
   * the charge otherwise. Power clamps inside Player (PLAYER_MAX_CHARGE_MS).
   */
  public pressShotUp(nowMs: number = this.clockMs): void {
    const player = this.player;
    if (!player || !player.isChargingNow()) {
      this.shotDownAt = null;
      return;
    }
    if (!this.context) {
      this.shotDownAt = null;
      player.releaseCharge();
      return;
    }
    const inRadiusNow = this.ballDistance() <= BALANCE_CONFIG.INPUT.PASS_PICKUP_RADIUS_PX;
    const elapsed = this.shotDownAt === null ? Infinity : nowMs - this.shotDownAt;
    this.shotDownAt = null;
    const bufferedTap =
      elapsed <= BALANCE_CONFIG.INPUT.BUFFER_MS && (inRadiusNow || this.shotDownInRadius);
    if (inRadiusNow || bufferedTap) {
      player.releaseCharge();
    } else {
      player.cancelCharge();
    }
    this.shotDownInRadius = false;
  }

  /**
   * Pressure intent: Button A held while the ball is out of pickup radius.
   * Observable for HUD/tests; update() turns it into a chase only when the
   * stick is neutral (an explicit stick deflection always wins).
   */
  public isPressing(): boolean {
    return this.actionHeld && this.ballDistance() > BALANCE_CONFIG.INPUT.PASS_PICKUP_RADIUS_PX;
  }

  /** Forward-most teammate inside the forward pass cone and max range. */
  public pickPassTarget(): Point | null {
    const player = this.player;
    const ctx = this.context;
    if (!player || !ctx) {
      return null;
    }
    return choosePassTarget(
      { x: player.sprite.x, y: player.sprite.y },
      ctx.getTeammates(),
      ctx.attackDir ?? 1,
      BALANCE_CONFIG.INPUT,
    );
  }

  public update(dtMs: number): void {
    const player = this.player;
    if (!player) {
      return;
    }
    this.clockMs += dtMs;
    const alpha = this.cfg.STICK_FILTER_ALPHA;
    this.stickFiltered.x += alpha * (this.stickTarget.x - this.stickFiltered.x);
    this.stickFiltered.y += alpha * (this.stickTarget.y - this.stickFiltered.y);

    const intent = this.getStickIntent();
    if (intent.x !== 0 || intent.y !== 0) {
      player.move(intent);
      return;
    }
    // No stick: Button-A pressure chases the ball; otherwise write nothing so
    // a keyboard controller sharing this player keeps full authority.
    if (this.isPressing()) {
      const ball = this.context?.getBallPos();
      if (ball) {
        player.move({ x: ball.x - player.sprite.x, y: ball.y - player.sprite.y });
      }
    }
  }

  /**
   * Pins every touch widget to fixed screen slots (same counter-scaling as
   * the rest of the HUD). MatchScene calls this once after attach().
   */
  public pinWidgets(zoom: number, viewW: number, viewH: number): void {
    this.lastPin = { zoom, viewW, viewH };
    for (const widget of this.widgets) {
      pinHudObject(widget, this.screenX(widget), this.screenY(widget), zoom, viewW, viewH);
    }
  }

  /** Distance from the controlled player to the ball, or Infinity if unknown. */
  private ballDistance(): number {
    const player = this.player;
    const ball = this.context?.getBallPos();
    if (!player || !ball) {
      return Infinity;
    }
    return Math.hypot(ball.x - player.sprite.x, ball.y - player.sprite.y);
  }

  // ---------------------------------------------------------------- widgets

  private screenX(widget: PinnableHud): number {
    if (widget === this.stickThumb) {
      return this.cfg.STICK_CENTER_X + this.stickFiltered.x * this.cfg.STICK_RADIUS_PX;
    }
    return this.widgetSlot(widget).x;
  }

  private screenY(widget: PinnableHud): number {
    if (widget === this.stickThumb) {
      return this.cfg.STICK_CENTER_Y + this.stickFiltered.y * this.cfg.STICK_RADIUS_PX;
    }
    return this.widgetSlot(widget).y;
  }

  private widgetSlot(widget: PinnableHud): Point {
    return (widget as unknown as { __slot?: Point }).__slot ?? { x: 0, y: 0 };
  }

  private trackWidget(widget: PinnableHud, slotX: number, slotY: number): void {
    (widget as unknown as { __slot?: Point }).__slot = { x: slotX, y: slotY };
    this.widgets.push(widget);
  }

  private isTouchScene(): boolean {
    const sys = (this.scene as unknown as {
      sys?: { game?: { device?: { input?: { touch?: unknown } } } };
    } | undefined)?.sys;
    return sys?.game?.device?.input?.touch === true;
  }

  private widgetFactory(): WidgetFactory | null {
    const add = (this.scene as unknown as { add?: unknown } | undefined)?.add as
      | WidgetFactory
      | undefined;
    if (!add || typeof add.zone !== 'function' || typeof add.circle !== 'function') {
      return null;
    }
    const inputPlugin = (this.scene as unknown as { input?: unknown } | undefined)?.input as
      | Phaser.Input.InputPlugin
      | undefined;
    if (!inputPlugin || typeof inputPlugin.on !== 'function') {
      return null;
    }
    return add;
  }

  private inputPlugin(): Phaser.Input.InputPlugin | null {
    const plugin = (this.scene as unknown as { input?: unknown } | undefined)?.input as
      | Phaser.Input.InputPlugin
      | undefined;
    return plugin ?? null;
  }

  private buildWidgets(): void {
    if (!this.isTouchScene()) {
      return;
    }
    const add = this.widgetFactory();
    if (!add) {
      return;
    }
    const cfg = this.cfg;
    this.widgetsBuilt = true;

    // Virtual stick: a fixed base (landscape bottom-left safe corner) with a
    // thumb that follows the drag; the hit zone covers the full deflection.
    const stickZone = add.zone(
      cfg.STICK_CENTER_X,
      cfg.STICK_CENTER_Y,
      cfg.STICK_RADIUS_PX * 2,
      cfg.STICK_RADIUS_PX * 2,
    );
    stickZone.setInteractive();
    stickZone.setDepth(cfg.WIDGET_DEPTH);
    const stickBase = add.circle(
      cfg.STICK_CENTER_X,
      cfg.STICK_CENTER_Y,
      cfg.STICK_RADIUS_PX,
      cfg.STICK_BASE_COLOR,
      cfg.STICK_BASE_ALPHA,
    );
    stickBase.setDepth(cfg.WIDGET_DEPTH);
    const thumb = add.circle(
      cfg.STICK_CENTER_X,
      cfg.STICK_CENTER_Y,
      cfg.STICK_THUMB_RADIUS_PX,
      cfg.STICK_THUMB_COLOR,
      cfg.STICK_THUMB_ALPHA,
    );
    thumb.setDepth(cfg.WIDGET_DEPTH);
    this.stickThumb = thumb;
    this.trackWidget(stickZone, cfg.STICK_CENTER_X, cfg.STICK_CENTER_Y);
    this.trackWidget(stickBase, cfg.STICK_CENTER_X, cfg.STICK_CENTER_Y);
    this.trackWidget(thumb, cfg.STICK_CENTER_X, cfg.STICK_CENTER_Y);

    stickZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.capturedPointerId = pointer.id;
      this.updateDrag(pointer);
      const input = this.inputPlugin();
      input?.off('pointermove', this.handlePointerMove);
      input?.on('pointermove', this.handlePointerMove);
      input?.once('pointerup', this.handlePointerUp);
    });

    // Buttons A (contextual) and B (shoot) on the bottom-right safe corner.
    this.buildButton(
      add,
      'A',
      cfg.BUTTON_A_X,
      cfg.BUTTON_A_Y,
      cfg.BUTTON_A_COLOR,
      () => this.pressActionDown(),
      () => this.pressActionUp(),
    );
    this.buildButton(
      add,
      'B',
      cfg.BUTTON_B_X,
      cfg.BUTTON_B_Y,
      cfg.BUTTON_B_COLOR,
      () => this.pressShotDown(),
      () => this.pressShotUp(),
    );
  }

  private buildButton(
    add: WidgetFactory,
    label: string,
    slotX: number,
    slotY: number,
    color: number,
    onDown: () => void,
    onUp: () => void,
  ): void {
    const cfg = this.cfg;
    const zone = add.zone(slotX, slotY, cfg.BUTTON_RADIUS_PX * 2, cfg.BUTTON_RADIUS_PX * 2);
    zone.setInteractive();
    zone.setDepth(cfg.WIDGET_DEPTH);
    const face = add.circle(slotX, slotY, cfg.BUTTON_RADIUS_PX, color, cfg.BUTTON_ALPHA);
    face.setDepth(cfg.WIDGET_DEPTH);
    const text = add.text(slotX, slotY, label, {
      fontFamily: 'monospace',
      fontSize: cfg.BUTTON_LABEL_FONT_SIZE,
      color: cfg.BUTTON_LABEL_COLOR,
    });
    text.setOrigin(0.5);
    text.setDepth(cfg.WIDGET_DEPTH);
    this.trackWidget(zone, slotX, slotY);
    this.trackWidget(face, slotX, slotY);
    this.trackWidget(text, slotX, slotY);
    zone.on('pointerdown', () => onDown());
    zone.on('pointerup', () => onUp());
    zone.on('pointerout', () => onUp());
  }

  private handlePointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.id === this.capturedPointerId) {
      this.updateDrag(pointer);
    }
  };

  private handlePointerUp = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.id !== this.capturedPointerId) {
      return;
    }
    this.capturedPointerId = null;
    this.setStick(0, 0);
    this.inputPlugin()?.off('pointermove', this.handlePointerMove);
    this.refreshThumb();
  };

  private updateDrag(pointer: { x: number; y: number }): void {
    const cfg = this.cfg;
    this.setStick(
      (pointer.x - cfg.STICK_CENTER_X) / cfg.STICK_RADIUS_PX,
      (pointer.y - cfg.STICK_CENTER_Y) / cfg.STICK_RADIUS_PX,
    );
    this.refreshThumb();
  }

  private refreshThumb(): void {
    const thumb = this.stickThumb;
    const pin = this.lastPin;
    if (!thumb || !pin) {
      return;
    }
    pinHudObject(
      thumb,
      this.cfg.STICK_CENTER_X + this.stickFiltered.x * this.cfg.STICK_RADIUS_PX,
      this.cfg.STICK_CENTER_Y + this.stickFiltered.y * this.cfg.STICK_RADIUS_PX,
      pin.zoom,
      pin.viewW,
      pin.viewH,
    );
  }
}
