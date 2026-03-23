#!/usr/bin/env node
/**
 * Generate app icon (icon.ico) from the favicon SVG.
 * Requires: npx --yes --package=sharp
 */
const fs = require('fs');
const path = require('path');

async function main() {
    let sharp;
    try {
        sharp = require('sharp');
    } catch {
        console.error('sharp not available. Install with: npm i -D sharp');
        process.exit(1);
    }

    const svgPath = path.resolve(__dirname, '..', 'frontend', 'public', 'favicon.svg');
    const outPath = path.resolve(__dirname, 'icon.ico');

    const svg = fs.readFileSync(svgPath);

    // Generate PNGs at standard ICO sizes
    const sizes = [16, 32, 48, 64, 128, 256];
    const images = [];
    for (const size of sizes) {
        const png = await sharp(svg).resize(size, size).png().toBuffer();
        images.push({ size, png });
    }

    // Build ICO file (uncompressed BMP format for compatibility)
    const ico = buildIco(images);
    fs.writeFileSync(outPath, ico);
    console.log(`Created ${path.relative(process.cwd(), outPath)} (${sizes.join(', ')}px)`);
}

function buildIco(images) {
    const numImages = images.length;
    const headerSize = 6;
    const entrySize = 16;
    const dirSize = headerSize + numImages * entrySize;

    // Calculate offsets
    let offset = dirSize;
    const entries = images.map(({ size, png }) => {
        const entry = { size, png, offset };
        offset += png.length;
        return entry;
    });

    const totalSize = offset;
    const buf = Buffer.alloc(totalSize);

    // ICO header
    buf.writeUInt16LE(0, 0);      // reserved
    buf.writeUInt16LE(1, 2);      // type: ico
    buf.writeUInt16LE(numImages, 4);

    // Directory entries
    entries.forEach((entry, i) => {
        const pos = headerSize + i * entrySize;
        buf.writeUInt8(entry.size >= 256 ? 0 : entry.size, pos);     // width
        buf.writeUInt8(entry.size >= 256 ? 0 : entry.size, pos + 1); // height
        buf.writeUInt8(0, pos + 2);          // color palette
        buf.writeUInt8(0, pos + 3);          // reserved
        buf.writeUInt16LE(1, pos + 4);       // color planes
        buf.writeUInt16LE(32, pos + 6);      // bits per pixel
        buf.writeUInt32LE(entry.png.length, pos + 8);  // size
        buf.writeUInt32LE(entry.offset, pos + 12);     // offset
    });

    // Image data (PNG)
    entries.forEach(entry => {
        entry.png.copy(buf, entry.offset);
    });

    return buf;
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
