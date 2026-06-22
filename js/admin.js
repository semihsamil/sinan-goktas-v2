const FILE_PANELS = [
    { category: 'general', inputId: 'file-general', uploadId: 'upload-general', statusId: 'status-general', listId: 'list-general', progressId: 'progress-general' },
    { category: 'reports', inputId: 'file-reports', uploadId: 'upload-reports', statusId: 'status-reports', listId: 'list-reports', progressId: 'progress-reports' },
    { category: 'notes', inputId: 'file-notes', uploadId: 'upload-notes', statusId: 'status-notes', listId: 'list-notes', progressId: 'progress-notes' },
    { category: 'schedule', inputId: 'file-schedule', uploadId: 'upload-schedule', statusId: 'status-schedule', listId: 'list-schedule', progressId: 'progress-schedule' },
];

const ROLE_OPTIONS = [
    { value: 'personel', label: 'Personel' },
    { value: 'is_yapilan', label: 'Kullanıcı' },
    { value: 'admin', label: 'Admin' },
];

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAdminPage()) return;

    const tabs = document.querySelectorAll('.admin-tab');
    const panels = document.querySelectorAll('.tab-panel');

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const name = tab.dataset.tab;
            tabs.forEach((t) => t.classList.toggle('active', t === tab));
            panels.forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
            if (name === 'users') loadUsers();
        });
    });

    try {
        const settings = await fetch(apiUrl('/api/settings')).then((r) => r.json());
        document.getElementById('contact_email').value = settings.contact_email || '';
        document.getElementById('contact_phone').value = settings.contact_phone || '';
        document.getElementById('contact_address').value = settings.contact_address || '';
        document.getElementById('map_lat').value = settings.map_lat || '';
        document.getElementById('map_lng').value = settings.map_lng || '';
        document.getElementById('map_label').value = settings.map_label || '';
        document.getElementById('site_address').value = settings.site_address || '';
        document.getElementById('site_lat').value = settings.site_lat || '';
        document.getElementById('site_lng').value = settings.site_lng || '';
        document.getElementById('site_label').value = settings.site_label || '';
    } catch (e) {
        showStatus('admin-status', 'Ayarlar yüklenemedi: ' + e.message, 'error');
    }

    FILE_PANELS.forEach((panel) => {
        loadFileList(panel.listId, panel.category, true);
        document.getElementById(panel.uploadId)?.addEventListener('click', () => uploadCategoryFile(panel));
    });

    attachSyncListeners();

    document.getElementById('save-site-location')?.addEventListener('click', async () => {
        try {
            const msg = await apiFetch('/api/settings', {
                method: 'POST',
                body: JSON.stringify({
                    site_address: document.getElementById('site_address').value,
                    site_lat: document.getElementById('site_lat').value,
                    site_lng: document.getElementById('site_lng').value,
                    site_label: document.getElementById('site_label').value,
                }),
            });
            showStatus('site-location-status', msg, 'success');
        } catch (e) {
            showStatus('site-location-status', e.message, 'error');
        }
    });

    document.getElementById('save-settings')?.addEventListener('click', async () => {
        try {
            const msg = await apiFetch('/api/settings', {
                method: 'POST',
                body: JSON.stringify({
                    contact_email: document.getElementById('contact_email').value,
                    contact_phone: document.getElementById('contact_phone').value,
                    contact_address: document.getElementById('contact_address').value,
                    map_lat: document.getElementById('map_lat').value,
                    map_lng: document.getElementById('map_lng').value,
                    map_label: document.getElementById('map_label').value,
                }),
            });
            showStatus('settings-status', msg, 'success');
        } catch (e) {
            showStatus('settings-status', e.message, 'error');
        }
    });

    document.getElementById('logout-btn')?.addEventListener('click', () => {
        setToken('');
        setUser(null);
        window.location.href = 'login.html';
    });
});

function showStatus(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = `form-status ${type}`;
}

function uploadCategoryFile(panel) {
    const input = document.getElementById(panel.inputId);
    const file = input?.files?.[0];
    if (!file) {
        showStatus(panel.statusId, 'Dosya seçin.', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', panel.category);

    const progressWrap = document.getElementById(panel.progressId);
    const progressBar = progressWrap?.querySelector('progress');
    const progressText = progressWrap?.querySelector('.progress-text');

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
            showStatus(panel.statusId, 'Dosya yüklendi.', 'success');
            input.value = '';
            loadFileList(panel.listId, panel.category, true);
            if (progressWrap) {
                setTimeout(() => {
                    progressWrap.style.display = 'none';
                }, 1200);
            }
        } else {
            showStatus(panel.statusId, xhr.responseText || 'Yükleme hatası', 'error');
        }
    };

    xhr.onerror = () => showStatus(panel.statusId, 'Bağlantı hatası', 'error');
    xhr.send(formData);
}

async function loadUsers() {
    const wrap = document.getElementById('users-list');
    if (!wrap) return;

    wrap.innerHTML = 'Yükleniyor...';
    try {
        const users = await apiFetch('/api/users');
        if (!users.length) {
            wrap.innerHTML = '<p class="content-box empty">Henüz kayıtlı kullanıcı yok.</p>';
            return;
        }

        wrap.innerHTML = `<table class="users-table">
            <thead>
                <tr>
                    <th>Kullanıcı</th>
                    <th>Rol</th>
                    <th>Ad Soyad</th>
                    <th>Telefon</th>
                    <th>Şantiye / Kurum</th>
                    <th>İşlem</th>
                </tr>
            </thead>
            <tbody>
                ${users
                    .map(
                        (u) => `<tr data-user-id="${u.id}">
                    <td>${escapeHtml(u.username)}</td>
                    <td>
                        <select class="user-role" data-id="${u.id}">
                            ${ROLE_OPTIONS.map(
                                (o) =>
                                    `<option value="${o.value}" ${u.role === o.value ? 'selected' : ''}>${o.label}</option>`
                            ).join('')}
                        </select>
                    </td>
                    <td>${escapeHtml(u.fullName || '-')}</td>
                    <td>${escapeHtml(u.phone || '-')}</td>
                    <td>${escapeHtml([u.siteName, u.companyName].filter(Boolean).join(' / ') || '-')}</td>
                    <td class="users-actions">
                        <button type="button" class="btn btn-ghost btn-sm user-save" data-id="${u.id}">Kaydet</button>
                        <button type="button" class="btn btn-ghost btn-sm user-delete" data-id="${u.id}">Sil</button>
                    </td>
                </tr>`
                    )
                    .join('')}
            </tbody>
        </table>`;

        wrap.querySelectorAll('.user-save').forEach((btn) => {
            btn.addEventListener('click', () => saveUserRole(btn.dataset.id));
        });
        wrap.querySelectorAll('.user-delete').forEach((btn) => {
            btn.addEventListener('click', () => deleteUser(btn.dataset.id));
        });
    } catch (e) {
        wrap.innerHTML = `<p class="form-status error">${escapeHtml(e.message)}</p>`;
    }
}

async function saveUserRole(id) {
    const select = document.querySelector(`.user-role[data-id="${id}"]`);
    if (!select) return;

    try {
        const msg = await apiFetch(`/api/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ role: select.value }),
        });
        showStatus('users-status', msg.message || 'Kullanıcı güncellendi', 'success');
        loadUsers();
    } catch (e) {
        showStatus('users-status', e.message, 'error');
    }
}

async function deleteUser(id) {
    if (!confirm('Bu kullanıcıyı silmek istiyor musunuz?')) return;

    try {
        const msg = await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
        showStatus('users-status', msg.message || 'Kullanıcı silindi', 'success');
        loadUsers();
    } catch (e) {
        showStatus('users-status', e.message, 'error');
    }
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text ?? '';
    return d.innerHTML;
}

function refreshAllLists() {
    FILE_PANELS.forEach((panel) => loadFileList(panel.listId, panel.category, true));
    const usersPanel = document.getElementById('panel-users');
    if (usersPanel?.classList.contains('active')) loadUsers();
}

function attachSyncListeners() {
    const streamUrl = apiUrl(`/api/sync/stream?token=${encodeURIComponent(getToken())}`);
    const evt = new EventSource(streamUrl, { withCredentials: false });
    evt.onerror = () => {};
    evt.onmessage = () => refreshAllLists();

    setInterval(refreshAllLists, 20000);
}
