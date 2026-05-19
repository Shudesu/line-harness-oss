import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const sharp = require(path.join(root, 'node_modules/.pnpm/node_modules/sharp'));
const sourceDir = path.join(root, 'apps/worker/public/aonisai/cafe');

const images = [
  { src: 'cafe-hero-source.jpg', out: 'cafe-hero.webp', width: 1400, quality: 76 },
  { src: 'カフェ外.jpg', out: 'cafe-exterior.webp', width: 1200, quality: 74 },
  { src: 'カフェ内部.jpg', out: 'cafe-interior.webp', width: 900, quality: 72 },
  { src: 'ソファー席.jpg', out: 'cafe-sofa.webp', width: 900, quality: 72 },
  { src: 'ブルーベリーピザ.jpg', out: 'blueberry-pizza.webp', width: 720, quality: 72 },
  { src: 'マルゲリータ.jpg', out: 'margherita.webp', width: 720, quality: 72 },
  { src: 'サラダピザ.jpg', out: 'salad-pizza.webp', width: 720, quality: 72 },
  { src: 'アイス_72.jpg', out: 'blueberry-ice.webp', width: 640, quality: 70 },
  { src: 'フィズ_72.jpg', out: 'blueberry-fizz.webp', width: 640, quality: 70 },
  { src: 'ブルーベリースムージー.jpg', out: 'blueberry-smoothie.webp', width: 640, quality: 70 },
  { src: 'コーヒー_72.jpg', out: 'coffee.webp', width: 640, quality: 70 },
  { src: 'ブルーベリージャム.jpg', out: 'blueberry-jam.webp', width: 640, quality: 70 },
  { src: 'ピザ3種類.jpg', out: 'pizza-collection.webp', width: 900, quality: 72 },
  { src: 'ポテト_72.jpg', out: 'potato.webp', width: 640, quality: 70 },
  { src: 'チキンナゲット_72.jpg', out: 'chicken-nugget.webp', width: 640, quality: 70 },
];

for (const image of images) {
  const input = path.join(sourceDir, image.src);
  const output = path.join(sourceDir, image.out);
  if (!existsSync(input)) {
    console.log(`skip missing source: ${image.src}`);
    continue;
  }
  await sharp(input)
    .rotate()
    .resize({ width: image.width, withoutEnlargement: true })
    .webp({ quality: image.quality, effort: 5 })
    .toFile(output);
  const metadata = await sharp(output).metadata();
  console.log(`${image.out}: ${metadata.width}x${metadata.height}`);
}
