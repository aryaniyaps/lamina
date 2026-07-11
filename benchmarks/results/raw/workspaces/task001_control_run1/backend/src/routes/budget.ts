import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireRole } from '../middleware';

const router = Router();

// Create income source
router.post('/:budgetId/income', requireRole(['OWNER', 'PARTNER']), async (req: Request, res: Response) => {
  const { budgetId } = req.params;
  const { name, amountCents, frequency, startDate, endDate } = req.body;
  const income = await prisma.incomeSource.create({
    data: {
      budgetId,
      name,
      amountCents,
      frequency,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : undefined,
    },
  });
  res.json(income);
});

// Create category
router.post('/:budgetId/categories', requireRole(['OWNER', 'PARTNER']), async (req: Request, res: Response) => {
  const { budgetId } = req.params;
  const { name, type, allocationCents, privacyLevel } = req.body;
  const cat = await prisma.category.create({
    data: {
      budgetId,
      name,
      type,
      allocationCents: allocationCents ?? 0,
      privacyLevel: privacyLevel ?? 'SHARED',
    },
  });
  res.json(cat);
});

// List categories (privacy applied)
router.get('/:budgetId/categories', requireRole(['OWNER', 'PARTNER']), async (req: Request, res: Response) => {
  const { budgetId } = req.params;
  const membership = (req as any).membership;
  const categories = await prisma.category.findMany({
    where: { budgetId },
  });
  // Filter personal categories for partner view
  const filtered = categories.filter(cat => {
    if (cat.privacyLevel === 'PERSONAL' && membership.role !== 'OWNER') {
      // hide details, only show placeholder
      return false;
    }
    return true;
  });
  res.json(filtered);
});

export default router;
