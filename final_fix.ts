import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const finalPairs = [
  { dept: "IT Support", role: "IT Support Engineer" },
  { dept: "DevOps", role: "DevOps Engineer" },
  { dept: "Customer Support", role: "Customer Support Specialist" },
  { dept: "Marketing", role: "Marketing Manager" },
  { dept: "Finance", role: "Finance Executive" },
  { dept: "Mobile Development", role: "Mobile App Developer" },
  { dept: "Software Development", role: "Software Architect" }
];

async function finalFix() {
  console.log("Setting up final distribution (NO DUPLICATES)...");
  
  const combinations = [];

  for (const pair of finalPairs) {
    let dept = await prisma.department.findFirst({ where: { name: pair.dept } });
    if (!dept) {
      dept = await prisma.department.create({ data: { name: pair.dept, code: `DEPT-${Math.floor(1000 + Math.random() * 9000)}` } });
    }

    let desig = await prisma.designation.findFirst({ where: { name: pair.role, departmentId: dept.id } });
    if (!desig) {
      desig = await prisma.designation.create({ data: { name: pair.role, departmentId: dept.id } });
    }

    combinations.push({ dId: dept.id, desigId: desig.id });
  }

  const employees = await prisma.employee.findMany({ select: { id: true } });
  
  const chunkSize = 200;
  for (let i = 0; i < employees.length; i += chunkSize) {
    const chunk = employees.slice(i, i + chunkSize);
    let sqlChunks = [];
    let desigChunks = [];

    for (let j = 0; j < chunk.length; j++) {
      const globalIdx = i + j;
      const pair = combinations[globalIdx % combinations.length];
      
      sqlChunks.push(`WHEN id = '${chunk[j].id}' THEN '${pair.dId}'`);
      desigChunks.push(`WHEN id = '${chunk[j].id}' THEN '${pair.desigId}'`);
    }
    
    const sql = `
      UPDATE "Employee"
      SET 
        "departmentId" = CASE ${sqlChunks.join(' ')} ELSE "departmentId" END,
        "designationId" = CASE ${desigChunks.join(' ')} ELSE "designationId" END
      WHERE id IN (${chunk.map(c => `'${c.id}'`).join(', ')})
    `;
    
    await prisma.$executeRawUnsafe(sql);
  }

  // Now, safely delete ANY designation that is NOT in our 7 valid ones
  const validDesigIds = combinations.map(c => c.desigId);
  const deleted = await prisma.designation.deleteMany({
    where: { id: { notIn: validDesigIds } }
  });
  console.log(`Deleted ${deleted.count} unused duplicate designations.`);

  try {
    const Redis = require('ioredis');
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    const keys = await redis.keys('employees:*');
    if (keys.length > 0) await redis.del(keys);
    redis.quit();
  } catch (e) {}
}

finalFix().then(() => {
  console.log("Success");
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
