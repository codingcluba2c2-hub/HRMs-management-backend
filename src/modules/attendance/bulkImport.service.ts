import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { prisma } from '../../lib/prisma';
import { getManagerScopedEmployeeFilter } from '../../utils/managerScope';
import {
  calculateAttendanceStatus,
  formatMinutesToHoursMinutes,
  AttendanceStatus
} from '../../config/attendancePolicy';

export type ImportMode = 'MIXED' | 'CREATE_ONLY' | 'CORRECT_ONLY';

export interface RawImportRow {
  rowNumber: number;
  employeeId: string;
  attendanceDate: string;
  punchIn?: string | null;
  punchOut?: string | null;
  lunchBreakMinutes?: number;
  teaBreakMinutes?: number;
  bioBreakMinutes?: number;
  officialBreakMinutes?: number;
  personalBreakMinutes?: number;
  attendanceStatus?: string | null;
  shift?: string | null;
  remarks?: string | null;
  recordId?: string | null;
}

export interface RowValidationResult {
  rowNumber: number;
  employeeId: string;
  employeeName?: string;
  department?: string;
  attendanceDate: string;
  recordId?: string | null;
  action: 'CREATE' | 'CORRECT' | 'SKIP' | 'ERROR' | 'DUPLICATE';
  isValid: boolean;
  errors: string[];
  warnings: string[];
  proposedData: {
    date: string;
    punchIn: string | null;
    punchOut: string | null;
    status: string;
    grossHours: number;
    effectiveHours: number;
    totalBreakMinutes: number;
    shiftName?: string;
    remarks?: string;
  };
  existingData?: {
    recordId: string;
    date: string;
    punchIn: string | null;
    punchOut: string | null;
    status: string;
    grossHours: number;
    effectiveHours: number;
    totalBreakMinutes: number;
  } | null;
}

export interface PreviewSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  newRecordsCount: number;
  correctionRecordsCount: number;
  skippedCount: number;
  duplicateCount: number;
  mode: ImportMode;
  rows: RowValidationResult[];
}

export interface CommitResult {
  totalProcessed: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  results: {
    rowNumber: number;
    employeeId: string;
    date: string;
    recordId?: string;
    status: 'CREATED' | 'UPDATED' | 'SKIPPED' | 'FAILED';
    message?: string;
  }[];
  googleSheetsSyncStatus: 'ENQUEUED' | 'SKIPPED' | 'FAILED';
}

/**
 * Generate standard Enterprise Attendance Import & Correction template (.xlsx)
 */
export async function generateTemplateWorkbook(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HRMS Pro Enterprise';
  workbook.created = new Date();

  // Sheet 1: Instructions & Guidelines
  const instructionsSheet = workbook.addWorksheet('Instructions');
  instructionsSheet.views = [{ showGridLines: true }];

  instructionsSheet.columns = [
    { header: 'Item', key: 'item', width: 28 },
    { header: 'Guideline / Rule', key: 'guideline', width: 68 },
    { header: 'Supported Formats / Examples', key: 'example', width: 42 }
  ];

  // Header styling
  const headerRow = instructionsSheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' } // Navy Blue
  };
  headerRow.height = 24;

  const instructions = [
    {
      item: '1. Objective',
      guideline: 'Use this template to create historical missing attendance records or correct existing records for multiple employees.',
      example: 'Bulk Import & Correction'
    },
    {
      item: '2. Employee Identifier',
      guideline: 'Always use stable official Employee ID (e.g. EMP7033928, EMP1001). Do not use employee names as identifiers.',
      example: 'EMP7033928'
    },
    {
      item: '3. Attendance Date',
      guideline: 'Date of attendance. Must be a valid historical or current date. Future dates are rejected.',
      example: 'YYYY-MM-DD (e.g. 2026-10-05)'
    },
    {
      item: '4. Punch In & Punch Out',
      guideline: 'Time of check-in and check-out. If overnight shift (Punch Out earlier than Punch In), it is treated as next-day checkout.',
      example: 'HH:mm (e.g. 09:15) or HH:mm:ss (09:15:00)'
    },
    {
      item: '5. Break Durations',
      guideline: 'Enter duration in exact minutes for Lunch, Tea, Bio, Official, and Personal breaks. Total breaks cannot exceed shift duration.',
      example: 'Lunch: 45, Tea: 15, Bio: 10, Official: 0'
    },
    {
      item: '6. Attendance Status',
      guideline: 'Leave BLANK or "AUTO" for automated calculation based on working hours, or provide a canonical status: PRESENT, HALF_DAY, ABSENT, LEAVE, HOLIDAY, WEEKEND.',
      example: 'PRESENT / HALF_DAY / ABSENT / AUTO'
    },
    {
      item: '7. Shift Assignment',
      guideline: 'Optional shift name or code. If left blank, employee default shift is assigned automatically.',
      example: 'General Shift / Morning Shift'
    },
    {
      item: '8. Record ID (For Corrections)',
      guideline: 'Leave blank to create a NEW record. Provide existing Record ID (UUID) or leave blank to match unambiguously by Employee ID + Date.',
      example: 'Leave blank or UUID (e.g. c3a1...)'
    },
    {
      item: '9. Import Modes',
      guideline: 'A. Create Missing Records (inserts only if not present). B. Correct Existing Records (updates only). C. Mixed Mode (creates missing, updates existing).',
      example: 'Select mode in preview dialog'
    },
    {
      item: '10. Google Sheets Sync',
      guideline: 'All successfully imported records automatically synchronize to the live Google Sheets Attendance worksheet with full audit logging.',
      example: 'Automatic Outbox Sync'
    }
  ];

  instructions.forEach(inst => {
    instructionsSheet.addRow(inst);
  });

  // Apply row styling to instructions
  for (let r = 2; r <= instructions.length + 1; r++) {
    const row = instructionsSheet.getRow(r);
    row.height = 22;
    row.alignment = { vertical: 'middle', wrapText: true };
    if (r % 2 === 0) {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF8FAFC' }
      };
    }
  }

  // Sheet 2: Attendance Data
  const dataSheet = workbook.addWorksheet('Attendance Data');
  dataSheet.views = [{ showGridLines: true }];

  dataSheet.columns = [
    { header: 'Employee ID', key: 'employeeId', width: 18 },
    { header: 'Attendance Date', key: 'attendanceDate', width: 18 },
    { header: 'Punch In', key: 'punchIn', width: 14 },
    { header: 'Punch Out', key: 'punchOut', width: 14 },
    { header: 'Lunch Break Minutes', key: 'lunchBreakMinutes', width: 20 },
    { header: 'Tea Break Minutes', key: 'teaBreakMinutes', width: 18 },
    { header: 'Bio Break Minutes', key: 'bioBreakMinutes', width: 18 },
    { header: 'Official Break Minutes', key: 'officialBreakMinutes', width: 22 },
    { header: 'Personal Break Minutes', key: 'personalBreakMinutes', width: 22 },
    { header: 'Attendance Status', key: 'attendanceStatus', width: 18 },
    { header: 'Shift', key: 'shift', width: 18 },
    { header: 'Remarks', key: 'remarks', width: 28 },
    { header: 'Record ID', key: 'recordId', width: 36 }
  ];

  const dataHeaderRow = dataSheet.getRow(1);
  dataHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  dataHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0284C7' } // Sky Blue
  };
  dataHeaderRow.height = 26;
  dataHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  // Sample Rows (Clearly labeled SAMPLE data)
  const sampleRows = [
    {
      employeeId: 'SAMPLE_EMP_01',
      attendanceDate: '2026-10-01',
      punchIn: '09:00',
      punchOut: '18:00',
      lunchBreakMinutes: 45,
      teaBreakMinutes: 15,
      bioBreakMinutes: 0,
      officialBreakMinutes: 0,
      personalBreakMinutes: 0,
      attendanceStatus: 'PRESENT',
      shift: 'General Shift',
      remarks: 'Sample standard 9-hour day',
      recordId: ''
    },
    {
      employeeId: 'SAMPLE_EMP_02',
      attendanceDate: '2026-10-01',
      punchIn: '09:30',
      punchOut: '14:00',
      lunchBreakMinutes: 30,
      teaBreakMinutes: 0,
      bioBreakMinutes: 0,
      officialBreakMinutes: 0,
      personalBreakMinutes: 0,
      attendanceStatus: 'HALF_DAY',
      shift: 'General Shift',
      remarks: 'Sample approved half-day session',
      recordId: ''
    },
    {
      employeeId: 'SAMPLE_EMP_03',
      attendanceDate: '2026-10-01',
      punchIn: '22:00',
      punchOut: '06:00',
      lunchBreakMinutes: 60,
      teaBreakMinutes: 0,
      bioBreakMinutes: 0,
      officialBreakMinutes: 0,
      personalBreakMinutes: 0,
      attendanceStatus: 'PRESENT',
      shift: 'Night Shift',
      remarks: 'Sample overnight shift',
      recordId: ''
    },
    {
      employeeId: 'SAMPLE_EMP_01',
      attendanceDate: '2026-10-02',
      punchIn: '',
      punchOut: '',
      lunchBreakMinutes: 0,
      teaBreakMinutes: 0,
      bioBreakMinutes: 0,
      officialBreakMinutes: 0,
      personalBreakMinutes: 0,
      attendanceStatus: 'LEAVE',
      shift: 'General Shift',
      remarks: 'Sample approved casual leave',
      recordId: ''
    }
  ];

  sampleRows.forEach(sr => {
    dataSheet.addRow(sr);
  });

  for (let r = 2; r <= sampleRows.length + 1; r++) {
    const row = dataSheet.getRow(r);
    row.height = 20;
    row.alignment = { vertical: 'middle' };
  }

  return workbook;
}

/**
 * Safely extract string/number cell value from ExcelJS Cell
 */
function getCellValue(cell: ExcelJS.Cell | undefined): any {
  if (!cell || cell.value === null || cell.value === undefined) return '';
  if (cell.value instanceof Date) return cell.value;
  if (typeof cell.value === 'object') {
    if ('result' in (cell.value as any)) return (cell.value as any).result;
    if ('text' in (cell.value as any)) return (cell.value as any).text;
    if ('richText' in (cell.value as any)) {
      return (cell.value as any).richText.map((t: any) => t.text).join('');
    }
  }
  return cell.value;
}

/**
 * Normalize and parse date string or Date object to YYYY-MM-DD
 */
function parseDateStringToUtcMidnight(val: any): { dateObj: Date | null; dateStr: string | null; error?: string } {
  if (!val) return { dateObj: null, dateStr: null, error: 'Attendance date is required' };

  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const dateObj = new Date(Date.UTC(y, val.getUTCMonth(), val.getUTCDate(), 0, 0, 0, 0));
    return { dateObj, dateStr };
  }

  const str = String(val).trim();
  if (!str) return { dateObj: null, dateStr: null, error: 'Attendance date is required' };

  // Match YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (m < 1 || m > 12 || d < 1 || d > 31) {
      return { dateObj: null, dateStr: null, error: `Invalid date values in ${str}` };
    }
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    return { dateObj, dateStr };
  }

  // Match DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10);
    const y = parseInt(dmyMatch[3], 10);
    if (m < 1 || m > 12 || d < 1 || d > 31) {
      return { dateObj: null, dateStr: null, error: `Invalid date values in ${str}` };
    }
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    return { dateObj, dateStr };
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const dateObj = new Date(Date.UTC(y, parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0));
    return { dateObj, dateStr };
  }

  return { dateObj: null, dateStr: null, error: `Unrecognized date format: "${str}". Use YYYY-MM-DD.` };
}

/**
 * Parse time string or Date object in context of a base date
 */
function parseTimeWithBaseDate(
  timeVal: any,
  baseDateStr: string
): { timeObj: Date | null; timeStr: string | null; error?: string } {
  if (!timeVal) return { timeObj: null, timeStr: null };

  if (timeVal instanceof Date) {
    const hours = String(timeVal.getHours()).padStart(2, '0');
    const minutes = String(timeVal.getMinutes()).padStart(2, '0');
    const seconds = String(timeVal.getSeconds()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}:${seconds}`;

    const [by, bm, bd] = baseDateStr.split('-').map(Number);
    const timeObj = new Date(by, bm - 1, bd, timeVal.getHours(), timeVal.getMinutes(), timeVal.getSeconds(), 0);
    return { timeObj, timeStr };
  }

  const raw = String(timeVal).trim();
  if (!raw) return { timeObj: null, timeStr: null };

  // Check if string contains full date+time
  if (raw.includes('T') || raw.includes(' ')) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      return { timeObj: d, timeStr: `${hours}:${minutes}:${seconds}` };
    }
  }

  // Parse HH:mm or HH:mm:ss
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return { timeObj: null, timeStr: null, error: `Invalid time format "${raw}". Use HH:mm or HH:mm:ss` };
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = match[3] ? parseInt(match[3], 10) : 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return { timeObj: null, timeStr: null, error: `Time out of range "${raw}"` };
  }

  const [by, bm, bd] = baseDateStr.split('-').map(Number);
  const timeObj = new Date(by, bm - 1, bd, hours, minutes, seconds, 0);
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return { timeObj, timeStr };
}

/**
 * Parse uploaded Excel or CSV buffer into raw row objects
 */
export async function parseBufferToRawRows(fileBuffer: Buffer, isCsv = false): Promise<RawImportRow[]> {
  const workbook = new ExcelJS.Workbook();

  if (isCsv) {
    const stream = new Readable();
    stream.push(fileBuffer);
    stream.push(null);
    await workbook.csv.read(stream);
  } else {
    await workbook.xlsx.load(fileBuffer as any);
  }

  // Find sheet: Prefer 'Attendance Data', else first worksheet
  let sheet = workbook.getWorksheet('Attendance Data');
  if (!sheet) {
    sheet = workbook.worksheets[0];
  }

  if (!sheet || sheet.rowCount < 2) {
    return [];
  }

  // Read and normalize headers
  const headerRow = sheet.getRow(1);
  const headerMap: { [key: string]: number } = {};

  headerRow.eachCell((cell, colNumber) => {
    const rawHeader = String(getCellValue(cell) || '').trim().toLowerCase();
    const cleanHeader = rawHeader.replace(/[^a-z0-9]/g, '');

    if (cleanHeader.includes('employeeid') || cleanHeader.includes('empid')) headerMap['employeeId'] = colNumber;
    else if (cleanHeader.includes('attendancedate') || cleanHeader.includes('date')) headerMap['attendanceDate'] = colNumber;
    else if (cleanHeader.includes('punchin') || cleanHeader.includes('checkin')) headerMap['punchIn'] = colNumber;
    else if (cleanHeader.includes('punchout') || cleanHeader.includes('checkout')) headerMap['punchOut'] = colNumber;
    else if (cleanHeader.includes('lunch')) headerMap['lunchBreakMinutes'] = colNumber;
    else if (cleanHeader.includes('tea')) headerMap['teaBreakMinutes'] = colNumber;
    else if (cleanHeader.includes('bio')) headerMap['bioBreakMinutes'] = colNumber;
    else if (cleanHeader.includes('official')) headerMap['officialBreakMinutes'] = colNumber;
    else if (cleanHeader.includes('personal')) headerMap['personalBreakMinutes'] = colNumber;
    else if (cleanHeader.includes('status')) headerMap['attendanceStatus'] = colNumber;
    else if (cleanHeader.includes('shift')) headerMap['shift'] = colNumber;
    else if (cleanHeader.includes('remark') || cleanHeader.includes('reason') || cleanHeader.includes('note')) headerMap['remarks'] = colNumber;
    else if (cleanHeader.includes('recordid') || cleanHeader === 'id') headerMap['recordId'] = colNumber;
  });

  const rawRows: RawImportRow[] = [];

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);

    // Skip empty rows
    const empVal = headerMap['employeeId'] ? getCellValue(row.getCell(headerMap['employeeId'])) : '';
    const dateVal = headerMap['attendanceDate'] ? getCellValue(row.getCell(headerMap['attendanceDate'])) : '';

    if (!empVal && !dateVal) continue;

    const parseNum = (colKey: string): number => {
      if (!headerMap[colKey]) return 0;
      const v = getCellValue(row.getCell(headerMap[colKey]));
      const n = Number(v);
      return isNaN(n) || n < 0 ? 0 : Math.round(n);
    };

    rawRows.push({
      rowNumber: r,
      employeeId: String(empVal).trim(),
      attendanceDate: dateVal instanceof Date ? dateVal.toISOString().split('T')[0] : String(dateVal).trim(),
      punchIn: headerMap['punchIn'] ? getCellValue(row.getCell(headerMap['punchIn'])) : null,
      punchOut: headerMap['punchOut'] ? getCellValue(row.getCell(headerMap['punchOut'])) : null,
      lunchBreakMinutes: parseNum('lunchBreakMinutes'),
      teaBreakMinutes: parseNum('teaBreakMinutes'),
      bioBreakMinutes: parseNum('bioBreakMinutes'),
      officialBreakMinutes: parseNum('officialBreakMinutes'),
      personalBreakMinutes: parseNum('personalBreakMinutes'),
      attendanceStatus: headerMap['attendanceStatus'] ? String(getCellValue(row.getCell(headerMap['attendanceStatus'])) || '').trim() : null,
      shift: headerMap['shift'] ? String(getCellValue(row.getCell(headerMap['shift'])) || '').trim() : null,
      remarks: headerMap['remarks'] ? String(getCellValue(row.getCell(headerMap['remarks'])) || '').trim() : null,
      recordId: headerMap['recordId'] ? String(getCellValue(row.getCell(headerMap['recordId'])) || '').trim() : null
    });
  }

  return rawRows;
}

/**
 * Validate raw import rows against DB, RBAC, business policies without mutating DB
 */
export async function validateImportRows(
  rawRows: RawImportRow[],
  user: any,
  mode: ImportMode = 'MIXED'
): Promise<PreviewSummary> {
  const scopedFilter = await getManagerScopedEmployeeFilter(user);

  // 1. Collect unique Employee IDs from file
  const empCodes = Array.from(new Set(rawRows.map(r => r.employeeId.toUpperCase()).filter(Boolean)));

  const matchedEmployees = await prisma.employee.findMany({
    where: {
      employeeId: { in: empCodes, mode: 'insensitive' },
      ...scopedFilter
    },
    include: {
      department: { select: { id: true, name: true } },
      designation: { select: { id: true, name: true } },
      shift: { select: { id: true, name: true, startTime: true, endTime: true } }
    }
  });

  const employeeMap = new Map<string, any>();
  matchedEmployees.forEach(emp => {
    employeeMap.set(emp.employeeId.toUpperCase(), emp);
  });

  // 2. Collect Record IDs and (employeeId, date) pairs to fetch existing attendance records
  const recordIds = rawRows.map(r => r.recordId).filter(Boolean) as string[];
  const existingRecordsById = recordIds.length > 0
    ? await prisma.attendanceRecord.findMany({
        where: { id: { in: recordIds } },
        include: {
          employee: { select: { id: true, employeeId: true } },
          logs: { orderBy: { punchIn: 'asc' } },
          breaks: true
        }
      })
    : [];

  const existingRecordMapById = new Map<string, any>();
  existingRecordsById.forEach(rec => existingRecordMapById.set(rec.id, rec));

  // 3. Batch fetch existing records by employee internal UUID and dates
  const empInternalIds = matchedEmployees.map(e => e.id);
  const existingRecordsByEmpAndDate = empInternalIds.length > 0
    ? await prisma.attendanceRecord.findMany({
        where: {
          employeeId: { in: empInternalIds }
        },
        include: {
          employee: { select: { id: true, employeeId: true } },
          logs: { orderBy: { punchIn: 'asc' } },
          breaks: true
        }
      })
    : [];

  const existingRecordMapByEmpDate = new Map<string, any>();
  existingRecordsByEmpAndDate.forEach(rec => {
    const dStr = rec.date.toISOString().split('T')[0];
    const key = `${rec.employeeId}_${dStr}`;
    existingRecordMapByEmpDate.set(key, rec);
  });

  // 4. Track file-internal duplicates (employeeId + date)
  const fileSeenKeys = new Map<string, number>();

  const validationResults: RowValidationResult[] = [];
  let newRecordsCount = 0;
  let correctionRecordsCount = 0;
  let skippedCount = 0;
  let duplicateCount = 0;
  let invalidRows = 0;

  for (const raw of rawRows) {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Filter out dummy sample template rows
    if (raw.employeeId.toUpperCase().startsWith('SAMPLE_EMP')) {
      continue;
    }

    // A. Validate Employee Existence & RBAC Department Scope
    const emp = employeeMap.get(raw.employeeId.toUpperCase());
    if (!emp) {
      errors.push(`Employee ID "${raw.employeeId}" not found or unauthorized within your departmental scope.`);
    }

    // B. Validate Attendance Date
    const { dateObj, dateStr, error: dateError } = parseDateStringToUtcMidnight(raw.attendanceDate);
    if (dateError) {
      errors.push(dateError);
    } else if (dateObj) {
      const todayUtcMidnight = new Date();
      todayUtcMidnight.setHours(23, 59, 59, 999);
      if (dateObj > todayUtcMidnight) {
        errors.push(`Attendance date cannot be in the future (${dateStr}).`);
      }
    }

    // C. Detect Duplicates within the uploaded file
    const dedupeKey = `${raw.employeeId.toUpperCase()}_${dateStr || raw.attendanceDate}`;
    if (fileSeenKeys.has(dedupeKey)) {
      errors.push(`Duplicate row in uploaded file for this employee and date (Already seen at Row ${fileSeenKeys.get(dedupeKey)}).`);
    } else {
      fileSeenKeys.set(dedupeKey, raw.rowNumber);
    }

    // D. Validate Punch In / Punch Out
    const validDateStr = dateStr || new Date().toISOString().split('T')[0];
    const pIn = parseTimeWithBaseDate(raw.punchIn, validDateStr);
    const pOut = parseTimeWithBaseDate(raw.punchOut, validDateStr);

    if (pIn.error) errors.push(`Punch In: ${pIn.error}`);
    if (pOut.error) errors.push(`Punch Out: ${pOut.error}`);

    let punchInObj = pIn.timeObj;
    let punchOutObj = pOut.timeObj;

    // Handle overnight shifts if punchOut is earlier in the day than punchIn
    if (punchInObj && punchOutObj && punchOutObj < punchInObj) {
      // Overnight shift: add 24 hours to punchOut
      punchOutObj = new Date(punchOutObj.getTime() + 24 * 60 * 60 * 1000);
      warnings.push('Overnight shift detected: Punch Out recorded on the following day.');
    }

    // E. Break minutes validation
    const lunch = raw.lunchBreakMinutes || 0;
    const tea = raw.teaBreakMinutes || 0;
    const bio = raw.bioBreakMinutes || 0;
    const official = raw.officialBreakMinutes || 0;
    const personal = raw.personalBreakMinutes || 0;

    const totalBreaks = lunch + tea + bio + official + personal;

    let grossMinutes = 0;
    if (punchInObj && punchOutObj) {
      grossMinutes = Math.floor((punchOutObj.getTime() - punchInObj.getTime()) / 60000);
      if (grossMinutes < 0) {
        errors.push('Punch Out time cannot be earlier than Punch In time.');
      } else if (totalBreaks > grossMinutes) {
        errors.push(`Total break duration (${totalBreaks}m) cannot exceed shift gross duration (${grossMinutes}m).`);
      }
    }

    const effectiveMinutes = Math.max(0, grossMinutes - totalBreaks);
    const grossHours = Math.round((grossMinutes / 60) * 100) / 100;
    const effectiveHours = Math.round((effectiveMinutes / 60) * 100) / 100;

    // F. Status calculation and validation
    let finalStatus = 'PRESENT';
    const rawStatus = raw.attendanceStatus?.toUpperCase().trim();
    const canonicalStatuses: AttendanceStatus[] = ['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKEND', 'INSUFFICIENT_HOURS'];

    if (rawStatus && rawStatus !== 'AUTO' && rawStatus !== '') {
      if (canonicalStatuses.includes(rawStatus as AttendanceStatus)) {
        finalStatus = rawStatus;
      } else {
        errors.push(`Invalid status "${raw.attendanceStatus}". Allowed: PRESENT, HALF_DAY, ABSENT, LEAVE, HOLIDAY, WEEKEND, AUTO.`);
      }
    } else {
      // Auto calculate
      if (!punchInObj && !punchOutObj) {
        finalStatus = 'ABSENT';
      } else {
        finalStatus = calculateAttendanceStatus(effectiveMinutes);
      }
    }

    // Require punch in if status is PRESENT or HALF_DAY
    if ((finalStatus === 'PRESENT' || finalStatus === 'HALF_DAY') && !punchInObj) {
      errors.push(`Punch In is required for attendance status ${finalStatus}.`);
    }

    // G. Determine Existing Record and Action (CREATE vs CORRECT vs SKIP)
    let existingRec: any = null;
    if (raw.recordId) {
      existingRec = existingRecordMapById.get(raw.recordId);
      if (!existingRec) {
        errors.push(`Specified Record ID "${raw.recordId}" does not exist in the database.`);
      }
    } else if (emp && dateStr) {
      const empDateKey = `${emp.id}_${dateStr}`;
      existingRec = existingRecordMapByEmpDate.get(empDateKey);
    }

    let action: 'CREATE' | 'CORRECT' | 'SKIP' | 'ERROR' | 'DUPLICATE' = 'CREATE';

    if (errors.some(e => e.includes('Duplicate row in uploaded file'))) {
      action = 'DUPLICATE';
    } else if (errors.length > 0) {
      action = 'ERROR';
    } else if (existingRec) {
      if (mode === 'CREATE_ONLY') {
        action = 'SKIP';
        warnings.push('Record already exists for this date. Skipped in "Create Only" mode.');
      } else {
        action = 'CORRECT';
      }
    } else {
      if (mode === 'CORRECT_ONLY') {
        action = 'ERROR';
        errors.push('No existing attendance record found to correct. Use "Create" or "Mixed" mode.');
      } else {
        action = 'CREATE';
      }
    }

    // Format existing data diff for display
    let existingDataDiff = null;
    if (existingRec) {
      const firstLog = existingRec.logs?.[0];
      const sumBreaks = (existingRec.breaks || []).reduce((acc: number, b: any) => acc + (b.durationMinutes || 0), 0);
      existingDataDiff = {
        recordId: existingRec.id,
        date: existingRec.date.toISOString().split('T')[0],
        punchIn: firstLog?.punchIn ? new Date(firstLog.punchIn).toTimeString().substring(0, 8) : null,
        punchOut: firstLog?.punchOut ? new Date(firstLog.punchOut).toTimeString().substring(0, 8) : null,
        status: existingRec.status,
        grossHours: existingRec.grossHours,
        effectiveHours: existingRec.effectiveHours,
        totalBreakMinutes: sumBreaks
      };
    }

    const isValid = errors.length === 0;
    if (!isValid) {
      invalidRows++;
      if (action === 'DUPLICATE') duplicateCount++;
    } else if (action === 'CREATE') newRecordsCount++;
    else if (action === 'CORRECT') correctionRecordsCount++;
    else if (action === 'SKIP') skippedCount++;

    validationResults.push({
      rowNumber: raw.rowNumber,
      employeeId: raw.employeeId,
      employeeName: emp ? `${emp.firstName} ${emp.lastName}`.trim() : undefined,
      department: emp?.department?.name,
      attendanceDate: validDateStr,
      recordId: existingRec?.id || raw.recordId || null,
      action,
      isValid,
      errors,
      warnings,
      proposedData: {
        date: validDateStr,
        punchIn: pIn.timeStr || null,
        punchOut: pOut.timeStr || null,
        status: finalStatus,
        grossHours,
        effectiveHours,
        totalBreakMinutes: totalBreaks,
        shiftName: raw.shift || emp?.shift?.name || 'General Shift',
        remarks: raw.remarks || undefined
      },
      existingData: existingDataDiff
    });
  }

  const validRows = validationResults.filter(r => r.isValid).length;

  return {
    totalRows: validationResults.length,
    validRows,
    invalidRows,
    newRecordsCount,
    correctionRecordsCount,
    skippedCount,
    duplicateCount,
    mode,
    rows: validationResults
  };
}

/**
 * Commit validated import rows to PostgreSQL inside bounded transactions
 * Enqueues durable outbox events for live Google Sheets sync
 */
export async function commitBulkImport(
  validatedRows: RowValidationResult[],
  user: any,
  mode: ImportMode = 'MIXED',
  reqMetadata?: { ip?: string; userAgent?: string }
): Promise<CommitResult> {
  const actorId = user?.id || 'SYSTEM_ADMIN';
  const scopedFilter = await getManagerScopedEmployeeFilter(user);

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const results: CommitResult['results'] = [];
  const modifiedRecordIds: { id: string; companyId?: string | null; action: string }[] = [];

  // Account for rows pre-marked as SKIP (e.g. existing records in CREATE_ONLY mode)
  for (const row of validatedRows) {
    if (row.action === 'SKIP') {
      skippedCount++;
      results.push({
        rowNumber: row.rowNumber,
        employeeId: row.employeeId,
        date: row.attendanceDate,
        recordId: row.recordId || row.existingData?.recordId || undefined,
        status: 'SKIPPED',
        message: 'Record already exists. Skipped in Create Only mode.'
      });
    }
  }

  // Filter down to rows eligible for commit
  const validActionableRows = validatedRows.filter(r => r.isValid && (r.action === 'CREATE' || r.action === 'CORRECT'));

  // Process in bounded batches of 25 to avoid lock timeouts and memory strain
  const BATCH_SIZE = 25;
  for (let i = 0; i < validActionableRows.length; i += BATCH_SIZE) {
    const batch = validActionableRows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      try {
        let outcomeStatus: 'CREATED' | 'UPDATED' | 'SKIPPED' = 'CREATED';
        let outcomeRecordId = '';
        let outcomeCompanyId: string | null = null;

        await prisma.$transaction(async (tx) => {
          // Re-verify employee within current DB state and manager scope
          const emp = await tx.employee.findFirst({
            where: {
              employeeId: { equals: row.employeeId, mode: 'insensitive' },
              ...scopedFilter
            },
            select: { id: true, companyId: true, shiftId: true }
          });

          if (!emp) {
            throw new Error(`Employee ID "${row.employeeId}" is no longer accessible or found.`);
          }
          outcomeCompanyId = emp.companyId;

          const [y, m, d] = row.attendanceDate.split('-').map(Number);
          const normalizedDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));

          // Resolve timestamps
          let punchInDate: Date | null = null;
          let punchOutDate: Date | null = null;

          if (row.proposedData.punchIn) {
            const [h, min, s] = row.proposedData.punchIn.split(':').map(Number);
            punchInDate = new Date(y, m - 1, d, h, min, s || 0, 0);
          }

          if (row.proposedData.punchOut) {
            const [h, min, s] = row.proposedData.punchOut.split(':').map(Number);
            punchOutDate = new Date(y, m - 1, d, h, min, s || 0, 0);
            if (punchInDate && punchOutDate < punchInDate) {
              // Overnight shift: add 24 hours
              punchOutDate = new Date(punchOutDate.getTime() + 24 * 60 * 60 * 1000);
            }
          }

          const existing = await tx.attendanceRecord.findUnique({
            where: { employeeId_date: { employeeId: emp.id, date: normalizedDate } },
            include: { logs: true }
          });

          if (row.action === 'CREATE' && existing) {
            if (mode === 'CREATE_ONLY') {
              outcomeStatus = 'SKIPPED';
              outcomeRecordId = existing.id;
              return;
            }
          }

          if (existing) {
            // Update existing record (for CORRECT action or MIXED mode fallback)
            await tx.attendanceRecord.update({
              where: { id: existing.id },
              data: {
                status: row.proposedData.status,
                grossHours: row.proposedData.grossHours,
                effectiveHours: row.proposedData.effectiveHours,
                shiftId: emp.shiftId || undefined,
                updatedAt: new Date()
              }
            });

            if (punchInDate) {
              const existingLog = existing.logs?.[0];
              if (existingLog) {
                await tx.attendanceLog.update({
                  where: { id: existingLog.id },
                  data: { punchIn: punchInDate, punchOut: punchOutDate }
                });
                await tx.attendanceLog.deleteMany({
                  where: { attendanceId: existing.id, id: { not: existingLog.id } }
                });
              } else {
                await tx.attendanceLog.create({
                  data: { attendanceId: existing.id, punchIn: punchInDate, punchOut: punchOutDate, deviceName: 'Bulk Import' }
                });
              }
            }

            if (row.proposedData.totalBreakMinutes > 0 && punchInDate) {
              await tx.breakSession.deleteMany({ where: { attendanceId: existing.id } });
              await tx.breakSession.create({
                data: {
                  attendanceId: existing.id,
                  type: 'LUNCH',
                  breakStart: new Date(punchInDate.getTime() + 4 * 60 * 60 * 1000),
                  breakEnd: new Date(punchInDate.getTime() + 4 * 60 * 60 * 1000 + row.proposedData.totalBreakMinutes * 60000),
                  durationMinutes: row.proposedData.totalBreakMinutes,
                  durationSeconds: row.proposedData.totalBreakMinutes * 60
                }
              });
            }

            await tx.auditLog.create({
              data: {
                userId: actorId,
                action: 'ATTENDANCE_BULK_CORRECT',
                entity: 'AttendanceRecord',
                entityId: existing.id,
                ip: reqMetadata?.ip || null,
                browser: reqMetadata?.userAgent || null
              }
            });

            await tx.attendanceCorrection.create({
              data: {
                employeeId: emp.id,
                attendanceRecordId: existing.id,
                date: normalizedDate,
                requestedCheckIn: punchInDate,
                requestedCheckOut: punchOutDate,
                correctionType: 'OTHER',
                reason: row.proposedData.remarks || `Bulk Attendance Correction (Row ${row.rowNumber})`,
                status: 'APPROVED',
                resolvedAt: new Date()
              }
            });

            outcomeStatus = 'UPDATED';
            outcomeRecordId = existing.id;
          } else {
            // Create brand new record
            const record = await tx.attendanceRecord.create({
              data: {
                employeeId: emp.id,
                date: normalizedDate,
                status: row.proposedData.status,
                grossHours: row.proposedData.grossHours,
                effectiveHours: row.proposedData.effectiveHours,
                shiftId: emp.shiftId || undefined,
                logs: punchInDate
                  ? {
                      create: [
                        {
                          punchIn: punchInDate,
                          punchOut: punchOutDate,
                          deviceName: 'Bulk Import'
                        }
                      ]
                    }
                  : undefined
              }
            });

            if (row.proposedData.totalBreakMinutes > 0 && punchInDate) {
              await tx.breakSession.create({
                data: {
                  attendanceId: record.id,
                  type: 'LUNCH',
                  breakStart: new Date(punchInDate.getTime() + 4 * 60 * 60 * 1000),
                  breakEnd: new Date(punchInDate.getTime() + 4 * 60 * 60 * 1000 + row.proposedData.totalBreakMinutes * 60000),
                  durationMinutes: row.proposedData.totalBreakMinutes,
                  durationSeconds: row.proposedData.totalBreakMinutes * 60
                }
              });
            }

            await tx.auditLog.create({
              data: {
                userId: actorId,
                action: 'ATTENDANCE_BULK_CREATE',
                entity: 'AttendanceRecord',
                entityId: record.id,
                ip: reqMetadata?.ip || null,
                browser: reqMetadata?.userAgent || null
              }
            });

            await tx.attendanceCorrection.create({
              data: {
                employeeId: emp.id,
                attendanceRecordId: record.id,
                date: normalizedDate,
                requestedCheckIn: punchInDate,
                requestedCheckOut: punchOutDate,
                correctionType: 'OTHER',
                reason: row.proposedData.remarks || `Bulk Attendance Import (Row ${row.rowNumber})`,
                status: 'APPROVED',
                resolvedAt: new Date()
              }
            });

            outcomeStatus = 'CREATED';
            outcomeRecordId = record.id;
          }
        }, { maxWait: 15000, timeout: 30000 });

        if (outcomeStatus === 'CREATED') {
          createdCount++;
          results.push({
            rowNumber: row.rowNumber,
            employeeId: row.employeeId,
            date: row.attendanceDate,
            recordId: outcomeRecordId,
            status: 'CREATED'
          });
          modifiedRecordIds.push({
            id: outcomeRecordId,
            companyId: outcomeCompanyId,
            action: 'BULK_IMPORT_CREATE'
          });
        } else if (outcomeStatus === 'UPDATED') {
          updatedCount++;
          results.push({
            rowNumber: row.rowNumber,
            employeeId: row.employeeId,
            date: row.attendanceDate,
            recordId: outcomeRecordId,
            status: 'UPDATED'
          });
          modifiedRecordIds.push({
            id: outcomeRecordId,
            companyId: outcomeCompanyId,
            action: 'BULK_IMPORT_CORRECT'
          });
        } else {
          skippedCount++;
          results.push({
            rowNumber: row.rowNumber,
            employeeId: row.employeeId,
            date: row.attendanceDate,
            recordId: outcomeRecordId,
            status: 'SKIPPED',
            message: 'Record already exists. Skipped in Create Only mode.'
          });
        }
      } catch (err: any) {
        failedCount++;
        results.push({
          rowNumber: row.rowNumber,
          employeeId: row.employeeId,
          date: row.attendanceDate,
          status: 'FAILED',
          message: err?.message || 'Database transaction error'
        });
      }
    }
  }

  // Enqueue durable Google Sheets Outbox events for all successfully modified records
  let googleSheetsSyncStatus: 'ENQUEUED' | 'SKIPPED' | 'FAILED' = 'ENQUEUED';
  try {
    const { GoogleSheetsService } = await import('../../services/googleSheets.service');
    for (const item of modifiedRecordIds) {
      await GoogleSheetsService.enqueueOutboxEvent(
        item.companyId || null,
        'ATTENDANCE',
        item.id,
        item.action
      );
    }
  } catch (sheetErr) {
    console.warn('[BulkImport] Warning: Google Sheets outbox enqueue caught exception:', sheetErr);
    googleSheetsSyncStatus = 'FAILED';
  }

  return {
    totalProcessed: results.length,
    createdCount,
    updatedCount,
    skippedCount,
    failedCount,
    results,
    googleSheetsSyncStatus
  };
}

/**
 * Generate validation error report or commit failure report (.xlsx)
 */
export async function generateErrorReportWorkbook(
  invalidRows: RowValidationResult[]
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Validation Errors');
  sheet.views = [{ showGridLines: true }];

  sheet.columns = [
    { header: 'Row #', key: 'rowNumber', width: 10 },
    { header: 'Employee ID', key: 'employeeId', width: 18 },
    { header: 'Employee Name', key: 'employeeName', width: 24 },
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Attendance Date', key: 'attendanceDate', width: 16 },
    { header: 'Status Action', key: 'action', width: 16 },
    { header: 'Validation Errors', key: 'errors', width: 48 },
    { header: 'Warnings', key: 'warnings', width: 36 }
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE11D48' } // Crimson Red
  };
  headerRow.height = 24;

  invalidRows.forEach(row => {
    sheet.addRow({
      rowNumber: row.rowNumber,
      employeeId: row.employeeId,
      employeeName: row.employeeName || 'Unknown',
      department: row.department || 'N/A',
      attendanceDate: row.attendanceDate,
      action: row.action,
      errors: row.errors.join('; '),
      warnings: row.warnings.join('; ')
    });
  });

  return workbook;
}
