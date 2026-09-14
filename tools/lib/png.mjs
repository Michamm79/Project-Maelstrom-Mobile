/**
 * Minimal PNG encoder: raw RGBA -> zlib -> IHDR/IDAT/IEND.
 *
 * Shared by the icon and sprite generators so there is one implementation to
 * trust. Keeps the repo free of an image dependency for what is ultimately
 * a few hundred bytes of chunk framing.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** @param rgba Buffer of width*height*4 bytes. */
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  // Each scanline is prefixed with its filter byte; 0 = None.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Nearest-neighbour upscale, so pixel art stays crisp in a preview. */
export function scale(rgba, width, height, factor) {
  const out = Buffer.alloc(width * factor * height * factor * 4);
  const outStride = width * factor * 4;
  for (let y = 0; y < height * factor; y++) {
    const sy = Math.floor(y / factor);
    for (let x = 0; x < width * factor; x++) {
      const sx = Math.floor(x / factor);
      rgba.copy(out, y * outStride + x * 4, (sy * width + sx) * 4, (sy * width + sx) * 4 + 4);
    }
  }
  return out;
}
