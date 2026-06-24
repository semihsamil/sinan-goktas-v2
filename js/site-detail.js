let siteMap;
let currentSiteId = null;

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text ?? '';
    return d.innerHTML;
}

function getSiteIdFromQuery() {
    const params = new URLSearchParams(window.location.search);
    return parseInt(params.get('id') || '', 10);
}

function showError(message) {
    const errorEl = document.getElementById('site-detail-error');
    const contentEl = document.getElementById('site-detail-content');
    if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = message;
    }
    if (contentEl) contentEl.hidden = true;
}

function isAdminUser() {
    try {
        const user = typeof getUser === 'function' ? getUser() : null;
        return user?.role === 'admin' && typeof getToken === 'function' && getToken();
    } catch {
        return false;
    }
}

function renderMap(site) {
    const container = document.getElementById('site-map-container');
    if (!container || typeof L === 'undefined') return;

    const lat = parseFloat(site.lat) || 39.7477;
    const lng = parseFloat(site.lng) || 37.0179;
    const label = site.name || 'Şantiye';

    siteMap = L.map('site-map-container').setView([lat, lng], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
    }).addTo(siteMap);

    L.marker([lat, lng]).addTo(siteMap).bindPopup(`<strong>${escapeHtml(label)}</strong>`).openPopup();

    setTimeout(() => siteMap.invalidateSize(), 300);
}

async function loadSiteFiles(siteId) {
    const listEl = document.getElementById('site-file-list');
    if (!listEl) return;

    try {
        const files = await fetch(
            apiUrl(`/files?category=general&site_id=${encodeURIComponent(siteId)}`)
        ).then((r) => r.json());

        if (!files.length) {
            listEl.innerHTML = '<p class="content-box empty">Bu şantiye için henüz dosya yüklenmemiş.</p>';
            return;
        }

        const admin = isAdminUser();
        listEl.innerHTML = `<ul class="file-list">${files
            .map((f) => {
                const del = admin
                    ? `<button type="button" class="btn btn-ghost btn-sm site-file-delete" data-id="${f.id}">Sil</button>`
                    : '';
                return `<li>
                    <a href="${apiUrl('/uploads/' + encodeURIComponent(f.filename))}" target="_blank" rel="noopener">${escapeHtml(f.originalname)}</a>
                    <span>${new Date(f.upload_date).toLocaleString('tr-TR')}</span>
                    ${del}
                </li>`;
            })
            .join('')}</ul>`;

        if (admin) {
            listEl.querySelectorAll('.site-file-delete').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    if (!confirm('Bu dosyayı silmek istiyor musunuz?')) return;
                    try {
                        await apiFetch(`/api/files/${btn.dataset.id}`, { method: 'DELETE' });
                        loadSiteFiles(siteId);
                    } catch (e) {
                        alert(e.message);
                    }
                });
            });
        }
    } catch {
        listEl.innerHTML = '<p class="form-status error">Dosya listesi yüklenemedi.</p>';
    }
}

function setupAdminFileUpload(siteId) {
    const adminBox = document.getElementById('site-file-admin');
    const input = document.getElementById('site-file-input');
    const btn = document.getElementById('site-file-upload');
    const statusEl = document.getElementById('site-file-status');
    const progressWrap = document.getElementById('site-file-progress');
    const progressBar = progressWrap?.querySelector('progress');
    const progressText = progressWrap?.querySelector('.progress-text');

    if (!isAdminUser() || !adminBox) return;
    adminBox.hidden = false;

    btn?.addEventListener('click', () => {
        const file = input?.files?.[0];
        if (!file) {
            if (statusEl) {
                statusEl.textContent = 'Dosya seçin.';
                statusEl.className = 'form-status error';
            }
            return;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('category', 'general');
        formData.append('site_id', String(siteId));

        if (progressWrap) progressWrap.style.display = 'block';
        if (progressBar) progressBar.value = 0;
        if (progressText) progressText.textContent = '0%';

        const xhr = new XMLHttpRequest();
        xhr.open('POST', apiUrl('/upload'));
        xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && progressBar && progressText) {
                const pct = Math.round((e.loaded / e.total) * 100);
                progressBar.value = pct;
                progressText.textContent = `${pct}%`;
            }
        };

        xhr.onload = () => {
            if (xhr.status === 200) {
                if (statusEl) {
                    statusEl.textContent = 'Dosya yüklendi.';
                    statusEl.className = 'form-status success';
                }
                if (input) input.value = '';
                loadSiteFiles(siteId);
                if (progressWrap) setTimeout(() => (progressWrap.style.display = 'none'), 1200);
            } else if (statusEl) {
                statusEl.textContent = xhr.responseText || 'Yükleme hatası';
                statusEl.className = 'form-status error';
            }
        };

        xhr.onerror = () => {
            if (statusEl) {
                statusEl.textContent = 'Bağlantı hatası';
                statusEl.className = 'form-status error';
            }
        };

        xhr.send(formData);
    });
}

function renderSiteDetail(site) {
    const titleEl = document.getElementById('site-title');
    const subtitleEl = document.getElementById('site-subtitle');
    const metaEl = document.getElementById('site-detail-meta');
    const addressLineEl = document.getElementById('site-address-line');
    const descriptionCard = document.getElementById('site-description-card');
    const descriptionEl = document.getElementById('site-description');
    const contentEl = document.getElementById('site-detail-content');

    if (titleEl) titleEl.textContent = site.name || 'Şantiye Detayı';
    if (subtitleEl) subtitleEl.textContent = site.address || 'Şantiye bilgileri';

    if (metaEl) {
        metaEl.innerHTML = `
            <li><strong>Şantiye adı</strong> ${escapeHtml(site.name || '-')}</li>
            <li><strong>Adres</strong> ${escapeHtml(site.address || 'Belirtilmemiş')}</li>
            <li><strong>Telefon</strong> ${site.phone ? `<a href="tel:${escapeHtml(site.phone.replace(/\s/g, ''))}">${escapeHtml(site.phone)}</a>` : 'Belirtilmemiş'}</li>
        `;
    }

    if (addressLineEl) {
        addressLineEl.textContent = site.address || 'Adres henüz girilmemiş.';
    }

    if (site.description && descriptionCard && descriptionEl) {
        descriptionCard.hidden = false;
        descriptionEl.textContent = site.description;
    }

    if (contentEl) contentEl.hidden = false;
    renderMap(site);
    loadSiteFiles(site.id);
    setupAdminFileUpload(site.id);
}

document.addEventListener('DOMContentLoaded', async () => {
    currentSiteId = getSiteIdFromQuery();
    if (!currentSiteId) {
        showError('Geçersiz şantiye bağlantısı.');
        return;
    }

    try {
        const res = await fetch(apiUrl(`/api/construction-sites/${currentSiteId}`));
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showError(data.error || 'Şantiye bulunamadı.');
            return;
        }
        const site = await res.json();
        renderSiteDetail(site);
    } catch {
        showError('Şantiye bilgileri yüklenemedi.');
    }
});
