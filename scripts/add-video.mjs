// Put a video beside the site so it plays in LIFEGEN's own player.
//
//   node scripts/add-video.mjs ~/Downloads/GRAND-CAMPUS-HANGOUT.mp4
//   node scripts/add-video.mjs ~/Downloads/clip.mp4 --as grand-campus-hangout-720p.mp4
//
// Why: a slot that plays through Google Drive's preview player shows Drive's
// own black surround and Drive's own play button — they are painted inside the
// frame by drive.google.com and cannot be styled from this page. A file served
// from this site plays in the first-party <video> player the testimony videos
// use: 16:9, bare on the page background, real controls, no provider chrome.
//
// The script checks the file is actually an MP4, reads its real duration and
// picture size out of the MP4 itself (no ffmpeg needed), refuses anything
// GitHub would reject, and copies it to public/brand/videos/. A slot picks it
// up when it names the file in its data-native-src attribute; see docs/MEDIA.md.
//
// Exit codes: 0 written, 1 refused (bad file / too large / exists without --force).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultDir = path.join(root, 'public', 'brand', 'videos');
// GitHub hard-fails on files over 100 MB; warn well before that.
const hardLimit = 100 * 1024 * 1024;
const softLimit = 90 * 1024 * 1024;

// ---- Minimal MP4 / ISO-BMFF reader (boxes only, no codecs ----------------)
function readBoxes(buf, start, end) {
    const boxes = [];
    let off = start;
    while (off + 8 <= end) {
        let size = buf.readUInt32BE(off);
        const type = buf.toString('latin1', off + 4, off + 8);
        let header = 8;
        if (size === 1) {
            if (off + 16 > end) break;
            size = Number(buf.readBigUInt64BE(off + 8));
            header = 16;
        } else if (size === 0) {
            size = end - off;
        }
        if (size < header || off + size > end) break;
        boxes.push({type, start: off, payload: off + header, size});
        off += size;
    }
    return boxes;
}

// Every box in the file, in reading order, with the container it sits in.
function walk(buf, start = 0, end = buf.length, out = [], containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'edts', 'udta'])) {
    for (const box of readBoxes(buf, start, end)) {
        out.push(box);
        if (containers.has(box.type)) walk(buf, box.payload, box.start + box.size, out, containers);
    }
    return out;
}

/**
 * Duration in seconds and picture size, straight out of the MP4's moov box.
 * Returns {duration: number|null, width: number|null, height: number|null}.
 */
export function mp4Info(buf) {
    const boxes = walk(buf);
    const find = (type) => boxes.find((b) => b.type === type);
    let duration = null;
    let width = null;
    let height = null;

    const mvhd = find('mvhd');
    if (mvhd) {
        const v = buf[mvhd.payload];
        // version(1)+flags(3), then creation/modification, then timescale+duration.
        const timescaleAt = mvhd.payload + (v === 1 ? 4 + 16 : 4 + 8);
        const timescale = buf.readUInt32BE(timescaleAt);
        const durationAt = timescaleAt + 4;
        const raw = v === 1 ? Number(buf.readBigUInt64BE(durationAt)) : buf.readUInt32BE(durationAt);
        if (timescale > 0 && raw > 0) duration = raw / timescale;
    }
    // Fragmented MP4 keeps its total in mehd (and its timecode in mvhd only).
    if (duration === null) {
        const mehd = find('mehd');
        if (mehd) {
            const v = buf[mehd.payload];
            const at = mehd.payload + (v === 1 ? 4 + 8 : 4 + 4);
            const raw = v === 1 ? Number(buf.readBigUInt64BE(at)) : buf.readUInt32BE(at);
            const timescale = mvhd ? buf.readUInt32BE(mvhd.payload + (buf[mvhd.payload] === 1 ? 4 + 16 : 4 + 8)) : 0;
            if (timescale > 0 && raw > 0) duration = raw / timescale;
        }
    }

    // tkhd carries the track's display size as 16.16 fixed point; video tracks
    // are the ones with real numbers, the audio track reports 0 × 0.
    for (const tkhd of boxes.filter((b) => b.type === 'tkhd')) {
        const v = buf[tkhd.payload];
        const at = tkhd.payload + (v === 1 ? 88 : 76);
        if (at + 8 > tkhd.start + tkhd.size) continue;
        const w = buf.readUInt32BE(at) / 65536;
        const h = buf.readUInt32BE(at + 4) / 65536;
        if (w >= 1 && h >= 1 && (width === null || w * h > width * height)) {
            width = Math.round(w);
            height = Math.round(h);
        }
    }
    return {duration, width, height};
}

export function formatDuration(seconds) {
    if (!(seconds > 0)) return null;
    const total = Math.round(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    if (mins === 0) return `${secs} sec`;
    return `${mins} min ${secs} sec`;
}

// ---- CLI ------------------------------------------------------------------
// Only runs when this file is the program being started: tests import the
// reader above to check the numbers against a published video.
function main(argv) {
    function usage(message) {
        if (message) console.error(`\n${message}`);
        console.error('\nUsage: node scripts/add-video.mjs <video.mp4> [--as <name.mp4>] [--dir <folder>] [--force]');
        console.error('  Converts nothing — it checks and copies an MP4 that is already web-ready.');
        process.exit(1);
    }

    if (!argv.length) usage();
    const source = argv[0];
    const flag = (name) => {
        const i = argv.indexOf(name);
        return i === -1 ? null : argv[i + 1];
    };
    const force = argv.includes('--force');
    const outDir = path.resolve(flag('--dir') || defaultDir);
    const targetName = flag('--as') || path.basename(source);
    const target = path.join(outDir, targetName);

    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) usage(`No such file: ${source}`);
    if (!outDir.startsWith(root)) usage(`--dir must stay inside the repository (${root})`);
    if (fs.existsSync(target) && !force) usage(`${path.relative(root, target)} already exists — re-run with --force to replace it.`);
    if (!targetName.toLowerCase().endsWith('.mp4')) usage('Target name must end in .mp4 — that is what videos.js plays directly.');

    const buf = fs.readFileSync(source);
    const signature = buf.toString('ascii', 4, 8);
    if (signature !== 'ftyp') usage(`${path.basename(source)} is not an MP4 (no ftyp box). Export it as MP4 first.`);
    if (buf.length > hardLimit) usage(`File is ${(buf.length / 1048576).toFixed(1)} MB — GitHub rejects anything over 100 MB. Export a smaller 720p/1080p MP4.`);

    const {duration, width, height} = mp4Info(buf);
    fs.mkdirSync(outDir, {recursive: true});
    fs.copyFileSync(source, target);

    const rel = '/' + path.relative(path.join(root, 'public'), target).split(path.sep).join('/');
    const label = formatDuration(duration);
    console.log(`${path.relative(root, target)}`);
    console.log(`  size      ${(buf.length / 1048576).toFixed(1)} MB${buf.length > softLimit ? '  (large — GitHub warns over 90 MB, consider 720p)' : ''}`);
    console.log(`  duration  ${label || 'unknown (parse found no mvhd duration)'}`);
    console.log(`  picture   ${width && height ? `${width} × ${height}` : 'unknown'}`);
    console.log('\nNext:');
    console.log(`  1. the slot must name it, e.g. data-native-src="${rel}"`);
    console.log(`  2. if that slot's caption shows a time, update it to: ${label ? `${label} · ` : '<time> · '}Plays on LIFEGEN.`);
    console.log('  3. node --test tests/ && npm run build');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
