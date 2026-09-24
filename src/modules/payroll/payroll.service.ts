import { prisma } from '../../lib/prisma';
import { Payroll, PayrollQuery } from '@prisma/client';
import { decrypt } from '../../utils/encryption';
import { generatePayslipPdf } from '../../utils/pdfGenerator';
import { sendPayrollEmail } from '../../utils/mailer';

export const createPayrollRecord = async (arg1: any, arg2?: any) => {
  const data = arg2 !== undefined ? arg2 : arg1;
  const employee = await prisma.employee.findUnique({ where: { id: data.employeeId } });
  if (!employee) throw new Error("Employee not found");

  // Calculate fields
  const grossSalary = data.basicSalary + (data.bonus || 0);
  const netSalary = grossSalary - (data.deductions || 0);
  
  // Tax logic (simplified)
  const incomeTax = data.deductions > 0 ? data.deductions * 0.5 : 0; // arbitrary split for display
  const providentFund = data.deductions > 0 ? data.deductions * 0.5 : 0;

  let parsedPaymentDate = new Date(data.paymentDate);
  if (typeof data.paymentDate === 'string' && data.paymentDate.length === 10) {
    const now = new Date();
    if (data.paymentDate === now.toISOString().split('T')[0]) {
      parsedPaymentDate = now;
    } else {
      parsedPaymentDate = new Date(`${data.paymentDate}T${now.toISOString().split('T')[1]}`);
    }
  }

  // Save to DB
  const payrollRecord = await prisma.payroll.upsert({
    where: {
      employeeId_month_year: {
        employeeId: employee.id,
        month: data.month,
        year: data.year
      }
    },
    update: {
      basicSalary: data.basicSalary,
      bonus: data.bonus || 0,
      deductions: data.deductions || 0,
      grossSalary,
      netSalary,
      incomeTax,
      providentFund,
      workingDays: data.workingDays,
      paidDays: data.workingDays,
      status: data.status,
      paymentDate: parsedPaymentDate
    },
    create: {
      employeeId: employee.id,
      month: data.month,
      year: data.year,
      basicSalary: data.basicSalary,
      bonus: data.bonus || 0,
      deductions: data.deductions || 0,
      grossSalary,
      netSalary,
      incomeTax,
      providentFund,
      workingDays: data.workingDays,
      paidDays: data.workingDays, // simplified
      status: data.status,
      paymentDate: parsedPaymentDate
    }
  });

  // Generate PDF Payslip
  try {
    const pdfBuffer = await generatePayslipPdf({
      companyName: "Enterprise HRMS",
      companyAddress: "123 Tech Park, Innovation Valley",
      companyWebsite: "www.enterprise-hrms.com",
      companyPhone: "+1 800 555 0199",
      month: data.month,
      year: data.year,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeId: employee.employeeId,
      employeeEmail: employee.email,
      paymentDate: new Date(data.paymentDate),
      workingDays: data.workingDays,
      transactionId: data.transactionId || `TXN-${Date.now()}`,
      bankName: data.bankName || employee.bankName || "N/A",
      accountNumber: data.accountNumber || (employee.accountNumber ? decrypt(employee.accountNumber) : "N/A"),
      basicSalary: data.basicSalary,
      bonus: data.bonus || 0,
      deductions: data.deductions || 0,
      netSalary
    });

    // Send Email
    await sendPayrollEmail(
      employee.email, 
      `${employee.firstName} ${employee.lastName}`, 
      data.month, 
      data.year, 
      netSalary,
      data.bankName || employee.bankName || "N/A",
      "XXXX" + (data.accountNumber || (employee.accountNumber ? decrypt(employee.accountNumber) : "")).slice(-4),
      pdfBuffer
    );
  } catch (error) {
    console.error("Failed to generate PDF or send email:", error);
    // Even if email fails, record is created, but we might want to log it
  }

  return payrollRecord;
};

export const bulkCreatePayrollRecords = async (records: any[]) => {
  const results = await Promise.allSettled(records.map(record => createPayrollRecord(record)));
  
  const successful = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value);
  const failed = results.filter(r => r.status === 'rejected').map((r: any) => ({
    reason: r.reason?.message || "Unknown error"
  }));

  return { successful, failed };
};

export const getPayrollSummary = async (userId: string, role: string) => {
  if (role === 'EMPLOYEE') {
    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new Error("Employee not found");
    
    // YTD Logic (Year To Date)
    const currentYear = new Date().getFullYear();
    const currentYearPayslips = await prisma.payroll.findMany({
      where: { employeeId: employee.id, year: currentYear }
    });

    const ytdEarnings = currentYearPayslips.reduce((acc: number, curr: any) => acc + curr.grossSalary, 0);
    const ytdDeductions = currentYearPayslips.reduce((acc: number, curr: any) => acc + curr.deductions, 0);
    const ytdTax = currentYearPayslips.reduce((acc: number, curr: any) => acc + curr.incomeTax, 0);
    const ytdNet = currentYearPayslips.reduce((acc: number, curr: any) => acc + curr.netSalary, 0);
    const ytdBonus = currentYearPayslips.reduce((acc: number, curr: any) => acc + curr.bonus, 0);
    const ytdPF = currentYearPayslips.reduce((acc: number, curr: any) => acc + curr.providentFund, 0);
    const averageSalary = currentYearPayslips.length > 0 ? (ytdNet / currentYearPayslips.length) : 0;

    // Latest month
    const latestPayslip = currentYearPayslips.sort((a: any, b: any) => 
      new Date(b.year, b.month - 1).getTime() - new Date(a.year, a.month - 1).getTime()
    )[0];

    const currentMonthSalary = latestPayslip ? latestPayslip.netSalary : 0;
    
    return {
      metrics: [
        { title: "Current Month Salary", value: `₹${currentMonthSalary.toLocaleString()}`, subtitle: "Net Pay", trend: "Latest", icon: "Wallet" },
        { title: "YTD Earnings", value: `₹${ytdEarnings.toLocaleString()}`, subtitle: "Gross Salary", trend: "This Year", icon: "Banknote" },
        { title: "Net Salary YTD", value: `₹${ytdNet.toLocaleString()}`, subtitle: "Take Home", trend: "This Year", icon: "CheckCircle" },
        { title: "Total Bonus", value: `₹${ytdBonus.toLocaleString()}`, subtitle: "YTD", trend: "Rewards", icon: "Award" },
        { title: "Total Deductions", value: `₹${ytdDeductions.toLocaleString()}`, subtitle: "YTD", trend: "Deductions", icon: "TrendingDown" },
        { title: "Income Tax Paid", value: `₹${ytdTax.toLocaleString()}`, subtitle: "YTD", trend: "Tax", icon: "Receipt" },
      ],
      ytdSummary: {
        ytdEarnings, ytdTax, ytdBonus, ytdPF, ytdDeductions, averageSalary
      },
      insights: [
        { id: '1', type: 'INFO', message: `Average monthly earnings this year are ₹${averageSalary.toLocaleString(undefined, {maximumFractionDigits: 0})}.` },
        { id: '2', type: 'POSITIVE', message: `Your latest payslip for ${latestPayslip ? latestPayslip.month + '/' + latestPayslip.year : 'N/A'} is available.` }
      ]
    };
  } else {
    // HR / SUPER ADMIN Global Summary
    const currentYear = new Date().getFullYear();
    const currentYearPayslips = await prisma.payroll.findMany({
      where: { year: currentYear }
    });

    const totalPaid = currentYearPayslips.reduce((acc: number, curr: any) => acc + curr.netSalary, 0);
    const totalGross = currentYearPayslips.reduce((acc: number, curr: any) => acc + curr.grossSalary, 0);
    const totalTax = currentYearPayslips.reduce((acc: number, curr: any) => acc + curr.incomeTax, 0);
    const totalBonus = currentYearPayslips.reduce((acc: number, curr: any) => acc + curr.bonus, 0);
    const totalDeductions = currentYearPayslips.reduce((acc: number, curr: any) => acc + curr.deductions, 0);
    const totalPF = currentYearPayslips.reduce((acc: number, curr: any) => acc + curr.providentFund, 0);

    return {
      metrics: [
        { title: "Total Salary Paid", value: `₹${totalPaid.toLocaleString()}`, subtitle: "Net Pay", trend: "Global", icon: "Wallet" },
        { title: "Total Gross Salary", value: `₹${totalGross.toLocaleString()}`, subtitle: "Gross Pay", trend: "Global", icon: "Banknote" },
        { title: "Total Tax Collected", value: `₹${totalTax.toLocaleString()}`, subtitle: "YTD", trend: "Tax", icon: "Receipt" },
        { title: "Total Bonus Paid", value: `₹${totalBonus.toLocaleString()}`, subtitle: "YTD", trend: "Rewards", icon: "Award" },
        { title: "Total Deductions", value: `₹${totalDeductions.toLocaleString()}`, subtitle: "YTD", trend: "Global", icon: "TrendingDown" },
        { title: "Total PF Contributions", value: `₹${totalPF.toLocaleString()}`, subtitle: "YTD", trend: "Deductions", icon: "ShieldCheck" }
      ],
      insights: [
        { id: '1', type: 'INFO', message: `Global payroll processed successfully this month.` },
      ]
    };
  }
};

export const getPayrollRecords = async (userId: string, role: string, filters: any) => {
  let whereClause: any = {};
  
  if (role === 'EMPLOYEE') {
    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new Error("Employee not found");
    whereClause.employeeId = employee.id;
  }

  if (filters.status && filters.status !== 'ALL') {
    whereClause.status = filters.status;
  }
  if (filters.year && filters.year !== 'ALL') {
    whereClause.year = parseInt(filters.year);
  }
  if (filters.month && filters.month !== 'ALL') {
    whereClause.month = parseInt(filters.month);
  }

  const records = await prisma.payroll.findMany({
    where: whereClause,
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    include: {
      employee: {
        include: {
          department: true,
          designation: true,
          user: true
        }
      }
    }
  });

  // Fetch company info to attach to records
  let companyName: string | null = null;
  let companyWebsite: string | null = null;
  let companyAddress: string | null = null;
  let companyPhone: string | null = null;

  const adminUser = await prisma.user.findFirst({
    where: {
      companyName: {
        not: null,
        notIn: ['', 'Company']
      }
    }
  });
  if (adminUser) {
    companyName = adminUser.companyName || null;
    companyWebsite = adminUser.companyWebsite || null;
    companyAddress = adminUser.companyAddress || null;
    companyPhone = adminUser.companyPhone || null;
  }

  const compContact = [companyWebsite, companyPhone].filter(Boolean).join(' | ');

  const enrichedRecords = records.map(r => ({
    ...JSON.parse(JSON.stringify(r)),
    companyName: companyName || '',
    companyAddress: companyAddress || '',
    companyContact: compContact,
    companyWebsite: companyWebsite || '',
    companyPhone: companyPhone || '',
    company: {
      companyName: companyName || '',
      companyAddress: companyAddress || '',
      companyWebsite: companyWebsite || '',
      companyPhone: companyPhone || '',
      companyContact: compContact
    }
  }));

  return enrichedRecords;
};

export const getPayslipById = async (userId: string, role: string, payslipId: string) => {
  const payroll = await prisma.payroll.findUnique({
    where: { id: payslipId },
    include: {
      employee: {
        include: {
          department: true,
          designation: true,
          manager: {
            include: { user: true }
          },
          user: true
        }
      }
    }
  });

  if (!payroll) {
    const error: any = new Error("Payslip record not found");
    error.statusCode = 404;
    throw error;
  }

  // IDOR Security Check: Employee can only access their own payslips
  if (role === 'EMPLOYEE') {
    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee || payroll.employeeId !== employee.id) {
      const error: any = new Error("Access denied: You are not authorized to view this payslip");
      error.statusCode = 403;
      throw error;
    }
  }

  // Fetch company info
  let companyName: string | null = null;
  let companyWebsite: string | null = null;
  let companyAddress: string | null = null;
  let companyPhone: string | null = null;

  if (payroll.employee.createdById) {
    const hrAdmin = await prisma.user.findUnique({ where: { id: payroll.employee.createdById } });
    if (hrAdmin?.companyName && hrAdmin.companyName.trim().length > 0 && hrAdmin.companyName !== 'Company') {
      companyName = hrAdmin.companyName;
      companyWebsite = hrAdmin.companyWebsite || null;
      companyAddress = hrAdmin.companyAddress || null;
      companyPhone = hrAdmin.companyPhone || null;
    }
  }

  if (!companyName && payroll.employee.userId) {
    const empUser = await prisma.user.findUnique({ where: { id: payroll.employee.userId } });
    if (empUser?.companyName && empUser.companyName.trim().length > 0 && empUser.companyName !== 'Company') {
      companyName = empUser.companyName;
      companyWebsite = empUser.companyWebsite || null;
      companyAddress = empUser.companyAddress || null;
      companyPhone = empUser.companyPhone || null;
    }
  }

  if (!companyName) {
    const adminUser = await prisma.user.findFirst({
      where: {
        companyName: {
          not: null,
          notIn: ['', 'Company']
        }
      }
    });
    if (adminUser) {
      companyName = adminUser.companyName;
      companyWebsite = adminUser.companyWebsite || null;
      companyAddress = adminUser.companyAddress || null;
      companyPhone = adminUser.companyPhone || null;
    }
  }

  const compContact = [companyWebsite, companyPhone].filter(Boolean).join(' | ');

  return {
    ...JSON.parse(JSON.stringify(payroll)),
    companyName: companyName || '',
    companyAddress: companyAddress || '',
    companyContact: compContact,
    companyWebsite: companyWebsite || '',
    companyPhone: companyPhone || '',
    company: {
      companyName: companyName || '',
      companyAddress: companyAddress || '',
      companyWebsite: companyWebsite || '',
      companyPhone: companyPhone || '',
      companyContact: compContact
    }
  };
};

export const generatePayslipPdfById = async (userId: string, role: string, payslipId: string): Promise<{ buffer: Buffer; fileName: string }> => {
  const payslipData = await getPayslipById(userId, role, payslipId);
  const emp = payslipData.employee;
  const company = payslipData.company;

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[(payslipData.month || 1) - 1] || `Month ${payslipData.month}`;
  const yearName = payslipData.year;
  const employeeName = `${emp.firstName} ${emp.lastName}`.trim();

  const buffer = await generatePayslipPdf({
    companyName: company.companyName,
    companyAddress: company.companyAddress,
    companyWebsite: company.companyWebsite,
    companyPhone: company.companyPhone,
    month: payslipData.month,
    year: payslipData.year,
    employeeName,
    employeeId: emp.employeeId || emp.id.slice(0, 8).toUpperCase(),
    employeeEmail: emp.email,
    paymentDate: payslipData.paymentDate,
    workingDays: payslipData.workingDays,
    transactionId: payslipData.transactionId || '—',
    bankName: emp.bankName || 'N/A',
    accountNumber: emp.accountNumber || 'N/A',
    basicSalary: payslipData.basicSalary,
    bonus: payslipData.bonus,
    deductions: payslipData.deductions,
    netSalary: payslipData.netSalary
  });

  const fileName = `Payslip_${monthName}_${yearName}_${employeeName.replace(/\s+/g, '_')}.pdf`;
  return { buffer, fileName };
};

export const getPayrollAnalytics = async (userId: string, role: string) => {
  let whereClause: any = {};
  if (role === 'EMPLOYEE') {
    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new Error("Employee not found");
    whereClause.employeeId = employee.id;
  }
  
  whereClause.year = new Date().getFullYear();

  const records = await prisma.payroll.findMany({
    where: whereClause,
    orderBy: { month: 'asc' }
  });

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  // Aggregate data if HR, else just map it for Employee
  const salaryTrend = months.map((m, i) => {
    const monthRecords = records.filter((r: any) => r.month === i + 1);
    return {
      month: m,
      netSalary: monthRecords.reduce((acc: number, curr: any) => acc + curr.netSalary, 0),
      grossSalary: monthRecords.reduce((acc: number, curr: any) => acc + curr.grossSalary, 0)
    };
  });

  const deductionTrend = months.map((m, i) => {
    const monthRecords = records.filter((r: any) => r.month === i + 1);
    return {
      month: m,
      tax: monthRecords.reduce((acc: number, curr: any) => acc + curr.incomeTax, 0),
      pf: monthRecords.reduce((acc: number, curr: any) => acc + curr.providentFund, 0),
      other: monthRecords.reduce((acc: number, curr: any) => acc + (curr.deductions - curr.incomeTax - curr.providentFund), 0)
    };
  });

  return { salaryTrend, deductionTrend };
};

export const createPayrollQuery = async (userId: string, data: any) => {
  const employee = await prisma.employee.findUnique({ where: { userId } });
  if (!employee) throw new Error("Employee not found");

  const query = await prisma.payrollQuery.create({
    data: {
      employeeId: employee.id,
      payrollId: data.payrollId || null,
      issueType: data.issueType,
      description: data.description,
      status: 'PENDING'
    }
  });

  return query;
};

export const getTimelineActivities = async (userId: string, role: string) => {
  // Mocking timeline activities based on database limits
  return [
    { id: 1, title: 'Salary Credited', description: 'Your salary for May 2026 was credited.', date: new Date().toISOString(), type: 'SUCCESS' },
    { id: 2, title: 'Payslip Generated', description: 'May 2026 payslip is available for download.', date: new Date(Date.now() - 86400000).toISOString(), type: 'INFO' },
    { id: 3, title: 'Bonus Processed', description: 'Annual performance bonus added to gross pay.', date: new Date(Date.now() - 172800000).toISOString(), type: 'WARNING' },
    { id: 4, title: 'Tax Config Updated', description: 'New tax regime selected for FY 26-27.', date: new Date(Date.now() - 259200000).toISOString(), type: 'INFO' },
  ];
};



export const deletePayrollRecord = async (id: string) => {
  return await prisma.payroll.delete({
    where: { id }
  });
};

