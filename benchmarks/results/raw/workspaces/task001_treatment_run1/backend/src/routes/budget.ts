import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { authorize } from '../permissions';

const router = Router();

// Create a new budget – enforce single active budget per household
router.post('/', authorize('budget', 'create'), async (req: Request, res: Response) => {
  const { householdId, periodStart, periodEnd, totalIncome, totalExpense, active } = req.body;
  if (!householdId || !periodStart || !periodEnd) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  // If active, deactivate any existing active budget first
  if (active) {
    await prisma.budget.updateMany({
      where: { householdId, active: true },
      data: { active: false },
    });
  }
  const budget = await prisma.budget.create({
    data: {
      householdId,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      totalIncome: totalIncome ?? 0,
      totalExpense: totalExpense ?? 0,
      active: active ?? true,
    },
  });
  res.status(201).json(budget);
});

// Weekly review – aggregate transactions for the active budget
router.get('/:id/weekly-review', authorize('budget', 'read'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const budget = await prisma.budget.findUnique({ where: { id } });
  if (!budget) return res.status(404).json({ error: 'Budget not found' });
  const start = new Date();
  start.setDate(start.getDate() - 7);
  const transactions = await prisma.transaction.findMany({
    where: {
      account: { householdId: budget.householdId },
      date: { gte: start, lte: new Date() },
    },
    include: { category: true },
  });
  const summary = transactions.reduce(
    (acc, tx) => {
      acc.total += Number(tx.amount);
      if (tx.category) {
        const catName = tx.category.name;
        acc.byCategory[catName] = (acc.byCategory[catName] || 0) + Number(tx.amount);
      }
      return acc;
    },
    { total: 0, byCategory: {} as Record<string, number> },
  );
  res.json({ budget, summary });
});

export default router;
