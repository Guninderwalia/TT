// Pulse v5.2 — automated SQLite backups.
//
// On top of Fly's 5-day volume snapshots, we take a logical, online-safe
// backup of the database once a day:
//   1. VACUUM INTO a timestamped copy under <data>/backups (30-day rotation).
//   2. gzip + upload it off-site to the Tigris/S3 bucket if AWS_* creds exist
//      (set automatically by `fly storage create`). Survives even a volume loss.
//
// Off-site upload is best-effort: if the bucket/creds aren't configured, we
// still keep the local rotated copies.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RETAIN_DAYS = 30;

function dbPath() {
  try { return require('../db/init').DB_PATH; } catch (_) { return null; }
}

function backupsDir() {
  const base = process.env.USER_DATA_PATH || process.env.APPDATA || process.cwd();
  const dir = path.join(base, 'backups');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

// Consistent snapshot of a LIVE database via VACUUM INTO (safe while in use,
// unlike a raw file copy which can capture a half-written page).
async function makeLocalBackup(db) {
  const dir = backupsDir();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = path.join(dir, `tasktango-${stamp}.db`);
  const safe = file.replace(/'/g, "''");
  await db.exec(`VACUUM INTO '${safe}'`);
  return file;
}

// Drop local backups older than RETAIN_DAYS.
function rotateLocal() {
  const dir = backupsDir();
  const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/^tasktango-.*\.db(\.gz)?$/.test(f)) continue;
      const full = path.join(dir, f);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); removed++; }
      } catch (_) {}
    }
  } catch (_) {}
  return removed;
}

// gzip + PUT to Tigris/S3. No-op (returns uploaded:false) when creds absent.
async function uploadOffsite(file) {
  const bucket = process.env.BUCKET_NAME;
  if (!bucket || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return { uploaded: false, reason: 'no bucket/creds' };
  }
  let S3Client, PutObjectCommand;
  try {
    ({ S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
  } catch (_) {
    return { uploaded: false, reason: '@aws-sdk/client-s3 not installed' };
  }
  const client = new S3Client({
    region: process.env.AWS_REGION || 'auto',
    endpoint: process.env.AWS_ENDPOINT_URL_S3 || undefined,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });
  const gz = zlib.gzipSync(fs.readFileSync(file));
  const key = `db-backups/${path.basename(file)}.gz`;
  await client.send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: gz, ContentType: 'application/gzip'
  }));
  return { uploaded: true, key, bytes: gz.length };
}

async function runDailyBackup(db) {
  if (!db) return { ok: false, reason: 'no db' };
  try {
    const file = await makeLocalBackup(db);
    const removed = rotateLocal();
    let offsite = { uploaded: false };
    try { offsite = await uploadOffsite(file); }
    catch (e) { offsite = { uploaded: false, reason: e.message }; }
    console.log(`[BACKUP] ✓ local=${path.basename(file)} (rotated ${removed}) · ` +
      `offsite=${offsite.uploaded ? offsite.key + ` (${Math.round(offsite.bytes / 1024)} KB)` : 'skipped:' + (offsite.reason || '')}`);
    return { ok: true, file, offsite };
  } catch (e) {
    console.error('[BACKUP] failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

module.exports = { runDailyBackup, backupsDir, dbPath };
