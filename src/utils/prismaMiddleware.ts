import { encrypt, decrypt } from './encryption';
import { PrismaClient } from '@prisma/client';

export const withEncryption = (prisma: PrismaClient) => {
  return prisma.$extends({
    query: {
      employeeDocument: {
        async create({ args, query }) {
          if (args.data.encryptedDocumentNumber) {
            args.data.encryptedDocumentNumber = encrypt(args.data.encryptedDocumentNumber);
          }
          if (args.data.encryptedDocumentPath) {
            args.data.encryptedDocumentPath = encrypt(args.data.encryptedDocumentPath);
          }
          const result = await query(args);
          return decryptDocument(result);
        },
        async update({ args, query }) {
          if (args.data.encryptedDocumentNumber && typeof args.data.encryptedDocumentNumber === 'string') {
            args.data.encryptedDocumentNumber = encrypt(args.data.encryptedDocumentNumber);
          }
          if (args.data.encryptedDocumentPath && typeof args.data.encryptedDocumentPath === 'string') {
            args.data.encryptedDocumentPath = encrypt(args.data.encryptedDocumentPath);
          }
          const result = await query(args);
          return decryptDocument(result);
        },
        async upsert({ args, query }) {
          if (args.create.encryptedDocumentNumber) {
            args.create.encryptedDocumentNumber = encrypt(args.create.encryptedDocumentNumber);
          }
          if (args.create.encryptedDocumentPath) {
            args.create.encryptedDocumentPath = encrypt(args.create.encryptedDocumentPath);
          }
          if (args.update.encryptedDocumentNumber && typeof args.update.encryptedDocumentNumber === 'string') {
            args.update.encryptedDocumentNumber = encrypt(args.update.encryptedDocumentNumber);
          }
          if (args.update.encryptedDocumentPath && typeof args.update.encryptedDocumentPath === 'string') {
            args.update.encryptedDocumentPath = encrypt(args.update.encryptedDocumentPath);
          }
          const result = await query(args);
          return decryptDocument(result);
        },
        async findUnique({ args, query }) {
          const result = await query(args);
          return decryptDocument(result);
        },
        async findFirst({ args, query }) {
          const result = await query(args);
          return decryptDocument(result);
        },
        async findMany({ args, query }) {
          const results = await query(args);
          if (Array.isArray(results)) {
            return results.map(decryptDocument);
          }
          return results;
        }
      }
    }
  });
};

function decryptDocument(doc: any) {
  if (!doc) return doc;
  
  if (doc.encryptedDocumentNumber) {
    doc.encryptedDocumentNumber = decrypt(doc.encryptedDocumentNumber);
  }
  if (doc.encryptedDocumentPath) {
    doc.encryptedDocumentPath = decrypt(doc.encryptedDocumentPath);
  }
  
  return doc;
}
