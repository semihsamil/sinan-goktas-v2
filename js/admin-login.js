document.addEventListener('DOMContentLoaded', () => {
    const notice = sessionStorage.getItem('admin_login_notice');
    const statusEl = document.getElementById('admin-login-status');
    if (notice) {
        sessionStorage.removeItem('admin_login_notice');
        if (statusEl) {
            statusEl.textContent = notice;
            statusEl.className = 'form-status error';
        }
    }

    if (getToken()) {
        const user = getUser();
        if (user?.role === 'admin') {
            window.location.replace('admin-panel.html');
        } else {
            window.location.replace('work-tracking.html');
        }
        return;
    }

    const form = document.getElementById('admin-login-form');
    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!statusEl) return;

        statusEl.textContent = 'Giriş yapılıyor...';
        statusEl.className = 'form-status';

        if (window.location.protocol === 'file:') {
            statusEl.textContent = 'start.bat çalıştırın — sonra http://localhost:3000/admin-login.html';
            statusEl.className = 'form-status error';
            return;
        }

        try {
            const username = document.getElementById('admin_username').value.trim();
            const password = document.getElementById('admin_password').value;
            const data = await fetch(apiUrl('/api/login'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            }).then(async (res) => {
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body.error || 'Giriş başarısız');
                return body;
            });

            if (data.role !== 'admin') {
                throw new Error('Bu hesap yönetici değil. Personel/kullanıcı girişi için login.html sayfasını kullanın.');
            }

            setToken(data.token);
            setUser({ username: data.username, role: 'admin', fullName: data.fullName || '' });
            window.location.replace('admin-panel.html');
        } catch (err) {
            statusEl.textContent = err.message;
            statusEl.className = 'form-status error';
        }
    });
});
