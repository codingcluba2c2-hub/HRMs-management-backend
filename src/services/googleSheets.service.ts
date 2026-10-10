import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';

export interface GoogleSheetsConfigParams {
  companyId?: string;
  spreadsheetId?: string;
}

export interface SyncResult {
  success: boolean;
  worksheet: string;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  error?: string;
}

export class GoogleSheetsService {
  // In-memory client cache to reuse authenticated Google API instances
  private static sheetsClientCache = new Map<string, { sheets: any; spreadsheetId: string }>();

  // In-memory set of already initialized spreadsheets to avoid redundant API schema queries
  private static initializedWorksheetSpreadsheets = new Set<string>();

  // In-memory row mapping caches for fast single-record row resolution
  private static attendanceRowCache = new Map<string, Map<string, number>>();
  private static employeeRowCache = new Map<string, Map<string, number>>();
  private static leaveRowCache = new Map<string, Map<string, number>>();
  private static rosterRowCache = new Map<string, Map<string, number>>();

  // Concurrency controls
  private static isProcessingQueue = false;
  private static activeEntityLocks = new Set<string>();

  /**
   * Helper to sanitize and redact sensitive key details from error logs
   */
  public static sanitizeError(error: any): string {
    if (!error) return 'Unknown error';
    let msg = error.message || String(error);
    // Redact private key or token patterns
    msg = msg.replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
    msg = msg.replace(/eyJ[a-zA-Z0-9_\-\.]+/gi, '[REDACTED_JWT]');
    return msg.substring(0, 500);
  }

  /**
   * Invalidate in-memory row cache safely
   */
  public static invalidateRowCache(worksheet?: string, spreadsheetId?: string) {
    if (spreadsheetId) {
      if (!worksheet || worksheet === 'Attendance') this.attendanceRowCache.delete(spreadsheetId);
      if (!worksheet || worksheet === 'Employees') this.employeeRowCache.delete(spreadsheetId);
      if (!worksheet || worksheet === 'Leave Requests') this.leaveRowCache.delete(spreadsheetId);
      if (!worksheet || worksheet === 'Shift Roster') this.rosterRowCache.delete(spreadsheetId);
    } else {
      if (!worksheet || worksheet === 'Attendance') this.attendanceRowCache.clear();
      if (!worksheet || worksheet === 'Employees') this.employeeRowCache.clear();
      if (!worksheet || worksheet === 'Leave Requests') this.leaveRowCache.clear();
      if (!worksheet || worksheet === 'Shift Roster') this.rosterRowCache.clear();
    }
  }

  /**
   * Authenticate and get Google Sheets v4 API Client (reused and cached)
   */
  public static async getSheetsClient(companyId?: string) {
    try {
      // 1. Resolve spreadsheetId from DB or environment
      let spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || '';
      
      if (companyId) {
        const config = await prisma.googleSheetsConfig.findUnique({
          where: { companyId }
        });
        if (config?.spreadsheetId) {
          spreadsheetId = config.spreadsheetId;
        }
      }

      if (!spreadsheetId || spreadsheetId.includes('example_sheet_id')) {
        const anyConfig = await prisma.googleSheetsConfig.findFirst({
          where: { isEnabled: true }
        });
        if (anyConfig?.spreadsheetId) {
          spreadsheetId = anyConfig.spreadsheetId;
        }
      }

      if (!spreadsheetId || spreadsheetId.includes('example_sheet_id')) {
        throw new Error("Google Spreadsheet ID is not configured. Please set GOOGLE_SPREADSHEET_ID in environment or admin settings.");
      }

      const cacheKey = `${companyId || 'GLOBAL'}:${spreadsheetId}`;
      if (this.sheetsClientCache.has(cacheKey)) {
        return this.sheetsClientCache.get(cacheKey)!;
      }

      // 2. Resolve Google Service Account Credentials
      let auth: any;
      const keyFilePath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH 
        ? path.resolve(process.cwd(), process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH)
        : path.resolve(process.cwd(), 'hrms-management-500604-924ea58afcca.json');

      if (fs.existsSync(keyFilePath)) {
        const keyData = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
        auth = new google.auth.JWT({
          email: keyData.client_email,
          key: keyData.private_key,
          scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/drive.file'
          ]
        });
      } else if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
        auth = new google.auth.JWT({
          email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          key: privateKey,
          scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/drive.file'
          ]
        });
      } else {
        throw new Error("Google Service Account credentials file or env variables (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY) not found.");
      }

      const sheets = google.sheets({ version: 'v4', auth });
      const clientEntry = { sheets, spreadsheetId };
      this.sheetsClientCache.set(cacheKey, clientEntry);
      return clientEntry;
    } catch (error: any) {
      const cleanMsg = this.sanitizeError(error);
      throw new Error(`Google Sheets Auth Failed: ${cleanMsg}`);
    }
  }

  /**
   * Test connection and verify spreadsheet permissions
   */
  public static async testConnection(companyId?: string) {
    try {
      const { sheets, spreadsheetId } = await this.getSheetsClient(companyId);
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetTitles = meta.data.sheets?.map((s: any) => s.properties?.title || '') || [];

      return {
        success: true,
        spreadsheetId,
        title: meta.data.properties?.title || 'HRMS Live Spreadsheet',
        worksheets: sheetTitles,
        message: 'Successfully connected to Google Spreadsheet with service account.'
      };
    } catch (error: any) {
      return {
        success: false,
        message: this.sanitizeError(error)
      };
    }
  }

  /**
   * Initialize required worksheets and standard headers if missing
   */
  public static async initializeWorksheets(companyId?: string) {
    const { sheets, spreadsheetId } = await this.getSheetsClient(companyId);

    // Skip if already initialized for this process lifetime
    if (this.initializedWorksheetSpreadsheets.has(spreadsheetId)) {
      return { success: true, message: 'Worksheets already verified and initialized.' };
    }
    
    // Get existing sheets
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingTitles = new Set(meta.data.sheets?.map((s: any) => s.properties?.title || '') || []);

    const requiredSheets = [
      {
        name: 'Employees',
        headers: ['Employee ID', 'Full Name', 'Email', 'Phone', 'Department', 'Designation', 'Employment Type', 'Joining Date', 'Status', 'Manager', 'Company', 'Last Updated']
      },
      {
        name: 'Attendance',
        headers: ['Record ID', 'Date', 'Employee ID', 'Employee Name', 'Department', 'Status', 'Punch In', 'Punch Out', 'Working Hours', 'Break Mins', 'Effective Mins', 'Shift', 'Last Updated']
      },
      {
        name: 'Leave Requests',
        headers: ['Request ID', 'Employee ID', 'Employee Name', 'Department', 'Leave Type', 'Start Date', 'End Date', 'Total Days', 'Reason', 'Status', 'Applied At', 'Reviewed By', 'Last Updated']
      },
      {
        name: 'Shift Roster',
        headers: ['Roster Entry ID', 'Employee ID', 'Employee Name', 'Department', 'Shift Name', 'Start Time', 'End Time', 'Date', 'Type', 'Last Updated']
      },
      {
        name: 'Sync Status',
        headers: ['Sync ID', 'Worksheet', 'Trigger Type', 'Status', 'Inserted', 'Updated', 'Skipped', 'Failed', 'Retries', 'Started At', 'Completed At', 'Error Message']
      }
    ];

    // Create missing sheets
    const requests: any[] = [];
    for (const reqSheet of requiredSheets) {
      if (!existingTitles.has(reqSheet.name)) {
        requests.push({
          addSheet: {
            properties: { title: reqSheet.name }
          }
        });
      }
    }

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
      });
    }

    // Write header rows for any sheet where Row 1 is empty
    for (const reqSheet of requiredSheets) {
      try {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${reqSheet.name}'!A1:Z1`
        });
        const rows = res.data.values;
        if (!rows || rows.length === 0 || rows[0].length === 0) {
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'${reqSheet.name}'!A1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [reqSheet.headers]
            }
          });
        }
      } catch (e) {
        console.warn(`Could not verify header for ${reqSheet.name}:`, this.sanitizeError(e));
      }
    }

    this.initializedWorksheetSpreadsheets.add(spreadsheetId);
    return { success: true, message: 'Initialized standard worksheets and header schemas.' };
  }

  /**
   * Fast load of Attendance Column A (Record ID to Row Number)
   */
  private static async loadAttendanceRowMap(sheets: any, spreadsheetId: string): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'Attendance'!A2:A`
      });
      const rows = res.data.values || [];
      const seen = new Set<string>();

      for (let i = 0; i < rows.length; i++) {
        const recordId = rows[i][0];
        if (recordId) {
          const cleanId = String(recordId).trim();
          const rowNum = i + 2; // Row 1 is header
          if (seen.has(cleanId)) {
            console.warn(`[GoogleSheets] Duplicate Record ID detected in Attendance worksheet: ${cleanId} at row ${rowNum}`);
          } else {
            seen.add(cleanId);
            map.set(cleanId, rowNum);
          }
        }
      }
    } catch (err) {
      console.error('[GoogleSheets] Failed to load Attendance row mapping:', this.sanitizeError(err));
    }
    return map;
  }

  /**
   * Targeted live synchronization for a single attendance record
   * Resolves row via immutable Record ID and updates/appends with sub-2s latency.
   */
  public static async syncSingleAttendanceRecord(recordId: string, companyId?: string, actionName = 'ATTENDANCE_RECORD_UPDATED') {
    const startTime = new Date();
    const lockKey = `ATTENDANCE:${recordId}`;

    if (this.activeEntityLocks.has(lockKey)) {
      console.log(`⚡ [GoogleSheets] Lock active for attendance record ${recordId}, will sync on release.`);
      return { success: true, updated: false, inserted: false, skipped: true };
    }

    this.activeEntityLocks.add(lockKey);
    try {
      // 1. Fetch latest committed state from PostgreSQL
      const rec = await prisma.attendanceRecord.findUnique({
        where: { id: recordId },
        include: {
          employee: {
            include: { department: true, company: true }
          },
          shift: true,
          logs: { orderBy: { punchIn: 'asc' } },
          breaks: { orderBy: { breakStart: 'asc' } }
        }
      });

      if (!rec) {
        console.warn(`[GoogleSheets] Attendance record ${recordId} not found in database.`);
        return { success: true, updated: false, inserted: false, skipped: true };
      }

      const { sheets, spreadsheetId } = await this.getSheetsClient(companyId || rec.employee?.companyId || undefined);
      await this.initializeWorksheets(companyId || rec.employee?.companyId || undefined);

      // 2. Compute canonical attendance row values
      const sortedLogs = [...rec.logs].sort((a, b) => new Date(a.punchIn).getTime() - new Date(b.punchIn).getTime());
      const firstLog = sortedLogs[0];
      const lastLog = sortedLogs[sortedLogs.length - 1];

      const firstPunchIn = firstLog?.punchIn;
      const hasOpenSession = Boolean(lastLog && !lastLog.punchOut);
      const lastPunchOut = hasOpenSession ? null : lastLog?.punchOut;

      const hasOpenBreak = rec.breaks.some(b => !b.breakEnd);

      let displayStatus = rec.status;
      if (hasOpenBreak) {
        displayStatus = 'ON_BREAK';
      } else if (hasOpenSession) {
        displayStatus = 'CURRENTLY_WORKING';
      }

      // Calculate total break minutes accurately (including open break elapsed minutes)
      const totalBreakMins = rec.breaks.reduce((acc, b) => {
        if (b.durationMinutes && b.durationMinutes > 0) return acc + b.durationMinutes;
        if (b.durationSeconds && b.durationSeconds > 0) return acc + Math.round(b.durationSeconds / 60);
        if (b.breakStart && b.breakEnd) {
          return acc + Math.max(0, Math.round((new Date(b.breakEnd).getTime() - new Date(b.breakStart).getTime()) / 60000));
        }
        if (b.breakStart && !b.breakEnd) {
          return acc + Math.max(0, Math.round((Date.now() - new Date(b.breakStart).getTime()) / 60000));
        }
        return acc;
      }, 0);

      const effectiveMins = Math.max(0, Math.round((rec.effectiveHours || 0) * 60));
      const workingHoursStr = `${(rec.effectiveHours || 0).toFixed(1)} hrs`;

      const rowValues = [
        rec.id, // Column A: Record ID (Immutable unique key)
        rec.date ? new Date(rec.date).toISOString().split('T')[0] : 'N/A', // Column B: Date
        rec.employee?.employeeId || rec.employeeId, // Column C: Employee ID
        rec.employee ? `${rec.employee.firstName} ${rec.employee.lastName}`.trim() : 'N/A', // Column D: Employee Name
        rec.employee?.department?.name || 'N/A', // Column E: Department
        displayStatus, // Column F: Status
        firstPunchIn ? new Date(firstPunchIn).toLocaleTimeString('en-US', { hour12: true }) : 'N/A', // Column G: Punch In
        lastPunchOut ? new Date(lastPunchOut).toLocaleTimeString('en-US', { hour12: true }) : 'N/A', // Column H: Punch Out
        workingHoursStr, // Column I: Working Hours
        totalBreakMins, // Column J: Break Mins
        effectiveMins, // Column K: Effective Mins
        rec.shift?.name || 'Default Shift', // Column L: Shift
        new Date().toISOString() // Column M: Last Updated
      ];

      // 3. Resolve row in sheet
      let rowMap = this.attendanceRowCache.get(spreadsheetId);
      if (!rowMap) {
        rowMap = await this.loadAttendanceRowMap(sheets, spreadsheetId);
        this.attendanceRowCache.set(spreadsheetId, rowMap);
      }

      let existingRow = rowMap.get(rec.id);
      let isUpdate = false;
      let targetRowNum = 0;

      if (existingRow) {
        // Update existing row
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'Attendance'!A${existingRow}:M${existingRow}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [rowValues] }
        });
        isUpdate = true;
        targetRowNum = existingRow;
      } else {
        // Append new row
        const appendRes = await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'Attendance'!A1`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [rowValues] }
        });

        const updatedRange = appendRes.data.updates?.updatedRange || '';
        const match = updatedRange.match(/!A(\d+):/i);
        if (match) {
          targetRowNum = parseInt(match[1], 10);
        } else {
          targetRowNum = rowMap.size + 2;
        }
        rowMap.set(rec.id, targetRowNum);
      }

      // 4. Record audit entry in Sync Status worksheet
      try {
        const syncStatusRow = [
          `SYNC-${Date.now()}`,
          'Attendance',
          `LIVE: ${actionName}`,
          'SUCCESS',
          isUpdate ? 0 : 1,
          isUpdate ? 1 : 0,
          0,
          0,
          0,
          startTime.toISOString(),
          new Date().toISOString(),
          'None'
        ];
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'Sync Status'!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [syncStatusRow] }
        });
      } catch (auditErr) {
        console.warn("[GoogleSheets] Could not append audit row to 'Sync Status':", this.sanitizeError(auditErr));
      }

      // 5. Update DB config status
      await prisma.googleSheetsConfig.updateMany({
        where: companyId ? { companyId } : {},
        data: {
          lastSyncStatus: 'SUCCESS',
          lastSyncAt: new Date(),
          lastSyncError: null
        }
      });

      console.log(`✅ [GoogleSheets] ${isUpdate ? 'Updated' : 'Inserted'} attendance record ${rec.id} at row ${targetRowNum} (${Date.now() - startTime.getTime()}ms)`);

      return {
        success: true,
        inserted: !isUpdate,
        updated: isUpdate,
        row: targetRowNum
      };
    } finally {
      this.activeEntityLocks.delete(lockKey);
    }
  }

  /**
   * Synchronize Employees Worksheet
   */
  public static async syncEmployees(companyId?: string): Promise<SyncResult> {
    const startTime = new Date();
    try {
      const { sheets, spreadsheetId } = await this.getSheetsClient(companyId);
      await this.initializeWorksheets(companyId);

      const whereClause: any = { isDeleted: false };
      const employees = await prisma.employee.findMany({
        where: whereClause,
        include: {
          department: true,
          designation: true,
          manager: true,
          company: true
        },
        orderBy: { createdAt: 'asc' }
      });

      const existingRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'Employees'!A1:Z10000`
      });
      const existingRows = existingRes.data.values || [];
      const idToRowMap = new Map<string, number>();

      for (let i = 1; i < existingRows.length; i++) {
        const empId = existingRows[i][0];
        if (empId) idToRowMap.set(String(empId).trim(), i + 1);
      }

      let inserted = 0;
      let updated = 0;
      const updateDataBatch: any[] = [];
      const appendRows: any[] = [];

      for (const emp of employees) {
        const rowValues = [
          emp.employeeId,
          `${emp.firstName} ${emp.lastName}`.trim(),
          emp.email,
          emp.phone || 'N/A',
          emp.department?.name || 'Unassigned',
          emp.designation?.name || 'Unassigned',
          emp.employmentType || 'FULL_TIME',
          emp.joiningDate ? new Date(emp.joiningDate).toISOString().split('T')[0] : 'N/A',
          emp.status || 'ACTIVE',
          emp.manager ? `${emp.manager.firstName} ${emp.manager.lastName}`.trim() : 'N/A',
          emp.company?.name || 'N/A',
          new Date().toISOString()
        ];

        const rowNum = idToRowMap.get(emp.employeeId);
        if (rowNum) {
          updated++;
          updateDataBatch.push({
            range: `'Employees'!A${rowNum}:L${rowNum}`,
            values: [rowValues]
          });
        } else {
          inserted++;
          appendRows.push(rowValues);
        }
      }

      if (updateDataBatch.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: updateDataBatch
          }
        });
      }

      if (appendRows.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'Employees'!A1`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: appendRows }
        });
      }

      await this.logSyncJob({
        companyId,
        worksheet: 'Employees',
        triggerType: 'SYNC_ACTION',
        status: 'SUCCESS',
        inserted,
        updated,
        skipped: 0,
        failed: 0,
        startedAt: startTime,
        completedAt: new Date()
      });

      return { success: true, worksheet: 'Employees', inserted, updated, skipped: 0, failed: 0 };
    } catch (error: any) {
      const errorMsg = this.sanitizeError(error);
      await this.logSyncJob({
        companyId,
        worksheet: 'Employees',
        triggerType: 'SYNC_ACTION',
        status: 'FAILED',
        errorMessage: errorMsg,
        startedAt: startTime,
        completedAt: new Date()
      });
      return { success: false, worksheet: 'Employees', inserted: 0, updated: 0, skipped: 0, failed: 1, error: errorMsg };
    }
  }

  /**
   * Synchronize Attendance Worksheet (Full reconciliation)
   */
  public static async syncAttendance(companyId?: string): Promise<SyncResult> {
    const startTime = new Date();
    try {
      const { sheets, spreadsheetId } = await this.getSheetsClient(companyId);
      await this.initializeWorksheets(companyId);

      const records = await prisma.attendanceRecord.findMany({
        include: {
          employee: {
            include: { department: true }
          },
          shift: true,
          logs: { orderBy: { punchIn: 'asc' } },
          breaks: { orderBy: { breakStart: 'asc' } }
        },
        take: 1000,
        orderBy: { date: 'desc' }
      });

      const existingRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'Attendance'!A1:Z10000`
      });
      const existingRows = existingRes.data.values || [];
      const idToRowMap = new Map<string, number>();

      for (let i = 1; i < existingRows.length; i++) {
        const recordId = existingRows[i][0];
        if (recordId) idToRowMap.set(String(recordId).trim(), i + 1);
      }

      let inserted = 0;
      let updated = 0;
      const updateDataBatch: any[] = [];
      const appendRows: any[] = [];

      for (const rec of records) {
        const sortedLogs = [...rec.logs].sort((a, b) => new Date(a.punchIn).getTime() - new Date(b.punchIn).getTime());
        const firstLog = sortedLogs[0];
        const lastLog = sortedLogs[sortedLogs.length - 1];

        const firstPunchIn = firstLog?.punchIn;
        const hasOpenSession = Boolean(lastLog && !lastLog.punchOut);
        const lastPunchOut = hasOpenSession ? null : lastLog?.punchOut;

        const hasOpenBreak = rec.breaks.some(b => !b.breakEnd);

        let displayStatus = rec.status;
        if (hasOpenBreak) {
          displayStatus = 'ON_BREAK';
        } else if (hasOpenSession) {
          displayStatus = 'CURRENTLY_WORKING';
        }

        const totalBreakMins = rec.breaks.reduce((acc, b) => {
          if (b.durationMinutes && b.durationMinutes > 0) return acc + b.durationMinutes;
          if (b.durationSeconds && b.durationSeconds > 0) return acc + Math.round(b.durationSeconds / 60);
          if (b.breakStart && b.breakEnd) {
            return acc + Math.max(0, Math.round((new Date(b.breakEnd).getTime() - new Date(b.breakStart).getTime()) / 60000));
          }
          if (b.breakStart && !b.breakEnd) {
            return acc + Math.max(0, Math.round((Date.now() - new Date(b.breakStart).getTime()) / 60000));
          }
          return acc;
        }, 0);

        const effectiveMins = Math.max(0, Math.round((rec.effectiveHours || 0) * 60));

        const rowValues = [
          rec.id,
          rec.date ? new Date(rec.date).toISOString().split('T')[0] : 'N/A',
          rec.employee?.employeeId || rec.employeeId,
          rec.employee ? `${rec.employee.firstName} ${rec.employee.lastName}`.trim() : 'N/A',
          rec.employee?.department?.name || 'N/A',
          displayStatus,
          firstPunchIn ? new Date(firstPunchIn).toLocaleTimeString('en-US', { hour12: true }) : 'N/A',
          lastPunchOut ? new Date(lastPunchOut).toLocaleTimeString('en-US', { hour12: true }) : 'N/A',
          rec.effectiveHours ? `${rec.effectiveHours.toFixed(1)} hrs` : '0.0 hrs',
          totalBreakMins,
          effectiveMins,
          rec.shift?.name || 'Default Shift',
          new Date().toISOString()
        ];

        const rowNum = idToRowMap.get(rec.id);
        if (rowNum) {
          updated++;
          updateDataBatch.push({
            range: `'Attendance'!A${rowNum}:M${rowNum}`,
            values: [rowValues]
          });
        } else {
          inserted++;
          appendRows.push(rowValues);
        }
      }

      if (updateDataBatch.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: 'USER_ENTERED', data: updateDataBatch }
        });
      }

      if (appendRows.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'Attendance'!A1`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: appendRows }
        });
      }

      // Refresh in-memory row cache
      const freshRowMap = await this.loadAttendanceRowMap(sheets, spreadsheetId);
      this.attendanceRowCache.set(spreadsheetId, freshRowMap);

      await this.logSyncJob({
        companyId,
        worksheet: 'Attendance',
        triggerType: 'SYNC_ACTION',
        status: 'SUCCESS',
        inserted,
        updated,
        startedAt: startTime,
        completedAt: new Date()
      });

      return { success: true, worksheet: 'Attendance', inserted, updated, skipped: 0, failed: 0 };
    } catch (error: any) {
      const errorMsg = this.sanitizeError(error);
      await this.logSyncJob({
        companyId,
        worksheet: 'Attendance',
        triggerType: 'SYNC_ACTION',
        status: 'FAILED',
        errorMessage: errorMsg,
        startedAt: startTime,
        completedAt: new Date()
      });
      return { success: false, worksheet: 'Attendance', inserted: 0, updated: 0, skipped: 0, failed: 1, error: errorMsg };
    }
  }

  /**
   * Synchronize Leave Requests Worksheet
   */
  public static async syncLeaveRequests(companyId?: string): Promise<SyncResult> {
    const startTime = new Date();
    try {
      const { sheets, spreadsheetId } = await this.getSheetsClient(companyId);
      await this.initializeWorksheets(companyId);

      const requests = await prisma.leaveRequest.findMany({
        include: {
          employee: { include: { department: true } },
          approvalHistory: { include: { actedBy: true } }
        },
        take: 1000,
        orderBy: { createdAt: 'desc' }
      });

      const existingRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'Leave Requests'!A1:Z10000`
      });
      const existingRows = existingRes.data.values || [];
      const idToRowMap = new Map<string, number>();

      for (let i = 1; i < existingRows.length; i++) {
        const reqId = existingRows[i][0];
        if (reqId) idToRowMap.set(String(reqId).trim(), i + 1);
      }

      let inserted = 0;
      let updated = 0;
      const updateDataBatch: any[] = [];
      const appendRows: any[] = [];

      for (const req of requests) {
        const totalDays = Math.max(
          1,
          Math.ceil((new Date(req.endDate).getTime() - new Date(req.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
        );
        const lastReviewer = req.approvalHistory?.[0]?.actedBy;

        const rowValues = [
          req.id,
          req.employee?.employeeId || req.employeeId,
          req.employee ? `${req.employee.firstName} ${req.employee.lastName}`.trim() : 'N/A',
          req.employee?.department?.name || 'N/A',
          req.leaveType,
          req.startDate ? new Date(req.startDate).toISOString().split('T')[0] : 'N/A',
          req.endDate ? new Date(req.endDate).toISOString().split('T')[0] : 'N/A',
          totalDays,
          (req.description || '').replace(/\r?\n|\r/g, ' '),
          req.status,
          req.createdAt ? new Date(req.createdAt).toISOString() : 'N/A',
          lastReviewer ? `${lastReviewer.firstName} ${lastReviewer.lastName}`.trim() : 'N/A',
          new Date().toISOString()
        ];

        const rowNum = idToRowMap.get(req.id);
        if (rowNum) {
          updated++;
          updateDataBatch.push({
            range: `'Leave Requests'!A${rowNum}:M${rowNum}`,
            values: [rowValues]
          });
        } else {
          inserted++;
          appendRows.push(rowValues);
        }
      }

      if (updateDataBatch.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: 'USER_ENTERED', data: updateDataBatch }
        });
      }

      if (appendRows.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'Leave Requests'!A1`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: appendRows }
        });
      }

      await this.logSyncJob({
        companyId,
        worksheet: 'Leave Requests',
        triggerType: 'SYNC_ACTION',
        status: 'SUCCESS',
        inserted,
        updated,
        startedAt: startTime,
        completedAt: new Date()
      });

      return { success: true, worksheet: 'Leave Requests', inserted, updated, skipped: 0, failed: 0 };
    } catch (error: any) {
      const errorMsg = this.sanitizeError(error);
      await this.logSyncJob({
        companyId,
        worksheet: 'Leave Requests',
        triggerType: 'SYNC_ACTION',
        status: 'FAILED',
        errorMessage: errorMsg,
        startedAt: startTime,
        completedAt: new Date()
      });
      return { success: false, worksheet: 'Leave Requests', inserted: 0, updated: 0, skipped: 0, failed: 1, error: errorMsg };
    }
  }

  /**
   * Synchronize Shift Roster Worksheet
   */
  public static async syncShiftRoster(companyId?: string): Promise<SyncResult> {
    const startTime = new Date();
    try {
      const { sheets, spreadsheetId } = await this.getSheetsClient(companyId);
      await this.initializeWorksheets(companyId);

      const rosterEntries = await prisma.rosterEntry.findMany({
        include: {
          employee: { include: { department: true } },
          shift: true
        },
        take: 1000,
        orderBy: { date: 'desc' }
      });

      const existingRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'Shift Roster'!A1:Z10000`
      });
      const existingRows = existingRes.data.values || [];
      const idToRowMap = new Map<string, number>();

      for (let i = 1; i < existingRows.length; i++) {
        const entryId = existingRows[i][0];
        if (entryId) idToRowMap.set(String(entryId).trim(), i + 1);
      }

      let inserted = 0;
      let updated = 0;
      const updateDataBatch: any[] = [];
      const appendRows: any[] = [];

      for (const entry of rosterEntries) {
        const rowValues = [
          entry.id,
          entry.employee?.employeeId || entry.employeeId,
          entry.employee ? `${entry.employee.firstName} ${entry.employee.lastName}`.trim() : 'N/A',
          entry.employee?.department?.name || 'N/A',
          entry.shift?.name || 'General Shift',
          entry.shift?.startTime || '09:00',
          entry.shift?.endTime || '18:00',
          entry.date ? new Date(entry.date).toISOString().split('T')[0] : 'N/A',
          entry.type || 'SHIFT',
          new Date().toISOString()
        ];

        const rowNum = idToRowMap.get(entry.id);
        if (rowNum) {
          updated++;
          updateDataBatch.push({
            range: `'Shift Roster'!A${rowNum}:J${rowNum}`,
            values: [rowValues]
          });
        } else {
          inserted++;
          appendRows.push(rowValues);
        }
      }

      if (updateDataBatch.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: 'USER_ENTERED', data: updateDataBatch }
        });
      }

      if (appendRows.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'Shift Roster'!A1`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: appendRows }
        });
      }

      await this.logSyncJob({
        companyId,
        worksheet: 'Shift Roster',
        triggerType: 'SYNC_ACTION',
        status: 'SUCCESS',
        inserted,
        updated,
        startedAt: startTime,
        completedAt: new Date()
      });

      return { success: true, worksheet: 'Shift Roster', inserted, updated, skipped: 0, failed: 0 };
    } catch (error: any) {
      const errorMsg = this.sanitizeError(error);
      await this.logSyncJob({
        companyId,
        worksheet: 'Shift Roster',
        triggerType: 'SYNC_ACTION',
        status: 'FAILED',
        errorMessage: errorMsg,
        startedAt: startTime,
        completedAt: new Date()
      });
      return { success: false, worksheet: 'Shift Roster', inserted: 0, updated: 0, skipped: 0, failed: 1, error: errorMsg };
    }
  }

  /**
   * Run full synchronization across all worksheets
   */
  public static async runFullSync(companyId?: string, triggerType = 'MANUAL') {
    const results: SyncResult[] = [];

    // Update DB Config Status
    await prisma.googleSheetsConfig.upsert({
      where: { companyId: companyId || 'GLOBAL' },
      create: {
        companyId: companyId || null,
        spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || '',
        serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'hrms-sheet@hrms-management-500604.iam.gserviceaccount.com',
        lastSyncStatus: 'IN_PROGRESS',
        lastSyncAt: new Date()
      },
      update: {
        lastSyncStatus: 'IN_PROGRESS',
        lastSyncAt: new Date()
      }
    });

    results.push(await this.syncEmployees(companyId));
    results.push(await this.syncAttendance(companyId));
    results.push(await this.syncLeaveRequests(companyId));
    results.push(await this.syncShiftRoster(companyId));

    const totalFailed = results.reduce((acc, r) => acc + r.failed, 0);
    const totalInserted = results.reduce((acc, r) => acc + r.inserted, 0);
    const totalUpdated = results.reduce((acc, r) => acc + r.updated, 0);

    const overallStatus = totalFailed === 0 ? 'SUCCESS' : (totalInserted > 0 || totalUpdated > 0 ? 'PARTIAL_SUCCESS' : 'FAILED');
    const firstError = results.find(r => r.error)?.error;

    await prisma.googleSheetsConfig.updateMany({
      where: companyId ? { companyId } : {},
      data: {
        lastSyncStatus: overallStatus,
        lastSyncAt: new Date(),
        lastSyncError: firstError || null
      }
    });

    // Write audit entry to Google Sheets 'Sync Status' worksheet
    try {
      const { sheets, spreadsheetId } = await this.getSheetsClient(companyId);
      const syncStatusRow = [
        `SYNC-${Date.now()}`,
        'All Worksheets',
        triggerType,
        overallStatus,
        totalInserted,
        totalUpdated,
        0,
        totalFailed,
        0,
        new Date().toISOString(),
        new Date().toISOString(),
        firstError || 'None'
      ];
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'Sync Status'!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [syncStatusRow] }
      });
    } catch (e) {
      console.warn("Could not append audit row to 'Sync Status' worksheet:", this.sanitizeError(e));
    }

    return {
      success: overallStatus !== 'FAILED',
      status: overallStatus,
      totalInserted,
      totalUpdated,
      totalFailed,
      results
    };
  }

  /**
   * Enqueue sync mutation to Outbox for reliable, non-blocking asynchronous processing
   */
  public static async enqueueOutboxEvent(
    companyId: string | null,
    entityType: 'EMPLOYEE' | 'ATTENDANCE' | 'LEAVE_REQUEST' | 'SHIFT_ROSTER',
    entityId: string,
    action = 'UPSERT'
  ) {
    try {
      console.log(`⚡ [GoogleSheets] Live outbox event enqueued: ${entityType} (ID: ${entityId}, Action: ${action})`);
      const event = await prisma.googleSheetsSyncOutbox.create({
        data: {
          companyId,
          entityType,
          entityId,
          action,
          status: 'PENDING'
        }
      });

      // Trigger targeted outbox processor immediately without blocking the caller HTTP response
      setImmediate(async () => {
        try {
          await this.processOutboxQueue();
        } catch (err) {
          console.error("Outbox background worker error:", this.sanitizeError(err));
        }
      });

      return event;
    } catch (e) {
      console.error("Failed to enqueue Google Sheets sync outbox event:", this.sanitizeError(e));
      return null;
    }
  }

  /**
   * Process pending items in Outbox queue with concurrency control, targeted single-record sync, and exponential backoff
   */
  public static async processOutboxQueue() {
    if (this.isProcessingQueue) {
      return;
    }
    this.isProcessingQueue = true;

    try {
      const pendingEvents = await prisma.googleSheetsSyncOutbox.findMany({
        where: {
          status: { in: ['PENDING', 'FAILED', 'RETRY_SCHEDULED'] },
          retryCount: { lt: 5 }
        },
        take: 25,
        orderBy: { createdAt: 'asc' }
      });

      if (pendingEvents.length === 0) return;

      for (const evt of pendingEvents) {
        try {
          await prisma.googleSheetsSyncOutbox.update({
            where: { id: evt.id },
            data: { status: 'PROCESSING' }
          });

          if (evt.entityType === 'ATTENDANCE') {
            await this.syncSingleAttendanceRecord(evt.entityId, evt.companyId || undefined, evt.action);
          } else if (evt.entityType === 'EMPLOYEE') {
            await this.syncEmployees(evt.companyId || undefined);
          } else if (evt.entityType === 'LEAVE_REQUEST') {
            await this.syncLeaveRequests(evt.companyId || undefined);
          } else if (evt.entityType === 'SHIFT_ROSTER') {
            await this.syncShiftRoster(evt.companyId || undefined);
          }

          // Mark current event completed
          await prisma.googleSheetsSyncOutbox.update({
            where: { id: evt.id },
            data: { status: 'COMPLETED', updatedAt: new Date() }
          });

          // Prevent stale overwrites: supersede older pending/processing events for the same record
          if (evt.entityType === 'ATTENDANCE') {
            await prisma.googleSheetsSyncOutbox.updateMany({
              where: {
                entityType: evt.entityType,
                entityId: evt.entityId,
                status: { in: ['PENDING', 'PROCESSING', 'RETRY_SCHEDULED'] },
                createdAt: { lte: evt.createdAt },
                id: { not: evt.id }
              },
              data: { status: 'COMPLETED' }
            });
          }
        } catch (error: any) {
          const errorMsg = this.sanitizeError(error);
          console.error(`[GoogleSheets Outbox] Failed to process event ${evt.id}:`, errorMsg);
          const nextRetry = evt.retryCount + 1;
          const isDeadLetter = nextRetry >= 5;

          await prisma.googleSheetsSyncOutbox.update({
            where: { id: evt.id },
            data: {
              status: isDeadLetter ? 'FAILED' : 'RETRY_SCHEDULED',
              retryCount: nextRetry,
              lastError: errorMsg,
              updatedAt: new Date()
            }
          });

          if (isDeadLetter) {
            await this.logSyncJob({
              companyId: evt.companyId || undefined,
              worksheet: evt.entityType,
              triggerType: `OUTBOX_DEAD_LETTER: ${evt.action}`,
              status: 'FAILED',
              errorMessage: errorMsg,
              failed: 1,
              startedAt: evt.createdAt,
              completedAt: new Date()
            });
          }
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Recover pending/interrupted events after process restart
   */
  public static async recoverAndProcessPendingEvents() {
    try {
      await prisma.googleSheetsSyncOutbox.updateMany({
        where: { status: 'PROCESSING' },
        data: { status: 'PENDING' }
      });
      await this.processOutboxQueue();
    } catch (err) {
      console.error("[GoogleSheets] Failed to recover pending outbox events:", this.sanitizeError(err));
    }
  }

  /**
   * Log sync job to Prisma audit table
   */
  private static async logSyncJob(data: {
    companyId?: string;
    worksheet: string;
    triggerType: string;
    status: string;
    inserted?: number;
    updated?: number;
    skipped?: number;
    failed?: number;
    errorMessage?: string;
    startedAt: Date;
    completedAt: Date;
  }) {
    try {
      await prisma.googleSheetsSyncJob.create({
        data: {
          companyId: data.companyId || null,
          worksheet: data.worksheet,
          triggerType: data.triggerType,
          status: data.status,
          insertedCount: data.inserted || 0,
          updatedCount: data.updated || 0,
          skippedCount: data.skipped || 0,
          failedCount: data.failed || 0,
          errorMessage: data.errorMessage || null,
          startedAt: data.startedAt,
          completedAt: data.completedAt
        }
      });
    } catch (e) {
      console.warn("Failed to log GoogleSheetsSyncJob to DB:", this.sanitizeError(e));
    }
  }

  /**
   * Fetch current status overview for administrative dashboard UI
   */
  public static async getIntegrationStatus(companyId?: string) {
    let config = await prisma.googleSheetsConfig.findFirst({
      where: companyId ? { companyId } : {}
    });

    const spreadsheetId = config?.spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID || '';
    const serviceAccountEmail = config?.serviceAccountEmail || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'hrms-sheet@hrms-management-500604.iam.gserviceaccount.com';

    // Counts from database
    const employeeCount = await prisma.employee.count({ where: companyId ? { companyId } : { isDeleted: false } });
    const attendanceCount = await prisma.attendanceRecord.count();
    const leaveCount = await prisma.leaveRequest.count();
    const rosterCount = await prisma.rosterEntry.count();

    const pendingOutboxCount = await prisma.googleSheetsSyncOutbox.count({
      where: {
        status: { in: ['PENDING', 'PROCESSING', 'RETRY_SCHEDULED'] },
        ...(companyId ? { companyId } : {})
      }
    });

    const failedOutboxCount = await prisma.googleSheetsSyncOutbox.count({
      where: {
        status: 'FAILED',
        ...(companyId ? { companyId } : {})
      }
    });

    const recentJobs = await prisma.googleSheetsSyncJob.findMany({
      where: companyId ? { companyId } : {},
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    const failedJobCount = await prisma.googleSheetsSyncJob.count({
      where: {
        status: 'FAILED',
        ...(companyId ? { companyId } : {})
      }
    });

    const testRes = await this.testConnection(companyId);

    const overallHealth = failedOutboxCount > 0 
      ? 'DEGRADED' 
      : (pendingOutboxCount > 0 ? 'SYNCING' : (testRes.success ? 'HEALTHY' : 'ERROR'));

    return {
      isEnabled: config?.isEnabled ?? true,
      spreadsheetId,
      spreadsheetUrl: spreadsheetId && !spreadsheetId.includes('example') ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}` : null,
      serviceAccountEmail,
      connectionStatus: testRes.success ? 'CONNECTED' : (spreadsheetId.includes('example') ? 'NOT_CONFIGURED' : 'CONNECTION_ERROR'),
      connectionMessage: testRes.message,
      lastSyncAt: config?.lastSyncAt || null,
      lastSyncStatus: config?.lastSyncStatus || 'IDLE',
      lastSyncError: config?.lastSyncError || null,
      syncHealth: overallHealth,
      counts: {
        employees: employeeCount,
        attendance: attendanceCount,
        leaveRequests: leaveCount,
        shiftRoster: rosterCount
      },
      pendingOutboxCount,
      failedOutboxCount,
      failedJobCount,
      recentJobs
    };
  }
}
