import dotenv from 'dotenv';
dotenv.config();
import http from 'http';
import express from 'express';
import attendanceRoutes from '../attendance.route';
import axios from 'axios';
import { prisma } from '../../../lib/prisma';
import ExcelJS from 'exceljs';
import FormData from 'form-data';
import jwt from 'jsonwebtoken';

async function runE2EVerification() {
  console.log('====================================================');
  console.log('   BULK IMPORT END-TO-END HTTP API VERIFICATION      ');
  console.log('====================================================\n');

  const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-change-me';

  // 1. Find or create an admin user
  let admin = await prisma.user.findFirst({
    include: { role: true }
  });

  const token = jwt.sign(
    {
      id: admin?.id,
      email: admin?.email,
      role: admin?.role?.name || 'SUPER_ADMIN',
      companyId: admin?.companyId
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const testApp = express();
  testApp.use(express.json());
  testApp.use('/api/attendance', attendanceRoutes);

  const server = http.createServer(testApp);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 6002;

  const client = axios.create({
    baseURL: `http://localhost:${port}/api`,
    headers: { Authorization: `Bearer ${token}` }
  });

  try {
    // Step 1: Download Template
  console.log('Step 1: Testing GET /attendance/bulk-import/template ...');
  const templateRes = await client.get('/attendance/bulk-import/template', { responseType: 'arraybuffer' });
  if (templateRes.status === 200 && templateRes.data.length > 1000) {
    console.log(`✅ Template downloaded successfully (${templateRes.data.length} bytes)`);
  } else {
    throw new Error('Template download failed');
  }

  // Step 2: Create a multi-employee, multi-date test workbook
  console.log('\nStep 2: Building test Excel workbook with multiple employees & historical dates...');
  const testWb = new ExcelJS.Workbook();
  const testSheet = testWb.addWorksheet('Attendance Data');
  testSheet.addRow([
    'Employee ID',
    'Attendance Date',
    'Punch In',
    'Punch Out',
    'Lunch Break Minutes',
    'Tea Break Minutes',
    'Bio Break Minutes',
    'Official Break Minutes',
    'Personal Break Minutes',
    'Attendance Status',
    'Shift',
    'Remarks',
    'Record ID'
  ]);

  // Clean old test dates for test employees
  const testDates = ['2026-07-10', '2026-07-11'];
  const emp1 = await prisma.employee.findFirst({ where: { employeeId: 'TEST_EMP_01' } });
  const emp2 = await prisma.employee.findFirst({ where: { employeeId: 'TEST_EMP_02' } });

  if (emp1 && emp2) {
    for (const d of testDates) {
      const dObj = new Date(d);
      await prisma.attendanceRecord.deleteMany({
        where: {
          employeeId: { in: [emp1.id, emp2.id] },
          date: new Date(Date.UTC(dObj.getFullYear(), dObj.getMonth(), dObj.getDate(), 0, 0, 0, 0))
        }
      });
    }

    // Pre-create 1 existing record for emp1 on 2026-07-10 that will be CORRECTED
    const preDate = new Date(Date.UTC(2026, 6, 10, 0, 0, 0, 0));
    const existingRec = await prisma.attendanceRecord.create({
      data: {
        employeeId: emp1.id,
        date: preDate,
        status: 'HALF_DAY',
        grossHours: 4,
        effectiveHours: 4
      }
    });

    // Row 1: Existing record correction (TEST_EMP_01 on 2026-07-10) -> changing to PRESENT, full hours
    testSheet.addRow([
      'TEST_EMP_01',
      '2026-07-10',
      '09:00:00',
      '18:00:00',
      45,
      15,
      0,
      0,
      0,
      'PRESENT',
      'General Shift',
      'Corrected from half day to full day',
      existingRec.id
    ]);

    // Row 2: Brand new record (TEST_EMP_01 on 2026-07-11)
    testSheet.addRow([
      'TEST_EMP_01',
      '2026-07-11',
      '09:30:00',
      '18:30:00',
      60,
      0,
      0,
      0,
      0,
      'PRESENT',
      'General Shift',
      'Brand new attendance',
      ''
    ]);

    // Row 3: Brand new record (TEST_EMP_02 on 2026-07-10)
    testSheet.addRow([
      'TEST_EMP_02',
      '2026-07-10',
      '08:45:00',
      '17:45:00',
      30,
      15,
      0,
      0,
      0,
      'PRESENT',
      'General Shift',
      'Brand new session for emp 2',
      ''
    ]);

    // Row 4: Intentional invalid row (invalid date) to test error diagnostics
    testSheet.addRow([
      'TEST_EMP_02',
      'INVALID_DATE_FORMAT',
      '09:00',
      '18:00',
      0,
      0,
      0,
      0,
      0,
      'PRESENT',
      'General Shift',
      'Bad row for testing',
      ''
    ]);

    const buf = await testWb.xlsx.writeBuffer();

    // Step 3: POST /attendance/bulk-import/preview
    console.log('\nStep 3: Testing POST /attendance/bulk-import/preview (File Upload & Validation)...');
    const form = new FormData();
    form.append('file', Buffer.from(buf), {
      filename: 'bulk_import_e2e.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    form.append('mode', 'MIXED');

    const previewRes = await client.post('/attendance/bulk-import/preview', form, {
      headers: form.getHeaders()
    });

    const previewData = previewRes.data?.data;
    console.log('✅ Preview Response received:');
    console.log(`   - Total rows: ${previewData.totalRows}`);
    console.log(`   - Valid rows: ${previewData.validRows}`);
    console.log(`   - Invalid rows: ${previewData.invalidRows}`);
    console.log(`   - New records: ${previewData.newRecordsCount}`);
    console.log(`   - Corrections: ${previewData.correctionRecordsCount}`);

    if (previewData.validRows !== 3 || previewData.invalidRows !== 1) {
      throw new Error(`Unexpected preview counts: valid=${previewData.validRows}, invalid=${previewData.invalidRows}`);
    }

    // Verify row 1 diff
    const row1 = previewData.rows.find((r: any) => r.rowNumber === 2);
    if (row1?.action === 'CORRECT' && row1?.existingData?.status === 'HALF_DAY' && row1?.proposedData?.status === 'PRESENT') {
      console.log('✅ Row 1 correctly detected as CORRECT with diff: HALF_DAY -> PRESENT');
    } else {
      throw new Error('Row 1 diff not detected correctly');
    }

    // Step 4: Export Error Report
    console.log('\nStep 4: Testing POST /attendance/bulk-import/export-report...');
    const errReportRes = await client.post(
      '/attendance/bulk-import/export-report',
      { invalidRows: previewData.rows.filter((r: any) => !r.isValid) },
      { responseType: 'arraybuffer' }
    );
    if (errReportRes.status === 200 && errReportRes.data.length > 500) {
      console.log(`✅ Diagnostic error workbook generated successfully (${errReportRes.data.length} bytes)`);
    }

    // Step 5: Confirm Bulk Import
    console.log('\nStep 5: Testing POST /attendance/bulk-import/confirm (Transactional DB Commit)...');
    const confirmRes = await client.post('/attendance/bulk-import/confirm', {
      rows: previewData.rows,
      mode: 'MIXED'
    });

    const commitData = confirmRes.data?.data;
    console.log('✅ Commit Response:');
    console.log(`   - Processed: ${commitData.totalProcessed}`);
    console.log(`   - Created: ${commitData.createdCount}`);
    console.log(`   - Updated: ${commitData.updatedCount}`);
    console.log(`   - Failed: ${commitData.failedCount}`);
    console.log(`   - Google Sheets Sync Status: ${commitData.googleSheetsSyncStatus}`);

    if (commitData.createdCount !== 2 || commitData.updatedCount !== 1) {
      throw new Error(`Unexpected commit counts: created=${commitData.createdCount}, updated=${commitData.updatedCount}`);
    }

    // Step 6: Verify in PostgreSQL database
    console.log('\nStep 6: Verifying records in PostgreSQL...');
    const updatedRec = await prisma.attendanceRecord.findUnique({
      where: { id: existingRec.id },
      include: { logs: true, breaks: true }
    });
    if (updatedRec?.status === 'PRESENT' && updatedRec?.logs.length === 1 && updatedRec?.breaks.length === 1) {
      console.log(`✅ Record ${existingRec.id} status successfully updated to PRESENT, with logs and breaks`);
    } else {
      throw new Error('Updated record verification failed in PostgreSQL');
    }

    // Step 7: Verify Audit Log
    console.log('\nStep 7: Verifying Audit Log in PostgreSQL...');
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: existingRec.id },
      orderBy: { timestamp: 'desc' }
    });
    if (audit && audit.action === 'ATTENDANCE_BULK_CORRECT') {
      console.log(`✅ Audit Log verified: action=${audit.action}, entityId=${audit.entityId}`);
    } else {
      throw new Error('Audit log entry not found');
    }

    // Step 8: Verify Google Sheets Outbox
    console.log('\nStep 8: Verifying Google Sheets Outbox Queue in PostgreSQL...');
    const outbox = await prisma.googleSheetsSyncOutbox.findFirst({
      where: { entityId: existingRec.id },
      orderBy: { createdAt: 'desc' }
    });
    if (outbox && outbox.entityType === 'ATTENDANCE') {
      console.log(`✅ Outbox entry verified: entityType=${outbox.entityType}, action=${outbox.action}, status=${outbox.status}`);
    } else {
      throw new Error('Outbox entry not found');
    }

    console.log('\n====================================================');
    console.log('   ALL E2E HTTP VERIFICATION CHECKS PASSED (100%)    ');
    console.log('====================================================\n');
    }
  } finally {
    server.close();
  }
}

runE2EVerification().catch(err => {
  const data = err?.response?.data;
  const errMsg = Buffer.isBuffer(data) ? data.toString('utf-8') : (data || err?.message || err);
  console.error('❌ E2E Verification failed:', err?.response?.status, errMsg);
  process.exit(1);
});
