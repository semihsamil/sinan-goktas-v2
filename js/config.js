(function () {
    const meta = document.querySelector('meta[name="api-base"]');
    const fromMeta = meta?.getAttribute('content')?.trim();
    const fromOverride = typeof window.API_HOST_OVERRIDE === 'string' ? window.API_HOST_OVERRIDE.trim() : '';
    const fromStorage = localStorage.getItem('api_base')?.trim();

    let base = fromOverride || fromMeta || fromStorage || '';

    // Netlify vb. statik host: origin API değildir, meta veya api-host.js gerekir
    const host = window.location.hostname || '';
    const isStaticHost =
        host.includes('netlify.app') ||
        host.includes('netlify.com') ||
        (host && !host.includes('localhost') && !host.includes('onrender.com') && !host.includes('railway.app'));

    if (!base && !isStaticHost && window.location.protocol !== 'file:') {
        base = window.location.origin;
    }

    window.APP_CONFIG = {
        apiBase: base.replace(/\/$/, ''),
    };

    window.apiUrl = function (path) {
        const p = path.startsWith('/') ? path : `/${path}`;
        if (!window.APP_CONFIG.apiBase) {
            console.warn('API adresi tanımlı değil. js/api-host.js dosyasına Render URL yazın.');
            return p;
        }
        return `${window.APP_CONFIG.apiBase}${p}`;
    };
})();
