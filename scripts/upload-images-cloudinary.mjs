#!/usr/bin/env node
/**
 * Upload local game images to Cloudinary (unsigned preset) and write the
 * delivery URLs back into Supabase.
 *
 * Cloudinary account: shawn's, GitHub login.
 *   Cloud name: hcqood2p (public — it is inside every delivery URL).
 *   Upload preset: gamerimage (Unsigned — no API secret needed anywhere).
 *
 * Two modes:
 *   --kind cover       files named <slug>.jpg/.png/.webp
 *                      -> games.cover_url (only when the game exists AND its
 *                         current cover is missing or /covers/placeholder.svg;
 *                         existing Nintendo/IGDB covers are never overwritten)
 *   --kind screenshots files named <slug>-1.<ext> ... <slug>-6.<ext>
 *                      -> games.screenshots text[] (only when the game exists
 *                         AND screenshots is currently null/empty; max 6)
 *
 * Delivery URLs are stored with f_auto,q_auto (Cloudinary serves webp/avif
 * automatically and optimises quality; no resize is baked in).
 *
 * Usage (from the project root, e.g. D:\Downloads\switch-price-site\更新):
 *   node scripts/upload-images-cloudinary.mjs --dir <folder> --kind cover
 *   node scripts/upload-images-cloudinary.mjs --dir <folder> --kind cover --apply
 *   node scripts/upload-images-cloudinary.mjs --dir <folder> --kind screenshots --apply
 *   Options: --limit N (default: all), --offset N (default: 0),
 *            --delay-ms N (default: 1000 — Cloudinary free tier throttles
 *            uploads; run big batches in chunks with --limit/--offset).
 *
 * Env (paste from your own .env.local — never send them to anyone):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   CLOUDINARY_CLOUD_NAME (default: hcqood2p)
 *   CLOUDINARY_UPLOAD_PRESET (default: gamerimage)
 *
 * Dry-run is the default: nothing is uploaded, nothing is written; it only
 * prints which files match which games and why others are skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const hasFlag = (name) => args.includes(name);

const DIR = getArg('--dir', '');
const KIND = getArg('--kind', 'cover');
const APPLY = hasFlag('--apply');
const LIMIT = Number(getArg('--limit', '0')) || 0;
const OFFSET = Number(getArg('--offset', '0')) || 0;
const DELAY_MS = Number(getArg('--delay-ms', '1000')) || 0;

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'hcqood2p';
const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || 'gamerimage';
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!DIR) {
  console.error('Usage: node scripts/upload-images-cloudinary.mjs --dir <folder> --kind cover|screenshots [--apply] [--limit N] [--offset N]');
  process.exit(2);
}
if (!['cover', 'screenshots'].includes(KIND)) {
  console.error('--kind must be cover or screenshots');
  process.exit(2);
}
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}
const ABS_DIR = path.isAbsolute(DIR) ? DIR : path.resolve(PROJECT_ROOT, DIR);
if (!fs.existsSync(ABS_DIR) || !fs.statSync(ABS_DIR).isDirectory()) {
  console.error(`Folder not found: ${ABS_DIR}`);
  process.exit(2);
}

const sbHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function getGame(slug) {
  const url = `${SUPABASE_URL}/rest/v1/games?select=id,slug,cover_url,screenshots&slug=eq.${encodeURIComponent(slug)}`;
  const res = await fetch(url, { headers: sbHeaders });
  if (!res.ok) throw new Error(`Supabase lookup failed (${res.status}) for ${slug}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

async function patchGame(slug, patch) {
  const url = `${SUPABASE_URL}/rest/v1/games?slug=eq.${encodeURIComponent(slug)}`;
  const res = await fetch(url, { method: 'PATCH', headers: sbHeaders, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(`Supabase update failed (${res.status}) for ${slug}: ${await res.text()}`);
}

async function uploadToCloudinary(filePath, publicId, folder) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(filePath));
  form.append('upload_preset', UPLOAD_PRESET);
  form.append('public_id', publicId);
  form.append('folder', folder);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Cloudinary upload failed (${res.status}): ${json?.error?.message ?? JSON.stringify(json)}`);
  // Insert f_auto,q_auto right after /image/upload/ for optimised delivery.
  return json.secure_url.replace('/image/upload/', '/image/upload/f_auto,q_auto/');
}

// ---- collect files ---------------------------------------------------------
const files = fs.readdirSync(ABS_DIR)
  .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
  .sort();
if (files.length === 0) {
  console.log(`No image files in ${ABS_DIR}.`);
  process.exit(0);
}

// Group by slug. Cover: <slug>.<ext>. Screenshots: <slug>-<n>.<ext> (n = 1..6).
const groups = new Map(); // slug -> { cover?: file, shots: Map<number, file> }
for (const f of files) {
  const base = path.basename(f, path.extname(f));
  if (KIND === 'cover') {
    if (!groups.has(base)) groups.set(base, { cover: f, shots: new Map() });
    else groups.get(base).cover = f;
  } else {
    const m = base.match(/^(.*)-([1-6])$/);
    if (!m) { console.log(`SKIP ${f}: screenshot files must be named <slug>-1..6.<ext>`); continue; }
    if (!groups.has(m[1])) groups.set(m[1], { cover: null, shots: new Map() });
    groups.get(m[1]).shots.set(Number(m[2]), f);
  }
}

let entries = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
if (OFFSET) entries = entries.slice(OFFSET);
if (LIMIT) entries = entries.slice(0, LIMIT);
console.log(`Mode: ${KIND} | ${APPLY ? 'APPLY (writes)' : 'DRY-RUN (no upload, no write)'} | ${entries.length} game(s) to process (of ${groups.size} found, ${files.length} files).`);

const report = { mode: KIND, apply: APPLY, at: new Date().toISOString(), results: [] };
let uploaded = 0, written = 0, skipped = 0;

for (const [slug, g] of entries) {
  try {
    const game = await getGame(slug);
    if (!game) { console.log(`SKIP ${slug}: no such game in DB`); report.results.push({ slug, status: 'no-game' }); skipped++; continue; }

    if (KIND === 'cover') {
      const hasCover = game.cover_url && !game.cover_url.includes('/covers/placeholder.svg');
      if (hasCover) { console.log(`SKIP ${slug}: already has a cover (${game.cover_url})`); report.results.push({ slug, status: 'has-cover' }); skipped++; continue; }
      const filePath = path.join(ABS_DIR, g.cover);
      let url;
      if (APPLY) {
        url = await uploadToCloudinary(filePath, slug, 'covers');
        await patchGame(slug, { cover_url: url });
        uploaded++; written++;
        await sleep(DELAY_MS);
      } else {
        url = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_auto,q_auto/covers/${slug}`;
      }
      console.log(`${APPLY ? 'OK' : 'WOULD'} ${slug}: cover <- ${url}`);
      report.results.push({ slug, status: APPLY ? 'uploaded' : 'would-upload', url });
    } else {
      if (game.screenshots && game.screenshots.length > 0) {
        console.log(`SKIP ${slug}: already has ${game.screenshots.length} screenshot(s)`);
        report.results.push({ slug, status: 'has-screenshots' }); skipped++; continue;
      }
      const nums = [...g.shots.keys()].sort((a, b) => a - b).slice(0, 6);
      if (nums.length === 0) { console.log(`SKIP ${slug}: no -1..6 files`); report.results.push({ slug, status: 'no-files' }); skipped++; continue; }
      const urls = [];
      for (const n of nums) {
        const filePath = path.join(ABS_DIR, g.shots.get(n));
        if (APPLY) {
          urls.push(await uploadToCloudinary(filePath, `${slug}-${n}`, 'screenshots'));
          uploaded++;
          await sleep(DELAY_MS);
        } else {
          urls.push(`https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_auto,q_auto/screenshots/${slug}-${n}`);
        }
      }
      if (APPLY) { await patchGame(slug, { screenshots: urls }); written++; }
      console.log(`${APPLY ? 'OK' : 'WOULD'} ${slug}: ${urls.length} screenshot(s)`);
      report.results.push({ slug, status: APPLY ? 'uploaded' : 'would-upload', urls });
    }
  } catch (e) {
    console.log(`ERROR ${slug}: ${e.message}`);
    report.results.push({ slug, status: 'error', error: e.message });
    skipped++;
  }
}

console.log(`\nDone. uploaded=${uploaded} written=${written} skipped=${skipped}`);
const reportPath = path.join(PROJECT_ROOT, 'data', `cloudinary-upload-${KIND}-${new Date().toISOString().slice(0, 10)}.json`);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`Report: ${reportPath}`);
