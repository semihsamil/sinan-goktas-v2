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
    contact_phone: '+90 5555555555',
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
        { name: 'salary_day_of_month', sql: 'ALTER TABLE users ADD COLUMN salary_day_of_month INTEGER' },
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

const MOBILE_PHONE_PREFIX = '+90 5';
const MOBILE_PHONE_REGEX = /^\+90 5\d{9}$/;

function validateTextNameOptional(value, fieldLabel) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;
    if (trimmed.length < 2 || trimmed.length > 80) {
        return { error: `${fieldLabel} 2-80 karakter olmalı` };
    }
    if (/\d/.test(trimmed)) {
        return { error: `${fieldLabel} alanına rakam yazılamaz` };
    }
    return null;
}

function validateMobilePhoneOptional(phone) {
    const trimmed = String(phone || '').trim();
    if (!trimmed || trimmed === MOBILE_PHONE_PREFIX) return null;
    if (!MOBILE_PHONE_REGEX.test(trimmed)) {
        return { error: 'Telefon formatı +90 5XXXXXXXXX olmalı' };
    }
    return null;
}

function validateMobilePhoneRequired(phone) {
    const trimmed = String(phone || '').trim();
    if (!trimmed || trimmed === MOBILE_PHONE_PREFIX) {
        return { error: 'Telefon zorunlu' };
    }
    if (!MOBILE_PHONE_REGEX.test(trimmed)) {
        return { error: 'Telefon formatı +90 5XXXXXXXXX olmalı' };
    }
    return null;
}

function sanitizeCoordinateServer(value) {
    let text = String(value || '').trim().replace(/,/g, '.');
    text = text.replace(/[^\d.]/g, '');
    const parts = text.split('.');
    if (parts.length <= 1) return parts[0] || '';
    return `${parts[0]}.${parts.slice(1).join('')}`;
}

function validateCoordinateOptional(value, fieldLabel) {
    const trimmed = sanitizeCoordinateServer(value);
    if (!trimmed) return null;
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
        return { error: `${fieldLabel} yalnızca sayı olmalı (ör. 39.7477)` };
    }
    return null;
}

function validateSalaryDayOfMonth(value, required = false) {
    const raw = value === null || value === undefined ? '' : String(value).trim();
    if (!raw) {
        return required ? { error: 'Maaş günü zorunlu (1-31)' } : { day: null };
    }
    const day = parseInt(raw, 10);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
        return { error: 'Maaş günü 1 ile 31 arasında olmalı' };
    }
    return { day };
}

function validateAdminUserCreate(body) {
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');
    const role = String(body?.role || 'personel').trim();
    const fullName = String(body?.fullName || '').trim();
    const phone = String(body?.phone || '').trim();
    const siteNameRaw = String(body?.siteName || '').trim();
    const companyNameRaw = String(body?.companyName || '').trim();
    const extraNote = String(body?.extraNote || '').trim();

    if (!username || !password) {
        return { error: 'Kullanıcı adı ve şifre zorunlu' };
    }
    if (!VALID_ROLES.includes(role)) {
        return { error: 'Geçersiz rol' };
    }
    if (username.length < 3 || username.length > 32) {
        return { error: 'Kullanıcı adı 3-32 karakter olmalı' };
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
        return { error: 'Kullanıcı adında sadece harf, rakam, . _ - kullanılabilir' };
    }
    if (password.length < 6) {
        return { error: 'Şifre en az 6 karakter olmalı' };
    }
    const fullNameErr = validateTextNameOptional(fullName, 'Ad soyad');
    if (fullNameErr) return fullNameErr;
    const phoneErr = validateMobilePhoneOptional(phone);
    if (phoneErr) return phoneErr;
    const companyName = role === 'is_yapilan' ? companyNameRaw : '';
    const siteName = role === 'is_yapilan' ? siteNameRaw : '';
    if (siteName.length > 80 || companyName.length > 80) {
        return { error: 'Şantiye/Kurum adı en fazla 80 karakter olabilir' };
    }
    const siteNameErr = validateTextNameOptional(siteName, 'Şantiye adı');
    if (siteNameErr) return siteNameErr;
    const companyNameErr = validateTextNameOptional(companyName, 'Kurum / firma');
    if (companyNameErr) return companyNameErr;
    if (extraNote.length > 200) {
        return { error: 'Not en fazla 200 karakter olabilir' };
    }

    let salaryDayOfMonth = null;
    if (role === 'personel') {
        const salaryErr = validateSalaryDayOfMonth(body?.salaryDayOfMonth, true);
        if (salaryErr.error) return salaryErr;
        salaryDayOfMonth = salaryErr.day;
    }

    return {
        username,
        password,
        role,
        fullName,
        phone,
        siteName,
        companyName,
        extraNote,
        salaryDayOfMonth,
    };
}

function todayDateOnly() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function parseDateOnly(value) {
    const d = new Date(String(value || '').trim());
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
}

function validateFutureOrTodayDate(value, fieldLabel, required = false) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        return required ? { error: `${fieldLabel} zorunlu` } : null;
    }
    const d = parseDateOnly(trimmed);
    if (!d) return { error: `${fieldLabel} geçerli bir tarih olmalı` };
    if (d < todayDateOnly()) return { error: `${fieldLabel} geçmiş bir tarih olamaz` };
    return null;
}

function validateLeaveRange(leaveDay, leaveEndDay) {
    const start = String(leaveDay || '').trim();
    const end = String(leaveEndDay || '').trim();

    if (!start && !end) {
        return { leaveDay: '', leaveEndDay: '' };
    }
    if (!start && end) {
        return { error: 'İzin başlangıç günü gerekli' };
    }

    const startErr = validateFutureOrTodayDate(start, 'İzin başlangıç günü', true);
    if (startErr) return startErr;

    if (!end || end === start) {
        return { leaveDay: start, leaveEndDay: '' };
    }

    const endErr = validateFutureOrTodayDate(end, 'İzin bitiş günü', true);
    if (endErr) return endErr;

    const startDate = parseDateOnly(start);
    const endDate = parseDateOnly(end);
    if (endDate < startDate) {
        return { error: 'İzin bitiş günü başlangıç gününden önce olamaz' };
    }

    return { leaveDay: start, leaveEndDay: end };
}

function migrateFilesSiteId(done) {
    db.all('PRAGMA table_info(files)', [], (err, cols) => {
        if (err) return done(err);
        if ((cols || []).some((c) => c.name === 'site_id')) return done();
        db.run('ALTER TABLE files ADD COLUMN site_id INTEGER', done);
    });
}

function migratePersonnelScheduleTable(done) {
    db.run(
        `CREATE TABLE IF NOT EXISTS personnel_schedule (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            salary_day TEXT,
            leave_day TEXT,
            leave_end_day TEXT,
            note TEXT,
            created_at TEXT
        )`,
        done
    );
}

function migratePersonnelScheduleLeaveEnd(done) {
    db.all('PRAGMA table_info(personnel_schedule)', [], (err, cols) => {
        if (err) return done(err);
        if ((cols || []).some((c) => c.name === 'leave_end_day')) return done();
        db.run('ALTER TABLE personnel_schedule ADD COLUMN leave_end_day TEXT', done);
    });
}

function migrateSalaryPaymentsTable(done) {
    db.run(
        `CREATE TABLE IF NOT EXISTS salary_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            payment_date TEXT NOT NULL,
            invoice_no TEXT,
            payment_type TEXT DEFAULT 'salary',
            note TEXT,
            created_at TEXT
        )`,
        done
    );
}

function migrateAuthSessionsTable(done) {
    db.run(
        `CREATE TABLE IF NOT EXISTS auth_sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER,
            username TEXT,
            role TEXT,
            full_name TEXT,
            created_at INTEGER NOT NULL
        )`,
        done
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
    const lat = sanitizeCoordinateServer(body?.lat);
    const lng = sanitizeCoordinateServer(body?.lng);
    const description = String(body?.description || '').trim();

    if (isCreate && !name) return { error: 'Şantiye adı zorunlu' };
    if (name && (name.length < 2 || name.length > 100)) {
        return { error: 'Şantiye adı 2-100 karakter olmalı' };
    }
    const nameErr = validateTextNameOptional(name, 'Şantiye adı');
    if (nameErr) return nameErr;
    if (address.length > 200) return { error: 'Adres en fazla 200 karakter olabilir' };
    const phoneErr = validateMobilePhoneOptional(phone);
    if (phoneErr) return phoneErr;
    if (description.length > 500) return { error: 'Açıklama en fazla 500 karakter olabilir' };
    const latErr = validateCoordinateOptional(lat, 'Enlem');
    if (latErr) return latErr;
    const lngErr = validateCoordinateOptional(lng, 'Boylam');
    if (lngErr) return lngErr;

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
    migrateFilesSiteId((migrateErr) => {
        if (migrateErr) console.error('Dosya site_id migration hatası:', migrateErr.message);
    });
    migratePersonnelScheduleTable((migrateErr) => {
        if (migrateErr) console.error('Çizelge tablosu migration hatası:', migrateErr.message);
    });
    migratePersonnelScheduleLeaveEnd((migrateErr) => {
        if (migrateErr) console.error('Çizelge leave_end_day migration hatası:', migrateErr.message);
    });
    migrateSalaryPaymentsTable((migrateErr) => {
        if (migrateErr) console.error('Maaş tablosu migration hatası:', migrateErr.message);
    });
    migrateAuthSessionsTable((migrateErr) => {
        if (migrateErr) console.error('Oturum tablosu migration hatası:', migrateErr.message);
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

function sessionFromRow(row) {
    return {
        userId: row.user_id ?? undefined,
        username: row.username || '',
        role: row.role || 'personel',
        fullName: row.full_name || '',
        created: row.created_at,
    };
}

function storeSession(token, session, cb) {
    sessions.set(token, session);
    db.run(
        `INSERT OR REPLACE INTO auth_sessions (token, user_id, username, role, full_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            token,
            session.userId ?? null,
            session.username || '',
            session.role || 'personel',
            session.fullName || '',
            session.created,
        ],
        cb
    );
}

function removeSession(token, cb) {
    sessions.delete(token);
    db.run('DELETE FROM auth_sessions WHERE token = ?', [token], cb || (() => {}));
}

function cleanSessions() {
    const cutoff = Date.now() - SESSION_MAX_AGE_MS;
    for (const [token, data] of sessions.entries()) {
        if (data.created < cutoff) sessions.delete(token);
    }
    db.run('DELETE FROM auth_sessions WHERE created_at < ?', [cutoff]);
}

setInterval(cleanSessions, 60 * 60 * 1000);

function requireAuth(req, res, next) {
    cleanSessions();
    const auth = req.get('authorization') || '';
    const queryToken = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
    const token = auth.replace(/^Bearer\s+/i, '').trim() || queryToken;
    if (!token) {
        return res.status(401).json({ error: 'Oturum bulunamadı. Lütfen tekrar giriş yapın.' });
    }

    const cached = sessions.get(token);
    if (cached) {
        if (Date.now() - cached.created > SESSION_MAX_AGE_MS) {
            removeSession(token);
            return res.status(401).json({ error: 'Oturum süresi doldu. Lütfen tekrar giriş yapın.' });
        }
        req.session = cached;
        req.token = token;
        return next();
    }

    db.get('SELECT * FROM auth_sessions WHERE token = ?', [token], (err, row) => {
        if (err || !row) {
            return res.status(401).json({ error: 'Oturum geçersiz. Lütfen tekrar giriş yapın.' });
        }
        if (Date.now() - row.created_at > SESSION_MAX_AGE_MS) {
            removeSession(token);
            return res.status(401).json({ error: 'Oturum süresi doldu. Lütfen tekrar giriş yapın.' });
        }
        const session = sessionFromRow(row);
        sessions.set(token, session);
        req.session = session;
        req.token = token;
        next();
    });
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

    const email = String(body.contact_email || '').trim();
    if (body.contact_email !== undefined) {
        if (!email || !email.includes('@') || email.length > 120) {
            return res.status(400).send('Geçerli bir e-posta adresi girin');
        }
    }
    const phoneErr = body.contact_phone !== undefined ? validateMobilePhoneRequired(body.contact_phone) : null;
    if (phoneErr) return res.status(400).send(phoneErr.error);
    if (body.map_lat !== undefined) {
        const latErr = validateCoordinateOptional(body.map_lat, 'Enlem');
        if (latErr) return res.status(400).send(latErr.error);
        body.map_lat = sanitizeCoordinateServer(body.map_lat);
    }
    if (body.map_lng !== undefined) {
        const lngErr = validateCoordinateOptional(body.map_lng, 'Boylam');
        if (lngErr) return res.status(400).send(lngErr.error);
        body.map_lng = sanitizeCoordinateServer(body.map_lng);
    }

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
            const session = {
                userId: user.id,
                username: user.username,
                role: user.role || 'personel',
                fullName: user.full_name || '',
                created: Date.now(),
            };
            return storeSession(token, session, (storeErr) => {
                if (storeErr) return res.status(500).json({ error: 'Giriş sırasında hata oluştu' });
                return res.json({
                    token,
                    username: user.username,
                    role: user.role || 'personel',
                    fullName: user.full_name || '',
                    message: 'Giriş başarılı',
                });
            });
        }

        if (ADMIN_PASSWORD && username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            const token = createToken();
            const session = { username, role: 'admin', created: Date.now() };
            return storeSession(token, session, (storeErr) => {
                if (storeErr) return res.status(500).json({ error: 'Giriş sırasında hata oluştu' });
                return res.json({ token, username, role: 'admin', message: 'Giriş başarılı' });
            });
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
    const fullNameErr = validateTextNameOptional(fullName, 'Ad soyad');
    if (fullNameErr) return res.status(400).json(fullNameErr);
    const phoneErr = validateMobilePhoneRequired(phone);
    if (phoneErr) return res.status(400).json(phoneErr);
    const companyName = role === 'is_yapilan' ? companyNameRaw : '';
    const siteName = role === 'is_yapilan' ? siteNameRaw : '';
    if (siteName.length > 80 || companyName.length > 80) {
        return res.status(400).json({ error: 'Şantiye/Kurum adı en fazla 80 karakter olabilir' });
    }
    const siteNameErr = validateTextNameOptional(siteName, 'Şantiye adı');
    if (siteNameErr) return res.status(400).json(siteNameErr);
    const companyNameErr = validateTextNameOptional(companyName, 'Kurum / firma');
    if (companyNameErr) return res.status(400).json(companyNameErr);

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
        `SELECT id, username, password, role, full_name, phone, site_name, company_name, extra_note,
                salary_day_of_month, created_at
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
                    salaryDayOfMonth: u.salary_day_of_month ?? null,
                    createdAt: u.created_at || '',
                }))
            );
        }
    );
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
    const validated = validateAdminUserCreate(req.body || {});
    if (validated.error) return res.status(400).json({ error: validated.error });

    db.run(
        `INSERT INTO users
            (username, password, role, full_name, phone, site_name, company_name, extra_note, salary_day_of_month, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            validated.username,
            validated.password,
            validated.role,
            validated.fullName,
            validated.phone,
            validated.siteName,
            validated.companyName,
            validated.extraNote,
            validated.salaryDayOfMonth,
            new Date().toISOString(),
        ],
        function createUserCb(err) {
            if (err) {
                if (String(err.message || '').toLowerCase().includes('unique')) {
                    return res.status(409).json({ error: 'Bu kullanıcı adı zaten kayıtlı' });
                }
                return res.status(500).json({ error: 'Kullanıcı eklenemedi' });
            }

            bumpSync();
            return res.json({
                ok: true,
                id: this.lastID,
                message: 'Yeni kullanıcı eklendi',
            });
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
    const fullNameErr = validateTextNameOptional(fullName, 'Ad soyad');
    if (fullNameErr) return res.status(400).json(fullNameErr);
    const phoneErr = validateMobilePhoneOptional(phone);
    if (phoneErr) return res.status(400).json(phoneErr);
    if (siteName.length > 80 || companyName.length > 80) {
        return res.status(400).json({ error: 'Şantiye/Kurum adı en fazla 80 karakter olabilir' });
    }
    const siteNameErr = validateTextNameOptional(siteName, 'Şantiye adı');
    if (siteNameErr) return res.status(400).json(siteNameErr);
    const companyNameErr = validateTextNameOptional(companyName, 'Kurum / firma');
    if (companyNameErr) return res.status(400).json(companyNameErr);
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
            const nextRole = role || user.role || 'personel';

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
            if (nextRole === 'personel') {
                const salaryErr = validateSalaryDayOfMonth(req.body?.salaryDayOfMonth, true);
                if (salaryErr.error) {
                    return res.status(400).json(salaryErr);
                }
                fields.push('salary_day_of_month=?');
                values.push(salaryErr.day);
            } else {
                fields.push('salary_day_of_month=?');
                values.push(null);
            }
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
    removeSession(req.token, (err) => {
        if (err) return res.status(500).json({ error: 'Çıkış sırasında hata oluştu' });
        res.json({ ok: true });
    });
});

app.get('/api/personnel-schedule', requireAuth, requireAdmin, (_req, res) => {
    db.all(
        `SELECT ps.id, ps.user_id, ps.leave_day, ps.leave_end_day, ps.note, ps.created_at,
                u.full_name, u.username, u.salary_day_of_month
         FROM personnel_schedule ps
         LEFT JOIN users u ON u.id = ps.user_id
         ORDER BY u.salary_day_of_month ASC, u.full_name ASC`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: 'Personel takibi okunamadı' });
            res.json(
                (rows || []).map((r) => ({
                    id: r.id,
                    userId: r.user_id,
                    fullName: r.full_name || r.username || '',
                    username: r.username || '',
                    salaryDay: r.salary_day_of_month ? String(r.salary_day_of_month) : '',
                    salaryDayOfMonth: r.salary_day_of_month ?? null,
                    leaveDay: r.leave_day || '',
                    leaveEndDay: r.leave_end_day || '',
                    note: r.note || '',
                    createdAt: r.created_at || '',
                }))
            );
        }
    );
});

app.post('/api/personnel-schedule', requireAuth, requireAdmin, (req, res) => {
    const userId = parseInt(req.body?.userId, 10);
    const note = String(req.body?.note || '').trim();

    if (!userId) return res.status(400).json({ error: 'Personel seçin' });

    const leaveValidated = validateLeaveRange(req.body?.leaveDay, req.body?.leaveEndDay);
    if (leaveValidated.error) return res.status(400).json({ error: leaveValidated.error });

    db.get('SELECT id, role, salary_day_of_month FROM users WHERE id=?', [userId], (userErr, user) => {
        if (userErr || !user) return res.status(404).json({ error: 'Personel bulunamadı' });
        if (user.role !== 'personel') {
            return res.status(400).json({ error: 'Personel takibine yalnızca personel rolü eklenebilir' });
        }
        if (!user.salary_day_of_month) {
            return res.status(400).json({
                error: 'Personelin maaş günü tanımlı değil. Kullanıcılar sekmesinden maaş günü girin.',
            });
        }
        if (note.length > 200) return res.status(400).json({ error: 'Not en fazla 200 karakter olabilir' });

        db.run(
            `INSERT INTO personnel_schedule (user_id, salary_day, leave_day, leave_end_day, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                userId,
                String(user.salary_day_of_month),
                leaveValidated.leaveDay,
                leaveValidated.leaveEndDay,
                note,
                new Date().toISOString(),
            ],
            function insertCb(err) {
                if (err) return res.status(500).json({ error: 'Kayıt eklenemedi' });
                bumpSync();
                res.json({ ok: true, id: this.lastID, message: 'Personel takip kaydı eklendi' });
            }
        );
    });
});

app.put('/api/personnel-schedule/:id', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Geçersiz id' });

    const note = String(req.body?.note || '').trim();
    const leaveValidated = validateLeaveRange(req.body?.leaveDay, req.body?.leaveEndDay);
    if (leaveValidated.error) return res.status(400).json({ error: leaveValidated.error });
    if (note.length > 200) return res.status(400).json({ error: 'Not en fazla 200 karakter olabilir' });

    db.run(
        'UPDATE personnel_schedule SET leave_day=?, leave_end_day=?, note=? WHERE id=?',
        [leaveValidated.leaveDay, leaveValidated.leaveEndDay, note, id],
        function updateCb(err) {
            if (err) return res.status(500).json({ error: 'Güncellenemedi' });
            if (this.changes === 0) return res.status(404).json({ error: 'Kayıt bulunamadı' });
            bumpSync();
            res.json({ ok: true, message: 'Personel takip kaydı güncellendi' });
        }
    );
});

app.delete('/api/personnel-schedule/:id', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Geçersiz id' });
    db.run('DELETE FROM personnel_schedule WHERE id=?', [id], function delCb(err) {
        if (err) return res.status(500).json({ error: 'Silinemedi' });
        if (this.changes === 0) return res.status(404).json({ error: 'Kayıt bulunamadı' });
        bumpSync();
        res.json({ ok: true, message: 'Kayıt silindi' });
    });
});

app.post('/upload', requireAuth, requireAdmin, (req, res) => {
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).send(err.message || 'Yükleme hatası');
        if (!req.file) return res.status(400).send('Dosya seçilmedi');

        const category = (req.body.category || 'reports').trim();
        if (!VALID_CATEGORIES.includes(category)) {
            return res.status(400).send('Geçersiz kategori');
        }

        const siteIdRaw = req.body.site_id ?? req.body.siteId;
        const siteId = siteIdRaw ? parseInt(siteIdRaw, 10) : null;
        if (category === 'general') {
            if (!siteId) return res.status(400).send('Şantiye seçimi zorunlu');
            db.get('SELECT id FROM construction_sites WHERE id=?', [siteId], (siteErr, siteRow) => {
                if (siteErr || !siteRow) return res.status(400).send('Geçersiz şantiye');
                insertFileRecord(siteId);
            });
            return;
        }
        insertFileRecord(null);

        function insertFileRecord(siteIdValue) {
            db.run(
                'INSERT INTO files (filename, originalname, upload_date, category, site_id) VALUES (?, ?, ?, ?, ?)',
                [req.file.filename, req.file.originalname, new Date().toISOString(), category, siteIdValue],
                (dbErr) => {
                    if (dbErr) return res.status(500).send('Veritabanı hatası');
                    bumpSync();
                    res.send('Dosya yüklendi');
                }
            );
        }
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
    const siteId = parseInt(req.query.site_id || req.query.siteId || '', 10);
    if (category && !VALID_CATEGORIES.includes(category)) {
        return res.status(400).send('Geçersiz kategori');
    }

    let sql = 'SELECT * FROM files';
    const params = [];
    const clauses = [];
    if (category) {
        clauses.push('category = ?');
        params.push(category);
    }
    if (siteId) {
        clauses.push('site_id = ?');
        params.push(siteId);
    }
    if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
    sql += ' ORDER BY upload_date DESC';

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
    console.log(`Admin: http://localhost:${PORT}/admin-login.html`);
    if (!ADMIN_PASSWORD) console.warn('Uyarı: .env içinde ADMIN_PASSWORD ayarlayın');
});
