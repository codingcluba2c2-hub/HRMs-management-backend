import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';

async function main() {
  const targetEmail = 'akhlaquerahman18@gmail.com'.toLowerCase().trim();
  const rawPassword = process.env.SUPER_ADMIN_PASSWORD || 'Admin@12345';
  const firstName = 'Super';
  const lastName = 'Admin';

  console.log(`Connecting and checking roles in database...`);
  const roles = await prisma.role.findMany();
  console.log('Available roles:', roles.map(r => ({ id: r.id, name: r.name })));

  // Look for SUPER_ADMIN role
  let superAdminRole = roles.find(r => r.name.toUpperCase().replace(/[\s_]+/g, '_') === 'SUPER_ADMIN');

  if (!superAdminRole) {
    console.log('SUPER_ADMIN role not found. Creating it...');
    superAdminRole = await prisma.role.create({
      data: {
        name: 'SUPER_ADMIN',
        description: 'Super Administrator Role'
      }
    });
    console.log('Created SUPER_ADMIN role with ID:', superAdminRole.id);
  } else {
    console.log('Found Super Admin role:', superAdminRole.name, superAdminRole.id);
  }

  // Check if user already exists
  const existingUser = await prisma.user.findFirst({
    where: {
      email: { equals: targetEmail, mode: 'insensitive' }
    },
    include: { role: true }
  });

  const passwordHash = await bcrypt.hash(rawPassword, 10);

  if (existingUser) {
    console.log(`User ${targetEmail} already exists (ID: ${existingUser.id}). Updating password and role...`);
    const updatedUser = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        firstName,
        lastName,
        passwordHash,
        roleId: superAdminRole.id,
        isDeleted: false,
        lockedUntil: null,
        loginAttempts: 0
      },
      include: { role: true }
    });
    console.log('✅ Super Admin account updated successfully:');
    console.log({
      id: updatedUser.id,
      name: `${updatedUser.firstName} ${updatedUser.lastName}`,
      email: updatedUser.email,
      role: updatedUser.role?.name
    });
  } else {
    console.log(`Creating new Super Admin user for ${targetEmail}...`);
    const newUser = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email: targetEmail,
        passwordHash,
        roleId: superAdminRole.id,
        isDeleted: false
      },
      include: { role: true }
    });
    console.log('✅ Super Admin account created successfully:');
    console.log({
      id: newUser.id,
      name: `${newUser.firstName} ${newUser.lastName}`,
      email: newUser.email,
      role: newUser.role?.name
    });
  }
}

main()
  .catch((e) => {
    console.error('❌ Error executing script:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
