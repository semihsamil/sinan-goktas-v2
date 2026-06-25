# Mimar Sinan Göktaş — Kurulum (Final)

Proje klasörü: `c:\Users\karak\Desktop\sinan_goktas-v2`

## Hızlı başlatma (bilgisayar başında değilken)

1. `start.bat` dosyasına çift tıkla  
2. Tarayıcı otomatik açılır: http://localhost:3000

## Manuel başlatma

```powershell
cd c:\Users\karak\Desktop\sinan_goktas-v2
npm install
npm start
```

## Admin girişi

- Adres: http://localhost:3000/admin-login.html
- Kullanıcı: `admin` (`.env` → `ADMIN_USERNAME`)
- Şifre: `admin123` (`.env` → `ADMIN_PASSWORD` — değiştirmen önerilir)

## Admin panelinde yapabileceklerin

- Genel şantiye bilgileri (metin)
- Günlük rapor dosyası yükleme / silme
- Bilgi notları
- Şantiye takip çizelgesi
- İletişim bilgileri (ana sayfada görünür)
- Harita konumu (enlem/boylam)

## İnternete yayınlama (Render — ücretsiz, domain şart değil)

1. Projeyi GitHub’a yükle (`.env` ve `database.db` yükleme)
2. https://render.com → New Web Service → repoyu bağla
3. Build: `npm install` — Start: `npm start`
4. Environment Variables ekle:
   - `ADMIN_USERNAME` = admin
   - `ADMIN_PASSWORD` = güçlü şifre
5. Deploy sonrası adres: `https://sinan-goktas-xxxx.onrender.com`

**Not:** Render ücretsiz planda sunucu uyuyunca ilk açılış yavaş olabilir. SQLite ve yüklenen dosyalar redeploy’da sıfırlanabilir; kalıcı veri için Render disk veya harici depolama gerekir.

## Netlify

Bu proje Node.js + SQLite kullanır. Sadece Netlify statik deploy **admin ve veritabanı için yeterli değildir**. Tüm site için Render kullan.

## Sorun giderme

| Sorun | Çözüm |
|--------|--------|
| Sayfa açılmıyor | `start.bat` veya `npm start` çalışıyor mu? |
| Admin giriş olmuyor | `.env` dosyası var mı? Şifre doğru mu? |
| İçerik boş | Admin panelinden kaydet |
| Dosya listesi boş | Admin → Günlük Raporlar → dosya yükle |

Eski proje (`sinan_goktas`) dokunulmadı; tüm güncellemeler `sinan_goktas-v2` içindedir.
