const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = process.env.INTERNAL_TOKEN;
const RAW_BASE_URL = process.env.BASE_URL;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const FILE_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutos

if (!TOKEN || TOKEN.length < 16) {
  console.error('ERRO: INTERNAL_TOKEN precisa estar configurado e ter pelo menos 16 caracteres.');
  process.exit(1);
}

if (!RAW_BASE_URL) {
  console.error('ERRO: BASE_URL não configurada. Ex.: https://video.seudominio.com');
  process.exit(1);
}

let BASE_URL;
try {
  const parsed = new URL(RAW_BASE_URL);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocolo inválido');
  BASE_URL = parsed.toString().replace(/\/$/, '');
  if (parsed.protocol !== 'https:') {
    console.warn('AVISO: BASE_URL não usa HTTPS. Para a Meta/Instagram, use uma URL pública HTTPS.');
  }
} catch {
  console.error('ERRO: BASE_URL inválida. Ex.: https://video.seudominio.com');
  process.exit(1);
}

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.disable('x-powered-by');
app.set('trust proxy', 1);

function auth(req, res, next) {
  const authHeader = req.get('authorization') || '';
  const expected = `Bearer ${TOKEN}`;

  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();

  return res.status(401).json({ success: false, error: 'Não autorizado.' });
}

function safeStoredFilename(value) {
  return typeof value === 'string' && /^[a-f0-9-]{36}\.mp4$/i.test(value);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.mp4`),
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    const acceptedMime = mime === 'video/mp4' || mime === 'application/octet-stream';
    const acceptedExt = ext === '.mp4' || ext === '';

    if (acceptedMime && acceptedExt) return cb(null, true);
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'));
  },
});

app.get('/', (_req, res) => {
  res.json({
    success: true,
    service: 'n8n-temp-server',
    status: 'online',
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ success: true, status: 'ok' });
});

// Público: a Meta precisa conseguir fazer GET/HEAD e Range Requests neste endereço.
app.use(
  '/video',
  express.static(UPLOADS_DIR, {
    fallthrough: false,
    acceptRanges: true,
    cacheControl: true,
    maxAge: '10m',
    immutable: false,
    setHeaders: (res) => {
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }),
);

// Protegido: n8n envia multipart/form-data com o campo binário chamado "file".
app.post('/upload', auth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return next(err);
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Nenhum arquivo MP4 enviado no campo "file".' });
    }

    return res.status(201).json({
      success: true,
      file_id: req.file.filename,
      size: req.file.size,
      expires_in_seconds: Math.floor(FILE_TTL_MS / 1000),
      url: `${BASE_URL}/video/${encodeURIComponent(req.file.filename)}`,
    });
  });
});

app.delete('/video/:filename', auth, async (req, res, next) => {
  try {
    const { filename } = req.params;
    if (!safeStoredFilename(filename)) {
      return res.status(400).json({ success: false, error: 'Nome de arquivo inválido.' });
    }

    const filePath = path.join(UPLOADS_DIR, filename);
    await fs.promises.unlink(filePath);
    return res.json({ success: true, message: 'Arquivo excluído.' });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ success: false, error: 'Arquivo não encontrado.' });
    }
    return next(err);
  }
});

async function cleanupExpiredFiles() {
  try {
    const files = await fs.promises.readdir(UPLOADS_DIR);
    const now = Date.now();

    await Promise.all(
      files.map(async (filename) => {
        if (!safeStoredFilename(filename)) return;

        const filePath = path.join(UPLOADS_DIR, filename);
        try {
          const stats = await fs.promises.stat(filePath);
          if (now - stats.mtimeMs > FILE_TTL_MS) {
            await fs.promises.unlink(filePath);
            console.log(`Limpeza automática: ${filename}`);
          }
        } catch (err) {
          if (err.code !== 'ENOENT') console.error(`Falha ao limpar ${filename}:`, err.message);
        }
      }),
    );
  } catch (err) {
    console.error('Falha na limpeza automática:', err.message);
  }
}

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, error: 'Arquivo excede o limite de 500 MB.' });
    }
    return res.status(400).json({ success: false, error: 'Envie somente 1 arquivo MP4 no campo "file".' });
  }

  console.error('Erro interno:', err);
  return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
});

cleanupExpiredFiles();
const cleanupTimer = setInterval(cleanupExpiredFiles, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

const server = app.listen(PORT, HOST, () => {
  console.log(`n8n-temp-server online em http://${HOST}:${PORT}`);
  console.log(`BASE_URL pública: ${BASE_URL}`);
});

function shutdown(signal) {
  console.log(`${signal} recebido. Encerrando servidor...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
