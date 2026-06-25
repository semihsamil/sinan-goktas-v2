const TOKEN_KEY = 'sinan_admin_token';
const USER_KEY = 'sinan_user';

function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
}

function setToken(token) {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
}

function getUser() {
    try {
        return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null');
    } catch {
        return null;
    }
}

function setUser(user) {
    if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(USER_KEY);
}

function authHeaders(hasJsonBody = false) {
    const headers = {};
    if (hasJsonBody) headers['Content-Type'] = 'application/json';
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

async function apiFetch(path, options = {}) {
    const url = typeof apiUrl === 'function' ? apiUrl(path) : path;
    const hasBody = options.body !== undefined && options.body !== null;
    const res = await fetch(url, {
        ...options,
        headers: {
            ...authHeaders(hasBody && typeof options.body === 'string'),
            ...(options.headers || {}),
        },
    });
    if (res.status === 401) {
        let msg = 'Oturum süresi doldu. Lütfen tekrar giriş yapın.';
        try {
            const body = await res.json();
            if (body.error) msg = body.error;
        } catch {
            /* düz metin */
        }
        throw new Error(msg);
    }
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'İstek başarısız');
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
}

function redirectToLogin(message) {
    setToken('');
    setUser(null);
    if (message) sessionStorage.setItem('login_notice', message);
    window.location.href = 'login.html';
}

function redirectToAdminLogin(message) {
    setToken('');
    setUser(null);
    if (message) sessionStorage.setItem('admin_login_notice', message);
    window.location.href = 'admin-login.html';
}

function requireAuthPage() {
    if (!getToken()) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

function requireAdminPage() {
    if (!getToken()) {
        window.location.href = 'admin-login.html';
        return false;
    }
    const user = getUser();
    if (!user || user.role !== 'admin') {
        alert('Bu sayfa sadece admin kullanıcılar içindir.');
        window.location.href = 'work-tracking.html';
        return false;
    }
    return true;
}
