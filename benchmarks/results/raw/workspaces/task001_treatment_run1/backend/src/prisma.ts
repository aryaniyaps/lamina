import { PrismaClient } from '@prisma/client';

// Export a single PrismaClient instance for the whole app
export const prisma = new PrismaClient();
