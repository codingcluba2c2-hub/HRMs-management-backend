import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const ALGORITHM = process.env.AES_ALGORITHM || 'aes-256-gcm';
const SECRET_KEY = process.env.AES_SECRET_KEY;
const VERSION = process.env.AES_VERSION || 'v1';

if (!SECRET_KEY || SECRET_KEY.length !== 32) {
  console.error("CRITICAL ERROR: AES_SECRET_KEY must be exactly 32 characters long.");
  process.exit(1);
}

export const generateIV = () => crypto.randomBytes(12); // GCM standard is 12 bytes

export const encrypt = (text: string): string => {
  if (!text) return text;
  const iv = generateIV();
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(SECRET_KEY), iv) as crypto.CipherGCM;
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  // Format: version:iv:authTag:encryptedText
  return `${VERSION}:${iv.toString('hex')}:${authTag}:${encrypted}`;
};

export const decrypt = (encryptedData: string): string => {
  if (!encryptedData || !encryptedData.includes(':')) return encryptedData;

  const parts = encryptedData.split(':');
  if (parts.length !== 4) return encryptedData;

  const [version, ivHex, authTagHex, encryptedText] = parts;
  
  // Backward compatibility / Key rotation can be handled via version check
  if (version !== VERSION) {
    console.warn(`Decrypting data from older version: ${version}`);
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(SECRET_KEY), Buffer.from(ivHex, 'hex')) as crypto.DecipherGCM;
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error("Decryption failed:", error);
    return "DECRYPTION_FAILED"; // Do not crash the app, but signal failure
  }
};

export const encryptObject = (obj: any): any => {
  if (!obj || typeof obj !== 'object') return obj;
  const encryptedObj: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      encryptedObj[key] = encrypt(value);
    } else {
      encryptedObj[key] = value;
    }
  }
  return encryptedObj;
};

export const decryptObject = (obj: any): any => {
  if (!obj || typeof obj !== 'object') return obj;
  const decryptedObj: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && value.includes(':')) {
      decryptedObj[key] = decrypt(value);
    } else {
      decryptedObj[key] = value;
    }
  }
  return decryptedObj;
};
