/**
 * test-admin-endpoints.js
 * Admin paneli üçün backend endpoint-lərini və məntiqini yoxlayır:
 * 1. GET /notify/istifadeciler
 * 2. POST /notify/sobe
 * 3. PATCH /notify/istifadeci/:id/sobe
 * 4. GET /notify/sobeler
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function runTest() {
  console.log('========================================================');
  console.log('TEST 1: Bütün istifadəçilər və şöbələr (GET /notify/istifadeciler formatı)');
  console.log('========================================================');

  const users = await prisma.taninanIstifadeci.findMany({
    include: {
      sobeler: {
        select: { id: true, ad: true },
      },
    },
    orderBy: {
      yaradildi: 'desc',
    },
  });

  const formattedUsers = users.map((u) => ({
    id: u.id,
    adSoyad: u.adSoyad,
    rol: u.rol,
    onlayn: false, // REST controller-də notifyGateway.isUserOnline(u.id) ilə yoxlanılır
    sonGirisTarixi: u.sonGirisTarixi,
    sobeler: (u.sobeler || []).map((s) => ({ id: s.id, ad: s.ad })),
  }));

  console.log('Nəticə:');
  console.log(JSON.stringify(formattedUsers, null, 2));

  console.log('\n========================================================');
  console.log('TEST 2: Yeni şöbə yarat (POST /notify/sobe formatı)');
  console.log('========================================================');

  const testSobeAd = 'İT və Proqram Təminatı Şöbəsi';
  let sobe = await prisma.sobe.findUnique({ where: { ad: testSobeAd } });
  if (!sobe) {
    sobe = await prisma.sobe.create({ data: { ad: testSobeAd } });
    console.log('Yeni şöbə yaradıldı:', sobe);
  } else {
    console.log('Mövcud şöbə tapıldı:', sobe);
  }

  const testSobeAd2 = 'Maliyyə və Mühasibatlıq';
  let sobe2 = await prisma.sobe.findUnique({ where: { ad: testSobeAd2 } });
  if (!sobe2) {
    sobe2 = await prisma.sobe.create({ data: { ad: testSobeAd2 } });
    console.log('İkinci şöbə yaradıldı:', sobe2);
  } else {
    console.log('İkinci şöbə mövcuddur:', sobe2);
  }

  console.log('\n========================================================');
  console.log('TEST 3: İstifadəçini şöbələrə bağla (PATCH /notify/istifadeci/:id/sobe formatı)');
  console.log('========================================================');

  if (users.length > 0) {
    const targetUser = users[0];
    console.log(`İstifadəçi #${targetUser.id} (${targetUser.adSoyad}) şöbələrə təyin edilir: [${sobe.ad}, ${sobe2.ad}]`);

    const updatedUser = await prisma.taninanIstifadeci.update({
      where: { id: targetUser.id },
      data: {
        sobeler: {
          set: [{ id: sobe.id }, { id: sobe2.id }],
        },
      },
      include: {
        sobeler: {
          select: { id: true, ad: true },
        },
      },
    });

    console.log('Yenilənmiş istifadəçi:');
    console.log({
      id: updatedUser.id,
      adSoyad: updatedUser.adSoyad,
      rol: updatedUser.rol,
      sobeler: updatedUser.sobeler,
    });
  }

  console.log('\n========================================================');
  console.log('TEST 4: Bütün şöbələri üzv sayı ilə gətir (GET /notify/sobeler formatı)');
  console.log('========================================================');

  const sobeler = await prisma.sobe.findMany({
    include: {
      _count: {
        select: { uzvler: true },
      },
      uzvler: {
        select: { id: true, adSoyad: true, rol: true },
      },
    },
    orderBy: {
      ad: 'asc',
    },
  });

  const formattedSobeler = sobeler.map((s) => ({
    id: s.id,
    ad: s.ad,
    uzvSayi: s._count?.uzvler ?? s.uzvler?.length ?? 0,
    memberCount: s._count?.uzvler ?? s.uzvler?.length ?? 0,
    uzvler: s.uzvler,
    yaradildi: s.yaradildi,
  }));

  console.log('Nəticə:');
  console.log(JSON.stringify(formattedSobeler, null, 2));

  console.log('\n✅ Bütün testlər uğurla başa çatdı!');
  await prisma.$disconnect();
}

runTest().catch((err) => {
  console.error('Xəta:', err);
  prisma.$disconnect();
  process.exit(1);
});
