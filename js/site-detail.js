let siteMap;

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
}

document.addEventListener('DOMContentLoaded', async () => {
    const siteId = getSiteIdFromQuery();
    if (!siteId) {
        showError('Geçersiz şantiye bağlantısı.');
        return;
    }

    try {
        const res = await fetch(apiUrl(`/api/construction-sites/${siteId}`));
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
