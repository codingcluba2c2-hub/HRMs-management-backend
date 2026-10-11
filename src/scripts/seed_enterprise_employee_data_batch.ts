import { prisma } from '../lib/prisma';
import { encrypt } from '../utils/encryption';
import crypto from 'crypto';

const BANKS = [
  { name: 'HDFC Bank', ifscPrefix: 'HDFC000' },
  { name: 'ICICI Bank', ifscPrefix: 'ICIC000' },
  { name: 'State Bank of India', ifscPrefix: 'SBIN000' },
  { name: 'Axis Bank', ifscPrefix: 'UTIB000' },
  { name: 'Kotak Mahindra Bank', ifscPrefix: 'KKBK000' }
];

const CITIES = [
  { city: 'Gurugram', state: 'Haryana', postalCode: '122002' },
  { city: 'New Delhi', state: 'Delhi', postalCode: '110001' },
  { city: 'Noida', state: 'Uttar Pradesh', postalCode: '201301' },
  { city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' },
  { city: 'Mumbai', state: 'Maharashtra', postalCode: '400001' }
];

async function seedFast() {
  console.log('⚡ Starting High-Speed Batch Enterprise Data Seed...');

  // 1. Shift
  let defaultShift = await prisma.shift.findFirst({ where: { status: true } });
  if (!defaultShift) {
    defaultShift = await prisma.shift.create({
      data: {
        name: 'General Day Shift',
        startTime: '09:00',
        endTime: '18:00',
        graceTime: 15,
        breakDuration: 60,
        weeklyOff: ['Sunday']
      }
    });
  }

  const allShifts = await prisma.shift.findMany();
  const employees = await prisma.employee.findMany({
    where: { isDeleted: false },
    select: {
      id: true,
      employeeId: true,
      firstName: true,
      lastName: true,
      email: true,
      bankName: true,
      accountNumber: true,
      city: true,
      shiftId: true,
      baseSalary: true,
      joiningDate: true
    }
  });

  console.log(`Loaded ${employees.length} employees.`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 2. Batch Leave Balances
  const leaveBalanceData: any[] = [];
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    leaveBalanceData.push({
      employeeId: emp.id,
      annual: 15,
      casual: 10,
      medical: 8,
      earned: 5,
      compOff: (i % 3 === 0) ? 2 : 0
    });
  }
  const lbResult = await prisma.leaveBalance.createMany({
    data: leaveBalanceData,
    skipDuplicates: true
  });
  console.log(`✅ Leave Balances seeded: ${lbResult.count}`);

  // 3. Batch Leave Requests
  const leaveRequestsData: any[] = [];
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const types = ['CASUAL', 'SICK', 'EARNED'];
    const chosenType = types[i % types.length];
    const startD = new Date(today);
    startD.setDate(today.getDate() - (4 + (i % 12)));
    const endD = new Date(startD);
    endD.setDate(startD.getDate() + (i % 2 === 0 ? 1 : 2));

    leaveRequestsData.push({
      employeeId: emp.id,
      leaveType: chosenType,
      startDate: startD,
      endDate: endD,
      status: (i % 5 === 0) ? 'PENDING' : 'APPROVED',
      description: `${chosenType.toLowerCase()} leave for family event / health checkup`,
      halfDay: false
    });
  }
  const lrResult = await prisma.leaveRequest.createMany({
    data: leaveRequestsData,
    skipDuplicates: true
  });
  console.log(`✅ Leave Requests seeded: ${lrResult.count}`);

  // 4. Batch Documents
  const documentsData: any[] = [];
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    documentsData.push({
      employeeId: emp.id,
      category: 'IDENTITY',
      documentType: 'Aadhaar Card',
      encryptedDocumentPath: `/uploads/docs/${emp.employeeId}_aadhaar.pdf`,
      fileHash: crypto.randomBytes(16).toString('hex'),
      mimeType: 'application/pdf',
      size: 450000,
      verificationStatus: 'VERIFIED',
      remarks: 'Aadhaar verified via UIDAI',
      verifiedBy: 'HR Operations',
      verifiedAt: new Date(today.getTime() - 15 * 86400000)
    });
    documentsData.push({
      employeeId: emp.id,
      category: 'IDENTITY',
      documentType: 'PAN Card',
      encryptedDocumentPath: `/uploads/docs/${emp.employeeId}_pan.jpg`,
      fileHash: crypto.randomBytes(16).toString('hex'),
      mimeType: 'image/jpeg',
      size: 210000,
      verificationStatus: 'VERIFIED',
      remarks: 'PAN verified with NSDL',
      verifiedBy: 'HR Operations',
      verifiedAt: new Date(today.getTime() - 15 * 86400000)
    });
    documentsData.push({
      employeeId: emp.id,
      category: 'EMPLOYMENT',
      documentType: 'Offer Letter',
      encryptedDocumentPath: `/uploads/docs/${emp.employeeId}_offer.pdf`,
      fileHash: crypto.randomBytes(16).toString('hex'),
      mimeType: 'application/pdf',
      size: 680000,
      verificationStatus: 'VERIFIED',
      remarks: 'Signed offer agreement',
      verifiedBy: 'HR Talent Dept',
      verifiedAt: new Date(today.getTime() - 20 * 86400000)
    });
  }
  const docResult = await prisma.employeeDocument.createMany({
    data: documentsData,
    skipDuplicates: true
  });
  console.log(`✅ Documents seeded: ${docResult.count}`);

  // 5. Batch Payroll
  const payrollData: any[] = [];
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const sal = Number(emp.baseSalary || 32000);
    const basic = Math.round(sal * 0.5);
    const hra = Math.round(sal * 0.3);
    const allowance = sal - basic - hra;
    const pf = Math.round(basic * 0.12);
    const deductions = pf + 200;
    const netSalary = sal - deductions;

    payrollData.push({
      employeeId: emp.id,
      month: 9,
      year: 2026,
      basicSalary: basic,
      hra,
      specialAllowance: allowance,
      grossSalary: sal,
      providentFund: pf,
      professionalTax: 200,
      deductions,
      netSalary,
      workingDays: 22,
      paidDays: 22,
      paymentDate: new Date('2026-10-01T10:00:00Z'),
      paymentMethod: 'BANK_TRANSFER',
      transactionId: `TXN${Math.floor(10000000 + (i * 8372) % 90000000)}`,
      status: 'PAID'
    });
  }
  const payResult = await prisma.payroll.createMany({
    data: payrollData,
    skipDuplicates: true
  });
  console.log(`✅ Payroll records seeded: ${payResult.count}`);

  // 6. Batch Attendance Records for past 20 days
  const attendanceData: any[] = [];
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const shiftForEmp = allShifts[i % allShifts.length] || defaultShift;
    const weeklyOff = shiftForEmp.weeklyOff?.length ? shiftForEmp.weeklyOff : ['Sunday'];

    for (let dayOffset = 20; dayOffset >= 1; dayOffset--) {
      const recordDate = new Date(today);
      recordDate.setDate(today.getDate() - dayOffset);
      recordDate.setHours(0, 0, 0, 0);

      const dayName = recordDate.toLocaleDateString('en-US', { weekday: 'long' });
      const isOff = weeklyOff.includes(dayName);

      if (isOff) {
        attendanceData.push({
          employeeId: emp.id,
          date: recordDate,
          status: 'WEEKEND',
          grossHours: 0,
          effectiveHours: 0,
          isLate: false,
          isOvertime: false,
          shiftId: shiftForEmp.id
        });
        continue;
      }

      const rand = (i * 11 + dayOffset * 17) % 100;
      let status = 'PRESENT';
      let isLate = false;
      let grossHours = 9.0;
      let effectiveHours = 8.0;

      if (rand < 3) {
        status = 'ABSENT';
        grossHours = 0;
        effectiveHours = 0;
      } else if (rand < 6) {
        status = 'HALF_DAY';
        grossHours = 4.5;
        effectiveHours = 4.0;
      } else {
        status = 'PRESENT';
        isLate = rand > 85;
        grossHours = parseFloat((8.5 + (rand % 10) * 0.1).toFixed(1));
        effectiveHours = parseFloat((grossHours - 1.0).toFixed(1));
      }

      attendanceData.push({
        employeeId: emp.id,
        date: recordDate,
        status,
        isLate,
        isOvertime: grossHours > 9.0,
        grossHours,
        effectiveHours,
        shiftId: shiftForEmp.id
      });
    }
  }

  // Insert in chunks of 500 for safety
  let totalAttInserted = 0;
  const CHUNK_SIZE = 500;
  for (let c = 0; c < attendanceData.length; c += CHUNK_SIZE) {
    const slice = attendanceData.slice(c, c + CHUNK_SIZE);
    const res = await prisma.attendanceRecord.createMany({
      data: slice,
      skipDuplicates: true
    });
    totalAttInserted += res.count;
  }
  console.log(`✅ Attendance Records batch seeded: ${totalAttInserted}`);

  // 7. Update Employee Bank & Contact if missing (in chunks of 15 concurrently)
  console.log('Updating employee profiles with bank and contact details...');
  for (let c = 0; c < employees.length; c += 15) {
    const chunk = employees.slice(c, c + 15);
    await Promise.all(chunk.map(async (emp, idxWithin) => {
      const globalIdx = c + idxWithin;
      const bankChoice = BANKS[globalIdx % BANKS.length];
      const cityChoice = CITIES[globalIdx % CITIES.length];
      const accNumRaw = `${Math.floor(1000000000 + (globalIdx * 9384729) % 9000000000)}`;
      const ifscCode = `${bankChoice.ifscPrefix}${String(1000 + (globalIdx * 37) % 9000)}`;
      const empUpi = `${emp.firstName.toLowerCase()}.${emp.employeeId.toLowerCase()}@okhdfcbank`;
      const assignedShift = emp.shiftId || (allShifts[globalIdx % allShifts.length]?.id || defaultShift.id);

      await prisma.employee.update({
        where: { id: emp.id },
        data: {
          bankName: emp.bankName || bankChoice.name,
          accountNumber: emp.accountNumber || encrypt(accNumRaw),
          ifsc: emp.accountNumber ? undefined : ifscCode,
          upiId: emp.accountNumber ? undefined : empUpi,
          address: emp.city ? undefined : `Tower ${1 + (globalIdx % 5)}, Floor ${2 + (globalIdx % 10)}, Cyber Hub`,
          city: emp.city || cityChoice.city,
          state: emp.city ? undefined : cityChoice.state,
          country: 'India',
          postalCode: emp.city ? undefined : cityChoice.postalCode,
          shiftId: assignedShift,
          baseSalary: emp.baseSalary && Number(emp.baseSalary) > 0 ? emp.baseSalary : (28000 + (globalIdx * 1200) % 45000)
        }
      });
    }));
  }

  console.log('🎉 ALL ENTERPRISE WORKFORCE DATA SUCCESSFULLY SEEDED!');
}

seedFast()
  .catch(err => {
    console.error('Batch seed error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
