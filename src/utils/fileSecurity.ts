import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

export interface FileValidationResult {
  isValid: boolean;
  error?: string;
  detectedMime?: string;
  safeFileName?: string;
}

/**
 * Validates file buffer by inspecting magic bytes/signatures.
 * Supports PDF, DOCX, and legacy DOC formats.
 */
export function validateResumeBuffer(buffer: Buffer, originalName: string): FileValidationResult {
  if (!buffer || buffer.length === 0) {
    return { isValid: false, error: 'Uploaded file is empty.' };
  }

  // Maximum size: 5 MB
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  if (buffer.length > MAX_FILE_SIZE) {
    return { isValid: false, error: 'File size exceeds maximum allowed limit of 5MB.' };
  }

  const ext = path.extname(originalName).toLowerCase();
  const allowedExtensions = ['.pdf', '.docx', '.doc'];
  if (!allowedExtensions.includes(ext)) {
    return { isValid: false, error: 'Unsupported file type. Only PDF and DOCX files are allowed.' };
  }

  // Magic bytes check
  // PDF: %PDF- (0x25 0x50 0x44 0x46)
  const isPdf = buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46;

  // DOCX (ZIP archive): PK\x03\x04 (0x50 0x4B 0x03 0x04)
  const isDocx = buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4B &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;

  // Legacy DOC (CFBF compound file): 0xD0 0xCF 0x11 0xE0
  const isDoc = buffer.length >= 4 &&
    buffer[0] === 0xD0 &&
    buffer[1] === 0xCF &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xE0;

  if (ext === '.pdf' && !isPdf) {
    return { isValid: false, error: 'File content does not match a valid PDF document.' };
  }

  if (ext === '.docx' && !isDocx) {
    return { isValid: false, error: 'File content does not match a valid DOCX document.' };
  }

  if (ext === '.doc' && !isDoc && !isDocx) {
    return { isValid: false, error: 'File content does not match a valid DOC document.' };
  }

  const randomSuffix = crypto.randomBytes(8).toString('hex');
  const sanitizedBase = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
  const safeFileName = `resume_${sanitizedBase}_${Date.now()}_${randomSuffix}${ext}`;

  return {
    isValid: true,
    detectedMime: isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    safeFileName
  };
}

/**
 * Saves resume to private local folder as backup/fallback if ImageKit is not configured.
 */
export async function saveResumeLocally(buffer: Buffer, safeFileName: string): Promise<string> {
  const uploadDir = path.join(process.cwd(), 'uploads', 'resumes');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const fullPath = path.join(uploadDir, safeFileName);
  await fs.promises.writeFile(fullPath, buffer);
  return `/uploads/resumes/${safeFileName}`;
}
