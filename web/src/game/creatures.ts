/**
 * The three enemy tiers, drawn.
 *
 * Style is the handheld-era look the character sprite already uses: one dark
 * tinted outline, a three-tone ramp, and a silhouette that carries the meaning
 * on its own. The DESIGNS are original - canon says these are renderings of
 * hostile code rather than creatures, so each one keeps a small hard-edged
 * "wrongness" (a notch, a seam, a flat cut) that a real animal would not have.
 *
 * They used to be generic icon shapes - a blob, a bone, a blade - shared with
 * the material icons, which meant tier read only as a size difference and an
 * enemy looked like something you could pick up.
 *
 * Everything is authored in a 100-unit tall box centred on the origin, with the
 * feet at about y = +38, and scaled by the caller. Poses take a `lean` so a
 * wind-up and a recoil are the same drawing shifted rather than three sets of
 * art.
 */
import { shade, withAlpha } from './icons';

/** Outlines are tinted toward the subject rather than pure black. */
const OUTLINE = '#181024';

export interface CreaturePose {
  /** Base colour; the ramp is derived from it. */
  color: string;
  /** Height in world units. */
  size: number;
  /** Seconds, for idle motion. */
  time: number;
  /** Per-enemy offset so a group does not breathe in unison. */
  phase: number;
  /** -1 facing left, 1 facing right. */
  facing: number;
  /** 0..1 through the wind-up before a blow lands. */
  windUp: number;
  /** 0..1 through a stagger, counting down. */
  stagger: number;
  /** True while it is coming for you. */
  aggro: boolean;
  /** 0..1, white flash on being hit. */
  flash: number;
}

function fillPath(
  ctx: CanvasRenderingContext2D,
  path: (c: CanvasRenderingContext2D) => void,
  fill: string,
  lineWidth = 3.2,
): void {
  ctx.beginPath();
  path(ctx);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

/** Two hot slits. Eyes are the one part that never takes the body's colour. */
function eyes(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, hot: string): void {
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x * side, y, w, h, 0, 0, Math.PI * 2);
    ctx.fillStyle = hot;
    ctx.fill();
  }
}

/**
 * The digital seam: a flat horizontal cut across the body that slides slowly.
 * It is what keeps these reading as renderings of a process rather than animals.
 */
function seam(ctx: CanvasRenderingContext2D, pose: CreaturePose, top: number, bottom: number, width: number): void {
  const travel = ((pose.time * 14 + pose.phase * 40) % (bottom - top + 30)) - 15;
  const y = top + travel;
  if (y < top || y > bottom) return;
  ctx.fillStyle = withAlpha('#ffffff', 0.13);
  ctx.fillRect(-width / 2, y, width, 2.5);
}

// ---------------------------------------------------------------- goblin

/**
 * Tier 1. Small, hunched, no neck, ears too long for it - cheap and disposable,
 * and it has to read as that instantly at a third the size of a Scythe-bearer.
 */
function goblin(ctx: CanvasRenderingContext2D, pose: CreaturePose, mid: string, lit: string, dark: string): void {
  const hot = pose.aggro ? '#ffd166' : '#9fe870';

  // Feet first, so the body outline sits over them.
  for (const side of [-1, 1]) {
    fillPath(ctx, (c) => {
      c.moveTo(side * 7, 30);
      c.lineTo(side * 21, 30);
      c.lineTo(side * 21, 40);
      c.lineTo(side * 7, 40);
    }, dark, 2.6);
  }


  // One mass for body and head: no neck is most of the silhouette's character.
  fillPath(ctx, (c) => {
    c.moveTo(-24, 32);
    c.lineTo(-26, -8);
    c.quadraticCurveTo(-26, -34, 0, -34);
    c.quadraticCurveTo(26, -34, 26, -8);
    c.lineTo(24, 32);
  }, mid);

  // Lit band across the top of the skull.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-24, 32);
  ctx.lineTo(-26, -8);
  ctx.quadraticCurveTo(-26, -34, 0, -34);
  ctx.quadraticCurveTo(26, -34, 26, -8);
  ctx.lineTo(24, 32);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = lit;
  ctx.fillRect(-28, -36, 56, 16);
  ctx.fillStyle = dark;
  ctx.fillRect(-28, 18, 56, 20);
  seam(ctx, pose, -34, 32, 52);
  ctx.restore();

  // Ears: broad and swept back, not antennae. Drawn with real width because at
  // 40 world units a two-pixel sliver disappears entirely.
  const flick = Math.sin(pose.time * 4 + pose.phase) * 2.5;
  for (const side of [-1, 1]) {
    fillPath(ctx, (c) => {
      c.moveTo(side * 21, -26);
      c.quadraticCurveTo(side * 44, -34 + flick, side * 52, -22 + flick);
      c.quadraticCurveTo(side * 38, -18 + flick, side * 30, -6);
      c.lineTo(side * 20, -12);
    }, dark, 2.6);
    // Inner ear, so it is not one flat slab.
    ctx.beginPath();
    ctx.moveTo(side * 25, -23);
    ctx.quadraticCurveTo(side * 40, -28 + flick, side * 44, -22 + flick);
    ctx.quadraticCurveTo(side * 34, -19 + flick, side * 27, -14);
    ctx.closePath();
    ctx.fillStyle = withAlpha('#000000', 0.22);
    ctx.fill();
  }

  // Arms, outside the body outline so the silhouette has limbs in it.
  const swing = Math.sin(pose.time * 6 + pose.phase) * 3;
  for (const side of [-1, 1]) {
    fillPath(ctx, (c) => {
      c.moveTo(side * 22, -4);
      c.quadraticCurveTo(side * 35, 2 + swing, side * 33, 16 + swing);
      c.quadraticCurveTo(side * 26, 18 + swing, side * 24, 8);
    }, lit, 2.6);
  }

  eyes(ctx, 10, -18, 5.2, 6, hot);
  // A flat cut for a mouth: hard-edged rather than drawn, and small enough to
  // read as a seam in something rendered rather than a smile.
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(-7, -5, 14, 3.4);
}

// ---------------------------------------------------------------- minotaur

/**
 * Tier 2. Shoulders are the whole idea: wider than it is tall through the
 * chest, on legs that look too short to move it. Something decided you were
 * worth spending on.
 */
function minotaur(ctx: CanvasRenderingContext2D, pose: CreaturePose, mid: string, lit: string, dark: string): void {
  const hot = pose.aggro ? '#ff8a5c' : '#ffcf8a';

  for (const side of [-1, 1]) {
    fillPath(ctx, (c) => {
      c.moveTo(side * 6, 16);
      c.lineTo(side * 24, 16);
      c.lineTo(side * 22, 41);
      c.lineTo(side * 8, 41);
    }, dark, 2.8);
  }

  // Arms, heavy, hanging well past the waist.
  const swing = Math.sin(pose.time * 4.4 + pose.phase) * 2.4;
  for (const side of [-1, 1]) {
    fillPath(ctx, (c) => {
      c.moveTo(side * 30, -22);
      c.lineTo(side * 44, -6 + swing);
      c.lineTo(side * 38, 20 + swing);
      c.lineTo(side * 25, 12);
    }, mid);
  }

  // Torso: a broad wedge, widest at the shoulder.
  fillPath(ctx, (c) => {
    c.moveTo(-32, -26);
    c.lineTo(32, -26);
    c.lineTo(24, 20);
    c.lineTo(-24, 20);
  }, mid);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-32, -26);
  ctx.lineTo(32, -26);
  ctx.lineTo(24, 20);
  ctx.lineTo(-24, 20);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = lit;
  ctx.fillRect(-34, -28, 68, 12);
  ctx.fillStyle = dark;
  ctx.fillRect(-34, 8, 68, 16);
  seam(ctx, pose, -26, 20, 64);
  ctx.restore();

  // Head: set low between the shoulders, muzzle forward.
  fillPath(ctx, (c) => {
    c.moveTo(-17, -46);
    c.lineTo(17, -46);
    c.lineTo(19, -28);
    c.lineTo(-19, -28);
  }, lit);

  // Horns: out and up, and thick enough to survive being 50 units tall. This is
  // the part that identifies a Minotaur across a field.
  for (const side of [-1, 1]) {
    fillPath(ctx, (c) => {
      c.moveTo(side * 14, -45);
      c.quadraticCurveTo(side * 40, -50, side * 44, -72);
      c.quadraticCurveTo(side * 36, -70, side * 33, -58);
      c.quadraticCurveTo(side * 28, -44, side * 13, -36);
    }, '#efe4cf', 2.8);
  }

  eyes(ctx, 8, -38, 4.2, 4.6, hot);
  // A ring, because it is wearing something: this one was equipped.
  ctx.strokeStyle = '#d9c38a';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(0, -24, 5.5, 0, Math.PI * 2);
  ctx.stroke();

  // Plate across the chest, hard-edged: issued, not grown.
  fillPath(ctx, (c) => {
    c.moveTo(-20, -14);
    c.lineTo(20, -14);
    c.lineTo(16, 6);
    c.lineTo(-16, 6);
  }, withAlpha('#0c0812', 0.34), 2.2);
  ctx.fillStyle = withAlpha('#ffffff', 0.13);
  ctx.fillRect(-16, -11, 32, 3);
}

// ---------------------------------------------------------------- scythe

/**
 * Tier 3. Tall and narrow where the others are squat, the blade reading before
 * the body does. If one is here, you are no longer being handled by a process.
 */
function scytheBearer(
  ctx: CanvasRenderingContext2D,
  pose: CreaturePose,
  mid: string,
  lit: string,
  dark: string,
): void {
  const hot = pose.aggro ? '#ff5d7e' : '#c98bb0';
  const drift = Math.sin(pose.time * 2.2 + pose.phase) * 2.4;

  // The blade, behind the body, on the facing side. A long thin crescent: at a
  // distance this is the whole identification.
  ctx.save();
  ctx.translate(pose.facing * 30, -6 + drift);
  ctx.rotate(pose.facing * (-0.18 + pose.windUp * 0.5));
  fillPath(ctx, (c) => {
    c.moveTo(0, 34);
    c.lineTo(3, -50);
    c.lineTo(pose.facing * 30, -62);
    c.quadraticCurveTo(pose.facing * 12, -44, pose.facing * 7, -46);
    c.lineTo(6, -50);
    c.lineTo(6, 34);
  }, '#d9dee8', 2.6);
  ctx.restore();

  // Cloak: no legs at all, a tapering column with a ragged hem.
  fillPath(ctx, (c) => {
    c.moveTo(0, -48);
    c.lineTo(22, -18);
    c.lineTo(28, 36);
    c.lineTo(16, 30);
    c.lineTo(8, 38);
    c.lineTo(0, 30);
    c.lineTo(-8, 38);
    c.lineTo(-16, 30);
    c.lineTo(-28, 36);
    c.lineTo(-22, -18);
  }, mid);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, -48);
  ctx.lineTo(22, -18);
  ctx.lineTo(28, 36);
  ctx.lineTo(-28, 36);
  ctx.lineTo(-22, -18);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = dark;
  ctx.fillRect(-30, 6, 60, 34);
  ctx.fillStyle = lit;
  ctx.fillRect(-30, -50, 16, 90);
  seam(ctx, pose, -48, 36, 56);
  ctx.restore();

  // Folds, so the cloak is cloth rather than a cut-out.
  ctx.strokeStyle = withAlpha('#000000', 0.26);
  ctx.lineWidth = 2;
  for (const at of [-9, 2, 12]) {
    ctx.beginPath();
    ctx.moveTo(at, -14);
    ctx.lineTo(at * 1.7, 32);
    ctx.stroke();
  }

  // The hood, and nothing inside it but the light.
  fillPath(ctx, (c) => {
    c.moveTo(0, -62);
    c.quadraticCurveTo(20, -58, 18, -34);
    c.lineTo(-18, -34);
    c.quadraticCurveTo(-20, -58, 0, -62);
  }, dark, 2.8);

  ctx.fillStyle = '#0a0710';
  ctx.beginPath();
  ctx.ellipse(0, -42, 12, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  eyes(ctx, 5, -42, 3, 4.4, hot);
}

// ------------------------------------------------------------------ imp

/**
 * Tier 1, and the smallest thing in the game.
 *
 * Read at a glance as "not worth a swing": barely a body, oversized head,
 * spindly limbs, and it leans forward because it is always arriving. The
 * silhouette has to separate from a Goblin at a third of a screen away, so it
 * is built on the opposite proportions - a Goblin is a wide hunched mass with
 * no neck, this is narrow and top-heavy.
 */
function imp(ctx: CanvasRenderingContext2D, pose: CreaturePose, mid: string, lit: string, dark: string): void {
  const hot = pose.aggro ? '#ffd166' : '#ffb27a';

  for (const side of [-1, 1]) {
    fillPath(ctx, (c) => {
      c.moveTo(side * 3, 16);
      c.lineTo(side * 11, 26);
      c.lineTo(side * 15, 26);
      c.lineTo(side * 7, 12);
    }, dark, 2.2);
  }

  // Narrow body, leaning into the run.
  fillPath(ctx, (c) => {
    c.moveTo(-9, 18);
    c.lineTo(-11, -6);
    c.quadraticCurveTo(-10, -16, 2, -16);
    c.quadraticCurveTo(13, -16, 12, -4);
    c.lineTo(9, 18);
  }, mid, 2.6);

  // Head, too big for it, which is the whole read.
  fillPath(ctx, (c) => {
    c.moveTo(-15, -16);
    c.quadraticCurveTo(-18, -38, 2, -38);
    c.quadraticCurveTo(20, -38, 17, -16);
  }, lit, 2.6);

  // Two horns, swept back.
  for (const side of [-1, 1]) {
    fillPath(ctx, (c) => {
      c.moveTo(side * 8, -34);
      c.quadraticCurveTo(side * 20, -46, side * 13, -50);
      c.lineTo(side * 6, -36);
    }, dark, 2);
  }

  seam(ctx, pose, -34, 16, 30);
  eyes(ctx, 6, -26, 3.2, 3.8, hot);
}

// ----------------------------------------------------------------- wisp

/**
 * Tier 1, and the one that does not come to you.
 *
 * No legs at all - it hangs. That is deliberate: the player has to be able to
 * tell at a glance that walking away from this one does not work the way it
 * works on everything else, and "it has no feet" says that before any bolt
 * has been fired.
 */
function wisp(ctx: CanvasRenderingContext2D, pose: CreaturePose, mid: string, lit: string, dark: string): void {
  const hot = pose.aggro ? '#ffe9a8' : '#bfe8ff';
  const drift = Math.sin(pose.time * 1.8 + pose.phase) * 3;

  ctx.save();
  ctx.translate(0, drift);

  // A trailing veil under it, so the lack of legs reads as hovering rather
  // than as art that is missing something.
  fillPath(ctx, (c) => {
    c.moveTo(-14, 2);
    c.quadraticCurveTo(-9, 24, 0, 34);
    c.quadraticCurveTo(9, 24, 14, 2);
  }, dark, 2.4);

  // The lantern body.
  fillPath(ctx, (c) => {
    c.moveTo(-17, 0);
    c.quadraticCurveTo(-21, -26, 0, -30);
    c.quadraticCurveTo(21, -26, 17, 0);
    c.quadraticCurveTo(9, 8, 0, 8);
    c.quadraticCurveTo(-9, 8, -17, 0);
  }, mid, 2.8);

  // A bright core, which is also the thing that lights up before it fires.
  const charge = 0.35 + pose.windUp * 0.65;
  ctx.fillStyle = withAlpha(hot, charge);
  ctx.beginPath();
  ctx.ellipse(0, -13, 8 + pose.windUp * 3, 9 + pose.windUp * 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Two hooks either side, so it is not a featureless blob at small sizes.
  for (const side of [-1, 1]) {
    fillPath(ctx, (c) => {
      c.moveTo(side * 16, -14);
      c.quadraticCurveTo(side * 28, -18, side * 24, -2);
      c.lineTo(side * 17, -6);
    }, lit, 2);
  }

  seam(ctx, pose, -28, 6, 36);
  eyes(ctx, 5, -19, 2.4, 3, hot);
  ctx.restore();
}

// ---------------------------------------------------------------- golem

/**
 * Tier 2, and the widest thing in the game.
 *
 * Built out of separated slabs with gaps between them, because the armour has
 * to be visible: the player needs a reason to believe their fists are the
 * wrong tool BEFORE they have spent ten seconds proving it. Squat and wide, so
 * it never reads as a Minotaur even in silhouette.
 */
function golem(ctx: CanvasRenderingContext2D, pose: CreaturePose, mid: string, lit: string, dark: string): void {
  const hot = pose.aggro ? '#ffd166' : '#9fb4c8';

  // Two heavy feet, set wide.
  for (const side of [-1, 1]) {
    fillPath(ctx, (c) => {
      c.moveTo(side * 10, 24);
      c.lineTo(side * 32, 24);
      c.lineTo(side * 32, 40);
      c.lineTo(side * 10, 40);
    }, dark, 3);
  }

  // The torso slab.
  fillPath(ctx, (c) => {
    c.moveTo(-34, 26);
    c.lineTo(-38, -16);
    c.lineTo(-24, -30);
    c.lineTo(24, -30);
    c.lineTo(38, -16);
    c.lineTo(34, 26);
  }, mid, 3.4);

  // Plates, with the gaps left showing - this is the armour, drawn.
  for (const [y, w] of [[-18, 52], [-4, 58], [10, 50]] as const) {
    fillPath(ctx, (c) => {
      c.moveTo(-w / 2, y);
      c.lineTo(w / 2, y);
      c.lineTo(w / 2 - 4, y + 9);
      c.lineTo(-w / 2 + 4, y + 9);
    }, lit, 2.2);
  }

  // A head that barely clears the shoulders.
  fillPath(ctx, (c) => {
    c.moveTo(-15, -30);
    c.lineTo(-13, -44);
    c.lineTo(13, -44);
    c.lineTo(15, -30);
  }, lit, 2.8);

  seam(ctx, pose, -44, 24, 70);
  eyes(ctx, 6, -37, 3, 2.6, hot);
}

// ----------------------------------------------------------------- lich

/**
 * Tier 3, and the one that is not looking at you.
 *
 * Tall, narrow and robed, with its arms out - a posture of working on
 * something else, which is exactly what it is doing. The ring above its hands
 * is the mending, and it is drawn whether or not it is currently mending so
 * that the player learns the shape before they learn what it does.
 */
function lich(ctx: CanvasRenderingContext2D, pose: CreaturePose, mid: string, lit: string, dark: string): void {
  const hot = pose.aggro ? '#ffd166' : '#d2b3ff';

  // The robe: no feet, a wide hem, and a narrow waist.
  fillPath(ctx, (c) => {
    c.moveTo(-30, 40);
    c.quadraticCurveTo(-16, 4, -13, -18);
    c.lineTo(13, -18);
    c.quadraticCurveTo(16, 4, 30, 40);
  }, mid, 3.2);

  // Sleeves reaching forward, which is where the ring sits.
  for (const side of [-1, 1]) {
    fillPath(ctx, (c) => {
      c.moveTo(side * 11, -14);
      c.quadraticCurveTo(side * 30, -10, side * 27, 6);
      c.lineTo(side * 17, 2);
      c.quadraticCurveTo(side * 16, -8, side * 9, -6);
    }, dark, 2.6);
  }

  // A high cowl rather than a face.
  fillPath(ctx, (c) => {
    c.moveTo(-14, -18);
    c.quadraticCurveTo(-18, -50, 0, -54);
    c.quadraticCurveTo(18, -50, 14, -18);
  }, lit, 2.8);

  ctx.fillStyle = '#0a0710';
  ctx.beginPath();
  ctx.ellipse(0, -34, 10, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // The working ring. Brightens and turns while it is actually mending.
  const work = Math.min(1, pose.windUp * 2 + 0.25);
  ctx.save();
  ctx.translate(0, 4);
  ctx.rotate(pose.time * 1.4 + pose.phase);
  ctx.strokeStyle = withAlpha(hot, 0.35 + work * 0.45);
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 6, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  seam(ctx, pose, -50, 38, 46);
  eyes(ctx, 4.5, -34, 2.6, 3.4, hot);
}

// ---------------------------------------------------------------- entry

const DRAW = {
  goblin,
  imp,
  wisp,
  minotaur,
  golem,
  scythe_bearer: scytheBearer,
  lich,
} as const;

export type CreatureId = keyof typeof DRAW;

export function isCreature(id: string): id is CreatureId {
  return id in DRAW;
}

/**
 * Draw one creature at the origin.
 *
 * Pose handles all three states off one set of art: the wind-up leans it back
 * and swells it slightly (a tell you can read before the blow), a stagger leans
 * it away and squashes it, and a hit washes the ramp to white.
 */
export function drawCreature(ctx: CanvasRenderingContext2D, id: CreatureId, pose: CreaturePose): void {
  const scale = pose.size / 100;
  const breath = 1 + Math.sin(pose.time * 3 + pose.phase) * 0.018;

  // Wind-up pulls back away from the target; the recoil goes the other way.
  const lean = pose.windUp * -7 + pose.stagger * 9;
  const squash = 1 - pose.stagger * 0.12 + pose.windUp * 0.06;

  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(pose.facing * lean, 0);
  ctx.scale(pose.facing, 1);
  ctx.scale(1 / squash, squash * breath);

  const base = pose.flash > 0 ? '#ffffff' : pose.color;
  const mid = base;
  const lit = pose.flash > 0 ? '#ffffff' : shade(base, 0.3);
  const dark = pose.flash > 0 ? '#f0f0f0' : shade(base, -0.34);

  DRAW[id](ctx, pose, mid, lit, dark);
  ctx.restore();
}
