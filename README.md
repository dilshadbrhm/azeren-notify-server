# Azeren Notify Server

"Azeren Notify" - mərkəzləşdirilmiş real-vaxt bildiriş sistemi backend xidməti.

---

## 🛠 Texnologiyalar və Paketlər
- **NestJS** (Express)
- **Prisma ORM** (SQLite bazası ilə)
- **Socket.IO** (`@nestjs/websockets`, `@nestjs/platform-socket.io`)
- **PMS Auth İnteqrasiyası** (`axios` vasitəsilə `https://pms.azerenerji.az/api/v1/auth/men`)
- **Class Validator / Transformer**

---

## 🗄 Verilənlər Bazası Modelləri (Prisma)

- **TaninanIstifadeci**: PMS-dən gələn real `id`, `adSoyad`, `rol` ('SUPERADMIN' | 'ADMIN' | 'USER'), `sonGirisTarixi`, `cihazId`, və aid olduğu `sobeler`.
- **Sobe**: Şöbə/kateqoriya (`id`, `ad`, `uzvler`).
- **Bildiris**: `id`, `gonderenId`, `gonderenAd`, `mesaj`, `seviyye` ('ADI' | 'VACIB' | 'COX_VACIB'), `yaradildi`, `hedefTipi` ('USER' | 'SOBE' | 'HAMISI'), `hedefId`, `silinib`.
- **BildirisOxunma**: Hər istifadəçiyə ünvanlanmış bildiriş statusu (`bildirisId`, `istifadeciId`, `gonderildiTarixi`, `catdiTarixi`, `oxunduTarixi`).

---

## 🔐 Autentifikasiya və Tək Cihaz Məhdudiyyəti

- Hər bir WebSocket bağlantısı və REST sorğusu **PMS Bearer token** ilə qorunur:
  - Header: `Authorization: Bearer <token>`
- Token `AuthService` vasitəsilə PMS serverində (`GET /api/v1/auth/men`) yoxlanılır və lokal bazada istifadəçi sinxronlaşdırılır (ilk dəfə daxil olanda defolt `USER` rolu ilə yaradılır).
- **Tək Cihaz Məhdudiyyəti**:
  - İstifadəçi WebSocket-ə qoşulduqda `qosul` hadisəsi ilə unikal `cihazId` təqdim edir.
  - Əgər həmin istifadəçi başqa cihazdan daxil olarsa, əvvəlki sessiyaya `sessiyaBaglandi` hadisəsi göndərilir və bağlantı avtomatik kəsilir.

---

## ⚡ WebSocket Hadisələri (Namespace: `/notify`)

### Client → Server:
1. **`qosul`**: `{ cihazId: string }`
   - Bağlantını qeydiyyatdan keçirir, tək cihazı yoxlayır və çatmamış offline bildirişləri dərhal göndərir.
2. **`bildirisGonder`** *(Yalnız ADMIN / SUPERADMIN)*:
   - `{ hedefTipi: 'USER' | 'SOBE' | 'HAMISI', hedefId?: string, mesaj: string, seviyye?: 'ADI' | 'VACIB' | 'COX_VACIB' }`
   - Bazada saxlayır, onlayn alıcılara dərhal `yeniBildiris` hadisəsi ilə göndərir və çatdırılma vaxtını qeyd edir.
3. **`bildirisSil`** *(Yalnız göndərən ADMIN və ya SUPERADMIN)*:
   - `{ bildirisId: string }`
   - Bildirişi silinib statusuna keçirir və bütün alıcılara `bildirisSilindi` göndərir.
4. **`bildirisCatdi`**: `{ bildirisId: string }`
5. **`bildirisOxundu`**: `{ bildirisId: string }`
6. **`onlineSiyahiTeleb`**: Boş body, onlayn istifadəçilərin siyahısını istəyir.

### Server → Client:
- **`qosuldu`**: `{ mesaj, istifadeci }`
- **`yeniBildiris`**: Bildiris obyekti
- **`bildirisSilindi`**: `{ bildirisId }`
- **`sessiyaBaglandi`**: `{ mesaj }`
- **`onlineSiyahi` / `presenceYenilendi`**: `[{ id, adSoyad, rol }]`
- **`xeta`**: `{ mesaj }`

---

## 🌐 REST API Endpoint-ləri

Bütün endpoint-lər `Authorization: Bearer <PMS-token>` tələb edir:

- `GET /notify/tarixce` — Cari istifadəçinin aldığı bütün bildirişlər və oxunma statusları
- `GET /notify/gonderilenler` *(Yalnız ADMIN / SUPERADMIN)* — Göndərilən bildirişlər və alıcıların statusu
- `GET /notify/istifadeciler` *(Yalnız ADMIN / SUPERADMIN)* — Bütün tanınan istifadəçilər, onlayn statusu və şöbələri
- `GET /notify/sobeler` *(Yalnız ADMIN / SUPERADMIN)* — Bütün şöbələr və üzvləri
- `POST /notify/sobe` *(Yalnız ADMIN / SUPERADMIN)* — `{ ad: string }` yeni şöbə yaradır
- `PATCH /notify/istifadeci/:id/sobe` *(Yalnız ADMIN / SUPERADMIN)* — `{ sobeIds: string[] }` istifadəçini şöbələrə təyin edir

---

## 🚀 Port İdarəetməsi və İşə Salma

Server başlanğıc portu kimi `PORT` mühit dəyişənini və ya defolt `4000` portunu yoxlayır. Əgər port məşğuldursa, avtomatik növbəti boş portu (4001, 4002...) taparaq başlayır.

```bash
# Bazanı miqrasiya etmək / yeniləmək
npx prisma db push

# Serveri başlatmaq
npm run start:dev
```
