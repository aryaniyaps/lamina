import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireRole } from '../middleware';

const router = Router();

// Summary for weekly review – categories with allocation and spent amount
router.get('/:budgetId/summary', requireRole(['OWNER', 'PARTNER']), async (req: Request, res: Response) => {
  const { budgetId } = req.params;
  const categories = await prisma.category.findMany({ where: { budgetId } });
  const spentByCat = await prisma.transaction.groupBy({
    by: ['categoryId'],
    where: { category: { budgetId } },
    _sum: { amountCents: true },
  });
  const summary = categories.map(cat => {
    const spent = spentByCat.find(s => s.categoryId === cat.id)?._sum.amountCents || 0;
    return {
      categoryId: cat.id,
      name: cat.name,
      allocationCents: cat.allocationCents,
      spentCents: spent,
      privacyLevel: cat.privacyLevel,
    };
  });
  res.json({ summary });
});

// Resolve a transaction during review (categorize or exclude)
router.post('/:budgetId/resolve-transaction', requireRole(['OWNER', 'PARTNER']), async (req: Request, res: Response) => {
  const { transactionId, categoryId, exclude } = req.body;
  const update: any = {};
  if (categoryId) update.categoryId = categoryId;
  if (exclude) update.status = 'EXCLUDED';
  const txn = await prisma.transaction.update({ where: { id: transactionId }, data: update });
  res.json(txn);
});

export default router;
