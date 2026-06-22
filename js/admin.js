const FILE_PANELS = [
    { category: 'general', inputId: 'file-general', uploadId: 'upload-general', statusId: 'status-general', listId: 'list-general', progressId: 'progress-general' },
    { category: 'reports', inputId: 'file-reports', uploadId: 'upload-reports', statusId: 'status-reports', listId: 'list-reports', progressId: 'progress-reports' },
    { category: 'notes', inputId: 'file-notes', uploadId: 'upload-notes', statusId: 'status-notes', listId: 'list-notes', progressId: 'progress-notes' },
    { category: 'schedule', inputId: 'file-schedule', uploadId: 'upload-schedule', statusId: 'status-schedule', listId: 'list-schedule', progressId: 'progress-schedule' },
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
    } catch (e) {
        showStatus('admin-status', 'Ayarlar yüklenemedi: ' + e.message, 'error');
    }

    FILE_PANELS.forEach((panel) => {
        loadFileList(panel.listId, panel.category, true);
        document.getElementById(panel.uploadId)?.addEventListener('click', () => uploadCategoryFile(panel));
    });

    // Sitede veya masaüstünde değişiklik yapıldığında paneli güncel tut.
    attachSyncListeners();

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

function refreshAllLists() {
    FILE_PANELS.forEach((panel) => loadFileList(panel.listId, panel.category, true));
}

function attachSyncListeners() {
    const streamUrl = apiUrl(`/api/sync/stream?token=${encodeURIComponent(getToken())}`);
    const evt = new EventSource(streamUrl, { withCredentials: false });
    evt.onerror = () => {};
    evt.onmessage = () => refreshAllLists();

    setInterval(refreshAllLists, 20000);
}
