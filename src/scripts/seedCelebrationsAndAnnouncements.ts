import { prisma } from '../lib/prisma';

async function seed() {
  console.log('--- Checking Announcements ---');
  const existingAnnouncements = await prisma.announcement.findMany();
  console.log('Existing announcements count:', existingAnnouncements.length);

  // Find an admin or manager user to author announcements
  const adminOrManager = await prisma.user.findFirst({
    where: {
      OR: [
        { role: { name: { in: ['HR_ADMIN', 'SUPER_ADMIN', 'MANAGER'] } } },
        { email: { contains: 'admin' } }
      ]
    }
  }) || await prisma.user.findFirst();

  if (!adminOrManager) {
    console.log('No user found to author announcement');
    return;
  }

  if (existingAnnouncements.length === 0) {
    console.log('Seeding enterprise announcements...');
    await prisma.announcement.createMany({
      data: [
        {
          title: 'Q4 Annual Town Hall & Performance Awards',
          content: 'All team members are invited to join the hybrid town hall on Friday at 4:00 PM IST. Leadership will share key product updates and annual recognitions.',
          type: 'INFO',
          target: 'ALL',
          authorId: adminOrManager.id,
          isActive: true
        },
        {
          title: 'New Health & Wellness Benefit Policy 2026',
          content: 'Updated comprehensive health insurance coverage and annual executive health checkup reimbursements are now live under the Benefits portal.',
          type: 'SUCCESS',
          target: 'ALL',
          authorId: adminOrManager.id,
          isActive: true
        },
        {
          title: 'Upcoming System Maintenance Window',
          content: 'Scheduled infrastructure upgrade will occur this Saturday between 11:00 PM and 1:00 AM IST. Attendance services will continue offline caching.',
          type: 'WARNING',
          target: 'ALL',
          authorId: adminOrManager.id,
          isActive: true
        }
      ]
    });
    console.log('Announcements seeded successfully!');
  }

  // Check employees for birthdays
  console.log('--- Checking Employees for Celebrations ---');
  const employees = await prisma.employee.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, firstName: true, lastName: true, dob: true, joiningDate: true }
  });
  console.log(`Found ${employees.length} active employees`);

  // Check if any has dob within next 30 days
  const today = new Date();
  let hasUpcomingBirthday = false;
  employees.forEach(e => {
    if (e.dob) {
      const d = new Date(e.dob);
      const diffDays = Math.round((new Date(today.getFullYear(), d.getMonth(), d.getDate()).getTime() - today.getTime()) / (1000 * 3600 * 24));
      if (diffDays >= 0 && diffDays <= 30) {
        hasUpcomingBirthday = true;
        console.log(`Upcoming birthday: ${e.firstName} ${e.lastName} in ${diffDays} days`);
      }
    }
  });

  if (!hasUpcomingBirthday && employees.length > 0) {
    // Also update a direct team member (Khushi Gupta) to have a birthday in 5 days
    const khushi = await prisma.employee.findFirst({
      where: { firstName: { contains: 'Khushi', mode: 'insensitive' } }
    });
    if (khushi) {
      const kbday = new Date(today);
      kbday.setDate(today.getDate() + 5);
      kbday.setFullYear(2001);
      await prisma.employee.update({
        where: { id: khushi.id },
        data: { dob: kbday }
      });
      console.log('Updated Khushi Gupta birthday to in 5 days');
    }
  }

  const khushiDirect = await prisma.employee.findFirst({
    where: { firstName: { contains: 'Khushi', mode: 'insensitive' } }
  });
  if (khushiDirect) {
    const kbday = new Date(today);
    kbday.setDate(today.getDate() + 5);
    kbday.setFullYear(2001);
    await prisma.employee.update({
      where: { id: khushiDirect.id },
      data: { dob: kbday }
    });
    console.log('Updated Khushi Gupta birthday in 5 days');
  }

  console.log('Celebrations and announcements check complete.');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed error:', err);
    process.exit(1);
  });
