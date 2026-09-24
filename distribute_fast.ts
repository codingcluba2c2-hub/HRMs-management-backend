import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const departments = [
  "IT Support", "DevOps", "Customer Support", "Marketing",
  "Finance", "Mobile Development", "Software Development"
];

const roles = [
  "Junior Software Engineer", "Software Architect", "Business Analyst", "Finance Executive"
];

async function fastDistribute() {
  console.log("Starting FAST distribution...");
  
  const deptMap: Record<string, string> = {};
  for (const name of departments) {
    let dept = await prisma.department.findFirst({ where: { name } });
    if (!dept) {
      dept = await prisma.department.create({ data: { name, code: `DEPT-${Math.floor(1000 + Math.random() * 9000)}` } });
    }
    deptMap[name] = dept.id;
  }

  const designations: {departmentId: string, designationId: string}[] = [];
  for (const dName of departments) {
    const dId = deptMap[dName];
    for (const rName of roles) {
      let desig = await prisma.designation.findFirst({ where: { name: rName, departmentId: dId } });
      if (!desig) {
        desig = await prisma.designation.create({ data: { name: rName, departmentId: dId } });
      }
      designations.push({ departmentId: dId, designationId: desig.id });
    }
  }

  const employees = await prisma.employee.findMany({ select: { id: true } });
  
  console.log(`Executing raw SQL updates for ${employees.length} employees...`);
  
  let sqlChunks = [];
  for (let i = 0; i < employees.length; i++) {
    const pair = designations[i % designations.length];
    sqlChunks.push(`WHEN id = '${employees[i].id}' THEN '${pair.departmentId}'`);
  }
  
  let desigChunks = [];
  for (let i = 0; i < employees.length; i++) {
    const pair = designations[i % designations.length];
    desigChunks.push(`WHEN id = '${employees[i].id}' THEN '${pair.designationId}'`);
  }

  if (employees.length > 0) {
    const sql = `
      UPDATE "Employee"
      SET 
        "departmentId" = CASE ${sqlChunks.join(' ')} ELSE "departmentId" END,
        "designationId" = CASE ${desigChunks.join(' ')} ELSE "designationId" END
    `;
    const res = await prisma.$executeRawUnsafe(sql);
    console.log(`Raw SQL update affected ${res} rows.`);
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

fastDistribute().then(() => {
  console.log("Success");
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
