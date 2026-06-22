async function loadConstructionSites() {
    const listEl = document.getElementById('sites-list');
    if (!listEl) return;

    try {
        const sites = await fetch(apiUrl('/api/construction-sites')).then((r) => r.json());

        if (!sites.length) {
            listEl.innerHTML = '<p class="content-box empty">Henüz kayıtlı şantiye yok.</p>';
            return;
        }

        listEl.innerHTML = `<ul class="sites-list-items">${sites
            .map(
                (site) => `<li class="sites-list-item">
                    <div class="sites-list-info">
                        <strong class="sites-list-name">${escapeHtml(site.name)}</strong>
                        ${site.address ? `<span class="sites-list-address">${escapeHtml(site.address)}</span>` : ''}
                    </div>
                    <a href="site-detail.html?id=${site.id}" class="btn btn-primary btn-sm">Görüntüle</a>
                </li>`
            )
            .join('')}</ul>`;
    } catch {
        listEl.innerHTML = '<p class="form-status error">Şantiye listesi yüklenemedi.</p>';
    }
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text ?? '';
    return d.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
    loadConstructionSites();
    setInterval(loadConstructionSites, 15000);
});
