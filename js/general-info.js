let siteMap;

document.addEventListener('DOMContentLoaded', async () => {
    const addressEl = document.getElementById('site-address-line');
    const container = document.getElementById('site-map-container');
    if (!container || typeof L === 'undefined') return;

    let lat = 39.7477;
    let lng = 37.0179;
    let label = 'Şantiye Konumu';
    let address = '';

    try {
        const s = await fetch(apiUrl('/api/settings')).then((r) => r.json());
        lat = parseFloat(s.site_lat) || lat;
        lng = parseFloat(s.site_lng) || lng;
        label = s.site_label || label;
        address = s.site_address || '';
    } catch {
        /* varsayılan */
    }

    if (addressEl) {
        addressEl.textContent = address || 'Şantiye adresi henüz girilmemiş.';
    }

    siteMap = L.map('site-map-container').setView([lat, lng], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
    }).addTo(siteMap);

    L.marker([lat, lng]).addTo(siteMap).bindPopup(`<strong>${escapeHtml(label)}</strong>`).openPopup();

    setTimeout(() => siteMap.invalidateSize(), 300);
});

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text ?? '';
    return d.innerHTML;
}
