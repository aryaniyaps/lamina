import { PrismaClient } from '@prisma/client';

// Singleton Prisma client to avoid too many connections during hot reloads
let prisma: PrismaClient;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  // In development we reuse the client across module reloads
  if (!(global as any).prisma) {
    (global as any).prisma = new PrismaClient();
  }
  prisma = (global as any).prisma;
}

export default prisma;
