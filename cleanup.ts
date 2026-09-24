import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function cleanup() {
  console.log("Starting cleanup...");
  
  // Get all unique designation names
  const uniqueNames = await prisma.designation.findMany({
    select: { name: true },
    distinct: ['name']
  });

  console.log(`Found ${uniqueNames.length} unique designation names.`);

  for (const { name } of uniqueNames) {
    // Find all designations with this name, ordered by createdAt ascending
    const desigs = await prisma.designation.findMany({
      where: { name },
      orderBy: { createdAt: 'asc' }
    });

    if (desigs.length > 1) {
      const original = desigs[0];
      console.log(`Consolidating ${desigs.length} records for ${name} into ID: ${original.id}`);

      // Get all duplicate IDs
      const duplicateIds = desigs.slice(1).map(d => d.id);

      // Reassign all employees that have the duplicate designation IDs to the original designation ID
      // and also update their departmentId to match the original designation's departmentId
      const updateRes = await prisma.employee.updateMany({
        where: { designationId: { in: duplicateIds } },
        data: { 
          designationId: original.id,
          departmentId: original.departmentId 
        }
      });
      console.log(`  Updated ${updateRes.count} employees.`);

      // Now delete the duplicate designations
      const delRes = await prisma.designation.deleteMany({
        where: { id: { in: duplicateIds } }
      });
      console.log(`  Deleted ${delRes.count} duplicate designations.`);
    }
  }

  // Same for Departments (if any duplicates exist)
  const uniqueDepts = await prisma.department.findMany({
    select: { name: true },
    distinct: ['name']
  });

  for (const { name } of uniqueDepts) {
    const depts = await prisma.department.findMany({
      where: { name },
      orderBy: { createdAt: 'asc' }
    });

    if (depts.length > 1) {
      const original = depts[0];
      console.log(`Consolidating ${depts.length} records for Department: ${name}`);

      const duplicateIds = depts.slice(1).map(d => d.id);

      // Update Employees
      await prisma.employee.updateMany({
        where: { departmentId: { in: duplicateIds } },
        data: { departmentId: original.id }
      });

      // Update Designations
      await prisma.designation.updateMany({
        where: { departmentId: { in: duplicateIds } },
        data: { departmentId: original.id }
      });

      // Delete duplicate Departments
      await prisma.department.deleteMany({
        where: { id: { in: duplicateIds } }
      });
    }
  }

  try {
    const Redis = require('ioredis');
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    const keys = await redis.keys('employees:*');
    if (keys.length > 0) await redis.del(keys);
    console.log('Redis cache cleared');
    redis.quit();
  } catch (e) {
    console.log("Redis not available");
  }
}

cleanup().then(() => {
  console.log("Success");
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
