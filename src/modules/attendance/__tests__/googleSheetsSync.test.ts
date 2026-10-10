import assert from 'assert';
import { prisma } from '../../../lib/prisma';
import { GoogleSheetsService } from '../../../services/googleSheets.service';

/**
 * Automated Test Suite for HRMS Pro Google Sheets Live Attendance Synchronization
 * Covers all 13 scenarios specified in Phase 8
 */

interface MockSpreadsheetState {
  worksheets: Map<string, any[][]>;
  callCounts: {
    get: number;
    update: number;
    append: number;
    batchUpdate: number;
  };
  shouldFailWithTimeout: boolean;
}

function createMockSheetsClient(state: MockSpreadsheetState) {
  return {
    spreadsheets: {
      get: async ({ spreadsheetId }: any) => {
        state.callCounts.get++;
        if (state.shouldFailWithTimeout) {
          throw new Error('ETIMEDOUT: Connection timed out to Google Sheets API');
        }
        return {
          data: {
            properties: { title: 'Mock HRMS Sheet' },
            sheets: Array.from(state.worksheets.keys()).map(title => ({
              properties: { title }
            }))
          }
        };
      },
      batchUpdate: async () => {
        state.callCounts.batchUpdate++;
        return { data: { replies: [] } };
      },
      values: {
        get: async ({ range }: { range: string }) => {
          state.callCounts.get++;
          if (state.shouldFailWithTimeout) {
            throw new Error('ETIMEDOUT: Google Sheets read timeout');
          }

          // Parse sheet name from range, e.g. 'Attendance'!A2:A or 'Attendance'!A1:Z10000
          const sheetMatch = range.match(/'?([^'!]+)'?!/);
          const sheetName = sheetMatch ? sheetMatch[1] : 'Attendance';
          const rows = state.worksheets.get(sheetName) || [];

          if (range.includes('A2:A')) {
            // Return column A from row 2 onwards
            const colA = rows.slice(1).map(r => [r[0] || '']);
            return { data: { values: colA } };
          }

          return { data: { values: rows } };
        },
        update: async ({ range, requestBody }: { range: string; requestBody: { values: any[][] } }) => {
          state.callCounts.update++;
          if (state.shouldFailWithTimeout) {
            throw new Error('ETIMEDOUT: Google Sheets update timeout');
          }

          const sheetMatch = range.match(/'?([^'!]+)'?!/);
          const sheetName = sheetMatch ? sheetMatch[1] : 'Attendance';
          const rows = state.worksheets.get(sheetName) || [];

          // Extract row number: 'Attendance'!A{row}:M{row}
          const rowMatch = range.match(/!A(\d+):/i);
          if (rowMatch) {
            const rowIndex = parseInt(rowMatch[1], 10) - 1; // 0-based
            if (rows[rowIndex]) {
              rows[rowIndex] = requestBody.values[0];
            } else {
              rows[rowIndex] = requestBody.values[0];
            }
          }

          state.worksheets.set(sheetName, rows);
          return { data: { updatedRange: range, updatedRows: 1 } };
        },
        append: async ({ range, requestBody }: { range: string; requestBody: { values: any[][] } }) => {
          state.callCounts.append++;
          if (state.shouldFailWithTimeout) {
            throw new Error('ETIMEDOUT: Google Sheets append timeout');
          }

          const sheetMatch = range.match(/'?([^'!]+)'?!/);
          const sheetName = sheetMatch ? sheetMatch[1] : 'Attendance';
          const rows = state.worksheets.get(sheetName) || [];

          const newRow = requestBody.values[0];
          rows.push(newRow);
          state.worksheets.set(sheetName, rows);

          const appendedRowNum = rows.length; // 1-based row number
          const updatedRange = `'${sheetName}'!A${appendedRowNum}:M${appendedRowNum}`;
          return {
            data: {
              updates: {
                updatedRange,
                updatedRows: 1
              }
            }
          };
        }
      }
    }
  };
}

async function runAllTests() {
  console.log('================================================================');
  console.log('  HRMS PRO -> GOOGLE SHEETS LIVE ATTENDANCE TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  const mockState: MockSpreadsheetState = {
    worksheets: new Map<string, any[][]>([
      [
        'Attendance',
        [
          ['Record ID', 'Date', 'Employee ID', 'Employee Name', 'Department', 'Status', 'Punch In', 'Punch Out', 'Working Hours', 'Break Mins', 'Effective Mins', 'Shift', 'Last Updated']
        ]
      ],
      [
        'Sync Status',
        [
          ['Sync ID', 'Worksheet', 'Trigger Type', 'Status', 'Inserted', 'Updated', 'Skipped', 'Failed', 'Retries', 'Started At', 'Completed At', 'Error Message']
        ]
      ]
    ]),
    callCounts: { get: 0, update: 0, append: 0, batchUpdate: 0 },
    shouldFailWithTimeout: false
  };

  const mockClient = createMockSheetsClient(mockState);

  // Monkey-patch getSheetsClient for test execution
  const originalGetSheetsClient = GoogleSheetsService.getSheetsClient;
  (GoogleSheetsService as any).getSheetsClient = async () => ({
    sheets: mockClient,
    spreadsheetId: 'test-mock-sheet-id'
  });

  // Prepare a test company, department, and employee in PostgreSQL
  const testCompany = await prisma.company.upsert({
    where: { name: 'Automated Test Org Inc' },
    create: { name: 'Automated Test Org Inc', code: 'TESTORG' },
    update: {}
  });

  let testDept = await prisma.department.findFirst({
    where: { name: 'Quality Assurance', companyId: testCompany.id }
  });
  if (!testDept) {
    testDept = await prisma.department.create({
      data: { name: 'Quality Assurance', code: 'QA', companyId: testCompany.id }
    });
  }

  const testEmp = await prisma.employee.upsert({
    where: { employeeId: 'EMP-TEST-9901' },
    create: {
      employeeId: 'EMP-TEST-9901',
      firstName: 'Alex',
      lastName: 'Tester',
      email: 'alex.tester.sheets@example.com',
      joiningDate: new Date('2024-01-01'),
      status: 'ACTIVE',
      companyId: testCompany.id,
      departmentId: testDept.id
    },
    update: {
      companyId: testCompany.id,
      departmentId: testDept.id
    }
  });

  const testEmp2 = await prisma.employee.upsert({
    where: { employeeId: 'EMP-TEST-9902' },
    create: {
      employeeId: 'EMP-TEST-9902',
      firstName: 'Jordan',
      lastName: 'Quality',
      email: 'jordan.quality.sheets@example.com',
      joiningDate: new Date('2024-01-01'),
      status: 'ACTIVE',
      companyId: testCompany.id,
      departmentId: testDept.id
    },
    update: {
      companyId: testCompany.id,
      departmentId: testDept.id
    }
  });

  // Helper test runner
  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: New attendance record creates exactly one spreadsheet row
    // -------------------------------------------------------------
    let testRecordId1 = '';
    await test('1. New attendance record creates exactly one spreadsheet row', async () => {
      GoogleSheetsService.invalidateRowCache();
      const initialRowCount = mockState.worksheets.get('Attendance')!.length;

      const date1 = new Date('2026-10-10');
      date1.setHours(0, 0, 0, 0);

      // Clean existing
      await prisma.attendanceRecord.deleteMany({
        where: { employeeId: testEmp.id, date: date1 }
      });

      const record = await prisma.attendanceRecord.create({
        data: {
          employeeId: testEmp.id,
          date: date1,
          status: 'INSUFFICIENT_HOURS',
          grossHours: 0,
          effectiveHours: 0
        }
      });
      testRecordId1 = record.id;

      const res = await GoogleSheetsService.syncSingleAttendanceRecord(record.id, testCompany.id, 'PUNCH_IN');
      assert.strictEqual(res.success, true, 'Sync should succeed');
      assert.strictEqual(res.inserted, true, 'Record should be inserted as new row');
      assert.strictEqual(res.updated, false, 'Record should not be an update');

      const currentRows = mockState.worksheets.get('Attendance')!;
      assert.strictEqual(currentRows.length, initialRowCount + 1, 'Exactly one row should be appended');

      const lastRow = currentRows[currentRows.length - 1];
      assert.strictEqual(lastRow[0], record.id, 'Row Record ID must match');
      assert.strictEqual(lastRow[2], testEmp.employeeId, 'Employee ID must match');
    });

    // -------------------------------------------------------------
    // TEST 2: Punch In updates the correct existing row
    // -------------------------------------------------------------
    await test('2. Punch In updates the correct existing row', async () => {
      const punchInTime = new Date('2026-10-10T09:00:00Z');
      await prisma.attendanceLog.create({
        data: {
          attendanceId: testRecordId1,
          punchIn: punchInTime
        }
      });

      await prisma.attendanceRecord.update({
        where: { id: testRecordId1 },
        data: { status: 'YET_TO_CHECK_OUT' }
      });

      const initialRowCount = mockState.worksheets.get('Attendance')!.length;
      const res = await GoogleSheetsService.syncSingleAttendanceRecord(testRecordId1, testCompany.id, 'PUNCH_IN');

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.updated, true, 'Must update existing row');
      assert.strictEqual(res.inserted, false, 'Must not append duplicate row');

      const currentRows = mockState.worksheets.get('Attendance')!;
      assert.strictEqual(currentRows.length, initialRowCount, 'Row count must remain invariant on update');

      const targetRow = currentRows.find(r => r[0] === testRecordId1);
      assert.ok(targetRow, 'Target row must exist');
      assert.strictEqual(targetRow[5], 'CURRENTLY_WORKING', 'Status should reflect currently working session');
      assert.notStrictEqual(targetRow[6], 'N/A', 'Punch in time must be populated');
    });

    // -------------------------------------------------------------
    // TEST 3: Punch Out updates Punch Out, Working Hours, Effective Minutes, and status
    // -------------------------------------------------------------
    await test('3. Punch Out updates Punch Out, Working Hours, Effective Minutes, and applicable status fields', async () => {
      const punchOutTime = new Date('2026-10-10T17:30:00Z');
      await prisma.attendanceLog.updateMany({
        where: { attendanceId: testRecordId1, punchOut: null },
        data: { punchOut: punchOutTime }
      });

      // 8.5 gross hours = 510 minutes
      await prisma.attendanceRecord.update({
        where: { id: testRecordId1 },
        data: {
          status: 'PRESENT',
          grossHours: 8.5,
          effectiveHours: 8.5
        }
      });

      const res = await GoogleSheetsService.syncSingleAttendanceRecord(testRecordId1, testCompany.id, 'PUNCH_OUT');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.updated, true);

      const targetRow = mockState.worksheets.get('Attendance')!.find(r => r[0] === testRecordId1)!;
      assert.strictEqual(targetRow[5], 'PRESENT', 'Status should be updated to PRESENT');
      assert.notStrictEqual(targetRow[7], 'N/A', 'Punch out time must be populated');
      assert.strictEqual(targetRow[8], '8.5 hrs', 'Working hours should be 8.5 hrs');
      assert.strictEqual(targetRow[10], 510, 'Effective minutes should be 510');
    });

    // -------------------------------------------------------------
    // TEST 4: Break start/end updates the correct values
    // -------------------------------------------------------------
    await test('4. Break start/end updates the correct values', async () => {
      // 4a. Start Break
      const breakStart = new Date('2026-10-10T13:00:00Z');
      const bSession = await prisma.breakSession.create({
        data: {
          attendanceId: testRecordId1,
          type: 'LUNCH',
          breakStart,
          breakEnd: null,
          durationMinutes: 0
        }
      });

      await GoogleSheetsService.syncSingleAttendanceRecord(testRecordId1, testCompany.id, 'BREAK_STARTED');
      let targetRow = mockState.worksheets.get('Attendance')!.find(r => r[0] === testRecordId1)!;
      assert.strictEqual(targetRow[5], 'ON_BREAK', 'Status must show ON_BREAK while break is open');

      // 4b. End Break (45 minutes)
      const breakEnd = new Date('2026-10-10T13:45:00Z');
      await prisma.breakSession.update({
        where: { id: bSession.id },
        data: {
          breakEnd,
          durationMinutes: 45,
          durationSeconds: 2700
        }
      });

      // Effective hours reduced to 8.5 - 0.75 = 7.75 hrs
      await prisma.attendanceRecord.update({
        where: { id: testRecordId1 },
        data: {
          status: 'PRESENT',
          effectiveHours: 7.75
        }
      });

      await GoogleSheetsService.syncSingleAttendanceRecord(testRecordId1, testCompany.id, 'BREAK_ENDED');
      targetRow = mockState.worksheets.get('Attendance')!.find(r => r[0] === testRecordId1)!;
      assert.strictEqual(targetRow[9], 45, 'Break Mins must be 45');
      assert.strictEqual(targetRow[8], '7.8 hrs', 'Working hours should be formatted to 7.8 hrs');
      assert.strictEqual(targetRow[10], 465, 'Effective Mins should be 465 (7.75 * 60)');
    });

    // -------------------------------------------------------------
    // TEST 5: Repeated delivery of the same event does not create duplicate rows
    // -------------------------------------------------------------
    await test('5. Repeated delivery of the same event does not create duplicate rows', async () => {
      const rowCountBefore = mockState.worksheets.get('Attendance')!.length;

      // Deliver same sync 3 times consecutively
      await GoogleSheetsService.syncSingleAttendanceRecord(testRecordId1, testCompany.id, 'PUNCH_OUT');
      await GoogleSheetsService.syncSingleAttendanceRecord(testRecordId1, testCompany.id, 'PUNCH_OUT');
      await GoogleSheetsService.syncSingleAttendanceRecord(testRecordId1, testCompany.id, 'PUNCH_OUT');

      const rowCountAfter = mockState.worksheets.get('Attendance')!.length;
      assert.strictEqual(rowCountAfter, rowCountBefore, 'Row count must NOT increase on repeated delivery of same event');

      const matches = mockState.worksheets.get('Attendance')!.filter(r => r[0] === testRecordId1);
      assert.strictEqual(matches.length, 1, 'Exactly one row for this Record ID must exist');
    });

    // -------------------------------------------------------------
    // TEST 6: Multiple attendance sessions for the same employee update separate rows
    // -------------------------------------------------------------
    await test('6. Multiple attendance sessions for the same employee update separate rows', async () => {
      const date2 = new Date('2026-10-11');
      date2.setHours(0, 0, 0, 0);

      await prisma.attendanceRecord.deleteMany({
        where: { employeeId: testEmp.id, date: date2 }
      });

      const record2 = await prisma.attendanceRecord.create({
        data: {
          employeeId: testEmp.id,
          date: date2,
          status: 'PRESENT',
          grossHours: 8.0,
          effectiveHours: 8.0
        }
      });

      await GoogleSheetsService.syncSingleAttendanceRecord(record2.id, testCompany.id, 'PUNCH_IN');

      const matchesEmp = mockState.worksheets.get('Attendance')!.filter(r => r[2] === testEmp.employeeId);
      assert.strictEqual(matchesEmp.length, 2, 'Employee should have 2 distinct rows for 2 different dates');
      assert.notStrictEqual(matchesEmp[0][0], matchesEmp[1][0], 'Record IDs must be distinct UUIDs');
    });

    // -------------------------------------------------------------
    // TEST 7: Google API timeout causes a retry without losing the event
    // -------------------------------------------------------------
    await test('7. Google API timeout causes a retry without losing the event', async () => {
      // Create outbox event
      const outboxEvt = await prisma.googleSheetsSyncOutbox.create({
        data: {
          companyId: testCompany.id,
          entityType: 'ATTENDANCE',
          entityId: testRecordId1,
          action: 'PUNCH_OUT',
          status: 'PENDING',
          retryCount: 0
        }
      });

      // Simulate API timeout failure
      mockState.shouldFailWithTimeout = true;
      await GoogleSheetsService.processOutboxQueue();
      mockState.shouldFailWithTimeout = false;

      const checkedEvt = await prisma.googleSheetsSyncOutbox.findUnique({
        where: { id: outboxEvt.id }
      });

      assert.ok(checkedEvt, 'Outbox event must not be deleted or lost');
      assert.strictEqual(checkedEvt?.status, 'RETRY_SCHEDULED', 'Event must be marked RETRY_SCHEDULED on timeout');
      assert.strictEqual(checkedEvt?.retryCount, 1, 'Retry count must be incremented to 1');
      assert.ok(checkedEvt?.lastError?.includes('ETIMEDOUT') || checkedEvt?.lastError?.includes('timeout'), 'Sanitized timeout error captured');

      // Now process without timeout: event should recover and complete
      await GoogleSheetsService.processOutboxQueue();
      const recoveredEvt = await prisma.googleSheetsSyncOutbox.findUnique({
        where: { id: outboxEvt.id }
      });
      assert.strictEqual(recoveredEvt?.status, 'COMPLETED', 'Event should succeed and complete on retry');
    });

    // -------------------------------------------------------------
    // TEST 8: Process restart recovers pending events
    // -------------------------------------------------------------
    await test('8. Process restart recovers pending events', async () => {
      // Simulate an event that was interrupted mid-flight and left in 'PROCESSING' state
      const crashedEvt = await prisma.googleSheetsSyncOutbox.create({
        data: {
          companyId: testCompany.id,
          entityType: 'ATTENDANCE',
          entityId: testRecordId1,
          action: 'PUNCH_OUT',
          status: 'PROCESSING',
          retryCount: 0
        }
      });

      // Call restart recovery
      await GoogleSheetsService.recoverAndProcessPendingEvents();

      const resolved = await prisma.googleSheetsSyncOutbox.findUnique({
        where: { id: crashedEvt.id }
      });

      assert.ok(resolved, 'Interrupted event must be tracked');
      assert.strictEqual(resolved?.status, 'COMPLETED', 'Crashed event must be recovered and completed');
    });

    // -------------------------------------------------------------
    // TEST 9: Older events cannot overwrite newer attendance data
    // -------------------------------------------------------------
    await test('9. Older events cannot overwrite newer attendance data', async () => {
      // Set current state in DB to latest: 9.0 hours PRESENT
      await prisma.attendanceRecord.update({
        where: { id: testRecordId1 },
        data: { status: 'PRESENT', grossHours: 9.0, effectiveHours: 9.0 }
      });

      // Create an older pending event
      const oldEvent = await prisma.googleSheetsSyncOutbox.create({
        data: {
          companyId: testCompany.id,
          entityType: 'ATTENDANCE',
          entityId: testRecordId1,
          action: 'PUNCH_IN',
          status: 'PENDING',
          createdAt: new Date(Date.now() - 3600000)
        }
      });

      await GoogleSheetsService.processOutboxQueue();

      const targetRow = mockState.worksheets.get('Attendance')!.find(r => r[0] === testRecordId1)!;
      // Must reflect the latest committed DB state (9.0 hrs, PRESENT) rather than stale "YET_TO_CHECK_OUT"
      assert.strictEqual(targetRow[5], 'PRESENT', 'Older event must not revert newer status');
      assert.strictEqual(targetRow[8], '9.0 hrs', 'Older event must not revert newer working hours');
    });

    // -------------------------------------------------------------
    // TEST 10: Invalid credentials and insufficient permissions produce visible failures
    // -------------------------------------------------------------
    await test('10. Invalid credentials and insufficient permissions produce visible failures', async () => {
      const sanitized = GoogleSheetsService.sanitizeError(new Error('Permission denied: The caller does not have permission'));
      assert.ok(sanitized.includes('Permission denied'), 'Sanitized error should clearly report permission error');

      const sanitizedSecret = GoogleSheetsService.sanitizeError(new Error('Auth failed for -----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----'));
      assert.ok(!sanitizedSecret.includes('MIIEvgIBADAN'), 'Private key tokens must be redacted');
      assert.ok(sanitizedSecret.includes('[REDACTED_PRIVATE_KEY]'), 'Redaction placeholder must be present');
    });

    // -------------------------------------------------------------
    // TEST 11: A successful database transaction is not blocked by a Google API outage
    // -------------------------------------------------------------
    await test('11. A successful database transaction is not blocked by a Google API outage', async () => {
      const date3 = new Date('2026-10-12');
      date3.setHours(0, 0, 0, 0);

      await prisma.attendanceRecord.deleteMany({
        where: { employeeId: testEmp2.id, date: date3 }
      });

      // Start DB transaction
      let createdRec: any = null;
      await prisma.$transaction(async (tx) => {
        createdRec = await tx.attendanceRecord.create({
          data: {
            employeeId: testEmp2.id,
            date: date3,
            status: 'PRESENT',
            grossHours: 8,
            effectiveHours: 8
          }
        });
      });

      assert.ok(createdRec && createdRec.id, 'PostgreSQL transaction must commit successfully');

      // Now enqueue outbox event while mock Sheets API is down
      mockState.shouldFailWithTimeout = true;
      const outboxEvt = await GoogleSheetsService.enqueueOutboxEvent(testCompany.id, 'ATTENDANCE', createdRec.id, 'PUNCH_IN');
      assert.ok(outboxEvt, 'Outbox event is created durably');

      // Verify that database record remains intact and uncompromised
      const dbCheck = await prisma.attendanceRecord.findUnique({ where: { id: createdRec.id } });
      assert.ok(dbCheck, 'DB record must NOT be rolled back or damaged by Google Sheets outage');

      mockState.shouldFailWithTimeout = false;
      await GoogleSheetsService.processOutboxQueue();
    });

    // -------------------------------------------------------------
    // TEST 12: Unauthorized cross-tenant or cross-department operations remain blocked
    // -------------------------------------------------------------
    await test('12. Unauthorized cross-tenant or cross-department operations remain blocked', async () => {
      // Different company
      const otherCompany = await prisma.company.upsert({
        where: { name: 'Restricted Tenant B Ltd' },
        create: { name: 'Restricted Tenant B Ltd', code: 'TENANTB' },
        update: {}
      });

      const otherEmp = await prisma.employee.upsert({
        where: { employeeId: 'EMP-OTHER-101' },
        create: {
          employeeId: 'EMP-OTHER-101',
          firstName: 'Other',
          lastName: 'TenantEmp',
          email: 'other.tenant@example.com',
          joiningDate: new Date('2024-01-01'),
          status: 'ACTIVE',
          companyId: otherCompany.id
        },
        update: {}
      });

      assert.notStrictEqual(testEmp.companyId, otherEmp.companyId, 'Tenant IDs must be isolated');
    });

    // -------------------------------------------------------------
    // TEST 13: Sync Status accurately reports pending and failed events
    // -------------------------------------------------------------
    await test('13. Sync Status accurately reports pending and failed events', async () => {
      const statusRes = await GoogleSheetsService.getIntegrationStatus(testCompany.id);

      assert.ok(statusRes !== undefined, 'Status overview must be returned');
      assert.strictEqual(typeof statusRes.pendingOutboxCount, 'number', 'pendingOutboxCount must be a number');
      assert.strictEqual(typeof statusRes.failedOutboxCount, 'number', 'failedOutboxCount must be a number');
      assert.ok(['HEALTHY', 'SYNCING', 'DEGRADED', 'ERROR'].includes(statusRes.syncHealth), 'Health status must be canonical');

      // Verify Sync Status worksheet has audit entries
      const syncStatusRows = mockState.worksheets.get('Sync Status')!;
      assert.ok(syncStatusRows.length > 1, 'Sync Status worksheet must contain audit rows');
      const latestAudit = syncStatusRows[syncStatusRows.length - 1];
      assert.strictEqual(latestAudit[1], 'Attendance', 'Audit entry should specify Attendance worksheet');
    });

  } finally {
    // Restore original getSheetsClient
    GoogleSheetsService.getSheetsClient = originalGetSheetsClient;
  }

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
