require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const VALID_CATEGORIES = ['reports', 'general', 'notes', 'schedule'];
const VALID_ROLES = ['admin', 'personel', 'is_yapilan'];
const sessions = new Map();
const syncClients = new Set();
let syncVersion = Date.now();

const db = new sqlite3.Database(path.join(ROOT, 'database.db'));

const DEFAULT_SETTINGS = {
    contact_email: 'info@mimarsinangoktas.com',
    contact_phone: '+90 346 000 00 00',
    contact_address: 'Sivas, Türkiye',
    map_lat: '39.7477',
    map_lng: '37.0179',
    map_label: 'Mimar Sinan Göktaş — Sivas',
    site_lat: '39.7477',
    site_lng: '37.0179',
    site_address: 'Sivas, Türkiye',
    site_label: 'Şantiye Konumu',
};

const ROLE_LABELS = {
    admin: 'Admin',
    personel: 'Personel',
    is_yapilan: 'Kullanıcı',
};

function migrateFilesTable(done) {
    db.all('PRAGMA table_info(files)', [], (err, cols) => {
        if (err) return done(err);
        const hasCategory = (cols || []).some((c) => c.name === 'category');
        if (!hasCategory) {
            db.run("ALTER TABLE files ADD COLUMN category TEXT DEFAULT 'reports'", (alterErr) => {
                if (alterErr) return done(alterErr);
                db.run("UPDATE files SET category = 'reports' WHERE category IS NULL OR category = ''", done);
            });
        } else {
            db.run("UPDATE files SET category = 'reports' WHERE category IS NULL OR category = ''", done);
        }
    });
}

function migrateUsersTable(done) {
    db.serialize(() => {
        db.run(
            `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT,
                role TEXT DEFAULT 'personel',
                full_name TEXT,
                phone TEXT,
                site_name TEXT,
                company_name TEXT,
                extra_note TEXT,
                created_at TEXT
            )`,
            (createErr) => {
                if (createErr) return done(createErr);
                ensureUsersColumns((columnsErr) => {
                    if (columnsErr) return done(columnsErr);
                    if (ADMIN_PASSWORD) {
                        db.run(
                            `INSERT INTO users (username, password, role, full_name, created_at)
                             VALUES (?, ?, 'admin', 'Sistem Yöneticisi', ?)
                             ON CONFLICT(username) DO UPDATE SET
                                password=excluded.password,
                                role='admin',
                                full_name='Sistem Yöneticisi'`,
                            [ADMIN_USERNAME, ADMIN_PASSWORD, new Date().toISOString()],
                            done
                        );
                    } else {
                        done();
                    }
                });
            }
        );
    });
}

function ensureUsersColumns(done) {
    const wantedColumns = [
        { name: 'full_name', sql: 'ALTER TABLE users ADD COLUMN full_name TEXT' },
        { name: 'phone', sql: 'ALTER TABLE users ADD COLUMN phone TEXT' },
        { name: 'site_name', sql: 'ALTER TABLE users ADD COLUMN site_name TEXT' },
        { name: 'company_name', sql: 'ALTER TABLE users ADD COLUMN company_name TEXT' },
        { name: 'extra_note', sql: 'ALTER TABLE users ADD COLUMN extra_note TEXT' },
    ];

    db.all('PRAGMA table_info(users)', [], (err, cols) => {
        if (err) return done(err);
        const existing = new Set((cols || []).map((c) => c.name));
        const pending = wantedColumns.filter((c) => !existing.has(c.name));

        if (!pending.length) return done();

        let index = 0;
        const next = () => {
            if (index >= pending.length) return done();
            db.run(pending[index].sql, (alterErr) => {
                if (alterErr) return done(alterErr);
                index += 1;
                next();
            });
        };
        next();
    });
}

function migrateConstructionSitesTable(done) {
    db.run(
        `CREATE TABLE IF NOT EXISTS construction_sites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            address TEXT,
            phone TEXT,
            lat TEXT,
            lng TEXT,
            description TEXT,
            created_at TEXT
        )`,
        (createErr) => {
            if (createErr) return done(createErr);
            db.get('SELECT COUNT(*) AS c FROM construction_sites', [], (countErr, row) => {
                if (countErr) return done(countErr);
                if ((row?.c || 0) > 0) return done();

                getSettings((settingsErr, settings) => {
                    if (settingsErr) return done(settingsErr);
                    const name = settings.site_label || 'Şantiye Konumu';
                    const hasData =
                        (settings.site_address && settings.site_address.trim()) ||
                        (settings.site_lat && settings.site_lat.trim());
                    if (!hasData) return done();

                    db.run(
                        `INSERT INTO construction_sites (name, address, phone, lat, lng, description, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            name,
                            settings.site_address || '',
                            '',
                            settings.site_lat || '39.7477',
                            settings.site_lng || '37.0179',
                            '',
                            new Date().toISOString(),
                        ],
                        done
                    );
                });
            });
        }
    );
}

function mapConstructionSite(row) {
    return {
        id: row.id,
        name: row.name || '',
        address: row.address || '',
        phone: row.phone || '',
        lat: row.lat || '',
        lng: row.lng || '',
        description: row.description || '',
        createdAt: row.created_at || '',
    };
}

function validateConstructionSiteBody(body, isCreate) {
    const name = String(body?.name || '').trim();
    const address = String(body?.address || '').trim();
    const phone = String(body?.phone || '').trim();
    const lat = String(body?.lat || '').trim().replace(',', '.');
    const lng = String(body?.lng || '').trim().replace(',', '.');
    const description = String(body?.description || '').trim();

    if (isCreate && !name) return { error: 'Şantiye adı zorunlu' };
    if (name && (name.length < 2 || name.length > 100)) {
        return { error: 'Şantiye adı 2-100 karakter olmalı' };
    }
    if (address.length > 200) return { error: 'Adres en fazla 200 karakter olabilir' };
    if (phone.length > 30) return { error: 'Telefon en fazla 30 karakter olabilir' };
    if (description.length > 500) return { error: 'Açıklama en fazla 500 karakter olabilir' };
    if (lat && Number.isNaN(parseFloat(lat))) return { error: 'Geçerli enlem girin' };
    if (lng && Number.isNaN(parseFloat(lng))) return { error: 'Geçerli boylam girin' };

    return { name, address, phone, lat, lng, description };
}

function broadcastSync() {
    const payload = `data: ${JSON.stringify({
        version: syncVersion,
        at: new Date().toISOString(),
    })}\n\n`;
    for (const client of syncClients) {
        client.write(payload);
    }
}

function bumpSync() {
    syncVersion = Date.now();
    broadcastSync();
}

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT,
        originalname TEXT,
        upload_date TEXT,
        category TEXT DEFAULT 'reports'
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);

    migrateFilesTable((migrateErr) => {
        if (migrateErr) console.error('Veritabanı migration hatası:', migrateErr.message);
    });
    migrateUsersTable((migrateErr) => {
        if (migrateErr) console.error('Kullanıcı tablosu migration hatası:', migrateErr.message);
    });
    migrateConstructionSitesTable((migrateErr) => {
        if (migrateErr) console.error('Şantiye tablosu migration hatası:', migrateErr.message);
    });

    Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => {
        db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value]);
    });
});

const uploadDir = path.join(ROOT, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}-${safe}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = /\.(pdf|doc|docx|xlsx|xls|txt|png|jpg|jpeg)$/i;
        if (allowed.test(file.originalname)) cb(null, true);
        else cb(new Error('Desteklenmeyen dosya türü'));
    },
});

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : true;

app.use(
    cors({
        origin: allowedOrigins,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(ROOT));

function createToken() {
    return crypto.randomBytes(32).toString('hex');
}

function cleanSessions() {
    const now = Date.now();
    for (const [token, data] of sessions.entries()) {
        if (now - data.created > SESSION_MAX_AGE_MS) sessions.delete(token);
    }
}

setInterval(cleanSessions, 60 * 60 * 1000);

function requireAuth(req, res, next) {
    cleanSessions();
    const auth = req.get('authorization') || '';
    const queryToken = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
    const token = auth.replace(/^Bearer\s+/i, '').trim() || queryToken;
    const session = sessions.get(token);
    if (!token || !session) {
        return res.status(401).json({ error: 'Yetkisiz erişim' });
    }
    req.session = session;
    req.token = token;
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session || req.session.role !== 'admin') {
        return res.status(403).json({ error: 'Bu işlem için admin yetkisi gerekir' });
    }
    next();
}

function getSettings(cb) {
    db.all('SELECT key, value FROM settings', [], (err, rows) => {
        if (err) return cb(err);
        const out = { ...DEFAULT_SETTINGS };
        (rows || []).forEach((r) => {
            out[r.key] = r.value;
        });
        cb(null, out);
    });
}

function saveSettings(pairs, cb) {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    pairs.forEach(([k, v]) => stmt.run(k, String(v ?? '')));
    stmt.finalize(cb);
}

function validateCredentials(username, password, cb) {
    db.get(
        `SELECT id, username, role, full_name, phone, site_name, company_name, extra_note
         FROM users WHERE username = ? AND password = ?`,
        [username, password],
        (err, row) => {
            if (err) return cb(err);
            cb(null, row || null);
        }
    );
}

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/sync/state', (_req, res) => {
    res.json({ version: syncVersion, at: new Date(syncVersion).toISOString() });
});

app.get('/api/sync/stream', requireAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const keepAlive = setInterval(() => {
        res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    }, 25000);

    syncClients.add(res);
    res.write(`data: ${JSON.stringify({ version: syncVersion, at: new Date(syncVersion).toISOString() })}\n\n`);

    req.on('close', () => {
        clearInterval(keepAlive);
        syncClients.delete(res);
    });
});

app.get('/api/settings', (_req, res) => {
    getSettings((err, settings) => {
        if (err) return res.status(500).json({ error: 'Ayarlar okunamadı' });
        res.json(settings);
    });
});

app.post('/api/settings', requireAuth, requireAdmin, (req, res) => {
    const body = req.body || {};
    const pairs = Object.entries(body).filter(([k]) => k in DEFAULT_SETTINGS);
    if (!pairs.length) return res.status(400).send('Güncellenecek ayar yok');
    saveSettings(pairs, (err) => {
        if (err) return res.status(500).send('Kayıt hatası');
        bumpSync();
        res.send('Ayarlar kaydedildi');
    });
});

app.get('/api/construction-sites', (_req, res) => {
    db.all(
        'SELECT id, name, address FROM construction_sites ORDER BY name COLLATE NOCASE',
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: 'Şantiyeler okunamadı' });
            res.json(
                (rows || []).map((r) => ({
                    id: r.id,
                    name: r.name || '',
                    address: r.address || '',
                }))
            );
        }
    );
});

app.get('/api/construction-sites/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Geçersiz id' });
    db.get('SELECT * FROM construction_sites WHERE id=?', [id], (err, row) => {
        if (err) return res.status(500).json({ error: 'Şantiye okunamadı' });
        if (!row) return res.status(404).json({ error: 'Şantiye bulunamadı' });
        res.json(mapConstructionSite(row));
    });
});

app.post('/api/construction-sites', requireAuth, requireAdmin, (req, res) => {
    const validated = validateConstructionSiteBody(req.body, true);
    if (validated.error) return res.status(400).json({ error: validated.error });

    db.run(
        `INSERT INTO construction_sites (name, address, phone, lat, lng, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            validated.name,
            validated.address,
            validated.phone,
            validated.lat,
            validated.lng,
            validated.description,
            new Date().toISOString(),
        ],
        function insertSite(err) {
            if (err) return res.status(500).json({ error: 'Şantiye eklenemedi' });
            bumpSync();
            res.json({ ok: true, id: this.lastID, message: 'Şantiye eklendi' });
        }
    );
});

app.put('/api/construction-sites/:id', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Geçersiz id' });

    const validated = validateConstructionSiteBody(req.body, false);
    if (validated.error) return res.status(400).json({ error: validated.error });
    if (!validated.name) return res.status(400).json({ error: 'Şantiye adı zorunlu' });

    db.run(
        `UPDATE construction_sites
         SET name=?, address=?, phone=?, lat=?, lng=?, description=?
         WHERE id=?`,
        [
            validated.name,
            validated.address,
            validated.phone,
            validated.lat,
            validated.lng,
            validated.description,
            id,
        ],
        function updateSite(err) {
            if (err) return res.status(500).json({ error: 'Şantiye güncellenemedi' });
            if (this.changes === 0) return res.status(404).json({ error: 'Şantiye bulunamadı' });
            bumpSync();
            res.json({ ok: true, message: 'Şantiye güncellendi' });
        }
    );
});

app.delete('/api/construction-sites/:id', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Geçersiz id' });

    db.run('DELETE FROM construction_sites WHERE id=?', [id], function deleteSite(err) {
        if (err) return res.status(500).json({ error: 'Şantiye silinemedi' });
        if (this.changes === 0) return res.status(404).json({ error: 'Şantiye bulunamadı' });
        bumpSync();
        res.json({ ok: true, message: 'Şantiye silindi' });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
    }

    validateCredentials(username.trim(), password, (err, user) => {
        if (err) return res.status(500).json({ error: 'Giriş sırasında hata oluştu' });

        if (user) {
            const token = createToken();
            sessions.set(token, {
                userId: user.id,
                username: user.username,
                role: user.role || 'personel',
                fullName: user.full_name || '',
                created: Date.now(),
            });
            return res.json({
                token,
                username: user.username,
                role: user.role || 'personel',
                fullName: user.full_name || '',
                message: 'Giriş başarılı',
            });
        }

        if (ADMIN_PASSWORD && username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            const token = createToken();
            sessions.set(token, { username, role: 'admin', created: Date.now() });
            return res.json({ token, username, role: 'admin', message: 'Giriş başarılı' });
        }

        return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    });
});

app.post('/api/register', (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const role = String(req.body?.role || 'personel').trim();
    const fullName = String(req.body?.fullName || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const siteNameRaw = String(req.body?.siteName || '').trim();
    const companyNameRaw = String(req.body?.companyName || '').trim();

    if (!username || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve şifre zorunlu' });
    }
    if (!VALID_ROLES.includes(role) || role === 'admin') {
        return res.status(400).json({ error: 'Geçersiz kayıt rolü' });
    }
    if (username.length < 3 || username.length > 32) {
        return res.status(400).json({ error: 'Kullanıcı adı 3-32 karakter olmalı' });
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
        return res.status(400).json({ error: 'Kullanıcı adında sadece harf, rakam, . _ - kullanılabilir' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });
    }
    if (fullName && (fullName.length < 2 || fullName.length > 80)) {
        return res.status(400).json({ error: 'Ad soyad 2-80 karakter olmalı' });
    }
    if (!/^\+90 5\d{9}$/.test(phone)) {
        return res.status(400).json({ error: 'Telefon formatı +90 5XXXXXXXXX olmalı' });
    }
    const companyName = role === 'is_yapilan' ? companyNameRaw : '';
    const siteName = role === 'is_yapilan' ? siteNameRaw : '';
    if (siteName.length > 80 || companyName.length > 80) {
        return res.status(400).json({ error: 'Şantiye/Kurum adı en fazla 80 karakter olabilir' });
    }

    db.run(
        `INSERT INTO users
            (username, password, role, full_name, phone, site_name, company_name, extra_note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [username, password, role, fullName, phone, siteName, companyName, '', new Date().toISOString()],
        function registerCb(err) {
            if (err) {
                if (String(err.message || '').toLowerCase().includes('unique')) {
                    return res.status(409).json({ error: 'Bu kullanıcı adı zaten kayıtlı' });
                }
                return res.status(500).json({ error: 'Kayıt sırasında hata oluştu' });
            }

            bumpSync();
            return res.json({
                ok: true,
                user: { id: this.lastID, username, role, fullName, phone, siteName, companyName },
                message: 'Kayıt başarılı. Giriş yapabilirsiniz.',
            });
        }
    );
});

app.get('/api/users', requireAuth, requireAdmin, (_req, res) => {
    db.all(
        `SELECT id, username, password, role, full_name, phone, site_name, company_name, extra_note, created_at
         FROM users ORDER BY created_at DESC`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: 'Kullanıcılar okunamadı' });
            res.json(
                (rows || []).map((u) => ({
                    id: u.id,
                    username: u.username,
                    password: u.password || '',
                    role: u.role || 'personel',
                    roleLabel: ROLE_LABELS[u.role] || u.role,
                    fullName: u.full_name || '',
                    phone: u.phone || '',
                    siteName: u.site_name || '',
                    companyName: u.company_name || '',
                    extraNote: u.extra_note || '',
                    createdAt: u.created_at || '',
                }))
            );
        }
    );
});

app.put('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Geçersiz id' });

    const username = String(req.body?.username ?? '').trim();
    const role = String(req.body?.role || '').trim();
    const fullName = String(req.body?.fullName ?? '').trim();
    const phone = String(req.body?.phone ?? '').trim();
    const siteName = String(req.body?.siteName ?? '').trim();
    const companyName = String(req.body?.companyName ?? '').trim();
    const extraNote = String(req.body?.extraNote ?? '').trim();
    const password = String(req.body?.password ?? '');

    if (username) {
        if (username.length < 3 || username.length > 32) {
            return res.status(400).json({ error: 'Kullanıcı adı 3-32 karakter olmalı' });
        }
        if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
            return res.status(400).json({ error: 'Kullanıcı adında sadece harf, rakam, . _ - kullanılabilir' });
        }
    }
    if (role && !VALID_ROLES.includes(role)) {
        return res.status(400).json({ error: 'Geçersiz rol' });
    }
    if (fullName && (fullName.length < 2 || fullName.length > 80)) {
        return res.status(400).json({ error: 'Ad soyad 2-80 karakter olmalı' });
    }
    if (phone && !/^\+90 5\d{9}$/.test(phone)) {
        return res.status(400).json({ error: 'Telefon formatı +90 5XXXXXXXXX olmalı' });
    }
    if (siteName.length > 80 || companyName.length > 80) {
        return res.status(400).json({ error: 'Şantiye/Kurum adı en fazla 80 karakter olabilir' });
    }
    if (extraNote.length > 200) {
        return res.status(400).json({ error: 'Not en fazla 200 karakter olabilir' });
    }
    if (password && password.length < 6) {
        return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });
    }

    db.get('SELECT id, username, role FROM users WHERE id=?', [id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

        if (user.role === 'admin' && role && role !== 'admin') {
            db.get("SELECT COUNT(*) AS c FROM users WHERE role='admin'", [], (countErr, row) => {
                if (countErr) return res.status(500).json({ error: 'Güncelleme hatası' });
                if ((row?.c || 0) <= 1) {
                    return res.status(400).json({ error: 'Son admin kullanıcısının rolü değiştirilemez' });
                }
                checkUsernameAndUpdate();
            });
            return;
        }

        checkUsernameAndUpdate();

        function checkUsernameAndUpdate() {
            if (username && username !== user.username) {
                db.get('SELECT id FROM users WHERE username=? AND id!=?', [username, id], (nameErr, existing) => {
                    if (nameErr) return res.status(500).json({ error: 'Güncelleme hatası' });
                    if (existing) return res.status(409).json({ error: 'Bu kullanıcı adı zaten kayıtlı' });
                    updateUserRecord();
                });
                return;
            }
            updateUserRecord();
        }

        function updateUserRecord() {
            const fields = [];
            const values = [];

            if (username && username !== user.username) {
                fields.push('username=?');
                values.push(username);
            }
            if (role) {
                fields.push('role=?');
                values.push(role);
            }
            fields.push('full_name=?');
            values.push(fullName);
            fields.push('phone=?');
            values.push(phone);
            fields.push('site_name=?');
            values.push(siteName);
            fields.push('company_name=?');
            values.push(companyName);
            fields.push('extra_note=?');
            values.push(extraNote);
            if (password) {
                fields.push('password=?');
                values.push(password);
            }

            values.push(id);
            db.run(`UPDATE users SET ${fields.join(', ')} WHERE id=?`, values, (updateErr) => {
                if (updateErr) return res.status(500).json({ error: 'Güncelleme hatası' });
                bumpSync();
                res.json({ ok: true, message: 'Kullanıcı güncellendi' });
            });
        }
    });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Geçersiz id' });

    if (req.session.userId === id) {
        return res.status(400).json({ error: 'Oturum açtığınız kullanıcı silinemez' });
    }

    db.get('SELECT id, role FROM users WHERE id=?', [id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

        if (user.role === 'admin') {
            db.get("SELECT COUNT(*) AS c FROM users WHERE role='admin'", [], (countErr, row) => {
                if (countErr) return res.status(500).json({ error: 'Silme hatası' });
                if ((row?.c || 0) <= 1) {
                    return res.status(400).json({ error: 'Son admin kullanıcısı silinemez' });
                }
                removeUser();
            });
            return;
        }

        removeUser();

        function removeUser() {
            db.run('DELETE FROM users WHERE id=?', [id], (delErr) => {
                if (delErr) return res.status(500).json({ error: 'Silme hatası' });
                bumpSync();
                res.json({ ok: true, message: 'Kullanıcı silindi' });
            });
        }
    });
});

app.get('/api/me', requireAuth, (req, res) => {
    if (!req.session.userId) {
        return res.json({
            username: req.session.username,
            role: req.session.role || 'personel',
            fullName: req.session.fullName || '',
            phone: '',
            siteName: '',
            companyName: '',
            extraNote: '',
        });
    }

    db.get(
        `SELECT username, role, full_name, phone, site_name, company_name, extra_note
         FROM users WHERE id = ?`,
        [req.session.userId],
        (err, row) => {
            if (err || !row) {
                return res.json({
                    username: req.session.username,
                    role: req.session.role || 'personel',
                    fullName: req.session.fullName || '',
                    phone: '',
                    siteName: '',
                    companyName: '',
                    extraNote: '',
                });
            }
            return res.json({
                username: row.username,
                role: row.role || 'personel',
                fullName: row.full_name || '',
                phone: row.phone || '',
                siteName: row.site_name || '',
                companyName: row.company_name || '',
                extraNote: row.extra_note || '',
            });
        }
    );
});

app.post('/api/logout', requireAuth, (req, res) => {
    sessions.delete(req.token);
    res.json({ ok: true });
});

app.post('/upload', requireAuth, requireAdmin, (req, res) => {
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).send(err.message || 'Yükleme hatası');
        if (!req.file) return res.status(400).send('Dosya seçilmedi');

        const category = (req.body.category || 'reports').trim();
        if (!VALID_CATEGORIES.includes(category)) {
            return res.status(400).send('Geçersiz kategori');
        }

        db.run(
            'INSERT INTO files (filename, originalname, upload_date, category) VALUES (?, ?, ?, ?)',
            [req.file.filename, req.file.originalname, new Date().toISOString(), category],
            (dbErr) => {
                if (dbErr) return res.status(500).send('Veritabanı hatası');
                bumpSync();
                res.send('Dosya yüklendi');
            }
        );
    });
});

app.delete('/api/files/:id', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).send('Geçersiz id');
    db.get('SELECT filename FROM files WHERE id=?', [id], (err, row) => {
        if (err || !row) return res.status(404).send('Dosya bulunamadı');
        const filePath = path.join(uploadDir, row.filename);
        db.run('DELETE FROM files WHERE id=?', [id], (delErr) => {
            if (delErr) return res.status(500).send('Silinemedi');
            fs.unlink(filePath, () => {});
            bumpSync();
            res.send('Dosya silindi');
        });
    });
});

app.get('/files', (req, res) => {
    const category = (req.query.category || '').trim();
    if (category && !VALID_CATEGORIES.includes(category)) {
        return res.status(400).send('Geçersiz kategori');
    }

    const sql = category
        ? 'SELECT * FROM files WHERE category = ? ORDER BY upload_date DESC'
        : 'SELECT * FROM files ORDER BY upload_date DESC';
    const params = category ? [category] : [];

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).send('Veritabanı hatası');
        res.json(rows || []);
    });
});

app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).send('Sunucu hatası');
});

app.listen(PORT, () => {
    console.log(`Site: http://localhost:${PORT}`);
    console.log(`Admin: http://localhost:${PORT}/login.html`);
    if (!ADMIN_PASSWORD) console.warn('Uyarı: .env içinde ADMIN_PASSWORD ayarlayın');
});
