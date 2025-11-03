import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Music from './music_model.js';
import { importToDb } from './import_to_db.js';

const app = express();
app.use(express.json());

// Add CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const PORT = Number(process.env.PORT) || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/Music';
const DEFAULT_LIBRARY_DIR = path.resolve(__dirname, '../Music');
const configuredLibraryDir = process.env.MUSIC_LIBRARY_DIR || DEFAULT_LIBRARY_DIR;
const MUSIC_LIBRARY_DIR = path.isAbsolute(configuredLibraryDir)
    ? path.normalize(configuredLibraryDir)
    : path.resolve(__dirname, configuredLibraryDir);

mongoose
    .connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log('Connected to MongoDB'))
    .catch((error) => console.error('MongoDB connection error:', error.message));

function ensureDbConnected(res) {
    if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: 'Database is not connected' });
        return false;
    }
    return true;
}

function authMiddleware(req, res, next) {
    const auth = req.headers.authorization;
    if(!auth) return res.status(401).json({ error: 'missing token' });
    const token = auth.split(' ')[1];
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (error) {
        res.status(401).json({ error: 'invalid token' });
    }
}

const asyncRoute = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
};

function resolveLibraryDirectory(directory) {
    if (!directory) {
        return MUSIC_LIBRARY_DIR;
    }
    if (path.isAbsolute(directory)) {
        return path.normalize(directory);
    }
    return path.resolve(MUSIC_LIBRARY_DIR, directory);
}

app.post('/login', (req, res) => {
    const {username, password} = req.body;
    if(username === 'admin' && password === 'password'){
        const token = jwt.sign({ username}, JWT_SECRET, { expiresIn: '24h' });
        return res.json({ token});
    }
    res.status(401).json({ error: 'invalid credentials' });
})

// simple health/root endpoint to avoid 404 on '/'
app.get('/', (req, res) => {
    res.json({ status: 'ok' });
});

app.post('/import', authMiddleware, asyncRoute(async (req, res) => {
    if (!ensureDbConnected(res)) return;
    const targetDir = resolveLibraryDirectory(req.body?.directory);
    if (!fs.existsSync(targetDir)) {
        return res.status(400).json({ error: `Library directory not found: ${targetDir}` });
    }

    try {
        const dirStat = fs.statSync(targetDir);
        if (!dirStat.isDirectory()) {
            return res.status(400).json({ error: `Path is not a directory: ${targetDir}` });
        }
    } catch (statError) {
        console.error(statError);
        return res.status(400).json({ error: `Unable to access directory: ${targetDir}` });
    }

    try {
        await importToDb(targetDir);
        res.json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
}));

app.get('/tracks', asyncRoute(async (req, res) => {
    if (!ensureDbConnected(res)) return;
    const docs = await Music.find({}, { title: 1, artist: 1 })
        .sort({ title: 1 })
        .lean()
        .exec();
    res.json(docs);
}));

app.get('/track/:id', asyncRoute(async (req, res) => {
    if (!ensureDbConnected(res)) return;
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid track id' });
    }

    const doc = await Music.findById(id).exec();
    if(!doc) return res.status(404).json({ error: 'Track not found' });
    const filePath = doc.path;
    if(!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on server' });

    const stat = fs.statSync(filePath);
    const range = req.headers.range;
    const total = stat.size;

    if(range){
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : total -1;
        const chunkSize = (end - start) + 1;
        const stream = fs.createReadStream(filePath, { start, end });
        stream.on('error', (streamError) => {
            console.error('Stream error:', streamError.message);
            res.destroy(streamError);
        });
        res.writeHead(206, {
            'Content-Range' : `bytes ${start}-${end}/${total}`,
            'Accept-Ranges' : 'bytes',
            'Content-Length' : chunkSize,
            'Content-Type' : 'audio/mpeg',
        });
        stream.pipe(res);
    } else {
        const stream = fs.createReadStream(filePath);
        stream.on('error', (streamError) => {
            console.error('Stream error:', streamError.message);
            res.destroy(streamError);
        });
        res.writeHead(200, {
            'Content-Length' : total,
            'Content-Type' : 'audio/mpeg',
        });
        stream.pipe(res);
    }
}));

app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) {
        return next(error);
    }
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Internal Server Error' });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));