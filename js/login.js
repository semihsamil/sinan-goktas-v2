document.addEventListener('DOMContentLoaded', () => {
    if (getToken()) {
        const user = getUser();
        window.location.href = user?.role === 'admin' ? 'admin-panel.html' : 'work-tracking.html';
        return;
    }

    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const statusEl = document.getElementById('login-status');
    const roleSelect = document.getElementById('reg-role');
    const companyInput = document.getElementById('reg-company');
    const siteInput = document.getElementById('reg-site');
    const phoneInput = document.getElementById('reg-phone');
    const companyGroup = document.getElementById('reg-company-group');
    const siteGroup = document.getElementById('reg-site-group');

    const applyRegisterRoleUi = () => {
        const role = roleSelect?.value || 'personel';
        if (!companyInput || !siteInput || !companyGroup || !siteGroup) return;
        if (role === 'is_yapilan') {
            companyGroup.classList.remove('hidden');
            siteGroup.classList.remove('hidden');
            companyInput.placeholder = 'Örn: XYZ Taahhüt / Taşeron';
            siteInput.placeholder = 'Örn: A Blok Kaba İnşaat Şantiyesi';
        } else {
            companyGroup.classList.add('hidden');
            siteGroup.classList.add('hidden');
            companyInput.value = '';
            siteInput.value = '';
            companyInput.placeholder = 'Örn: ABC İnşaat';
            siteInput.placeholder = 'Örn: Sivas Merkez Konut Projesi';
        }
    };

    const normalizePhone = () => {
        if (!phoneInput) return;
        const prefix = '+90 5';
        const raw = phoneInput.value || '';
        const digitsOnly = raw.replace(/\D/g, '');
        let rest = '';
        if (digitsOnly.startsWith('905')) {
            rest = digitsOnly.slice(3);
        } else if (digitsOnly.startsWith('5')) {
            rest = digitsOnly.slice(1);
        } else {
            rest = digitsOnly;
        }
        rest = rest.slice(0, 9);
        phoneInput.value = prefix + rest;
    };

    phoneInput?.addEventListener('input', normalizePhone);
    phoneInput?.addEventListener('blur', normalizePhone);
    normalizePhone();
    roleSelect?.addEventListener('change', applyRegisterRoleUi);
    applyRegisterRoleUi();

    document.querySelectorAll('.form-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            const mode = tab.dataset.mode;
            document.querySelectorAll('.form-tab').forEach((t) => t.classList.toggle('active', t === tab));
            loginForm.classList.toggle('hidden', mode !== 'login');
            registerForm.classList.toggle('hidden', mode !== 'register');
        });
    });

    loginForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        statusEl.textContent = 'Giriş yapılıyor...';
        statusEl.className = 'form-status';

        if (window.location.protocol === 'file:') {
            statusEl.textContent = 'start.bat çalıştırın veya npm start — sonra http://localhost:3000/login.html';
            statusEl.className = 'form-status error';
            return;
        }

        try {
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;
            const data = await fetch(apiUrl('/api/login'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            }).then(async (res) => {
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body.error || 'Giriş başarısız');
                return body;
            });
            setToken(data.token);
            setUser({ username: data.username, role: data.role || 'personel', fullName: data.fullName || '' });
            window.location.href = data.role === 'admin' ? 'admin-panel.html' : 'work-tracking.html';
        } catch (err) {
            statusEl.textContent = err.message;
            statusEl.className = 'form-status error';
        }
    });

    registerForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        statusEl.textContent = 'Kayıt yapılıyor...';
        statusEl.className = 'form-status';

        try {
            const username = document.getElementById('reg-username').value.trim();
            const role = document.getElementById('reg-role').value;
            const fullName = document.getElementById('reg-fullname').value.trim();
            const phone = document.getElementById('reg-phone').value.trim();
            const companyName = document.getElementById('reg-company').value.trim();
            const siteName = document.getElementById('reg-site').value.trim();
            const password = document.getElementById('reg-password').value;
            const password2 = document.getElementById('reg-password2').value;

            if (password !== password2) {
                throw new Error('Şifreler uyuşmuyor');
            }
            if (!/^\+90 5\d{9}$/.test(phone)) {
                throw new Error('Telefon formatı +90 5XXXXXXXXX olmalı');
            }

            const data = await fetch(apiUrl('/api/register'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username,
                    password,
                    role,
                    fullName,
                    phone,
                    companyName,
                    siteName,
                }),
            }).then(async (res) => {
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body.error || 'Kayıt başarısız');
                return body;
            });

            statusEl.textContent = data.message || 'Kayıt başarılı. Giriş yapabilirsiniz.';
            statusEl.className = 'form-status success';
            registerForm.reset();
        } catch (err) {
            statusEl.textContent = err.message;
            statusEl.className = 'form-status error';
        }
    });
});
