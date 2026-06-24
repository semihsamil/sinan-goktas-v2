const NAV_ITEMS = [
    { href: 'index.html', label: 'Ana Sayfa', id: 'home' },
    { href: 'general-info.html', label: 'Genel Şantiye Bilgileri', id: 'general' },
    { href: 'daily-reports.html', label: 'Günlük Raporlar', id: 'reports' },
    { href: 'notes.html', label: 'Bilgi Notları', id: 'notes' },
    { href: 'work-tracking.html', label: 'İş Takibi', id: 'work' },
    { href: 'schedule.html', label: 'Şantiye Çizelgesi', id: 'schedule' },
    { href: 'map.html', label: 'Konum Haritası', id: 'map' },
    { href: 'kullanim-kilavuzu.html', label: 'Kullanım Kılavuzu', id: 'guide' },
];

const PAGE_CATEGORY = {
    general: 'general',
    reports: 'reports',
    notes: 'notes',
    schedule: 'schedule',
};

const EMPTY_MESSAGES = {
    general: 'Henüz genel bilgi dosyası yüklenmemiş.',
    reports: 'Henüz günlük rapor dosyası yüklenmemiş.',
    notes: 'Henüz bilgi notu dosyası yüklenmemiş.',
    schedule: 'Henüz çizelge dosyası yüklenmemiş.',
};

function getActivePage() {
    return document.body.dataset.page || '';
}

function renderHeader() {
    const header = document.getElementById('site-header');
    if (!header) return;

    const active = getActivePage();
    const isAdmin = active === 'admin';

    const desktopNav = isAdmin
        ? ''
        : `<nav class="desktop-nav" aria-label="Ana menü">${NAV_ITEMS.filter((i) => i.id !== 'home')
              .map(
                  (item) =>
                      `<a href="${item.href}" class="${active === item.id ? 'active' : ''}">${item.label}</a>`
              )
              .join('')}</nav>`;

    header.innerHTML = `
        <a href="index.html" class="brand">Mimar Sinan Göktaş</a>
        ${desktopNav}
        <div class="header-actions">
            ${isAdmin ? '' : '<a href="login.html" class="btn btn-primary btn-login-desktop">Giriş / Admin</a>'}
            ${isAdmin ? '<a href="index.html" class="btn btn-ghost">Siteye Dön</a>' : ''}
            <button type="button" class="burger" id="burger" aria-label="Menü">☰</button>
        </div>
    `;

    const navList = NAV_ITEMS.map(
        (item) =>
            `<li><a href="${item.href}" class="${active === item.id ? 'active' : ''}">${item.label}</a></li>`
    ).join('');

    let overlay = document.getElementById('nav-overlay');
    let drawer = document.getElementById('nav-drawer');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'nav-overlay';
        overlay.className = 'nav-overlay';
        document.body.appendChild(overlay);
    }

    if (!drawer) {
        drawer = document.createElement('aside');
        drawer.id = 'nav-drawer';
        drawer.className = 'nav-drawer';
        document.body.appendChild(drawer);
    }

    drawer.innerHTML = `<h2>Menü</h2><ul>${navList}</ul>`;

    const burger = document.getElementById('burger');
    const closeNav = () => {
        overlay.classList.remove('open');
        drawer.classList.remove('open');
        document.body.style.overflow = '';
    };
    const openNav = () => {
        overlay.classList.add('open');
        drawer.classList.add('open');
        document.body.style.overflow = 'hidden';
    };

    burger?.addEventListener('click', () => {
        if (drawer.classList.contains('open')) closeNav();
        else openNav();
    });
    overlay.addEventListener('click', closeNav);
    drawer.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeNav));
}

function setFooterYear() {
    const y = document.getElementById('year');
    if (y) y.textContent = new Date().getFullYear();
}

async function loadContactInfo() {
    const list = document.getElementById('contact-list');
    if (!list) return;
    try {
        const s = await fetch(apiUrl('/api/settings')).then((r) => r.json());
        list.innerHTML = `
            <li><strong>E-posta</strong> <a href="mailto:${escapeHtml(s.contact_email)}">${escapeHtml(s.contact_email)}</a></li>
            <li><strong>Telefon</strong> ${escapeHtml(s.contact_phone)}</li>
            <li><strong>Adres</strong> ${escapeHtml(s.contact_address)}</li>
        `;
    } catch {
        list.innerHTML = '<li class="empty">İletişim bilgisi yüklenemedi.</li>';
    }
}

async function loadFileList(containerId, category, adminMode = false) {
    const list = document.getElementById(containerId);
    if (!list) return;

    try {
        const files = await fetch(apiUrl(`/files?category=${encodeURIComponent(category)}`)).then((r) =>
            r.json()
        );

        if (!files.length) {
            list.innerHTML = `<p class="content-box empty">${EMPTY_MESSAGES[category] || 'Henüz dosya yok.'}</p>`;
            list.classList.remove('file-list');
            return;
        }

        list.innerHTML = `<ul>${files
            .map((f) => {
                const del = adminMode
                    ? `<button type="button" class="btn btn-ghost btn-sm" data-delete="${f.id}">Sil</button>`
                    : '';
                return `<li>
                    <a href="${apiUrl('/uploads/' + encodeURIComponent(f.filename))}" target="_blank" rel="noopener">${escapeHtml(f.originalname)}</a>
                    <span>${new Date(f.upload_date).toLocaleString('tr-TR')}</span>
                    ${del}
                </li>`;
            })
            .join('')}</ul>`;
        list.classList.add('file-list');

        if (adminMode) {
            list.querySelectorAll('[data-delete]').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    if (!confirm('Bu dosyayı silmek istiyor musunuz?')) return;
                    try {
                        await apiFetch(`/api/files/${btn.dataset.delete}`, { method: 'DELETE' });
                        loadFileList(containerId, category, true);
                    } catch (e) {
                        alert(e.message);
                    }
                });
            });
        }
    } catch {
        list.innerHTML = '<p class="form-status error">Dosya listesi alınamadı. Sunucu çalışıyor mu?</p>';
    }
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
    renderHeader();
    setFooterYear();

    const page = getActivePage();
    if (page === 'home') loadContactInfo();

    const category = PAGE_CATEGORY[page];
    if (category) {
        loadFileList('file-list', category, false);
        setInterval(() => loadFileList('file-list', category, false), 15000);
    }
});

// Admin paneli de kullanır
window.loadFileList = loadFileList;
