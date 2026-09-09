// Preserve animation timing and pale lavender artwork; remove neutral white background regions.
// Usage: node scripts/prepare-thinking-gif.mjs <source.gif> [crop-width:height:x:y]
import { spawnSync } from 'node:child_process';
const source = process.argv[2];
if (!source) throw new Error('A source GIF path is required');
const width = 480, height = 288, fps = 25;
function run(args, input) {
  const result = spawnSync('ffmpeg', ['-v', 'error', ...args], {
    input, maxBuffer: 512 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr?.toString() || 'ffmpeg failed');
  return result.stdout;
}
const crop = process.argv[3];
if (crop && !/^\d+:\d+:\d+:\d+$/.test(crop)) throw new Error('Invalid crop');
const filter = `${crop ? `crop=${crop},` : ''}scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=white,fps=${fps}`;
const raw = run(['-i', source, '-vf', filter,
  '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
const pixels = width * height, stride = pixels * 4;
if (raw.length % stride) throw new Error('Incomplete decoded frame');
for (let offset = 0; offset < raw.length; offset += stride) {
  const visited = new Uint8Array(pixels), queue = new Int32Array(pixels);
  let head = 0, tail = 0;
  const visit = (p) => {
    if (visited[p]) return;
    visited[p] = 1;
    const i = offset + p * 4;
    const r = raw[i], g = raw[i + 1], b = raw[i + 2];
    // The white background is neutral; the artwork's near-white areas are lavender.
    if (Math.min(r, g, b) >= 242 && Math.max(r, g, b) - Math.min(r, g, b) <= 5) {
      raw[i + 3] = 0;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
  const drain = () => { while (head < tail) {
    const p = queue[head++], x = p % width;
    if (x) visit(p - 1);
    if (x + 1 < width) visit(p + 1);
    if (p >= width) visit(p - width);
    if (p + width < pixels) visit(p + width);
  } };
  drain();
  // Enclosed background (e.g. between the person's legs) is not border-connected.
  // Keep tiny white highlights, but remove large neutral-white islands.
  for (let p = 0; p < pixels; p++) {
    if (visited[p]) continue;
    head = 0; tail = 0;
    visit(p); drain();
    if (tail < 80) for (let j = 0; j < tail; j++) raw[offset + queue[j] * 4 + 3] = 255;
  }
}
run(['-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`,
  '-r', String(fps), '-i', 'pipe:0', '-filter_complex',
  '[0:v]split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=diff[p];[b][p]paletteuse=alpha_threshold=128:dither=sierra2_4a',
  '-loop', '0', 'public/my-tasks-thinking.gif'], raw);
run(['-y', '-i', 'public/my-tasks-thinking.gif', '-frames:v', '1', 'public/my-tasks-thinking-still.png']);
console.log(`Processed ${raw.length / stride} frames at ${fps} fps with transparent background.`);
