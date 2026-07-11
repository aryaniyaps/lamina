import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireRole } from '../middleware';
import { generateDuplicateHash } from '../utils/duplicate';

const router = Router();

// Create a manual transaction (e.g., cash entry)
router.post('/', requireRole(['OWNER', 'PARTNER']), async (req: Request, res: Response) => {
  const { accountId, amountCents, postedAt, description, merchantName, categoryId } = req.body;
  const dupHash = generateDuplicateHash(amountCents, new Date(postedAt), merchantName);
  const txn = await prisma.transaction.create({
    data: {
      accountId,
      amountCents,
      postedAt: new Date(postedAt),
      description,
      merchantName,
      categoryId,
      duplicateHash: dupHash,
    },
  });
  res.json(txn);
});

// List transactions for an account (with optional filters)
router.get('/account/:accountId', requireRole(['OWNER', 'PARTNER', 'VIEWER']), async (req: Request, res: Response) => {
  const { accountId } = req.params;
  const { status, categoryId } = req.query as any;
  const where: any = { accountId };
  if (status) where.status = status;
  if (categoryId) where.categoryId = categoryId;
  const txns = await prisma.transaction.findMany({ where });
  res.json(txns);
});

// Update transaction: categorize, exclude, split (simple split creates child rows)
router.patch('/:id', requireRole(['OWNER', 'PARTNER']), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { categoryId, exclude, split } = req.body;
  if (split && Array.isArray(split)) {
    // split is array of { amountCents, categoryId }
    const original = await prisma.transaction.findUnique({ where: { id } });
    if (!original) return res.status(404).json({ error: 'Transaction not found' });
    // mark original as excluded to avoid double-counting
    await prisma.transaction.update({ where: { id }, data: { status: 'EXCLUDED' } });
    const created = await Promise.all(
      split.map((part: any) =>
        prisma.transaction.create({
          data: {
            accountId: original.accountId,
            amountCents: part.amountCents,
            postedAt: original.postedAt,
            description: original.description,
            merchantName: original.merchantName,
            categoryId: part.categoryId,
            status: 'POSTED',
            duplicateHash: original.duplicateHash,
          },
        })
      )
    );
    return res.json({ originalExcluded: true, splitCreated: created });
  }
  const update: any = {};
  if (categoryId) update.categoryId = categoryId;
  if (exclude) update.status = 'EXCLUDED';
  const txn = await prisma.transaction.update({ where: { id }, data: update });
  res.json(txn);
});

export default router;
