import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from './prisma';

interface AuthPayload { userId: string; }

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload;
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) throw new Error('User not found');
    (req as any).user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const requireRole = (allowed: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as any;
    const membership = await prisma.householdMembership.findFirst({
      where: { userId: user.id, status: 'ACTIVE' },
    });
    if (!membership || !allowed.includes(membership.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    (req as any).membership = membership;
    next();
  };
};
