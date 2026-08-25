const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Validação estrita de segurança (Regra 3)
const TOKEN = process.env.INTERNAL_TOKEN;
if (!TOKEN) {
    console.error("ERRO CRÍTICO: INTERNAL_TOKEN não configurado nas variáveis de ambiente.");
    process.exit(1); 
}

const BASE_URL = process.env.BASE_URL || 'https://seu-dominio.com';
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

const app = express();
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const auth = (req, res, next) => {
    if (req.headers.authorization === `Bearer ${TOKEN}`) return next();
    res.status(401).json({ error: 'Não autorizado' });
};

// Configuração do Multer com limite de 500MB (Regra 2)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueId = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueId + '.mp4');
    }
});
const upload = multer({ 
    storage,
    limits: { fileSize: 500 * 1024 * 1024 } 
});

// Rota Pública
app.use('/video', express.static(UPLOADS_DIR));

// Rota de Upload (Protegida)
app.post('/upload', auth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    res.json({
        success: true,
        file_id: req.file.filename,
        url: `${BASE_URL}/video/${req.file.filename}`
    });
});

// Rota de Exclusão (Protegida)
app.delete('/video/:filename', auth, (req, res) => {
    const filePath = path.join(UPLOADS_DIR, req.params.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ success: true, message: 'Arquivo excluído com sucesso.' });
    } else {
        res.status(404).json({ error: 'Arquivo não encontrado.' });
    }
});

// Limpeza de Segurança Automática (Mantém arquivos abandonados > 2h)
setInterval(() => {
    fs.readdir(UPLOADS_DIR, (err, files) => {
        if (err) return;
        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(UPLOADS_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                if (now - stats.birthtimeMs > 2 * 60 * 60 * 1000) {
                    fs.unlink(filePath, () => console.log(`Limpeza automática de segurança: ${file}`));
                }
            });
        });
    });
}, 60 * 60 * 1000);

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
