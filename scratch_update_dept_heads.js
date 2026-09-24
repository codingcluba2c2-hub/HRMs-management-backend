const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const departments = await prisma.department.findMany({
    include: { employees: { include: { subordinates: true } } }
  });
  
  for (const dept of departments) {
    if (!dept.managerId && dept.employees.length > 0) {
      // Find employees in this department who manage someone in the same department
      const managersInDept = dept.employees.filter(emp => 
        emp.subordinates.some(sub => sub.departmentId === dept.id)
      );
      
      if (managersInDept.length > 0) {
        // Assign the first one found
        await prisma.department.update({
          where: { id: dept.id },
          data: { managerId: managersInDept[0].id }
        });
        console.log(`Updated dept ${dept.name} with manager ${managersInDept[0].firstName} ${managersInDept[0].lastName}`);
      } else {
        console.log(`No clear manager found for dept ${dept.name}`);
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
