import { prisma } from '../lib/prisma';

async function updatePermissions() {
  const settings = await prisma.systemSetting.findMany({
    where: { key: { startsWith: 'page_permissions_' } }
  });

  for (const s of settings) {
    try {
      const arr: string[] = JSON.parse(s.value);
      if (Array.isArray(arr) && arr.includes('/dashboard/workforce-map')) {
        const filtered = arr.filter((x: string) => x !== '/dashboard/workforce-map');
        await prisma.systemSetting.update({
          where: { id: s.id },
          data: { value: JSON.stringify(filtered) }
        });
        console.log(`Cleaned ${s.key}: removed /dashboard/workforce-map`);
      }
    } catch (e) {}
  }
}

updatePermissions()
  .then(() => console.log('Permissions updated successfully'))
  .catch(console.error)
  .finally(() => prisma.$disconnect());
