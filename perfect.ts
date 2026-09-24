import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const depts = [
  "IT Support", "DevOps", "Customer Support", "Marketing",
  "Finance", "Mobile Development", "Software Development"
];

const rolesList = [
  "Junior Software Engineer", "Software Architect", "Software Architect", "Business Analyst",
  "Business Analyst", "Business Analyst", "Finance Executive", "Software Architect", "Junior Software Engineer"
];

async function perfectDistribute() {
  console.log("Setting up perfect distribution (chunked)...");
  
  const deptIds = [];
  for (const name of depts) {
    let dept = await prisma.department.findFirst({ where: { name } });
    if (!dept) {
      dept = await prisma.department.create({ data: { name, code: `DEPT-${Math.floor(1000 + Math.random() * 9000)}` } });
    }
    deptIds.push(dept.id);
  }

  // Pre-create all combinations to avoid creating them in a massive loop
  const combinations = [];
  for (let i = 0; i < Math.max(depts.length, rolesList.length); i++) {
    const dId = deptIds[i % depts.length];
    const roleName = rolesList[i % rolesList.length];
    
    let desig = await prisma.designation.findFirst({ where: { name: roleName, departmentId: dId } });
    if (!desig) {
      desig = await prisma.designation.create({ data: { name: roleName, departmentId: dId } });
    }
    combinations.push({ dId, desigId: desig.id });
  }

  const employees = await prisma.employee.findMany({ select: { id: true } });
  
  // Chunking
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
    console.log(`Updated chunk ${i} to ${i + chunk.length}`);
  }

  try {
    const Redis = require('ioredis');
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    const keys = await redis.keys('employees:*');
    if (keys.length > 0) await redis.del(keys);
    redis.quit();
    console.log('Redis cache cleared');
  } catch (e) {}
}

perfectDistribute().then(() => {
  console.log("Success");
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
