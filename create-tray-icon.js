// create-tray-icon.js — Run this once with: node create-tray-icon.js
// Creates a simple 32x32 PNG tray icon programmatically
const fs = require('fs');
const path = require('path');

// Minimal 16x16 PNG in teal color (a simple colored square)
// This is a hand-crafted minimal valid PNG file
function createMinimalPNG() {
    // PNG signature
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR chunk - 16x16, 8-bit RGBA
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(16, 0);  // width
    ihdrData.writeUInt32BE(16, 4);  // height
    ihdrData.writeUInt8(8, 8);      // bit depth
    ihdrData.writeUInt8(6, 9);      // color type (RGBA)
    ihdrData.writeUInt8(0, 10);     // compression
    ihdrData.writeUInt8(0, 11);     // filter
    ihdrData.writeUInt8(0, 12);     // interlace

    const ihdr = createChunk('IHDR', ihdrData);

    // IDAT chunk - raw pixel data
    // Each row: filter byte (0) + 16 pixels * 4 bytes (RGBA)
    const rawData = Buffer.alloc(16 * (1 + 16 * 4));
    for (let y = 0; y < 16; y++) {
        const rowOffset = y * (1 + 16 * 4);
        rawData[rowOffset] = 0; // no filter
        for (let x = 0; x < 16; x++) {
            const pixOffset = rowOffset + 1 + x * 4;
            // Create a rounded parakeet-like shape
            const cx = 7.5, cy = 7.5, r = 6;
            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            if (dist <= r) {
                rawData[pixOffset] = 0;       // R
                rawData[pixOffset + 1] = 210; // G (teal)
                rawData[pixOffset + 2] = 211; // B
                rawData[pixOffset + 3] = 255; // A
            } else {
                rawData[pixOffset + 3] = 0;   // transparent
            }
        }
    }

    // Compress with zlib (deflate)
    const zlib = require('zlib');
    const compressed = zlib.deflateSync(rawData);
    const idat = createChunk('IDAT', compressed);

    // IEND chunk
    const iend = createChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);

    const typeBuffer = Buffer.from(type);
    const crcData = Buffer.concat([typeBuffer, data]);

    // CRC32
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcData), 0);

    return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

const outputPath = path.join(__dirname, 'assets', 'tray-icon.png');
fs.mkdirSync(path.join(__dirname, 'assets'), { recursive: true });
fs.writeFileSync(outputPath, createMinimalPNG());
console.log('Tray icon created at:', outputPath);
