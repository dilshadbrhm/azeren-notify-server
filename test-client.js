/**
 * test-client.js
 * PMS-ə daxil olur, token alır və Azeren Notify WebSocket serverinə qoşularaq
 * gələn bildirişləri canlı dinləyir.
 * 
 * İstifadə:
 *   node test-client.js <USERNAME> <PASSWORD>
 */

const axios = require('axios');
const https = require('https');
const { io } = require('socket.io-client');

const PMS_BASE_URL = 'https://pms.azerenerji.az/api/v1';
const NOTIFY_SERVER_URL = 'http://localhost:4000/notify';

// SSL sertifikat yoxlamasını tənzimləyən HTTPS agent (korporativ CA dəstəyi üçün)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.error('\n❌ Xəta: İstifadəçi adı və şifrə tələb olunur!');
  console.log('👉 İstifadə qaydası: node test-client.js <USERNAME> <PASSWORD>\n');
  process.exit(1);
}

// Sadə riyazi captcha-nı həll edən funksiya (məs: "4 + 5")
function solveCaptcha(sual) {
  const match = sual.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/);
  if (match) {
    const a = parseInt(match[1], 10);
    const op = match[2];
    const b = parseInt(match[3], 10);
    switch (op) {
      case '+': return String(a + b);
      case '-': return String(a - b);
      case '*': return String(a * b);
      case '/': return String(Math.floor(a / b));
    }
  }
  // Təhlükəsiz riyazi eval fallback
  if (/^[0-9\s\+\-\*\/]+$/.test(sual)) {
    return String(Function(`'use strict'; return (${sual})`)());
  }
  throw new Error(`Captcha sualı avtomatik həll edilə bilmədi: "${sual}"`);
}

async function main() {
  try {
    console.log('\n--- 1. PMS-DƏN CAPTCHA ALINIR ---');
    const captchaRes = await axios.get(`${PMS_BASE_URL}/auth/captcha`, { httpsAgent });
    const { sual, token: captchaToken } = captchaRes.data;
    console.log(`📝 Captcha sualı: ${sual}`);

    const captchaAnswer = solveCaptcha(sual);
    console.log(`💡 Hesablanmış cavab: ${captchaAnswer}`);

    console.log('\n--- 2. PMS-Ə DAXİL OLUNUR (LOGIN) ---');
    console.log(`👤 İstifadəçi: ${username}`);
    const loginRes = await axios.post(
      `${PMS_BASE_URL}/auth/login`,
      {
        name: username,
        password: password,
        captcha: captchaAnswer,
        captchaToken: captchaToken,
      },
      { httpsAgent },
    );

    const { accessToken, istifadeci } = loginRes.data;
    if (!accessToken) {
      throw new Error('PMS-dən accessToken alınmadı: ' + JSON.stringify(loginRes.data));
    }

    console.log(`✅ Login uğurlu!`);
    console.log(`👤 Ad Soyad: ${istifadeci?.adSoyad || istifadeci?.name || username}`);
    console.log(`🆔 İstifadəçi ID: ${istifadeci?.id}`);
    console.log(`🔑 Token: ${accessToken.slice(0, 25)}...`);

    console.log('\n--- 3. WEBSOCKET SERVERƏ QOŞULUR ---');
    const cihazId = 'test-client-' + Date.now();
    console.log(`🌐 Server URL: ${NOTIFY_SERVER_URL}`);
    console.log(`📱 Cihaz ID: ${cihazId}`);

    const socket = io(NOTIFY_SERVER_URL, {
      auth: {
        token: accessToken,
        cihazId: cihazId,
      },
      transports: ['websocket', 'polling'],
    });

    // Bağlantı hadisələri
    socket.on('connect', () => {
      console.log(`\n🟢 [CONNECT] WebSocket serverə qoşuldu! Socket ID: ${socket.id}`);
      
      // Serverdə qeydiyyatdan keçmək üçün 'qosul' emit edilir
      socket.emit('qosul', { cihazId });
    });

    socket.on('qosuldu', (data) => {
      console.log('🎉 [QOSULDU] Server qeydiyyatı təsdiqlədi:', data.mesaj || data);
      console.log('📡 Bildirişlər gözlənilir... (Çıxmaq üçün Ctrl+C basın)\n');
    });

    socket.on('disconnect', (reason) => {
      console.log(`🔴 [DISCONNECT] Bağlantı kəsildi! Səbəb: ${reason}`);
    });

    socket.on('connect_error', (error) => {
      console.error(`⚠️ [CONNECT_ERROR] Qoşulma xətası: ${error.message}`);
    });

    socket.on('xeta', (errData) => {
      console.warn(`⚠️ [XETA] Server xətası:`, errData);
    });

    socket.on('sessiyaBaglandi', (info) => {
      console.warn(`⚠️ [SESSIYA_BAGLANDI]`, info);
    });

    // Əsas bildiriş dinləyicisi
    socket.on('yeniBildiris', (b) => {
      console.log('\n╔════════════════════════════════════════════════════════════╗');
      console.log('║ 🔔 YENİ BİLDİRİŞ ALINDI!                                   ║');
      console.log('╠════════════════════════════════════════════════════════════╣');
      console.log(`║ 🆔 ID:       ${b.id}`);
      console.log(`║ 💬 Mesaj:    ${b.mesaj}`);
      console.log(`║ 👤 Göndərən: ${b.gonderenAdSoyad || b.gonderenId || 'Sistem'}`);
      console.log(`║ ⚡ Səviyyə:  ${b.seviyye}`);
      console.log(`║ 🎯 Hədəf:    ${b.hedefTipi}${b.hedefId ? ' (' + b.hedefId + ')' : ''}`);
      console.log(`║ 🕒 Tarix:    ${b.yaradilmaTarixi || new Date().toLocaleString()}`);
      console.log('╚════════════════════════════════════════════════════════════╝\n');

      // Çatdırılma təsdiqi göndər
      socket.emit('bildirisCatdi', { bildirisId: b.id });
    });

    socket.on('bildirisSilindi', (data) => {
      console.log(`🗑️ [SILINDI] Bildiriş silindi: ID #${data.bildirisId}`);
    });

  } catch (err) {
    if (err.response) {
      console.error(`\n❌ PMS HTTP Xətası [Status ${err.response.status}]:`, err.response.data);
    } else {
      console.error('\n❌ Xəta baş verdi:', err.message);
    }
    process.exit(1);
  }
}

main();
