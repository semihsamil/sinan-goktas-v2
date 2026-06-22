let siteMap;

document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('map-container');
    if (!container || typeof L === 'undefined') return;

    let lat = 39.7477;
    let lng = 37.0179;
    let label = 'Mimar Sinan Göktaş';

    try {
        const s = await fetch(apiUrl('/api/settings')).then((r) => r.json());
        lat = parseFloat(s.map_lat) || lat;
        lng = parseFloat(s.map_lng) || lng;
        label = s.map_label || label;
    } catch {
        /* varsayılan koordinat */
    }

    siteMap = L.map('map-container').setView([lat, lng], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
    }).addTo(siteMap);

    L.marker([lat, lng]).addTo(siteMap).bindPopup(`<strong>${label}</strong>`).openPopup();

    setTimeout(() => siteMap.invalidateSize(), 300);
});
