import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { authorize } from '../permissions';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// Create category – primary_budgeter can create shared, partners can create personal (isShared false)
router.post('/', authorize('category', 'create'), async (req: AuthRequest, res: Response) => {
  const { householdId, name, isShared, budgetedAmount } = req.body;
  if (!householdId || !name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const user = req.user!;
  // Partners cannot create shared categories
  if (user.role === 'partner' && isShared) {
    return res.status(403).json({ error: 'Partners may only create personal categories' });
  }
  const category = await prisma.category.create({
    data: {
      householdId,
      name,
      isShared: isShared ?? true,
      budgetedAmount: budgetedAmount ?? 0,
    },
  });
  res.status(201).json(category);
});

// List categories – primary_budgeter sees all, partner sees shared + their personal
router.get('/', authorize('category', 'read'), async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const householdId = user.householdId!;
  const where: any = { householdId };
  if (user.role === 'partner') {
    where.OR = [{ isShared: true }]; // personal categories are not visible to partners
  }
  const categories = await prisma.category.findMany({ where });
  res.json(categories);
});

// Update category – partners can only update their own personal categories
router.patch('/:id', authorize('category', 'update'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { name, isShared, budgetedAmount } = req.body;
  const user = req.user!;
  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) return res.status(404).json({ error: 'Category not found' });
  if (category.householdId !== user.householdId) {
    return res.status(403).json({ error: 'Category not in your household' });
  }
  if (user.role === 'partner' && category.isShared) {
    return res.status(403).json({ error: 'Partners cannot modify shared categories' });
  }
  const updated = await prisma.category.update({
    where: { id },
    data: {
      name: name ?? undefined,
      isShared: isShared !== undefined ? !!isShared : undefined,
      budgetedAmount: budgetedAmount !== undefined ? Number(budgetedAmount) : undefined,
    },
  });
  res.json(updated);
});

export default router;
