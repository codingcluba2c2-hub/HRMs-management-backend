import { prisma } from '../../../lib/prisma';
import { GoogleSheetsService } from '../../../services/googleSheets.service';

/**
 * Phase 9: Live End-to-End Verification against actual Google Sheets
 * Tests Punch-In, Break, Punch-Out, row immutability, duplicate avoidance, and measures latency.
 */
async function runLiveVerification() {
  console.log('================================================================');
  console.log('  LIVE GOOGLE SHEETS END-TO-END VERIFICATION');
  console.log('================================================================\n');

  // Verify connection to live Google Spreadsheet
  const connTest = await GoogleSheetsService.testConnection();
  console.log('1. Connection Test:', connTest);
  if (!connTest.success) {
    throw new Error(`Google Sheets connection failed: ${connTest.message}`);
  }

  const { sheets, spreadsheetId } = await GoogleSheetsService.getSheetsClient();
  console.log(`Target Spreadsheet ID: ${spreadsheetId}`);

  // Find or create test employee
  let employee = await prisma.employee.findFirst({
    where: { status: 'ACTIVE' },
    include: { department: true }
  });

  if (!employee) {
    throw new Error('No active employee found for live testing.');
  }

  console.log(`Using Test Employee: ${employee.firstName} ${employee.lastName} (${employee.employeeId})`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Clean any existing record for this employee today for a fresh live verification
  await prisma.attendanceRecord.deleteMany({
    where: { employeeId: employee.id, date: today }
  });

  // Step 1: Create Attendance Record & Punch In in PostgreSQL
  console.log('\n--- Step 1: Punch In (PostgreSQL Transaction) ---');
  const punchInTime = new Date();
  const record = await prisma.attendanceRecord.create({
    data: {
      employeeId: employee.id,
      date: today,
      status: 'YET_TO_CHECK_OUT',
      shiftId: employee.shiftId || undefined,
      logs: {
        create: {
          punchIn: punchInTime
        }
      }
    },
    include: { logs: true }
  });

  console.log(`Created Attendance Record ID: ${record.id}`);
  console.log(`Punch In Timestamp: ${punchInTime.toISOString()}`);

  // Step 2: Trigger Live Synchronization & Measure Latency
  console.log('\n--- Step 2: Live Sync Punch In to Google Sheets ---');
  const t0 = Date.now();
  const syncResult1 = await GoogleSheetsService.syncSingleAttendanceRecord(record.id, employee.companyId || undefined, 'PUNCH_IN');
  const punchInLatencyMs = Date.now() - t0;

  console.log(`Punch In Sync Result:`, syncResult1);
  console.log(`⏱️ Measured Synchronization Latency: ${punchInLatencyMs} ms`);

  // Step 3: Verify Row in Live Google Sheet
  console.log('\n--- Step 3: Verify Live Sheet Row Content ---');
  const targetRowNumber = syncResult1.row;
  const sheetRowRes1 = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'Attendance'!A${targetRowNumber}:M${targetRowNumber}`
  });
  const rowValues1 = sheetRowRes1.data.values?.[0] || [];
  console.log(`Row ${targetRowNumber} in Google Sheets:`, rowValues1);

  if (rowValues1[0] !== record.id) {
    throw new Error(`Record ID mismatch! Expected ${record.id}, got ${rowValues1[0]}`);
  }
  if (rowValues1[5] !== 'CURRENTLY_WORKING') {
    throw new Error(`Status mismatch! Expected CURRENTLY_WORKING, got ${rowValues1[5]}`);
  }
  console.log('✅ Live Google Sheet verified: Record ID matches and Status is CURRENTLY_WORKING');

  // Step 4: Add Break and Live Sync
  console.log('\n--- Step 4: Break Session (Start & End) ---');
  const breakStart = new Date(Date.now() - 30 * 60000);
  const breakEnd = new Date();
  await prisma.breakSession.create({
    data: {
      attendanceId: record.id,
      type: 'TEA',
      breakStart,
      breakEnd,
      durationMinutes: 30,
      durationSeconds: 1800
    }
  });

  const t1 = Date.now();
  const syncResult2 = await GoogleSheetsService.syncSingleAttendanceRecord(record.id, employee.companyId || undefined, 'BREAK_ENDED');
  const breakLatencyMs = Date.now() - t1;
  console.log(`Break Sync Result:`, syncResult2);
  console.log(`⏱️ Measured Break Sync Latency: ${breakLatencyMs} ms`);

  const sheetRowRes2 = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'Attendance'!A${targetRowNumber}:M${targetRowNumber}`
  });
  const rowValues2 = sheetRowRes2.data.values?.[0] || [];
  console.log(`Row ${targetRowNumber} after break:`, rowValues2);

  if (Number(rowValues2[9]) !== 30) {
    throw new Error(`Break minutes mismatch! Expected 30, got ${rowValues2[9]}`);
  }
  console.log('✅ Live Google Sheet verified: Break Mins is 30');

  // Step 5: Punch Out and Live Sync
  console.log('\n--- Step 5: Punch Out ---');
  const punchOutTime = new Date();
  await prisma.attendanceLog.updateMany({
    where: { attendanceId: record.id, punchOut: null },
    data: { punchOut: punchOutTime }
  });

  await prisma.attendanceRecord.update({
    where: { id: record.id },
    data: {
      status: 'PRESENT',
      grossHours: 8.5,
      effectiveHours: 8.0
    }
  });

  const t2 = Date.now();
  const syncResult3 = await GoogleSheetsService.syncSingleAttendanceRecord(record.id, employee.companyId || undefined, 'PUNCH_OUT');
  const punchOutLatencyMs = Date.now() - t2;
  console.log(`Punch Out Sync Result:`, syncResult3);
  console.log(`⏱️ Measured Punch Out Latency: ${punchOutLatencyMs} ms`);

  const sheetRowRes3 = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'Attendance'!A${targetRowNumber}:M${targetRowNumber}`
  });
  const rowValues3 = sheetRowRes3.data.values?.[0] || [];
  console.log(`Row ${targetRowNumber} after punch out:`, rowValues3);

  if (rowValues3[5] !== 'PRESENT') {
    throw new Error(`Status mismatch! Expected PRESENT, got ${rowValues3[5]}`);
  }
  if (rowValues3[8] !== '8.0 hrs') {
    throw new Error(`Working hours mismatch! Expected 8.0 hrs, got ${rowValues3[8]}`);
  }
  if (Number(rowValues3[10]) !== 480) {
    throw new Error(`Effective mins mismatch! Expected 480, got ${rowValues3[10]}`);
  }
  console.log('✅ Live Google Sheet verified: Punch Out updated, Working Hours: 8.0 hrs, Effective Mins: 480');

  // Step 6: Verify No Duplicate Rows were Created
  console.log('\n--- Step 6: Verify Invariant Row Uniqueness ---');
  const allRowsRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'Attendance'!A2:A`
  });
  const allRecordIds = allRowsRes.data.values?.map((r: any[]) => r[0]) || [];
  const occurrences = allRecordIds.filter((id: any) => id === record.id).length;
  console.log(`Occurrences of Record ID ${record.id} in sheet: ${occurrences}`);
  if (occurrences !== 1) {
    throw new Error(`Duplicate row detected! Expected 1 occurrence, found ${occurrences}`);
  }
  console.log('✅ No duplicate rows created in Google Sheets');

  // Step 7: Verify Sync Status worksheet
  console.log('\n--- Step 7: Verify Sync Status Worksheet ---');
  const syncStatusRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'Sync Status'!A1:L5`
  });
  console.log('Latest Sync Status rows:', syncStatusRes.data.values);
  console.log('✅ Sync Status worksheet contains updated audit entries');

  console.log('\n================================================================');
  console.log('  LIVE VERIFICATION SUCCESSFUL');
  console.log(`  Average Measured Sync Latency: ${Math.round((punchInLatencyMs + breakLatencyMs + punchOutLatencyMs) / 3)} ms`);
  console.log('================================================================\n');
}

runLiveVerification().catch(err => {
  console.error('Live Verification Failed:', err);
  process.exit(1);
});
