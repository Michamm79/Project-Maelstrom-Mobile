/**
 * Procedural icon rendering.
 *
 * MaterialSO.icon is a Sprite in Unity; there are no sprites here, so every
 * material declares a `shape` key and gets drawn from paths instead. That keeps
 * the repo free of binary art while still giving ~40 visually distinct items,
 * and it means new content is playable the moment it is added to the JSON.
 *
 * Every shape draws centred on the origin, inside a box of roughly `size`.
 */

export type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------- colour utils

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const int = Number.parseInt(full, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** amount > 0 lightens, < 0 darkens. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const mix = (c: number) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))
      .toString(16)
      .padStart(2, '0');
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------- path helpers

function poly(ctx: Ctx, points: readonly [number, number][], s: number): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    const px = x * s;
    const py = y * s;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

function circle(ctx: Ctx, x: number, y: number, r: number, s: number): void {
  ctx.beginPath();
  ctx.arc(x * s, y * s, r * s, 0, Math.PI * 2);
}

function bar(ctx: Ctx, x: number, y: number, w: number, h: number, s: number, radius = 0.05): void {
  const rx = radius * s;
  ctx.beginPath();
  ctx.roundRect((x - w / 2) * s, (y - h / 2) * s, w * s, h * s, rx);
}

/**
 * Internal edges inside a shape.
 *
 * The stroke is a heavily darkened tint of the fill rather than the fill barely
 * darkened: handheld sprite work keeps one near-black line everywhere and lets
 * the fill carry the hue, which is most of why that art stays readable at
 * thumbnail size. The old -0.45 left, say, a pale stone outlined in grey.
 */
function fillStroke(ctx: Ctx, fill: string, s: number, lineScale = 0.075): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, lineScale * s);
  ctx.strokeStyle = shade(fill, -0.68);
  ctx.stroke();
}

// ---------------------------------------------------------------- shapes

type ShapeFn = (ctx: Ctx, color: string, s: number) => void;

const shapes: Record<string, ShapeFn> = {
  rock: (ctx, c, s) => {
    poly(ctx, [[-0.42, 0.1], [-0.3, -0.28], [0.06, -0.42], [0.38, -0.16], [0.4, 0.18], [0.1, 0.42], [-0.26, 0.36]], s);
    fillStroke(ctx, c, s);
    poly(ctx, [[-0.18, -0.1], [0.02, -0.24], [0.16, -0.04], [-0.02, 0.08]], s);
    ctx.fillStyle = withAlpha(shade(c, 0.28), 0.7);
    ctx.fill();
  },

  ore: (ctx, c, s) => {
    shapes.rock?.(ctx, shade(c, -0.25), s);
    ctx.fillStyle = shade(c, 0.42);
    for (const [x, y, r] of [[-0.14, -0.06, 0.08], [0.12, 0.1, 0.06], [0.06, -0.22, 0.05], [-0.2, 0.18, 0.045]] as const) {
      circle(ctx, x, y, r, s);
      ctx.fill();
    }
  },

  lump: (ctx, c, s) => {
    poly(ctx, [[-0.38, 0.16], [-0.24, -0.2], [0.1, -0.34], [0.36, -0.06], [0.3, 0.26], [-0.06, 0.38]], s);
    fillStroke(ctx, c, s);
  },

  stick: (ctx, c, s) => {
    ctx.save();
    ctx.rotate(-0.68);
    bar(ctx, 0, 0, 0.16, 0.86, s, 0.08);
    fillStroke(ctx, c, s);
    ctx.strokeStyle = withAlpha(shade(c, -0.3), 0.8);
    ctx.lineWidth = Math.max(1, 0.03 * s);
    ctx.beginPath();
    ctx.moveTo(-0.02 * s, -0.3 * s);
    ctx.lineTo(-0.02 * s, 0.28 * s);
    ctx.stroke();
    ctx.restore();
  },

  leaf: (ctx, c, s) => {
    ctx.beginPath();
    ctx.moveTo(0, -0.46 * s);
    ctx.quadraticCurveTo(0.4 * s, -0.06 * s, 0, 0.46 * s);
    ctx.quadraticCurveTo(-0.4 * s, -0.06 * s, 0, -0.46 * s);
    ctx.closePath();
    fillStroke(ctx, c, s);
    ctx.strokeStyle = withAlpha(shade(c, -0.35), 0.9);
    ctx.lineWidth = Math.max(1, 0.035 * s);
    ctx.beginPath();
    ctx.moveTo(0, -0.4 * s);
    ctx.lineTo(0, 0.4 * s);
    ctx.stroke();
  },

  moss: (ctx, c, s) => {
    for (const [x, y, r] of [[-0.2, 0.08, 0.22], [0.16, 0.02, 0.2], [-0.02, -0.16, 0.24], [0.22, 0.2, 0.15], [-0.24, -0.14, 0.14]] as const) {
      circle(ctx, x, y, r, s);
      fillStroke(ctx, shade(c, x * 0.4), s, 0.035);
    }
  },

  shard: (ctx, c, s) => {
    poly(ctx, [[0, -0.48], [0.28, 0.06], [0.1, 0.46], [-0.18, 0.34], [-0.26, -0.08]], s);
    fillStroke(ctx, c, s);
    poly(ctx, [[0, -0.44], [0.2, 0.04], [0.02, 0.2]], s);
    ctx.fillStyle = withAlpha(shade(c, 0.35), 0.55);
    ctx.fill();
  },

  gem: (ctx, c, s) => {
    poly(ctx, [[0, -0.46], [0.34, -0.1], [0.2, 0.42], [-0.2, 0.42], [-0.34, -0.1]], s);
    fillStroke(ctx, c, s);
    poly(ctx, [[0, -0.46], [0.34, -0.1], [0, 0.06], [-0.34, -0.1]], s);
    ctx.fillStyle = withAlpha(shade(c, 0.45), 0.6);
    ctx.fill();
    poly(ctx, [[0, 0.06], [0.2, 0.42], [-0.2, 0.42]], s);
    ctx.fillStyle = withAlpha(shade(c, -0.2), 0.4);
    ctx.fill();
  },

  drop: (ctx, c, s) => {
    ctx.beginPath();
    ctx.moveTo(0, -0.46 * s);
    ctx.bezierCurveTo(0.36 * s, -0.02 * s, 0.34 * s, 0.44 * s, 0, 0.44 * s);
    ctx.bezierCurveTo(-0.34 * s, 0.44 * s, -0.36 * s, -0.02 * s, 0, -0.46 * s);
    ctx.closePath();
    fillStroke(ctx, c, s);
    circle(ctx, -0.1, 0.14, 0.09, s);
    ctx.fillStyle = withAlpha('#ffffff', 0.5);
    ctx.fill();
  },

  dust: (ctx, c, s) => {
    const dots: readonly [number, number, number][] = [
      [-0.26, 0.12, 0.08], [0.0, -0.06, 0.1], [0.24, 0.16, 0.075], [0.1, 0.32, 0.06],
      [-0.12, -0.3, 0.065], [0.28, -0.2, 0.055], [-0.32, -0.1, 0.05], [0.02, 0.14, 0.05],
    ];
    for (const [x, y, r] of dots) {
      circle(ctx, x, y, r, s);
      ctx.fillStyle = withAlpha(shade(c, r * 3), 0.9);
      ctx.fill();
    }
  },

  blob: (ctx, c, s) => {
    ctx.beginPath();
    ctx.ellipse(0, 0.05 * s, 0.38 * s, 0.34 * s, 0.3, 0, Math.PI * 2);
    fillStroke(ctx, c, s);
    circle(ctx, -0.12, -0.08, 0.1, s);
    ctx.fillStyle = withAlpha('#ffffff', 0.35);
    ctx.fill();
  },

  cap: (ctx, c, s) => {
    bar(ctx, 0, 0.24, 0.16, 0.4, s, 0.06);
    fillStroke(ctx, shade(c, 0.35), s);
    ctx.beginPath();
    ctx.arc(0, 0.04 * s, 0.42 * s, Math.PI, 0);
    ctx.closePath();
    fillStroke(ctx, c, s);
    ctx.fillStyle = withAlpha(shade(c, 0.5), 0.8);
    for (const [x, y, r] of [[-0.18, -0.1, 0.06], [0.1, -0.16, 0.05], [0.2, -0.02, 0.045]] as const) {
      circle(ctx, x, y, r, s);
      ctx.fill();
    }
  },

  bloom: (ctx, c, s) => {
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate((i / 6) * Math.PI * 2);
      ctx.beginPath();
      ctx.ellipse(0, -0.26 * s, 0.13 * s, 0.22 * s, 0, 0, Math.PI * 2);
      fillStroke(ctx, c, s, 0.035);
      ctx.restore();
    }
    circle(ctx, 0, 0, 0.15, s);
    fillStroke(ctx, shade(c, 0.45), s, 0.035);
  },

  bone: (ctx, c, s) => {
    ctx.save();
    ctx.rotate(-0.5);
    bar(ctx, 0, 0, 0.16, 0.6, s, 0.08);
    fillStroke(ctx, c, s);
    for (const y of [-0.32, 0.32]) {
      for (const x of [-0.11, 0.11]) {
        circle(ctx, x, y, 0.13, s);
        fillStroke(ctx, c, s, 0.045);
      }
    }
    ctx.restore();
  },

  coil: (ctx, c, s) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = 0.13 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const angle = t * Math.PI * 5;
      const radius = (0.1 + t * 0.3) * s;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * 0.75;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = withAlpha(shade(c, 0.4), 0.55);
    ctx.lineWidth = 0.045 * s;
    ctx.stroke();
  },

  chain: (ctx, c, s) => {
    for (const [x, y] of [[-0.22, -0.2], [0, 0], [0.22, 0.2]] as const) {
      ctx.beginPath();
      ctx.ellipse(x * s, y * s, 0.17 * s, 0.12 * s, 0.7, 0, Math.PI * 2);
      ctx.lineWidth = 0.09 * s;
      ctx.strokeStyle = c;
      ctx.stroke();
      ctx.lineWidth = 0.03 * s;
      ctx.strokeStyle = shade(c, -0.4);
      ctx.stroke();
    }
  },

  plate: (ctx, c, s) => {
    bar(ctx, 0, 0, 0.74, 0.34, s, 0.06);
    fillStroke(ctx, c, s);
    bar(ctx, 0, -0.06, 0.6, 0.1, s, 0.04);
    ctx.fillStyle = withAlpha(shade(c, 0.4), 0.55);
    ctx.fill();
  },

  brick: (ctx, c, s) => {
    bar(ctx, 0, 0, 0.8, 0.44, s, 0.04);
    fillStroke(ctx, c, s);
    ctx.strokeStyle = withAlpha(shade(c, -0.35), 0.8);
    ctx.lineWidth = 0.03 * s;
    ctx.beginPath();
    ctx.moveTo(-0.4 * s, 0);
    ctx.lineTo(0.4 * s, 0);
    ctx.moveTo(-0.1 * s, -0.22 * s);
    ctx.lineTo(-0.1 * s, 0);
    ctx.moveTo(0.14 * s, 0);
    ctx.lineTo(0.14 * s, 0.22 * s);
    ctx.stroke();
  },

  ingot: (ctx, c, s) => {
    poly(ctx, [[-0.42, 0.2], [-0.3, -0.16], [0.3, -0.16], [0.42, 0.2]], s);
    fillStroke(ctx, c, s);
    bar(ctx, 0, -0.2, 0.6, 0.1, s, 0.03);
    ctx.fillStyle = shade(c, 0.35);
    ctx.fill();
  },

  ring: (ctx, c, s) => {
    ctx.beginPath();
    ctx.arc(0, 0, 0.34 * s, 0, Math.PI * 2);
    ctx.lineWidth = 0.12 * s;
    ctx.strokeStyle = c;
    ctx.stroke();
    ctx.lineWidth = 0.035 * s;
    ctx.strokeStyle = shade(c, -0.4);
    ctx.stroke();
  },

  wrap: (ctx, c, s) => {
    ctx.beginPath();
    ctx.moveTo(-0.44 * s, -0.2 * s);
    ctx.quadraticCurveTo(0, 0.1 * s, 0.44 * s, -0.2 * s);
    ctx.lineTo(0.44 * s, 0.06 * s);
    ctx.quadraticCurveTo(0, 0.36 * s, -0.44 * s, 0.06 * s);
    ctx.closePath();
    fillStroke(ctx, c, s);
  },

  flame: (ctx, c, s) => {
    ctx.beginPath();
    ctx.moveTo(0, -0.48 * s);
    ctx.bezierCurveTo(0.3 * s, -0.16 * s, 0.32 * s, 0.24 * s, 0, 0.44 * s);
    ctx.bezierCurveTo(-0.32 * s, 0.24 * s, -0.3 * s, -0.16 * s, 0, -0.48 * s);
    ctx.closePath();
    fillStroke(ctx, c, s);
    ctx.beginPath();
    ctx.moveTo(0, -0.16 * s);
    ctx.bezierCurveTo(0.16 * s, 0.02 * s, 0.16 * s, 0.24 * s, 0, 0.34 * s);
    ctx.bezierCurveTo(-0.16 * s, 0.24 * s, -0.16 * s, 0.02 * s, 0, -0.16 * s);
    ctx.closePath();
    ctx.fillStyle = withAlpha('#ffe9a8', 0.85);
    ctx.fill();
  },

  torch: (ctx, c, s) => {
    ctx.save();
    ctx.translate(0, 0.14 * s);
    bar(ctx, 0, 0.14, 0.14, 0.56, s, 0.05);
    fillStroke(ctx, '#8a5f34', s);
    ctx.restore();
    ctx.save();
    ctx.translate(0, -0.2 * s);
    ctx.scale(0.72, 0.72);
    shapes.flame?.(ctx, c, s);
    ctx.restore();
  },

  lantern: (ctx, c, s) => {
    bar(ctx, 0, 0.02, 0.5, 0.6, s, 0.08);
    fillStroke(ctx, shade(c, -0.55), s);
    bar(ctx, 0, 0.02, 0.32, 0.42, s, 0.04);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -0.3 * s, 0.16 * s, Math.PI, 0);
    ctx.lineWidth = 0.06 * s;
    ctx.strokeStyle = shade(c, -0.5);
    ctx.stroke();
  },

  kiln: (ctx, c, s) => {
    poly(ctx, [[-0.42, 0.4], [-0.32, -0.24], [0, -0.42], [0.32, -0.24], [0.42, 0.4]], s);
    fillStroke(ctx, c, s);
    ctx.beginPath();
    ctx.arc(0, 0.22 * s, 0.16 * s, Math.PI, 0);
    ctx.lineTo(0.16 * s, 0.4 * s);
    ctx.lineTo(-0.16 * s, 0.4 * s);
    ctx.closePath();
    ctx.fillStyle = '#ff9d3c';
    ctx.fill();
    ctx.strokeStyle = withAlpha(shade(c, -0.4), 0.7);
    ctx.lineWidth = 0.03 * s;
    ctx.beginPath();
    ctx.moveTo(-0.36 * s, -0.04 * s);
    ctx.lineTo(0.36 * s, -0.04 * s);
    ctx.stroke();
  },

  flask: (ctx, c, s) => {
    ctx.beginPath();
    ctx.moveTo(-0.1 * s, -0.42 * s);
    ctx.lineTo(-0.1 * s, -0.14 * s);
    ctx.lineTo(-0.34 * s, 0.3 * s);
    ctx.quadraticCurveTo(-0.34 * s, 0.44 * s, -0.18 * s, 0.44 * s);
    ctx.lineTo(0.18 * s, 0.44 * s);
    ctx.quadraticCurveTo(0.34 * s, 0.44 * s, 0.34 * s, 0.3 * s);
    ctx.lineTo(0.1 * s, -0.14 * s);
    ctx.lineTo(0.1 * s, -0.42 * s);
    ctx.closePath();
    ctx.fillStyle = withAlpha('#dff2fb', 0.35);
    ctx.fill();
    ctx.lineWidth = Math.max(1, 0.05 * s);
    ctx.strokeStyle = '#cfe8f2';
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = c;
    ctx.fillRect(-0.4 * s, 0.06 * s, 0.8 * s, 0.4 * s);
    ctx.restore();
    bar(ctx, 0, -0.44, 0.28, 0.1, s, 0.03);
    fillStroke(ctx, '#b08a5c', s, 0.03);
  },

  axe: (ctx, c, s) => {
    ctx.save();
    ctx.rotate(0.42);
    bar(ctx, 0, 0.1, 0.13, 0.78, s, 0.05);
    fillStroke(ctx, '#8a5f34', s);
    ctx.beginPath();
    ctx.moveTo(-0.04 * s, -0.42 * s);
    ctx.quadraticCurveTo(0.42 * s, -0.34 * s, 0.36 * s, 0.02 * s);
    ctx.quadraticCurveTo(0.2 * s, -0.06 * s, -0.04 * s, -0.06 * s);
    ctx.closePath();
    fillStroke(ctx, c, s);
    ctx.restore();
  },

  hammer: (ctx, c, s) => {
    ctx.save();
    ctx.rotate(0.42);
    bar(ctx, 0, 0.14, 0.13, 0.72, s, 0.05);
    fillStroke(ctx, '#8a5f34', s);
    bar(ctx, 0, -0.3, 0.62, 0.3, s, 0.05);
    fillStroke(ctx, c, s);
    ctx.restore();
  },

  blade: (ctx, c, s) => {
    ctx.save();
    ctx.rotate(0.6);
    poly(ctx, [[-0.06, -0.46], [0.12, -0.34], [0.1, 0.08], [-0.06, 0.14]], s);
    fillStroke(ctx, c, s);
    bar(ctx, 0.02, 0.28, 0.14, 0.34, s, 0.05);
    fillStroke(ctx, '#7a5330', s);
    ctx.restore();
  },

  sword: (ctx, c, s) => {
    ctx.save();
    ctx.rotate(0.72);
    poly(ctx, [[0, -0.5], [0.11, -0.34], [0.11, 0.16], [-0.11, 0.16], [-0.11, -0.34]], s);
    fillStroke(ctx, c, s);
    bar(ctx, 0, 0.2, 0.46, 0.1, s, 0.03);
    fillStroke(ctx, shade(c, -0.35), s, 0.035);
    bar(ctx, 0, 0.36, 0.13, 0.26, s, 0.05);
    fillStroke(ctx, '#6b4a2c', s, 0.035);
    ctx.restore();
  },

  spear: (ctx, c, s) => {
    ctx.save();
    ctx.rotate(0.72);
    bar(ctx, 0, 0.16, 0.1, 0.68, s, 0.04);
    fillStroke(ctx, '#8a5f34', s, 0.04);
    poly(ctx, [[0, -0.5], [0.16, -0.26], [0, -0.14], [-0.16, -0.26]], s);
    fillStroke(ctx, c, s);
    ctx.restore();
  },

  bow: (ctx, c, s) => {
    ctx.beginPath();
    ctx.arc(-0.1 * s, 0, 0.42 * s, -1.05, 1.05);
    ctx.lineWidth = 0.1 * s;
    ctx.strokeStyle = c;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0.26 * s, -0.36 * s);
    ctx.lineTo(0.26 * s, 0.36 * s);
    ctx.lineWidth = 0.035 * s;
    ctx.strokeStyle = '#e8dcc0';
    ctx.stroke();
  },

  lens: (ctx, c, s) => {
    circle(ctx, 0, 0, 0.4, s);
    ctx.fillStyle = withAlpha(c, 0.55);
    ctx.fill();
    ctx.lineWidth = 0.08 * s;
    ctx.strokeStyle = shade(c, -0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-0.1 * s, -0.1 * s, 0.16 * s, Math.PI * 0.9, Math.PI * 1.9);
    ctx.lineWidth = 0.05 * s;
    ctx.strokeStyle = withAlpha('#ffffff', 0.75);
    ctx.stroke();
  },

  mirror: (ctx, c, s) => {
    ctx.beginPath();
    ctx.ellipse(0, -0.06 * s, 0.32 * s, 0.36 * s, 0, 0, Math.PI * 2);
    fillStroke(ctx, c, s);
    ctx.beginPath();
    ctx.moveTo(-0.16 * s, 0.12 * s);
    ctx.lineTo(0.1 * s, -0.26 * s);
    ctx.lineWidth = 0.06 * s;
    ctx.strokeStyle = withAlpha('#ffffff', 0.7);
    ctx.stroke();
    bar(ctx, 0, 0.36, 0.12, 0.24, s, 0.04);
    fillStroke(ctx, shade(c, -0.5), s, 0.035);
  },

  core: (ctx, c, s) => {
    circle(ctx, 0, 0, 0.42, s);
    ctx.fillStyle = withAlpha(c, 0.28);
    ctx.fill();
    circle(ctx, 0, 0, 0.3, s);
    ctx.lineWidth = 0.05 * s;
    ctx.strokeStyle = shade(c, 0.2);
    ctx.stroke();
    circle(ctx, 0, 0, 0.16, s);
    fillStroke(ctx, c, s, 0.04);
  },

  rune: (ctx, c, s) => {
    poly(ctx, [[-0.34, -0.38], [0.34, -0.38], [0.4, 0.28], [0, 0.44], [-0.4, 0.28]], s);
    fillStroke(ctx, shade(c, -0.5), s);
    ctx.strokeStyle = c;
    ctx.lineWidth = 0.07 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-0.14 * s, -0.22 * s);
    ctx.lineTo(0.14 * s, -0.22 * s);
    ctx.moveTo(0, -0.22 * s);
    ctx.lineTo(0, 0.24 * s);
    ctx.moveTo(-0.16 * s, 0.06 * s);
    ctx.lineTo(0, -0.06 * s);
    ctx.moveTo(0.16 * s, 0.06 * s);
    ctx.lineTo(0, -0.06 * s);
    ctx.stroke();
  },

  orb: (ctx, c, s) => {
    circle(ctx, 0, 0, 0.44, s);
    ctx.fillStyle = withAlpha(c, 0.22);
    ctx.fill();
    circle(ctx, 0, 0, 0.32, s);
    const gradient = ctx.createRadialGradient(-0.1 * s, -0.12 * s, 0.02 * s, 0, 0, 0.34 * s);
    gradient.addColorStop(0, shade(c, 0.6));
    gradient.addColorStop(1, shade(c, -0.35));
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.lineWidth = 0.04 * s;
    ctx.strokeStyle = withAlpha('#ffffff', 0.5);
    ctx.stroke();
  },

  star: (ctx, c, s) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const radius = (i % 2 === 0 ? 0.48 : 0.16) * s;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    fillStroke(ctx, c, s);
    circle(ctx, 0, 0, 0.1, s);
    ctx.fillStyle = withAlpha('#ffffff', 0.8);
    ctx.fill();
  },
};

// ---------------------------------------------------------------- presentation

/**
 * Everything above draws a flat silhouette. The passes below are applied to all
 * of them at once, so that shapes written weeks apart still read as one item
 * set: one light from the upper left, a specular hotspot where it lands, and a
 * shadow cast away from it.
 *
 * Doing this here rather than inside each shape is the whole point - any shape
 * added later inherits the lighting for free, and re-colouring or replacing the
 * material list changes nothing about how items are lit.
 */

/** The composited box, in units of `size`. The extra margin is the shadow's. */
const PAD = 1.25;

// Offset far enough to clear the keyline. At 0.03 the outline, which is 0.026
// wide and fully opaque, sat on top of the shadow and hid it entirely.
const SHADOW_OFFSET = 0.062;
const SHADOW_BLUR = 0.022;
const SHADOW_ALPHA = 0.36;
const BEVEL = 0.022;
/** Keyline thickness, as a fraction of the rendered box. */
const OUTLINE_WIDTH = 0.026;
/** Tinted toward violet rather than pure black, the way GBA-era darks are. */
const OUTLINE_INK = '#191024';

/**
 * Icons are identical every frame, so they are rendered once and blitted after
 * that. Drops in the world would otherwise re-run their paths sixty times a
 * second for no visual difference.
 */
const CACHE_LIMIT = 320;
const cache = new Map<string, HTMLCanvasElement>();

function makeCanvas(px: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  return canvas;
}

/**
 * A band along one edge of a silhouette: the shape, minus a copy of itself
 * nudged away from that edge. Subtracting the shape from itself is what makes
 * this work for all 38 shapes without any of them knowing about it - a bevel
 * hand-drawn per shape would be 38 chances to draw it inconsistently.
 */
function edgeBand(
  mask: HTMLCanvasElement, px: number, dx: number, dy: number, tint: string,
): HTMLCanvasElement | null {
  const band = makeCanvas(px);
  const ctx = band?.getContext('2d');
  if (!band || !ctx) return null;

  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(mask, dx, dy);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, px, px);
  return band;
}

/**
 * The silhouette grown outward by `width` and filled flat.
 *
 * Drawn as a ring of offset copies: enough of them that a diagonal edge comes
 * out even rather than scalloped, few enough to stay cheap. The result is
 * cached with the icon, so this runs once per shape, colour and pixel size.
 */
function outlineOf(mask: HTMLCanvasElement, px: number, width: number): HTMLCanvasElement | null {
  const ring = makeCanvas(px);
  const ctx = ring?.getContext('2d');
  if (!ring || !ctx) return null;

  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    ctx.drawImage(mask, Math.cos(angle) * width, Math.sin(angle) * width);
  }
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = OUTLINE_INK;
  ctx.fillRect(0, 0, px, px);
  return ring;
}

function renderIcon(shape: string, color: string, px: number): HTMLCanvasElement | null {
  const mask = makeCanvas(px);
  const maskCtx = mask?.getContext('2d');
  const art = makeCanvas(px);
  const artCtx = art?.getContext('2d');
  const out = makeCanvas(px);
  const outCtx = out?.getContext('2d');
  if (!mask || !maskCtx || !art || !artCtx || !out || !outCtx) return null;

  // Shapes measure their line widths against the size they are handed, so hand
  // them device pixels and keep the transform to a plain recentring.
  const artSize = px / PAD;
  const half = px / 2;
  maskCtx.translate(half, half);
  maskCtx.lineJoin = 'round';
  (shapes[shape] ?? shapes.rock)?.(maskCtx, color, artSize);

  artCtx.drawImage(mask, 0, 0);

  // `source-atop` keeps every pass inside whatever the shape actually drew, so a
  // thin shape like `chain` is lit as precisely as a solid one like `brick`.
  artCtx.globalCompositeOperation = 'source-atop';

  const light = artCtx.createLinearGradient(
    half - artSize * 0.5, half - artSize * 0.55,
    half + artSize * 0.5, half + artSize * 0.55,
  );
  // Banded, not smooth. Two flat steps with a hard edge between them is what
  // reads as pixel art; a continuous ramp reads as a 3D render of a pebble.
  light.addColorStop(0, 'rgba(255,246,224,0.34)');
  light.addColorStop(0.34, 'rgba(255,246,224,0.34)');
  light.addColorStop(0.35, 'rgba(255,255,255,0)');
  light.addColorStop(0.62, 'rgba(0,0,0,0)');
  light.addColorStop(0.63, 'rgba(18,12,30,0.3)');
  light.addColorStop(1, 'rgba(18,12,30,0.42)');
  artCtx.fillStyle = light;
  artCtx.fillRect(0, 0, px, px);

  const spec = artCtx.createRadialGradient(
    half - artSize * 0.2, half - artSize * 0.26, 0,
    half - artSize * 0.2, half - artSize * 0.26, artSize * 0.46,
  );
  spec.addColorStop(0, 'rgba(255,255,255,0.3)');
  spec.addColorStop(0.55, 'rgba(255,255,255,0.07)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  artCtx.fillStyle = spec;
  artCtx.fillRect(0, 0, px, px);

  // The bevel: lit edge facing the light, occluded edge facing away from it.
  const bevel = Math.max(1, px * BEVEL);
  const rim = edgeBand(mask, px, bevel, bevel, '#fff6e2');
  const occlusion = edgeBand(mask, px, -bevel, -bevel, '#0e0a18');
  const blurs = typeof artCtx.filter === 'string';
  if (blurs) artCtx.filter = `blur(${bevel * 0.6}px)`;
  if (rim) {
    artCtx.globalAlpha = 0.6;
    artCtx.drawImage(rim, 0, 0);
  }
  if (occlusion) {
    artCtx.globalAlpha = 0.5;
    artCtx.drawImage(occlusion, 0, 0);
  }
  if (blurs) artCtx.filter = 'none';
  artCtx.globalAlpha = 1;

  // The drop shadow is the silhouette again: `brightness(0)` keeps the alpha and
  // throws the colour away, which beats approximating 38 outlines by hand.
  if (blurs) {
    outCtx.filter = `blur(${Math.max(0.75, px * SHADOW_BLUR)}px) brightness(0)`;
    outCtx.globalAlpha = SHADOW_ALPHA;
    outCtx.drawImage(mask, px * SHADOW_OFFSET, px * SHADOW_OFFSET * 1.3);
    outCtx.filter = 'none';
    outCtx.globalAlpha = 1;
  }

  // The outline that makes it read as sprite work: one dark keyline around the
  // whole silhouette, whatever that silhouette turned out to be. Dilating the
  // mask gets it for all 38 shapes at once - the alternative is authoring an
  // outline path per shape and keeping 38 of them in sync by hand.
  const ring = outlineOf(mask, px, Math.max(1.1, px * OUTLINE_WIDTH));
  if (ring) outCtx.drawImage(ring, 0, 0);

  outCtx.drawImage(art, 0, 0);

  return out;
}

/**
 * How many device pixels the box covers once the caller's transform is applied,
 * so an icon on a 3x phone is rendered at 3x rather than scaled up from 1x.
 * Quantised, or a camera that drifts by a hair would fill the cache.
 */
function devicePixels(ctx: Ctx, box: number): number {
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const scale = t ? Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d)) : 1;
  return Math.min(512, Math.max(24, Math.ceil((box * scale) / 8) * 8));
}

/**
 * Draw a material icon centred on the current origin.
 * An unknown shape key falls back to a plain rock rather than drawing nothing,
 * so new content is always visible even before it has art direction.
 */
export function drawIcon(ctx: Ctx, shape: string, color: string, size: number): void {
  const box = size * PAD;
  const key = `${shape}|${color}|${devicePixels(ctx, box)}`;

  let icon = cache.get(key);
  if (!icon) {
    const rendered = renderIcon(shape, color, devicePixels(ctx, box));
    if (!rendered) {
      // Nothing to composite into - no DOM, or a context we cannot get. Draw the
      // bare shape so the icon is still right, just unlit.
      ctx.save();
      ctx.lineJoin = 'round';
      (shapes[shape] ?? shapes.rock)?.(ctx, color, size);
      ctx.restore();
      return;
    }
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, rendered);
    icon = rendered;
  }

  ctx.drawImage(icon, -box / 2, -box / 2, box, box);
}

/** The margin drawIcon reserves around the art, in units of `size`. */
export const iconPad = PAD;

export const knownShapes = Object.keys(shapes);
