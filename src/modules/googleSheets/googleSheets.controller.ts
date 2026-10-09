import { Response } from 'express';
import { AuthRequest } from '../../middlewares/authMiddleware';
import { GoogleSheetsService } from '../../services/googleSheets.service';
import { prisma } from '../../lib/prisma';

export class GoogleSheetsController {
  /**
   * GET /api/google-sheets/status
   */
  public static async getStatus(req: AuthRequest, res: Response) {
    try {
      const companyId = req.user?.companyId || undefined;
      const status = await GoogleSheetsService.getIntegrationStatus(companyId);
      return res.status(200).json({
        success: true,
        data: status
      });
    } catch (error: any) {
      const errorMsg = GoogleSheetsService.sanitizeError(error);
      return res.status(500).json({
        success: false,
        message: errorMsg
      });
    }
  }

  /**
   * POST /api/google-sheets/config
   */
  public static async updateConfig(req: AuthRequest, res: Response) {
    try {
      const { spreadsheetId, isEnabled, autoSyncEnabled } = req.body;
      const companyId = req.user?.companyId || null;

      if (spreadsheetId && typeof spreadsheetId !== 'string') {
        return res.status(400).json({ success: false, message: 'Invalid spreadsheet ID provided' });
      }

      const config = await prisma.googleSheetsConfig.upsert({
        where: { companyId: companyId || 'GLOBAL' },
        create: {
          companyId,
          spreadsheetId: spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID || '',
          serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'hrms-sheet@hrms-management-500604.iam.gserviceaccount.com',
          isEnabled: isEnabled ?? true,
          autoSyncEnabled: autoSyncEnabled ?? true
        },
        update: {
          ...(spreadsheetId !== undefined ? { spreadsheetId } : {}),
          ...(isEnabled !== undefined ? { isEnabled } : {}),
          ...(autoSyncEnabled !== undefined ? { autoSyncEnabled } : {})
        }
      });

      return res.status(200).json({
        success: true,
        message: 'Google Sheets configuration updated successfully.',
        data: config
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: GoogleSheetsService.sanitizeError(error)
      });
    }
  }

  /**
   * POST /api/google-sheets/test-connection
   */
  public static async testConnection(req: AuthRequest, res: Response) {
    try {
      const companyId = req.user?.companyId || undefined;
      const result = await GoogleSheetsService.testConnection(companyId);

      if (!result.success) {
        return res.status(400).json(result);
      }

      return res.status(200).json(result);
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: GoogleSheetsService.sanitizeError(error)
      });
    }
  }

  /**
   * POST /api/google-sheets/initialize
   */
  public static async initialize(req: AuthRequest, res: Response) {
    try {
      const companyId = req.user?.companyId || undefined;
      const result = await GoogleSheetsService.initializeWorksheets(companyId);
      return res.status(200).json(result);
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: GoogleSheetsService.sanitizeError(error)
      });
    }
  }

  /**
   * POST /api/google-sheets/sync-now
   */
  public static async syncNow(req: AuthRequest, res: Response) {
    try {
      const companyId = req.user?.companyId || undefined;
      const result = await GoogleSheetsService.runFullSync(companyId, 'MANUAL');
      return res.status(200).json({
        success: result.success,
        message: `Synchronization complete. ${result.totalInserted} inserted, ${result.totalUpdated} updated, ${result.totalFailed} failed.`,
        data: result
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: GoogleSheetsService.sanitizeError(error)
      });
    }
  }

  /**
   * POST /api/google-sheets/retry-failed
   */
  public static async retryFailed(req: AuthRequest, res: Response) {
    try {
      const companyId = req.user?.companyId || undefined;
      await GoogleSheetsService.processOutboxQueue();
      const result = await GoogleSheetsService.runFullSync(companyId, 'RETRY');

      return res.status(200).json({
        success: result.success,
        message: `Retry completed. Total updated: ${result.totalUpdated}, Total inserted: ${result.totalInserted}`,
        data: result
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: GoogleSheetsService.sanitizeError(error)
      });
    }
  }
}
