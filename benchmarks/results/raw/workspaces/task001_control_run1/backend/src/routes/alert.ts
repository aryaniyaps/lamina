import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireRole } from '../middleware';

const router = Router();

// List alerts for current user (unread only by default)
router.get('/', requireRole(['OWNER', 'PARTNER', 'VIEWER']), async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { status } = req.query as any;
  const where: any = { userId };
  if (status) where.status = status;
  const alerts = await prisma.alert.findMany({ where, orderBy: { createdAt: 'desc' } });
  res.json(alerts);
});

// Dismiss an alert (mark as DISMISSED)
router.patch('/:id/dismiss', requireRole(['OWNER', 'PARTNER', 'VIEWER']), async (req: Request, res: Response) => {
  const { id } = req.params;
  const alert = await prisma.alert.update({ where: { id }, data: { status: 'DISMISSED' } });
  res.json(alert);
});

export default router;
