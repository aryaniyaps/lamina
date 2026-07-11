import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
    householdId?: string;
  };
}

export const authenticateJwt = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.user = {
      id: user.id,
      role: user.role,
      householdId: user.householdId ?? undefined,
    };
    next();
  } catch (err) {
    console.error('JWT auth error', err);
    return res.status(401).json({ error: 'Invalid token' });
  }
};
