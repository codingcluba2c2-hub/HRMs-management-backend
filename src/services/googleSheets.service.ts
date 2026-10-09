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
   * Authenticate and get Google Sheets v4 API Client
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
        // Fallback check if any config exists in DB
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

      // 2. Resolve Google Service Account Credentials
      let auth: any;
      const keyFilePath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH 
        ? path.resolve(process.cwd(), process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH)
        : path.resolve(process.cwd(), 'hrms-management-500604-b65f35625a01.json');

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
      return { sheets, spreadsheetId };
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
      const sheetTitles = meta.data.sheets?.map(s => s.properties?.title || '') || [];

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
    
    // Get existing sheets
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingTitles = new Set(meta.data.sheets?.map(s => s.properties?.title || '') || []);

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

    return { success: true, message: 'Initialized standard worksheets and header schemas.' };
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
      // Sync all active employees to the connected sheet
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
        if (empId) idToRowMap.set(String(empId), i + 1);
      }

      let inserted = 0;
      let updated = 0;
      const updateDataBatch: any[] = [];
      const appendRows: any[] = [];

      for (const emp of employees) {
        const rowValues = [
          emp.employeeId,
          `${emp.firstName} ${emp.lastName}`,
          emp.email,
          emp.phone || 'N/A',
          emp.department?.name || 'Unassigned',
          emp.designation?.name || 'Unassigned',
          emp.employmentType || 'FULL_TIME',
          emp.joiningDate ? new Date(emp.joiningDate).toISOString().split('T')[0] : 'N/A',
          emp.status || 'ACTIVE',
          emp.manager ? `${emp.manager.firstName} ${emp.manager.lastName}` : 'N/A',
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
   * Synchronize Attendance Worksheet
   */
  public static async syncAttendance(companyId?: string): Promise<SyncResult> {
    const startTime = new Date();
    try {
      const { sheets, spreadsheetId } = await this.getSheetsClient(companyId);
      await this.initializeWorksheets(companyId);

      const whereClause: any = {};
      // Sync all attendance records to the connected sheet
      const records = await prisma.attendanceRecord.findMany({
        where: whereClause,
        include: {
          employee: {
            include: { department: true }
          },
          shift: true,
          logs: true,
          breaks: true
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
        if (recordId) idToRowMap.set(String(recordId), i + 1);
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
        const displayStatus = hasOpenSession ? 'CURRENTLY_WORKING' : rec.status;

        const totalBreakMins = rec.breaks.reduce((acc, b) => acc + (b.durationMinutes || 0), 0);
        const effectiveMins = Math.max(0, Math.round((rec.effectiveHours || 0) * 60));

        const rowValues = [
          rec.id,
          rec.date ? new Date(rec.date).toISOString().split('T')[0] : 'N/A',
          rec.employee?.employeeId || rec.employeeId,
          rec.employee ? `${rec.employee.firstName} ${rec.employee.lastName}` : 'N/A',
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

      const whereClause: any = {};
      // Sync all leave requests to the connected sheet
      const requests = await prisma.leaveRequest.findMany({
        where: whereClause,
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
        if (reqId) idToRowMap.set(String(reqId), i + 1);
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
          req.employee ? `${req.employee.firstName} ${req.employee.lastName}` : 'N/A',
          req.employee?.department?.name || 'N/A',
          req.leaveType,
          req.startDate ? new Date(req.startDate).toISOString().split('T')[0] : 'N/A',
          req.endDate ? new Date(req.endDate).toISOString().split('T')[0] : 'N/A',
          totalDays,
          (req.description || '').replace(/\r?\n|\r/g, ' '),
          req.status,
          req.createdAt ? new Date(req.createdAt).toISOString() : 'N/A',
          lastReviewer ? `${lastReviewer.firstName} ${lastReviewer.lastName}` : 'N/A',
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

      const whereClause: any = {};
      // Sync all shift roster entries to the connected sheet
      const rosterEntries = await prisma.rosterEntry.findMany({
        where: whereClause,
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
        if (entryId) idToRowMap.set(String(entryId), i + 1);
      }

      let inserted = 0;
      let updated = 0;
      const updateDataBatch: any[] = [];
      const appendRows: any[] = [];

      for (const entry of rosterEntries) {
        const rowValues = [
          entry.id,
          entry.employee?.employeeId || entry.employeeId,
          entry.employee ? `${entry.employee.firstName} ${entry.employee.lastName}` : 'N/A',
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
   * Enqueue sync mutation to Outbox for non-blocking asynchronous processing
   */
  public static async enqueueOutboxEvent(companyId: string | null, entityType: 'EMPLOYEE' | 'ATTENDANCE' | 'LEAVE_REQUEST' | 'SHIFT_ROSTER', entityId: string, action = 'UPSERT') {
    try {
      console.log(`⚡ [GoogleSheets] Live outbox event enqueued: ${entityType} (ID: ${entityId})`);
      await prisma.googleSheetsSyncOutbox.create({
        data: {
          companyId,
          entityType,
          entityId,
          action,
          status: 'PENDING'
        }
      });

      // Process outbox IMMEDIATELY in background without blocking caller HTTP response
      setImmediate(async () => {
        try {
          if (entityType === 'ATTENDANCE') {
            await this.syncAttendance();
          } else if (entityType === 'EMPLOYEE') {
            await this.syncEmployees();
          } else if (entityType === 'LEAVE_REQUEST') {
            await this.syncLeaveRequests();
          } else if (entityType === 'SHIFT_ROSTER') {
            await this.syncShiftRoster();
          }
          await this.processOutboxQueue();
        } catch (err) {
          console.error("Outbox background worker error:", this.sanitizeError(err));
        }
      });
    } catch (e) {
      console.error("Failed to enqueue Google Sheets sync outbox event:", this.sanitizeError(e));
    }
  }

  /**
   * Process pending items in Outbox queue with exponential backoff & retries
   */
  public static async processOutboxQueue() {
    const pendingEvents = await prisma.googleSheetsSyncOutbox.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        retryCount: { lt: 3 }
      },
      take: 20,
      orderBy: { createdAt: 'asc' }
    });

    if (pendingEvents.length === 0) return;

    for (const evt of pendingEvents) {
      try {
        await prisma.googleSheetsSyncOutbox.update({
          where: { id: evt.id },
          data: { status: 'PROCESSING' }
        });

        if (evt.entityType === 'EMPLOYEE') {
          await this.syncEmployees(evt.companyId || undefined);
        } else if (evt.entityType === 'ATTENDANCE') {
          await this.syncAttendance(evt.companyId || undefined);
        } else if (evt.entityType === 'LEAVE_REQUEST') {
          await this.syncLeaveRequests(evt.companyId || undefined);
        } else if (evt.entityType === 'SHIFT_ROSTER') {
          await this.syncShiftRoster(evt.companyId || undefined);
        }

        await prisma.googleSheetsSyncOutbox.update({
          where: { id: evt.id },
          data: { status: 'COMPLETED' }
        });
      } catch (error: any) {
        const errorMsg = this.sanitizeError(error);
        await prisma.googleSheetsSyncOutbox.update({
          where: { id: evt.id },
          data: {
            status: 'FAILED',
            retryCount: evt.retryCount + 1,
            lastError: errorMsg
          }
        });
      }
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
      counts: {
        employees: employeeCount,
        attendance: attendanceCount,
        leaveRequests: leaveCount,
        shiftRoster: rosterCount
      },
      failedJobCount,
      recentJobs
    };
  }
}
