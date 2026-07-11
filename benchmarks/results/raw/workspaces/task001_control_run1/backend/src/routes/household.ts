import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireRole } from '../middleware';

const router = Router();

// Get household details (including active budget)
router.get('/:id', requireRole(['OWNER', 'PARTNER', 'VIEWER']), async (req: Request, res: Response) => {
  const { id } = req.params;
  const household = await prisma.household.findUnique({
    where: { id },
    include: { budgets: { where: { status: 'ACTIVE' }, take: 1 } },
  });
  if (!household) return res.status(404).json({ error: 'Household not found' });
  res.json(household);
});

export default router;
