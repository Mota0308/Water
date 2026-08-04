import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  mongoConfigured,
  connectMongo,
  getDaily,
  saveDaily,
  getProjectsState,
  saveProjectsState,
  uploadFile,
  downloadFile,
} from './mongo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'store-web');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  text.split(/\r?\n/).forEach((line) => {
    const s = line.trim();
    if (!s || s.startsWith('#')) return;
    const i = s.indexOf('=');
    if (i < 1) return;
    const key = s.slice(0, i).trim();
    let val = s.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  });
}
loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.join(__dirname, '.env'));

const port = Number(process.env.PORT || 8080);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024 },
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    configured: mongoConfigured(),
    mongoConfigured: mongoConfigured(),
    // keep old key so older frontend builds still work
    driveConfigured: mongoConfigured(),
    storage: mongoConfigured() ? 'mongodb' : null,
    db: process.env.MONGODB_DB || 'store_employee',
  });
});

function requireDb(_req, res, next) {
  if (!mongoConfigured()) {
    return res.status(503).json({
      error: 'MongoDB not configured. Set MONGODB_URI (and optional MONGODB_DB).',
    });
  }
  next();
}

app.get('/api/daily', requireDb, async (_req, res) => {
  try {
    res.json(await getDaily());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put('/api/daily', requireDb, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'JSON body required' });
    }
    await saveDaily(req.body);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/projects', requireDb, async (_req, res) => {
  try {
    res.json(await getProjectsState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put('/api/projects', requireDb, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'JSON body required' });
    }
    await saveProjectsState(req.body);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/files', requireDb, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file field required' });
    const saved = await uploadFile({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
    });
    res.json(saved);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/files/:id', requireDb, async (req, res) => {
  try {
    const { stream, name, mimeType } = await downloadFile(req.params.id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
    stream.on('error', (err) => {
      console.error(err);
      if (!res.headersSent) res.status(404).json({ error: 'File not found' });
    });
    stream.pipe(res);
  } catch (e) {
    console.error(e);
    res.status(404).json({ error: String(e.message || e) });
  }
});

app.use(express.static(webRoot));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(webRoot, 'index.html'));
});

async function main() {
  if (mongoConfigured()) {
    try {
      await connectMongo();
    } catch (e) {
      console.error('MongoDB connect failed:', e.message || e);
      console.error('Server will start but /api/* will error until URI/network is fixed.');
    }
  } else {
    console.warn('MONGODB_URI not set — demo mode (no cloud persist).');
  }
  app.listen(port, () => {
    console.log(`store-web server on http://localhost:${port}`);
    console.log(`Mongo configured: ${mongoConfigured()}`);
  });
}

main();
