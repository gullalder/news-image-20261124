import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

// Serve the frozen artwork; rendering tools are deliberately unnecessary at run time.
const artwork = readFileSync(new URL('entry.png', import.meta.url));
const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (artwork.length > 1048576 || artwork.length < 45) {
  throw new Error('Artwork must fit within the one MiB PNG limit');
}
if (!artwork.subarray(0, 8).equals(pngMagic)) {
  throw new Error('Artwork is not a PNG');
}
if (artwork.toString('ascii', 12, 16) !== 'IHDR' ||
    artwork.readUInt32BE(16) !== 1024 || artwork.readUInt32BE(20) !== 1024) {
  throw new Error('Artwork must have a 1024 by 1024 PNG header');
}
// Check every chunk, including its CRC, rather than trusting a header alone.
function checksum(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
let offset = 8;
let ended = false;
const compressed: Buffer[] = [];
while (offset < artwork.length) {
  if (offset + 12 > artwork.length) throw new Error('Truncated PNG chunk');
  const length = artwork.readUInt32BE(offset);
  const boundary = offset + 12 + length;
  if (boundary > artwork.length) throw new Error('PNG chunk exceeds file');
  const kind = artwork.toString('ascii', offset + 4, offset + 8);
  if (checksum(artwork.subarray(offset + 4, boundary - 4)) !== artwork.readUInt32BE(boundary - 4)) {
    throw new Error(`Invalid checksum in ${kind}`);
  }
  if (kind === 'IDAT') compressed.push(artwork.subarray(offset + 8, boundary - 4));
  offset = boundary;
  if (kind === 'IEND') {
    if (length !== 0 || offset !== artwork.length) throw new Error('Invalid PNG ending');
    ended = true;
    break;
  }
}
const channels = artwork[25] === 2 ? 3 : artwork[25] === 6 ? 4 : 0;
if (!ended || !compressed.length || !channels || artwork[24] !== 8 || artwork[28] !== 0) {
  throw new Error('Expected a complete, non-interlaced RGB or RGBA PNG');
}
const stride = 1024 * channels + 1;
const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: stride * 1024 });
if (pixels.length !== stride * 1024) throw new Error('PNG pixel data has the wrong length');
for (let row = 0; row < 1024; row++) {
  if (pixels[row * stride] > 4) throw new Error('Invalid PNG scanline filter');
}
const destination = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
mkdirSync(destination, { recursive: true });
writeFileSync(resolve(destination, 'entry.png'), artwork);
