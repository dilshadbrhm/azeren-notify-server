import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  try {
    // 1. Bütün istifadəçiləri çap et
    const istifadeciler = await prisma.taninanIstifadeci.findMany({
      select: { id: true, adSoyad: true, rol: true },
    });

    console.log('\n===== TaninanIstifadeci cədvəli =====');
    if (istifadeciler.length === 0) {
      console.log('(Heç bir qeyd tapılmadı)');
    } else {
      console.table(istifadeciler);
    }

    // 2. Hamısının rolunu SUPERADMIN-ə yenilə
    const result = await prisma.taninanIstifadeci.updateMany({
      data: { rol: 'SUPERADMIN' },
    });

    console.log(`\n✅ ${result.count} sətrin rolu SUPERADMIN-ə yeniləndi.\n`);

    // 3. Yenilənmiş siyahını yenidən çap et
    const yenilenmis = await prisma.taninanIstifadeci.findMany({
      select: { id: true, adSoyad: true, rol: true },
    });
    console.log('===== Yenilənmiş vəziyyət =====');
    console.table(yenilenmis);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
