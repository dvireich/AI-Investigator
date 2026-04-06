/**
 * Process docs/icon.png into:
 * - frontend/public/icon-circle.png  (128×128 circular header logo)
 * - frontend/public/favicon.png      (32×32 circular favicon)
 * - scripts/icon.ico                 (multi-size ICO for desktop exe)
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function circleSvg(s) {
    const r = s / 2;
    return Buffer.from(
        `<svg width="${s}" height="${s}"><circle cx="${r}" cy="${r}" r="${r}" fill="white"/></svg>`
    );
}

async function main() {
    // Accept .png or .jpg source
    let src = path.join(ROOT, 'docs', 'icon.png');
    if (!fs.existsSync(src)) {
        src = path.join(ROOT, 'docs', 'icon.jpg');
    }
    if (!fs.existsSync(src)) {
        console.error('No docs/icon.png or docs/icon.jpg found');
        process.exit(1);
    }
    const meta = await sharp(src).metadata();
    console.log(`Source: ${meta.width}×${meta.height}, ${meta.format}`);

    // Center-crop to square
    const size = Math.min(meta.width, meta.height);
    const left = Math.floor((meta.width - size) / 2);
    const top = Math.floor((meta.height - size) / 2);
    console.log(`Cropping to ${size}×${size} from (${left}, ${top})`);

    const squareBuf = await sharp(src)
        .extract({ left, top, width: size, height: size })
        .toBuffer();

    // 1. Header icon: 256×256 circular PNG (displayed at 48–56px with 2× retina)
    await sharp(squareBuf)
        .resize(256, 256)
        .composite([{ input: circleSvg(256), blend: 'dest-in' }])
        .png()
        .toFile(path.join(ROOT, 'frontend', 'public', 'icon-circle.png'));
    console.log('✓ frontend/public/icon-circle.png');

    // 2. Favicon: 32×32 circular PNG
    await sharp(squareBuf)
        .resize(32, 32)
        .composite([{ input: circleSvg(32), blend: 'dest-in' }])
        .png()
        .toFile(path.join(ROOT, 'frontend', 'public', 'favicon.png'));
    console.log('✓ frontend/public/favicon.png');

    // 3. ICO file with multiple sizes
    const icoSizes = [16, 32, 48, 64, 128, 256];
    const icoBufs = [];
    for (const s of icoSizes) {
        const buf = await sharp(squareBuf)
            .resize(s, s)
            .composite([{ input: circleSvg(s), blend: 'dest-in' }])
            .png()
            .toBuffer();
        icoBufs.push({ size: s, buf });
        console.log(`  ICO layer: ${s}×${s} (${buf.length} bytes)`);
    }

    // Build ICO container (PNG-encoded entries)
    const numImages = icoBufs.length;
    const headerLen = 6 + numImages * 16;
    let offset = headerLen;
    const entries = [];
    for (const { size: s, buf } of icoBufs) {
        entries.push({ size: s, buf, offset });
        offset += buf.length;
    }

    const ico = Buffer.alloc(offset);
    ico.writeUInt16LE(0, 0);          // reserved
    ico.writeUInt16LE(1, 2);          // type: icon
    ico.writeUInt16LE(numImages, 4);  // count

    entries.forEach(({ size: s, buf, offset: off }, i) => {
        const pos = 6 + i * 16;
        ico.writeUInt8(s < 256 ? s : 0, pos);
        ico.writeUInt8(s < 256 ? s : 0, pos + 1);
        ico.writeUInt8(0, pos + 2);
        ico.writeUInt8(0, pos + 3);
        ico.writeUInt16LE(1, pos + 4);
        ico.writeUInt16LE(32, pos + 6);
        ico.writeUInt32LE(buf.length, pos + 8);
        ico.writeUInt32LE(off, pos + 12);
        buf.copy(ico, off);
    });

    fs.writeFileSync(path.join(ROOT, 'scripts', 'icon.ico'), ico);
    console.log(`✓ scripts/icon.ico (${ico.length} bytes)`);

    console.log('\nAll icons generated!');
}

main().catch(e => { console.error(e); process.exit(1); });
