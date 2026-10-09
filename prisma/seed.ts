import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = 'akhlaquerahman0786@gmail.com';
  
  // Create Canonical Roles
  const canonicalRoles = [
    { name: 'SUPER_ADMIN', description: 'Super Administrator Role' },
    { name: 'HR_ADMIN', description: 'HR Administrator Role' },
    { name: 'MANAGER', description: 'Department / Team Manager Role' },
    { name: 'EMPLOYEES', description: 'Employee Role' }
  ];

  let superAdminRoleId = '';
  for (const r of canonicalRoles) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description },
      create: r
    });
    if (r.name === 'SUPER_ADMIN') superAdminRoleId = role.id;
  }

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
        roleId: superAdminRoleId
      }
    });
    console.log('✅ Super Admin seeded successfully.');
  } else {
    await prisma.user.update({
      where: { email: adminEmail },
      data: { roleId: superAdminRoleId }
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
