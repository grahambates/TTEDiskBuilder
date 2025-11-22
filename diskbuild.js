#!/usr/bin/env node

import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);

// ANSI color codes
const colors = {
    red: '\x1b[31m',
    reset: '\x1b[0m'
};

// Packing methods enum
const PackingMethod = {
    None: 0,
    Shrinkler: 1,
    ZX0: 2,
    LZ: 3,
    Deflate: 4,
    Trim: 5
};

// ============================================================================
// ASCII Art Banner
// ============================================================================
function printBanner() {
    console.log('.__.  .__.  .______.______________________ .');
    console.log('\\\\ |__|  |__|  ___//                      \\\\');
    console.log('| ____/ ____/ ___/:    THE TWITCH ELITE   //');
    console.log('|  |__|  |__|  |  |      ..PRESENTS..     \\\\');
    console.log('|  |  |  |  | :|  |                       //');
    console.log('>> |  | :|  |  `  >>  Disk Builder - JS  << ');
    console.log('| :|  |  |  |_____|                       \\\\');
    console.log('|  |  |  `  |::.tHE                       //');
    console.log('|  `  |_____|tWITCH                       \\\\');
    console.log('//____|::::::.eLITE::.________________fZn_//');
    console.log();
}

// ============================================================================
// BigEndian Writer - Accumulates binary data in big-endian format
// ============================================================================
class BigEndianWriter {
    constructor() {
        this.buffers = [];
        this.length = 0;
    }

    write(buffer) {
        this.buffers.push(buffer);
        this.length += buffer.length;
    }

    writeAscii(text, length) {
        const buffer = Buffer.alloc(length);
        buffer.write(text, 0, Math.min(text.length, length), 'ascii');
        this.write(buffer);
    }

    writeInt32(value) {
        const buffer = Buffer.allocUnsafe(4);
        buffer.writeInt32BE(value, 0);
        this.write(buffer);
    }

    toBuffer() {
        return Buffer.concat(this.buffers);
    }

    get position() {
        return this.length;
    }
}

// ============================================================================
// Bootblock Checksum Calculator
// ============================================================================
function bootBlockCheckSum(bootBlock) {
    // Clear existing checksum
    bootBlock[4] = 0;
    bootBlock[5] = 0;
    bootBlock[6] = 0;
    bootBlock[7] = 0;

    let checksum = 0;
    let precsum = 0;

    // Calculate checksum over 1024 bytes (0x100 = 256 longs)
    for (let i = 0; i < 0x100; i++) {
        precsum = checksum;
        const longValue = (bootBlock[i * 4] << 24) |
                         (bootBlock[(i * 4) + 1] << 16) |
                         (bootBlock[(i * 4) + 2] << 8) |
                         bootBlock[(i * 4) + 3];

        checksum = (checksum + longValue) >>> 0; // Keep as unsigned 32-bit
        if (checksum < precsum) {
            checksum++;
        }
    }

    checksum = (~checksum) >>> 0; // Invert and keep as unsigned

    // Write checksum back to bootblock in big-endian
    bootBlock[4] = (checksum >>> 24) & 0xFF;
    bootBlock[5] = (checksum >>> 16) & 0xFF;
    bootBlock[6] = (checksum >>> 8) & 0xFF;
    bootBlock[7] = checksum & 0xFF;
}

// ============================================================================
// External Packer Functions
// ============================================================================
async function shrinklerPack(data) {
    const infile = path.join(tmpdir(), `shrink_in_${Date.now()}_${Math.random()}`);
    const outfile = path.join(tmpdir(), `shrink_out_${Date.now()}_${Math.random()}`);

    try {
        await fs.writeFile(infile, data);
        await execFileAsync('shrinkler', ['-d', infile, outfile]);
        const packed = await fs.readFile(outfile);
        return packed;
    } finally {
        await fs.unlink(infile).catch(() => {});
        await fs.unlink(outfile).catch(() => {});
    }
}

async function zx0Pack(data) {
    const infile = path.join(tmpdir(), `zx0_in_${Date.now()}_${Math.random()}`);
    const outfile = path.join(tmpdir(), `zx0_out_${Date.now()}_${Math.random()}`);

    try {
        await fs.writeFile(infile, data);
        await execFileAsync('salvador', [infile, outfile]);
        const packed = await fs.readFile(outfile);
        return packed;
    } finally {
        await fs.unlink(infile).catch(() => {});
        await fs.unlink(outfile).catch(() => {});
    }
}

async function deflatePack(data) {
    const infile = path.join(tmpdir(), `deflate_in_${Date.now()}_${Math.random()}`);
    const outfile = infile + '.deflate';

    try {
        await fs.writeFile(infile, data);
        await execFileAsync('zopfli', ['--deflate', infile]);
        const packed = await fs.readFile(outfile);
        return packed;
    } finally {
        await fs.unlink(infile).catch(() => {});
        await fs.unlink(outfile).catch(() => {});
    }
}

function trim(data) {
    let tail = 0;
    let pos = data.length - 1;

    while (pos > 0 && data[pos] === 0x00) {
        tail++;
        pos--;
    }

    return data.slice(0, data.length - tail);
}

// ============================================================================
// Disk Item Processing
// ============================================================================
async function loadDiskItem(diskItem, sourcePath) {
    const sourceFile = path.join(sourcePath, diskItem.Filename);
    let data = await fs.readFile(sourceFile);

    const fileTag = `${diskItem.FileID} - [${diskItem.Filename}]`;
    console.log(`Packing ${diskItem.PackingMethod} - ${fileTag}`);

    diskItem.FileSize = data.length;

    switch (diskItem.PackingMethod) {
        case PackingMethod.Shrinkler:
            data = await shrinklerPack(data);
            break;
        case PackingMethod.ZX0:
            data = await zx0Pack(data);
            break;
        case PackingMethod.Deflate:
            data = await deflatePack(data);
            break;
        case PackingMethod.None:
            break;
        case PackingMethod.Trim:
            data = trim(data);
            break;
        default:
            throw new Error(`Invalid packing method for ${fileTag}`);
    }

    diskItem.PackedData = data;
    diskItem.PackedSize = data.length;
    console.log(`Finished - ${fileTag}`);
}

// ============================================================================
// Merge Data
// ============================================================================
function mergeData(diskItems) {
    const writer = new BigEndianWriter();
    let pos = 0;

    for (const diskItem of diskItems) {
        diskItem.DiskLocation = pos;
        writer.write(diskItem.PackedData);
        pos += diskItem.PackedSize;
    }

    return writer.toBuffer();
}

// ============================================================================
// Make Disk
// ============================================================================
async function makeDisk(diskItems, data, sourcePath) {
    const fileTableSize = diskItems.length * 4 * 4;
    const offset = 0x400 + fileTableSize;

    const writer = new BigEndianWriter();

    // Read and checksum bootblock
    const bootblockFile = path.join(sourcePath, 'bootblock');
    const bootBlock = await fs.readFile(bootblockFile);

    if (bootBlock.length !== 0x400) {
        throw new Error('bootblock incorrect size');
    }

    bootBlockCheckSum(bootBlock);
    writer.write(bootBlock);

    // Write file table
    for (const diskItem of diskItems) {
        writer.writeAscii(diskItem.FileID, 4);
        writer.writeInt32(diskItem.DiskLocation + offset);

        let packedSize = diskItem.PackedSize;

        // Make even
        if ((packedSize & 1) === 1) {
            packedSize++;
        }

        // Set cacheable flag
        if (diskItem.Cacheable) {
            packedSize |= 1 << 24;
        }

        // Set packing method
        packedSize |= diskItem.PackingMethod << 28;

        writer.writeInt32(packedSize);
        writer.writeInt32(diskItem.FileSize);
    }

    // Write data
    writer.write(data);

    // Pad to disk size (0xdc000 = 901,120 bytes = 880KB)
    const spaceNeeded = 0xdc000 - writer.position;
    if (spaceNeeded < 0) {
        throw new Error(`disk is ${-spaceNeeded} bytes over budget!`);
    }

    const spacer = Buffer.alloc(spaceNeeded);
    writer.write(spacer);

    console.log(`FYI: you have ${spaceNeeded} bytes remaining on this disk`);

    return writer.toBuffer();
}

// ============================================================================
// Build Disk
// ============================================================================
async function buildDisk(sourcePath) {
    const jsonFile = path.join(sourcePath, 'disk.json');

    try {
        await fs.access(jsonFile);
    } catch {
        console.log('Cannot find disk.json!');
        return;
    }

    const jsonContent = await fs.readFile(jsonFile, 'utf-8');
    const diskItems = JSON.parse(jsonContent);

    console.log('Adding files...');
    for (const diskItem of diskItems) {
        await loadDiskItem(diskItem, sourcePath);
    }

    const diskData = mergeData(diskItems);
    const disk = await makeDisk(diskItems, diskData, sourcePath);

    await fs.writeFile(path.join(sourcePath, 'final.adf'), disk);
}

// ============================================================================
// Main Entry Point
// ============================================================================
async function main() {
    printBanner();

    if (process.argv.length < 3) {
        console.log(`${colors.red}ERROR: No folder path provided!${colors.reset}`);
        console.log();
        console.log('Usage: node diskbuild.js <folder-path>');
        console.log();
        console.log('The folder must contain:');
        console.log('  - disk.json (configuration file)');
        console.log('  - bootblock (binary file)');
        process.exit(1);
    }

    const folder = process.argv[2];
    console.log(`Opening folder - ${folder}`);

    try {
        await buildDisk(folder);
    } catch (error) {
        console.log(`${colors.red}ERROR: ${error.message}${colors.reset}`);
        process.exit(1);
    }
}

main();
