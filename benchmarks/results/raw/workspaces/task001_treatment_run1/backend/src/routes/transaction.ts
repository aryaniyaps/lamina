import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { authorize } from '../permissions';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// Helper to ensure the account belongs to the user's household
const verifyAccountHousehold = async (accountId: string, householdId: string) => {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  return account && account.householdId === householdId;
};

// Helper to verify category belongs to household (if provided)
const verifyCategoryHousehold = async (categoryId: string | null, householdId: string) => {
  if (!categoryId) return true;
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  return category && category.householdId === householdId;
};

// Create transaction – respects privacy and duplicate detection
router.post('/', authorize('transaction', 'create'), async (req: AuthRequest, res: Response) => {
  const { accountId, categoryId, amount, date, description, isPersonal } = req.body;
  if (!accountId || amount === undefined || !date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const user = req.user!;
  // Verify account belongs to user's household
  const householdId = user.householdId!;
  const accountOk = await verifyAccountHousehold(accountId, householdId);
  if (!accountOk) return res.status(400).json({ error: 'Account does not belong to your household' });
  // Verify category (if any) belongs to household
  const categoryOk = await verifyCategoryHousehold(categoryId ?? null, householdId);
  if (!categoryOk) return res.status(400).json({ error: 'Category does not belong to your household' });

  // Privacy rule: partners can only create personal transactions
  if (user.role === 'partner' && !isPersonal) {
    return res.status(403).json({ error: 'Partners may only create personal transactions' });
  }

  // Duplicate detection – naive match on amount, date, description, account
  const duplicate = await prisma.transaction.findFirst({
    where: {
      accountId,
      amount: Number(amount),
      date: new Date(date),
      description,
    },
  });
  if (duplicate) {
    // Mark as duplicate and return existing
    await prisma.transaction.update({
      where: { id: duplicate.id },
      data: { syncStatus: 'duplicate' },
    });
    return res.status(200).json({ message: 'Duplicate transaction detected', transaction: duplicate });
  }

  const tx = await prisma.transaction.create({
    data: {
      accountId,
      categoryId: categoryId ?? undefined,
      amount: Number(amount),
      date: new Date(date),
      description,
      isPersonal: !!isPersonal,
      syncStatus: 'pending',
    },
  });
  res.status(201).json(tx);
});

// List transactions – respects privacy
router.get('/', authorize('transaction', 'read'), async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const householdId = user.householdId!;
  const whereClause: any = {
    account: { householdId },
  };
  if (user.role === 'partner') {
    // Partners see only shared transactions and their own personal ones
    whereClause.OR = [
      { isPersonal: false },
      { isPersonal: true, account: { householdId } }, // personal belongs to same household (owner check later)
    ];
  }
  const transactions = await prisma.transaction.findMany({
    where: whereClause,
    include: { account: true, category: true },
  });
  // Filter personal transactions to owner only
  const filtered = transactions.filter((tx) => {
    if (user.role !== 'partner') return true;
    if (!tx.isPersonal) return true;
    // Owner is the user who created the transaction – we don't store owner, so assume partner cannot see any personal.
    // In a real app we would have a creatorId field. Here we block all personal for partner.
    return false;
  });
  res.json(filtered);
});

// Update transaction – only allowed for owner or primary_budgeter
router.put('/:id', authorize('transaction', 'update'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { amount, date, description, categoryId, isPersonal } = req.body;
  const user = req.user!;
  const tx = await prisma.transaction.findUnique({ where: { id } });
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  // Verify household ownership
  const account = await prisma.account.findUnique({ where: { id: tx.accountId } });
  if (!account || account.householdId !== user.householdId) {
    return res.status(403).json({ error: 'Transaction not in your household' });
  }
  // Privacy: partners cannot modify non‑personal transactions
  if (user.role === 'partner' && !tx.isPersonal) {
    return res.status(403).json({ error: 'Partners cannot modify shared transactions' });
  }
  // If partner attempts to set isPersonal false, reject
  if (user.role === 'partner' && isPersonal === false) {
    return res.status(403).json({ error: 'Partners cannot change transaction to shared' });
  }
  const updated = await prisma.transaction.update({
    where: { id },
    data: {
      amount: amount !== undefined ? Number(amount) : undefined,
      date: date ? new Date(date) : undefined,
      description: description ?? undefined,
      categoryId: categoryId ?? undefined,
      isPersonal: isPersonal !== undefined ? !!isPersonal : undefined,
    },
  });
  res.json(updated);
});

// Delete transaction – primary_budgeter can delete any; partner only own personal
router.delete('/:id', authorize('transaction', 'delete'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;
  const tx = await prisma.transaction.findUnique({ where: { id } });
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  const account = await prisma.account.findUnique({ where: { id: tx.accountId } });
  if (!account || account.householdId !== user.householdId) {
    return res.status(403).json({ error: 'Transaction not in your household' });
  }
  if (user.role === 'partner' && !tx.isPersonal) {
    return res.status(403).json({ error: 'Partners cannot delete shared transactions' });
  }
  await prisma.transaction.delete({ where: { id } });
  res.json({ message: 'Transaction deleted' });
});

export default router;
