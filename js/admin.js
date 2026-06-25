const FILE_PANELS = [
    { category: 'reports', inputId: 'file-reports', uploadId: 'upload-reports', statusId: 'status-reports', listId: 'list-reports', progressId: 'progress-reports' },
    { category: 'notes', inputId: 'file-notes', uploadId: 'upload-notes', statusId: 'status-notes', listId: 'list-notes', progressId: 'progress-notes' },
];

const ROLE_OPTIONS = [
    { value: 'personel', label: 'Personel' },
    { value: 'is_yapilan', label: 'Kullanıcı' },
    { value: 'admin', label: 'Admin' },
];

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAdminPage()) return;

    try {
        await apiFetch('/api/me');
    } catch (e) {
        redirectToLogin(e.message || 'Oturum geçersiz. Lütfen tekrar giriş yapın.');
        return;
    }

    InputFilters.attachMobilePhoneFields(document);
    InputFilters.attachTextNameFields(document);
    InputFilters.attachCoordinateFields(document);

    initNewUserForm();

    const tabs = document.querySelectorAll('.admin-tab');
    const panels = document.querySelectorAll('.tab-panel');

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const name = tab.dataset.tab;
            tabs.forEach((t) => t.classList.toggle('active', t === tab));
            panels.forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
            if (name === 'users') loadUsers();
            if (name === 'schedule') loadScheduleAdmin();
        });
    });

    try {
        const settings = await fetch(apiUrl('/api/settings')).then((r) => r.json());
        document.getElementById('contact_email').value = settings.contact_email || '';
        document.getElementById('contact_phone').value = InputFilters.toMobilePhoneFieldValue(settings.contact_phone);
        document.getElementById('contact_address').value = settings.contact_address || '';
        document.getElementById('map_lat').value = settings.map_lat || '';
        document.getElementById('map_lng').value = settings.map_lng || '';
        document.getElementById('map_label').value = settings.map_label || '';
    } catch (e) {
        showStatus('admin-status', 'Ayarlar yüklenemedi: ' + e.message, 'error');
    }

    loadConstructionSitesAdmin();

    FILE_PANELS.forEach((panel) => {
        loadFileList(panel.listId, panel.category, true);
        document.getElementById(panel.uploadId)?.addEventListener('click', () => uploadCategoryFile(panel));
    });

    attachSyncListeners();
    initScheduleAdminPanel();

    document.getElementById('save-construction-site')?.addEventListener('click', saveConstructionSite);
    document.getElementById('cancel-construction-site')?.addEventListener('click', resetConstructionSiteForm);

    document.getElementById('save-settings')?.addEventListener('click', async () => {
        const contactPhone = InputFilters.normalizeMobilePhone(document.getElementById('contact_phone').value);
        const phoneErr = InputFilters.validateMobilePhone(contactPhone, true);
        if (phoneErr) {
            showStatus('settings-status', phoneErr, 'error');
            return;
        }
        const mapLatErr = InputFilters.validateCoordinate(document.getElementById('map_lat').value, 'Enlem');
        if (mapLatErr) {
            showStatus('settings-status', mapLatErr, 'error');
            return;
        }
        const mapLngErr = InputFilters.validateCoordinate(document.getElementById('map_lng').value, 'Boylam');
        if (mapLngErr) {
            showStatus('settings-status', mapLngErr, 'error');
            return;
        }

        try {
            const msg = await apiFetch('/api/settings', {
                method: 'POST',
                body: JSON.stringify({
                    contact_email: document.getElementById('contact_email').value,
                    contact_phone: contactPhone,
                    contact_address: document.getElementById('contact_address').value,
                    map_lat: InputFilters.sanitizeCoordinate(document.getElementById('map_lat').value),
                    map_lng: InputFilters.sanitizeCoordinate(document.getElementById('map_lng').value),
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
                    <th>Kullanıcı adı</th>
                    <th>Şifre</th>
                    <th>Rol</th>
                    <th>Ad Soyad</th>
                    <th>Telefon</th>
                    <th>Şantiye</th>
                    <th>Kurum</th>
                    <th>Not</th>
                    <th>Maaş Günü</th>
                    <th>İşlem</th>
                </tr>
            </thead>
            <tbody>
                ${users
                    .map(
                        (u) => `<tr data-user-id="${u.id}">
                    <td><input type="text" class="user-field user-username" data-id="${u.id}" value="${escapeAttr(u.username)}"></td>
                    <td><input type="text" class="user-field user-password" data-id="${u.id}" value="${escapeAttr(u.password)}"></td>
                    <td>
                        <select class="user-role" data-id="${u.id}">
                            ${ROLE_OPTIONS.map(
                                (o) =>
                                    `<option value="${o.value}" ${u.role === o.value ? 'selected' : ''}>${o.label}</option>`
                            ).join('')}
                        </select>
                    </td>
                    <td><input type="text" class="user-field user-fullname" data-id="${u.id}" value="${escapeAttr(u.fullName)}" data-text-name></td>
                    <td><input type="text" class="user-field user-phone" data-id="${u.id}" value="${escapeAttr(u.phone)}" placeholder="+90 5XXXXXXXXX" data-mobile-phone data-mobile-phone-optional="1"></td>
                    <td><input type="text" class="user-field user-site" data-id="${u.id}" value="${escapeAttr(u.siteName)}" data-text-name></td>
                    <td><input type="text" class="user-field user-company" data-id="${u.id}" value="${escapeAttr(u.companyName)}" data-text-name></td>
                    <td><input type="text" class="user-field user-note" data-id="${u.id}" value="${escapeAttr(u.extraNote)}"></td>
                    <td class="user-salary-day-cell">${
                        u.role === 'personel'
                            ? `<div class="salary-day-field">
                        <input type="hidden" class="user-salary-day" data-id="${u.id}" data-salary-day-value value="${escapeAttr(u.salaryDayOfMonth ?? '')}">
                        <span class="salary-day-label">${escapeHtml(InputFilters.formatSalaryDayLabel(u.salaryDayOfMonth ?? ''))}</span>
                        <input type="date" class="user-salary-day-picker" data-id="${u.id}" data-salary-day-picker title="Ayın hangi günü">
                    </div>`
                            : '<span class="text-muted">—</span>'
                    }</td>
                    <td class="users-actions">
                        <button type="button" class="btn btn-primary btn-sm user-save" data-id="${u.id}">Kaydet</button>
                        <button type="button" class="btn btn-ghost btn-sm user-delete" data-id="${u.id}">Sil</button>
                    </td>
                </tr>`
                    )
                    .join('')}
            </tbody>
        </table>`;

        wrap.querySelectorAll('.user-save').forEach((btn) => {
            btn.addEventListener('click', () => saveUser(btn.dataset.id));
        });
        wrap.querySelectorAll('.user-delete').forEach((btn) => {
            btn.addEventListener('click', () => deleteUser(btn.dataset.id));
        });

        InputFilters.attachMobilePhoneFields(wrap);
        InputFilters.attachTextNameFields(wrap);
        InputFilters.attachSalaryDayFields(wrap);
        wrap.querySelectorAll('.user-phone').forEach((input) => {
            input.value = InputFilters.toMobilePhoneFieldValue(input.value);
        });
    } catch (e) {
        wrap.innerHTML = `<p class="form-status error">${escapeHtml(e.message)}</p>`;
    }
}

async function saveUser(id) {
    const username = document.querySelector(`.user-username[data-id="${id}"]`)?.value?.trim() || '';
    const password = document.querySelector(`.user-password[data-id="${id}"]`)?.value || '';
    const role = document.querySelector(`.user-role[data-id="${id}"]`)?.value || '';
    const fullName = document.querySelector(`.user-fullname[data-id="${id}"]`)?.value?.trim() || '';
    const phone = document.querySelector(`.user-phone[data-id="${id}"]`)?.value?.trim() || '';
    const siteName = document.querySelector(`.user-site[data-id="${id}"]`)?.value?.trim() || '';
    const companyName = document.querySelector(`.user-company[data-id="${id}"]`)?.value?.trim() || '';
    const extraNote = document.querySelector(`.user-note[data-id="${id}"]`)?.value?.trim() || '';
    const salaryDayOfMonth = document.querySelector(`.user-salary-day[data-id="${id}"]`)?.value?.trim() || '';

    if (!username) {
        showStatus('users-status', 'Kullanıcı adı boş olamaz.', 'error');
        return;
    }
    if (!password) {
        showStatus('users-status', 'Şifre boş olamaz.', 'error');
        return;
    }

    const nameErr = InputFilters.validateTextName(fullName, 'Ad soyad');
    if (nameErr) {
        showStatus('users-status', nameErr, 'error');
        return;
    }
    const phoneErr = InputFilters.validateMobilePhone(phone, false);
    if (phoneErr) {
        showStatus('users-status', phoneErr, 'error');
        return;
    }
    const siteErr = InputFilters.validateTextName(siteName, 'Şantiye adı');
    if (siteErr) {
        showStatus('users-status', siteErr, 'error');
        return;
    }
    const companyErr = InputFilters.validateTextName(companyName, 'Kurum / firma');
    if (companyErr) {
        showStatus('users-status', companyErr, 'error');
        return;
    }
    if (role === 'personel') {
        const salaryErr = InputFilters.validateSalaryDayOfMonth(salaryDayOfMonth, true);
        if (salaryErr) {
            showStatus('users-status', salaryErr, 'error');
            return;
        }
    }

    try {
        const msg = await apiFetch(`/api/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
                username,
                password,
                role,
                fullName,
                phone: InputFilters.mobilePhoneForSave(phone),
                siteName,
                companyName,
                extraNote,
                salaryDayOfMonth: role === 'personel' ? salaryDayOfMonth : null,
            }),
        });
        showStatus('users-status', msg.message || 'Kullanıcı güncellendi', 'success');
        loadUsers();
    } catch (e) {
        showStatus('users-status', parseApiError(e.message), 'error');
    }
}

function parseApiError(message) {
    try {
        const data = JSON.parse(message);
        if (data.error) return data.error;
    } catch {
        /* düz metin */
    }
    return message || 'İşlem başarısız';
}

function escapeAttr(text) {
    return escapeHtml(text ?? '').replace(/"/g, '&quot;');
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

function updateNewUserRoleFields() {
    const role = document.getElementById('new_user_role')?.value || 'personel';
    const showCustomer = role === 'is_yapilan';
    const showSalary = role === 'personel';
    document.querySelectorAll('.new-user-customer-fields').forEach((el) => {
        el.classList.toggle('hidden', !showCustomer);
    });
    document.querySelectorAll('.new-user-salary-fields').forEach((el) => {
        el.classList.toggle('hidden', !showSalary);
    });
}

function resetNewUserForm() {
    document.getElementById('new_user_role').value = 'personel';
    document.getElementById('new_user_username').value = '';
    document.getElementById('new_user_password').value = '';
    document.getElementById('new_user_password2').value = '';
    document.getElementById('new_user_fullname').value = '';
    document.getElementById('new_user_phone').value = InputFilters.MOBILE_PHONE_PREFIX;
    document.getElementById('new_user_site').value = '';
    document.getElementById('new_user_company').value = '';
    document.getElementById('new_user_note').value = '';
    document.getElementById('new_user_salary_day').value = '';
    document.getElementById('new_user_salary_day_picker').value = '';
    document.getElementById('new_user_salary_day_label').textContent = 'Takvimden gün seçin';
    updateNewUserRoleFields();
}

function initNewUserForm() {
    const form = document.getElementById('user-add-form');
    const toggleBtn = document.getElementById('user-add-toggle');
    const cancelBtn = document.getElementById('user-add-cancel');
    const roleSelect = document.getElementById('new_user_role');

    roleSelect?.addEventListener('change', updateNewUserRoleFields);
    updateNewUserRoleFields();

    toggleBtn?.addEventListener('click', () => {
        resetNewUserForm();
        if (form) form.hidden = false;
        InputFilters.attachMobilePhoneFields(form || document);
        InputFilters.attachTextNameFields(form || document);
        InputFilters.attachSalaryDayFields(form || document);
    });

    cancelBtn?.addEventListener('click', () => {
        if (form) form.hidden = true;
        resetNewUserForm();
    });

    document.getElementById('create-user-btn')?.addEventListener('click', createUser);
}

async function createUser() {
    const role = document.getElementById('new_user_role')?.value || 'personel';
    const username = document.getElementById('new_user_username')?.value?.trim() || '';
    const password = document.getElementById('new_user_password')?.value || '';
    const password2 = document.getElementById('new_user_password2')?.value || '';
    const fullName = document.getElementById('new_user_fullname')?.value?.trim() || '';
    const phone = document.getElementById('new_user_phone')?.value?.trim() || '';
    const siteName = document.getElementById('new_user_site')?.value?.trim() || '';
    const companyName = document.getElementById('new_user_company')?.value?.trim() || '';
    const extraNote = document.getElementById('new_user_note')?.value?.trim() || '';
    const salaryDayOfMonth = document.getElementById('new_user_salary_day')?.value?.trim() || '';

    if (!username) {
        showStatus('users-status', 'Kullanıcı adı zorunlu.', 'error');
        return;
    }
    if (!password || password.length < 6) {
        showStatus('users-status', 'Şifre en az 6 karakter olmalı.', 'error');
        return;
    }
    if (password !== password2) {
        showStatus('users-status', 'Şifreler eşleşmiyor.', 'error');
        return;
    }

    const nameErr = InputFilters.validateTextName(fullName, 'Ad soyad');
    if (nameErr) {
        showStatus('users-status', nameErr, 'error');
        return;
    }
    const phoneErr = InputFilters.validateMobilePhone(phone, false);
    if (phoneErr) {
        showStatus('users-status', phoneErr, 'error');
        return;
    }
    const siteErr = InputFilters.validateTextName(siteName, 'Şantiye adı');
    if (siteErr) {
        showStatus('users-status', siteErr, 'error');
        return;
    }
    const companyErr = InputFilters.validateTextName(companyName, 'Kurum / firma');
    if (companyErr) {
        showStatus('users-status', companyErr, 'error');
        return;
    }
    if (role === 'personel') {
        const salaryErr = InputFilters.validateSalaryDayOfMonth(salaryDayOfMonth, true);
        if (salaryErr) {
            showStatus('users-status', salaryErr, 'error');
            return;
        }
    }

    try {
        const msg = await apiFetch('/api/users', {
            method: 'POST',
            body: JSON.stringify({
                username,
                password,
                role,
                fullName,
                phone: InputFilters.mobilePhoneForSave(phone),
                siteName: role === 'is_yapilan' ? siteName : '',
                companyName: role === 'is_yapilan' ? companyName : '',
                extraNote,
                salaryDayOfMonth: role === 'personel' ? salaryDayOfMonth : null,
            }),
        });
        showStatus('users-status', msg.message || 'Yeni kullanıcı eklendi', 'success');
        resetNewUserForm();
        const form = document.getElementById('user-add-form');
        if (form) form.hidden = true;
        loadUsers();
    } catch (e) {
        const errMsg = parseApiError(e.message);
        if (String(errMsg).includes('Oturum') || String(errMsg).includes('giriş')) {
            redirectToLogin(errMsg);
            return;
        }
        showStatus('users-status', errMsg, 'error');
    }
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text ?? '';
    return d.innerHTML;
}

function getConstructionSiteFormData() {
    return {
        name: document.getElementById('site_name')?.value?.trim() || '',
        address: document.getElementById('site_address')?.value?.trim() || '',
        phone: InputFilters.mobilePhoneForSave(document.getElementById('site_phone')?.value),
        lat: InputFilters.sanitizeCoordinate(document.getElementById('site_lat')?.value),
        lng: InputFilters.sanitizeCoordinate(document.getElementById('site_lng')?.value),
        description: document.getElementById('site_description')?.value?.trim() || '',
    };
}

function resetConstructionSiteForm() {
    document.getElementById('site_edit_id').value = '';
    document.getElementById('site_name').value = '';
    document.getElementById('site_address').value = '';
    document.getElementById('site_phone').value = InputFilters.MOBILE_PHONE_PREFIX;
    document.getElementById('site_lat').value = '';
    document.getElementById('site_lng').value = '';
    document.getElementById('site_description').value = '';
    document.getElementById('site-form-title').textContent = 'Yeni şantiye ekle';
    document.getElementById('cancel-construction-site').hidden = true;
    showStatus('site-location-status', '', '');
}

function fillConstructionSiteForm(site) {
    document.getElementById('site_edit_id').value = site.id;
    document.getElementById('site_name').value = site.name || '';
    document.getElementById('site_address').value = site.address || '';
    document.getElementById('site_phone').value = InputFilters.toMobilePhoneFieldValue(site.phone);
    document.getElementById('site_lat').value = site.lat || '';
    document.getElementById('site_lng').value = site.lng || '';
    document.getElementById('site_description').value = site.description || '';
    document.getElementById('site-form-title').textContent = 'Şantiyeyi düzenle';
    document.getElementById('cancel-construction-site').hidden = false;
    document.getElementById('site_name')?.focus();
}

async function loadConstructionSitesAdmin() {
    const wrap = document.getElementById('admin-sites-list');
    if (!wrap) return;

    wrap.innerHTML = 'Yükleniyor...';
    try {
        const sites = await fetch(apiUrl('/api/construction-sites')).then((r) => r.json());
        if (!sites.length) {
            wrap.innerHTML = '<p class="content-box empty">Henüz şantiye eklenmemiş.</p>';
            return;
        }

        wrap.innerHTML = `<ul class="admin-sites-items">${sites
            .map(
                (site) => `<li class="admin-sites-item">
                    <div>
                        <strong>${escapeHtml(site.name)}</strong>
                        ${site.address ? `<span>${escapeHtml(site.address)}</span>` : ''}
                    </div>
                    <div class="admin-sites-actions">
                        <a href="site-detail.html?id=${site.id}" class="btn btn-primary btn-sm">Detay / Dosyalar</a>
                        <button type="button" class="btn btn-ghost btn-sm site-edit" data-id="${site.id}">Düzenle</button>
                        <button type="button" class="btn btn-ghost btn-sm site-delete" data-id="${site.id}">Sil</button>
                    </div>
                </li>`
            )
            .join('')}</ul>`;

        wrap.querySelectorAll('.site-edit').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    const site = await fetch(apiUrl(`/api/construction-sites/${btn.dataset.id}`)).then((r) => {
                        if (!r.ok) throw new Error('Şantiye okunamadı');
                        return r.json();
                    });
                    fillConstructionSiteForm(site);
                } catch (e) {
                    showStatus('site-location-status', e.message, 'error');
                }
            });
        });

        wrap.querySelectorAll('.site-delete').forEach((btn) => {
            btn.addEventListener('click', () => deleteConstructionSite(btn.dataset.id));
        });
    } catch (e) {
        wrap.innerHTML = `<p class="form-status error">${escapeHtml(e.message)}</p>`;
    }
}

async function saveConstructionSite() {
    const editId = document.getElementById('site_edit_id')?.value?.trim();
    const body = getConstructionSiteFormData();

    if (!body.name) {
        showStatus('site-location-status', 'Şantiye adı zorunlu.', 'error');
        return;
    }

    const nameErr = InputFilters.validateTextName(body.name, 'Şantiye adı', true);
    if (nameErr) {
        showStatus('site-location-status', nameErr, 'error');
        return;
    }

    const phoneRaw = document.getElementById('site_phone')?.value || '';
    const phoneErr = InputFilters.validateMobilePhone(phoneRaw, false);
    if (phoneErr) {
        showStatus('site-location-status', phoneErr, 'error');
        return;
    }
    const latErr = InputFilters.validateCoordinate(document.getElementById('site_lat')?.value, 'Enlem');
    if (latErr) {
        showStatus('site-location-status', latErr, 'error');
        return;
    }
    const lngErr = InputFilters.validateCoordinate(document.getElementById('site_lng')?.value, 'Boylam');
    if (lngErr) {
        showStatus('site-location-status', lngErr, 'error');
        return;
    }

    try {
        const result = editId
            ? await apiFetch(`/api/construction-sites/${editId}`, {
                  method: 'PUT',
                  body: JSON.stringify(body),
              })
            : await apiFetch('/api/construction-sites', {
                  method: 'POST',
                  body: JSON.stringify(body),
              });

        showStatus('site-location-status', result.message || 'Kaydedildi', 'success');
        resetConstructionSiteForm();
        loadConstructionSitesAdmin();
    } catch (e) {
        showStatus('site-location-status', e.message, 'error');
    }
}

async function deleteConstructionSite(id) {
    if (!confirm('Bu şantiyeyi silmek istiyor musunuz?')) return;

    try {
        const result = await apiFetch(`/api/construction-sites/${id}`, { method: 'DELETE' });
        showStatus('site-location-status', result.message || 'Şantiye silindi', 'success');
        if (document.getElementById('site_edit_id')?.value === String(id)) {
            resetConstructionSiteForm();
        }
        loadConstructionSitesAdmin();
    } catch (e) {
        showStatus('site-location-status', e.message, 'error');
    }
}

function refreshAllLists() {
    FILE_PANELS.forEach((panel) => loadFileList(panel.listId, panel.category, true));
    loadConstructionSitesAdmin();
    loadScheduleAdmin();
    const usersPanel = document.getElementById('panel-users');
    if (usersPanel?.classList.contains('active')) loadUsers();
}

let personnelOptionsCache = [];

async function loadPersonnelOptions() {
    if (personnelOptionsCache.length) return personnelOptionsCache;
    const users = await apiFetch('/api/users');
    personnelOptionsCache = users.filter((u) => u.role === 'personel');
    return personnelOptionsCache;
}

function resetScheduleForm() {
    document.getElementById('schedule_edit_id').value = '';
    document.getElementById('schedule_leave_day').value = '';
    document.getElementById('schedule_note').value = '';
    const userSelect = document.getElementById('schedule_user');
    if (userSelect) {
        userSelect.value = '';
        userSelect.disabled = false;
    }
}

async function populateScheduleUserSelect(selectedId) {
    const select = document.getElementById('schedule_user');
    if (!select) return;
    const personnel = await loadPersonnelOptions();
    select.innerHTML = personnel.length
        ? personnel.map((p) => `<option value="${p.id}">${escapeHtml(p.fullName || p.username)}</option>`).join('')
        : '<option value="">Personel yok</option>';
    if (selectedId) select.value = String(selectedId);
}

async function loadScheduleAdmin() {
    const grid = document.getElementById('schedule-grid');
    if (!grid) return;
    try {
        const rows = await ScheduleUi.fetchPersonnelSchedule();
        ScheduleUi.renderScheduleGrid(grid, rows, {
            admin: true,
            onDelete: deleteScheduleRow,
            onEdit: editScheduleRow,
        });
    } catch (e) {
        grid.innerHTML = `<p class="form-status error">${escapeHtml(e.message)}</p>`;
    }
}

function initScheduleAdminPanel() {
    const form = document.getElementById('schedule-add-form');
    const toggleBtn = document.getElementById('schedule-add-toggle');
    const cancelBtn = document.getElementById('schedule-cancel');
    const saveBtn = document.getElementById('schedule-save');

    toggleBtn?.addEventListener('click', async () => {
        resetScheduleForm();
        await populateScheduleUserSelect();
        if (form) form.hidden = false;
        ScheduleUi.applyMinDateInputs(form || document);
    });

    cancelBtn?.addEventListener('click', () => {
        if (form) form.hidden = true;
        resetScheduleForm();
    });

    saveBtn?.addEventListener('click', saveScheduleRow);
    ScheduleUi.applyMinDateInputs(document);
    loadScheduleAdmin();
}

async function saveScheduleRow() {
    const editId = document.getElementById('schedule_edit_id')?.value?.trim();
    const userId = document.getElementById('schedule_user')?.value;
    const leaveDay = document.getElementById('schedule_leave_day')?.value || '';
    const note = document.getElementById('schedule_note')?.value?.trim() || '';

    if (!userId) {
        showStatus('schedule-status', 'Personel seçin.', 'error');
        return;
    }

    try {
        const body = { userId, leaveDay, note };
        const result = editId
            ? await apiFetch(`/api/personnel-schedule/${editId}`, { method: 'PUT', body: JSON.stringify(body) })
            : await apiFetch('/api/personnel-schedule', { method: 'POST', body: JSON.stringify(body) });

        showStatus('schedule-status', result.message || 'Kaydedildi', 'success');
        document.getElementById('schedule-add-form').hidden = true;
        resetScheduleForm();
        personnelOptionsCache = [];
        loadScheduleAdmin();
    } catch (e) {
        showStatus('schedule-status', parseApiError(e.message), 'error');
    }
}

async function deleteScheduleRow(id) {
    if (!confirm('Bu çizelge kaydını silmek istiyor musunuz?')) return;
    try {
        const result = await apiFetch(`/api/personnel-schedule/${id}`, { method: 'DELETE' });
        showStatus('schedule-status', result.message || 'Silindi', 'success');
        loadScheduleAdmin();
    } catch (e) {
        showStatus('schedule-status', parseApiError(e.message), 'error');
    }
}

async function editScheduleRow(id, rows) {
    const row = rows.find((r) => String(r.id) === String(id));
    if (!row) return;
    document.getElementById('schedule_edit_id').value = row.id;
    await populateScheduleUserSelect(row.userId);
    const userSelect = document.getElementById('schedule_user');
    if (userSelect) userSelect.disabled = true;
    document.getElementById('schedule_leave_day').value = row.leaveDay || '';
    document.getElementById('schedule_note').value = row.note || '';
    const form = document.getElementById('schedule-add-form');
    if (form) {
        form.hidden = false;
        ScheduleUi.applyMinDateInputs(form);
    }
}

function attachSyncListeners() {
    const streamUrl = apiUrl(`/api/sync/stream?token=${encodeURIComponent(getToken())}`);
    const evt = new EventSource(streamUrl, { withCredentials: false });
    evt.onerror = () => {};
    evt.onmessage = () => refreshAllLists();

    setInterval(refreshAllLists, 20000);
}
