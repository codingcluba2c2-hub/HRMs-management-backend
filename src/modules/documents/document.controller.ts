import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { ApiResponse } from '../../utils/ApiResponse';
import { upload } from '../../utils/upload';
import path from 'path';
import fs from 'fs';
import ImageKit from 'imagekit';
import { sendDocumentApprovalEmail } from '../../utils/mailer';
import jwt from 'jsonwebtoken';

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY!,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY!,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT!
});

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

const maskSensitiveData = (str: string | null | undefined): string | null => {
  if (!str) return null;
  if (str.length <= 4) return str;
  return 'XXXX XXXX ' + str.slice(-4);
};

export const uploadDocument = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const roleObj = (req as any).user.role;
    const roleName = typeof roleObj === 'string' ? roleObj : roleObj?.name;
    const normalizedRole = roleName?.toUpperCase().replace(' ', '_');

    let employeeIdToUse: string;

    const { documentType, documentNumber, remarks, employeeId: bodyEmployeeId, category, expiryDate } = req.body;

    if (bodyEmployeeId && (normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'HR_ADMIN')) {
      const targetEmployee = await prisma.employee.findUnique({ where: { id: bodyEmployeeId } });
      if (!targetEmployee) {
        return res.status(404).json(new ApiResponse(false, "Target employee profile not found"));
      }
      employeeIdToUse = targetEmployee.id;
    } else {
      const employee = await prisma.employee.findUnique({ where: { userId } });
      if (!employee) {
        return res.status(404).json(new ApiResponse(false, "Employee profile not found"));
      }
      employeeIdToUse = employee.id;
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json(new ApiResponse(false, "No file uploaded"));
    }
    
    if (!documentType) {
      return res.status(400).json(new ApiResponse(false, "Document type is required"));
    }

    // Upload to ImageKit
    const uploadResponse = await imagekit.upload({
      file: file.buffer, // memory storage buffer
      fileName: file.originalname,
      folder: '/hrms_documents',
      useUniqueFileName: true
    });

    const fileHash = uploadResponse.fileId;
    const existing = await prisma.employeeDocument.findUnique({ where: { fileHash } });
    if (existing) {
      await imagekit.deleteFile(fileHash);
      return res.status(409).json(new ApiResponse(false, "This exact document has already been uploaded"));
    }

    // Create via Prisma
    const document = await prisma.employeeDocument.create({
      data: {
        employeeId: employeeIdToUse,
        category: category || "IDENTITY",
        documentType,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        encryptedDocumentNumber: documentNumber || null,
        encryptedDocumentPath: uploadResponse.url,
        fileHash,
        mimeType: file.mimetype,
        size: file.size,
        remarks: remarks || null,
        verificationStatus: "PENDING",
        version: 1
      }
    });

    // Create DocumentAuditLog
    await prisma.documentAuditLog.create({
      data: {
        documentId: document.id,
        actorId: userId,
        action: "UPLOADED",
        ipAddress: req.ip || '',
        browser: req.headers['user-agent'] || '',
        device: 'Desktop' // Mock device
      }
    });

    // Global Audit Log
    await prisma.auditLog.create({
      data: {
        userId,
        action: "DOCUMENT_UPLOAD",
        entity: "EmployeeDocument",
        entityId: document.id,
        ip: req.ip || '',
        browser: req.headers['user-agent'] || ''
      }
    });

    // Mask for employee
    if (normalizedRole !== 'SUPER_ADMIN' && normalizedRole !== 'HR_ADMIN') {
      document.encryptedDocumentNumber = maskSensitiveData(document.encryptedDocumentNumber);
      document.encryptedDocumentPath = 'HIDDEN';
    }

    return res.status(201).json(new ApiResponse(true, "Document uploaded successfully", document));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getDocuments = async (req: Request, res: Response) => {
  try {
    let documents;

    const userId = (req as any).user.id;
    const roleObj = (req as any).user.role;
    const userRole = typeof roleObj === 'string' ? roleObj : roleObj?.name;
    const normalizedRole = userRole?.toUpperCase().replace(' ', '_');

    const { category, status, documentType } = req.query;
    
    const whereClause: any = {};
    if (category && category !== 'ALL') whereClause.category = category;
    if (status && status !== 'ALL') whereClause.verificationStatus = status;
    if (documentType && documentType !== 'ALL') whereClause.documentType = documentType;

    if (normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'HR_ADMIN') {
      documents = await prisma.employeeDocument.findMany({
        where: whereClause,
        include: { employee: true },
        orderBy: { createdAt: 'desc' }
      });
      documents = documents.map(doc => ({
        ...doc,
        documentNumber: doc.encryptedDocumentNumber,
        fileUrl: doc.encryptedDocumentPath
      }));
    } else {
      const employee = await prisma.employee.findUnique({ where: { userId } });
      if (!employee) {
        return res.status(200).json(new ApiResponse(true, "Success", []));
      }
      
      whereClause.employeeId = employee.id;
      
      documents = await prisma.employeeDocument.findMany({
        where: whereClause,
        include: { employee: true },
        orderBy: { createdAt: 'desc' }
      });

      // Mask sensitive data
      documents = documents.map(doc => ({
        ...doc,
        documentNumber: maskSensitiveData(doc.encryptedDocumentNumber),
        fileUrl: 'HIDDEN',
        encryptedDocumentNumber: maskSensitiveData(doc.encryptedDocumentNumber),
        encryptedDocumentPath: 'HIDDEN'
      }));
    }

    return res.status(200).json(new ApiResponse(true, "Success", documents));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getDocumentById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.id;
    const document = await prisma.employeeDocument.findUnique({ where: { id }, include: { employee: true } });
    if (!document) return res.status(404).json(new ApiResponse(false, "Document not found"));

    const roleObj = (req as any).user.role;
    const userRole = typeof roleObj === 'string' ? roleObj : roleObj?.name;
    const normalizedRole = userRole?.toUpperCase().replace(' ', '_');
    if (normalizedRole !== 'SUPER_ADMIN' && normalizedRole !== 'HR_ADMIN') {
      const employee = await prisma.employee.findUnique({ where: { userId } });
      if (document.employeeId !== employee?.id) {
        return res.status(403).json(new ApiResponse(false, "Unauthorized to view this document"));
      }
      // Masking
      document.encryptedDocumentNumber = maskSensitiveData(document.encryptedDocumentNumber);
      document.encryptedDocumentPath = 'HIDDEN';
    }

    // Audit Log View
    await prisma.auditLog.create({
      data: {
        userId,
        action: "DOCUMENT_VIEW",
        entity: "EmployeeDocument",
        entityId: document.id,
        ip: req.ip || '',
        browser: req.headers['user-agent'] || ''
      }
    });

    return res.status(200).json(new ApiResponse(true, "Success", document));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const approveDocument = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.id;
    
    const document = await prisma.employeeDocument.update({
      where: { id },
      data: {
        verificationStatus: "APPROVED",
        verifiedBy: userId,
        verifiedAt: new Date()
      },
      include: { employee: { include: { user: true } } }
    });

    const user = document.employee?.user;
    if (user && user.email) {
      const name = `${user.firstName} ${user.lastName}`;
      sendDocumentApprovalEmail(user.email, name, document.documentType, "APPROVED").catch(console.error);
    }

    await prisma.auditLog.create({
      data: {
        userId, action: "DOCUMENT_APPROVED", entity: "EmployeeDocument", entityId: id,
        ip: req.ip || '', browser: req.headers['user-agent'] || ''
      }
    });

    return res.status(200).json(new ApiResponse(true, "Document approved", document));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const rejectDocument = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { remarks } = req.body;
    const userId = (req as any).user.id;
    
    const document = await prisma.employeeDocument.update({
      where: { id },
      data: {
        verificationStatus: "REJECTED",
        verifiedBy: userId,
        verifiedAt: new Date(),
        remarks: remarks || "Rejected by HR"
      },
      include: { employee: { include: { user: true } } }
    });

    const user = document.employee?.user;
    if (user && user.email) {
      const name = `${user.firstName} ${user.lastName}`;
      sendDocumentApprovalEmail(user.email, name, document.documentType, "REJECTED").catch(console.error);
    }

    await prisma.auditLog.create({
      data: {
        userId, action: "DOCUMENT_REJECTED", entity: "EmployeeDocument", entityId: id,
        ip: req.ip || '', browser: req.headers['user-agent'] || ''
      }
    });

    return res.status(200).json(new ApiResponse(true, "Document rejected", document));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const generateDownloadUrl = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.id;
    const document = await prisma.employeeDocument.findUnique({ where: { id } });
    if (!document) return res.status(404).json(new ApiResponse(false, "Document not found"));

    const roleObj = (req as any).user.role;
    const userRole = typeof roleObj === 'string' ? roleObj : roleObj?.name;
    const normalizedRole = userRole?.toUpperCase().replace(' ', '_');
    if (normalizedRole !== 'SUPER_ADMIN' && normalizedRole !== 'HR_ADMIN') {
      const employee = await prisma.employee.findUnique({ where: { userId } });
      if (document.employeeId !== employee?.id) {
        return res.status(403).json(new ApiResponse(false, "Unauthorized"));
      }
    }

    // Just return the Cloudinary URL directly instead of going through preview endpoint
    const downloadUrl = document.encryptedDocumentPath;

    await prisma.auditLog.create({
      data: {
        userId, action: "DOWNLOAD_URL_GENERATED", entity: "EmployeeDocument", entityId: id,
        ip: req.ip || '', browser: req.headers['user-agent'] || ''
      }
    });

    return res.status(200).json(new ApiResponse(true, "Success", { downloadUrl }));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const previewDocument = async (req: Request, res: Response) => {
  // Since we now return the Cloudinary URL directly, this endpoint might not be used.
  // However, keeping it as a fallback redirect if old links exist.
  try {
    const { token } = req.params;
    if (!token) return res.status(400).send("Invalid request");

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const filePath = decoded.path;
    
    // Redirect to the Cloudinary URL
    return res.redirect(filePath);
  } catch (error: any) {
    return res.status(403).send("Link expired or invalid");
  }
};

export const deleteDocument = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const document = await prisma.employeeDocument.findUnique({ where: { id } });
    if (!document) return res.status(404).json(new ApiResponse(false, "Document not found"));

    const roleObj = (req as any).user.role;
    const userRole = typeof roleObj === 'string' ? roleObj : roleObj?.name;
    const normalizedRole = userRole?.toUpperCase().replace(' ', '_');
    if (normalizedRole !== 'SUPER_ADMIN' && normalizedRole !== 'HR_ADMIN') {
      const employee = await prisma.employee.findUnique({ where: { userId } });
      if (document.employeeId !== employee?.id) {
        return res.status(403).json(new ApiResponse(false, "Unauthorized"));
      }
    }

    // Destroy the asset from ImageKit
    // fileHash holds the fileId because we saved uploadResponse.fileId to fileHash during upload
    if (document.fileHash) {
      await imagekit.deleteFile(document.fileHash);
    }

    await prisma.employeeDocument.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        userId, action: "DOCUMENT_DELETED", entity: "EmployeeDocument", entityId: id,
        ip: req.ip || '', browser: req.headers['user-agent'] || ''
      }
    });

    return res.status(200).json(new ApiResponse(true, "Document deleted successfully"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getDocumentTypes = async (req: Request, res: Response) => {
  try {
    let types = await prisma.documentType.findMany({ orderBy: { name: 'asc' } });
    
    // Auto-seed predefined types if empty
    if (types.length === 0) {
      const defaultTypes = [
        "Aadhaar Card", "PAN Card", "Passport", "Driving License", 
        "10th Marksheet", "12th Marksheet", "Degree Certificate"
      ];
      await prisma.documentType.createMany({
        data: defaultTypes.map(name => ({ name })),
        skipDuplicates: true
      });
      types = await prisma.documentType.findMany({ orderBy: { name: 'asc' } });
    }
    
    return res.status(200).json(new ApiResponse(true, "Success", types));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const createDocumentType = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json(new ApiResponse(false, "Name is required"));
    
    const existing = await prisma.documentType.findUnique({ where: { name } });
    if (existing) return res.status(400).json(new ApiResponse(false, "Document type already exists"));

    const newType = await prisma.documentType.create({ data: { name } });
    return res.status(201).json(new ApiResponse(true, "Document type created", newType));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getDocumentSummary = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const roleObj = (req as any).user.role;
    const userRole = typeof roleObj === 'string' ? roleObj : roleObj?.name;
    const normalizedRole = userRole?.toUpperCase().replace(' ', '_');

    let whereClause: any = {};

    if (normalizedRole !== 'SUPER_ADMIN' && normalizedRole !== 'HR_ADMIN') {
      const employee = await prisma.employee.findUnique({ where: { userId } });
      if (!employee) {
        const categories = ['IDENTITY', 'EMPLOYMENT', 'PAYROLL', 'BANK', 'EDUCATION', 'COMPLIANCE', 'MEDICAL'];
        return res.status(200).json(new ApiResponse(true, "Success", {
          metrics: { total: 0, verified: 0, pending: 0, expiring: 0, storageFormatted: '0.00 MB', lastUpload: null },
          categoryMetrics: categories.map(cat => ({ category: cat, count: 0, completion: 0 })),
          storage: { usedGB: 0, totalGB: 5 },
          expiringDocs: []
        }));
      }
      whereClause.employeeId = employee.id;
    }

    const allDocs = await prisma.employeeDocument.findMany({ where: whereClause, orderBy: { createdAt: 'desc' } });

    const total = allDocs.length;
    const verified = allDocs.filter(d => d.verificationStatus === 'VERIFIED').length;
    const pending = allDocs.filter(d => d.verificationStatus === 'PENDING').length;
    const expiringSoon = allDocs.filter(d => {
      if (!d.expiryDate) return false;
      const diff = new Date(d.expiryDate).getTime() - new Date().getTime();
      return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000;
    });

    const totalSize = allDocs.reduce((acc, curr) => acc + curr.size, 0);
    const storageFormatted = (totalSize / (1024 * 1024)).toFixed(2) + ' MB';

    // Categories
    const categories = ['IDENTITY', 'EMPLOYMENT', 'PAYROLL', 'BANK', 'EDUCATION', 'COMPLIANCE', 'MEDICAL'];
    const categoryMetrics = categories.map(cat => {
      const catDocs = allDocs.filter(d => d.category === cat);
      // Mock completion logic: assume 2 docs per category for 100%
      const completion = Math.min(100, Math.round((catDocs.length / 2) * 100));
      return { category: cat, count: catDocs.length, completion };
    });

    return res.status(200).json(new ApiResponse(true, "Success", {
      metrics: {
        total,
        verified,
        pending,
        expiring: expiringSoon.length,
        storageFormatted,
        lastUpload: allDocs.length > 0 ? allDocs[0].createdAt : null
      },
      categoryMetrics,
      storage: {
        usedGB: totalSize / (1024 * 1024 * 1024),
        totalGB: 5
      },
      expiringDocs: expiringSoon.slice(0, 5)
    }));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};
