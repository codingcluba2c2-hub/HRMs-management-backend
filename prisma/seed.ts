import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = 'akhlaquerahman0786@gmail.com';
  
  // Create SUPER_ADMIN Role
  const superAdminRole = await prisma.role.upsert({
    where: { name: 'SUPER_ADMIN' },
    update: {},
    create: {
      name: 'SUPER_ADMIN',
      description: 'Super Administrator Role',
    },
  });

  // Check if admin already exists
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail }
  });

  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash('Admin@123', 10);
    
    await prisma.user.create({
      data: {
        firstName: 'Super',
        lastName: 'Admin',
        email: adminEmail,
        passwordHash,
        roleId: superAdminRole.id
      }
    });
    console.log('✅ Super Admin seeded successfully.');
  } else {
    await prisma.user.update({
      where: { email: adminEmail },
      data: { roleId: superAdminRole.id }
    });
    console.log('✅ Super Admin role re-assigned successfully.');
  }

  // Seed Shifts
  const defaultShifts = [
    { name: "General Shift", startTime: "09:00", endTime: "18:00" },
    { name: "Morning Shift", startTime: "06:00", endTime: "14:00" },
    { name: "Evening Shift", startTime: "14:00", endTime: "22:00" },
    { name: "Night Shift", startTime: "22:00", endTime: "06:00" }
  ];

  for (const shift of defaultShifts) {
    const existing = await prisma.shift.findUnique({ where: { name: shift.name } });
    if (!existing) {
      await prisma.shift.create({ data: shift });
      console.log(`✅ Seeded Shift: ${shift.name}`);
    } else {
      console.log(`✅ Shift ${shift.name} already exists.`);
    }
  }
}

main()
  .catch((e) => {
    console.error('❌ Failed to seed database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
