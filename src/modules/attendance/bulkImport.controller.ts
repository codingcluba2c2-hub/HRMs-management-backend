import { Request, Response } from 'express';
import path from 'path';
import multer from 'multer';
import { ApiResponse } from '../../utils/ApiResponse';
import { normalizeRole, CANONICAL_ROLES } from '../../utils/roleConstants';
import {
  generateTemplateWorkbook,
  parseBufferToRawRows,
  validateImportRows,
  commitBulkImport,
  generateErrorReportWorkbook,
  ImportMode,
  RowValidationResult
} from './bulkImport.service';

// Memory upload middleware for .xlsx and .csv spreadsheets
export const spreadsheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();
    if (
      ext === '.xlsx' ||
      ext === '.csv' ||
      mime.includes('spreadsheet') ||
      mime.includes('excel') ||
      mime.includes('csv')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel (.xlsx) and CSV (.csv) spreadsheets are permitted.'));
    }
  }
}).single('file');

/**
 * Check if the requesting user has administrative bulk attendance permissions
 */
function assertAuthorizedUser(req: Request): boolean {
  const user = (req as any).user;
  if (!user) return false;
  const role = normalizeRole(typeof user.role === 'string' ? user.role : user.role?.name);
  return role === CANONICAL_ROLES.SUPER_ADMIN || role === CANONICAL_ROLES.HR_ADMIN || role === CANONICAL_ROLES.MANAGER;
}

/**
 * GET /api/attendance/bulk-import/template
 * Download standardized enterprise Excel template (.xlsx)
 */
export const downloadTemplate = async (req: Request, res: Response) => {
  try {
    if (!assertAuthorizedUser(req)) {
      return res.status(403).json(new ApiResponse(false, 'Forbidden: You do not have permissions to access bulk import tools.'));
    }

    const workbook = await generateTemplateWorkbook();
    const filename = `HRMS_Bulk_Attendance_Template_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    console.error('[BulkImport] Error generating template:', error);
    return res.status(500).json(new ApiResponse(false, error.message || 'Failed to generate attendance template.'));
  }
};

/**
 * POST /api/attendance/bulk-import/preview
 * Parse uploaded .xlsx or .csv and return comprehensive preview with validation diagnostics
 * NO DATABASE MUTATIONS OR GOOGLE SHEETS CALLS ARE PERFORMED HERE
 */
export const previewBulkImport = async (req: Request, res: Response) => {
  try {
    if (!assertAuthorizedUser(req)) {
      return res.status(403).json(new ApiResponse(false, 'Forbidden: Insufficient privileges for bulk attendance operations.'));
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json(new ApiResponse(false, 'No spreadsheet file provided. Please upload a .xlsx or .csv file.'));
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const isCsv = ext === '.csv' || req.file.mimetype.includes('csv');
    const mode = (req.body.mode as ImportMode) || 'MIXED';

    const rawRows = await parseBufferToRawRows(req.file.buffer, isCsv);

    if (rawRows.length === 0) {
      return res.status(400).json(new ApiResponse(false, 'The uploaded spreadsheet contains no attendance data rows.'));
    }

    if (rawRows.length > 5000) {
      return res.status(400).json(new ApiResponse(false, `The file contains ${rawRows.length} rows, which exceeds the maximum limit of 5,000 rows per batch.`));
    }

    const preview = await validateImportRows(rawRows, (req as any).user, mode);

    return res.status(200).json(new ApiResponse(true, 'Spreadsheet preview and validation completed.', preview));
  } catch (error: any) {
    console.error('[BulkImport] Preview error:', error);
    return res.status(500).json(new ApiResponse(false, error.message || 'Failed to parse and validate spreadsheet.'));
  }
};

/**
 * POST /api/attendance/bulk-import/confirm
 * Execute atomic/bounded commit for pre-validated rows
 * Enqueues Google Sheets sync outbox events and records audit history
 */
export const confirmBulkImport = async (req: Request, res: Response) => {
  try {
    if (!assertAuthorizedUser(req)) {
      return res.status(403).json(new ApiResponse(false, 'Forbidden: Insufficient privileges to commit attendance changes.'));
    }

    const { rows, mode = 'MIXED' } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json(new ApiResponse(false, 'No valid rows provided for commit.'));
    }

    const result = await commitBulkImport(
      rows as RowValidationResult[],
      (req as any).user,
      mode as ImportMode,
      {
        ip: req.ip || undefined,
        userAgent: req.headers['user-agent'] || undefined
      }
    );

    return res.status(200).json(new ApiResponse(true, 'Attendance records committed successfully.', result));
  } catch (error: any) {
    console.error('[BulkImport] Confirm error:', error);
    return res.status(500).json(new ApiResponse(false, error.message || 'Failed to commit attendance records.'));
  }
};

/**
 * POST /api/attendance/bulk-import/export-report
 * Download Excel report of invalid rows with detailed diagnostic error messages
 */
export const exportErrorReport = async (req: Request, res: Response) => {
  try {
    if (!assertAuthorizedUser(req)) {
      return res.status(403).json(new ApiResponse(false, 'Forbidden: Insufficient privileges.'));
    }

    const { invalidRows } = req.body;

    if (!Array.isArray(invalidRows) || invalidRows.length === 0) {
      return res.status(400).json(new ApiResponse(false, 'No invalid rows provided to export.'));
    }

    const workbook = await generateErrorReportWorkbook(invalidRows);
    const filename = `HRMS_Attendance_Error_Report_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    console.error('[BulkImport] Export error report error:', error);
    return res.status(500).json(new ApiResponse(false, error.message || 'Failed to export error report.'));
  }
};
