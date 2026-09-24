import { PrismaClient } from '@prisma/client';
import { withEncryption } from '../utils/prismaMiddleware';

// Function to create a new connection to the database (Prisma Client)
const prismaClientSingleton = () => {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'stdout', level: 'warn' },
      ...(process.env.NODE_ENV === 'development' ? [{ emit: 'stdout', level: 'query' } as any] : [])
    ],
  });

  // Filter out harmless Neon database idle disconnect logs
  (client as any).$on('error', (e: any) => {
    if (e.message && e.message.includes('kind: Closed, cause: None')) {
      return; // Ignore
    }
    console.error(`prisma:error ${e.message}`);
  });

  // Wrap the database connection with our encryption logic so secure fields are automatically encrypted/decrypted
  return withEncryption(client);
};

// Define the type for our database connection
type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

// Create a global space to store the database connection so we don't open too many connections during development
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

// Export the database connection. If one already exists globally, use it. Otherwise, create a new one.
export const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

// If we are not in production (e.g. running locally), save this connection globally to reuse it across hot-reloads
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
