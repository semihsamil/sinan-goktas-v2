document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuthPage()) return;

    const info = document.getElementById('work-user-info');
    const files = document.getElementById('work-files');

    try {
        const me = await apiFetch('/api/me');
        const roleLabel = me.role === 'is_yapilan' ? 'Kullanıcı' : me.role || 'personel';
        info.innerHTML = `
            <li><strong>Kullanıcı</strong> ${escapeText(me.username || '-')}</li>
            <li><strong>Rol</strong> ${escapeText(roleLabel)}</li>
            ${me.fullName ? `<li><strong>Ad Soyad</strong> ${escapeText(me.fullName)}</li>` : ''}
            ${me.phone ? `<li><strong>Telefon</strong> ${escapeText(me.phone)}</li>` : ''}
            ${me.siteName ? `<li><strong>Şantiye</strong> ${escapeText(me.siteName)}</li>` : ''}
            ${me.companyName ? `<li><strong>Kurum/Firma</strong> ${escapeText(me.companyName)}</li>` : ''}
        `;
    } catch {
        window.location.href = 'login.html';
        return;
    }

    if (files) {
        files.id = 'file-list';
        await loadFileList('file-list', 'reports', false);
        setInterval(() => loadFileList('file-list', 'reports', false), 15000);
    }

    document.getElementById('work-logout')?.addEventListener('click', async () => {
        try {
            await apiFetch('/api/logout', { method: 'POST' });
        } catch {
            // logout fail olsa da local oturumu temizle.
        }
        setToken('');
        setUser(null);
        window.location.href = 'login.html';
    });
});

function escapeText(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
}

