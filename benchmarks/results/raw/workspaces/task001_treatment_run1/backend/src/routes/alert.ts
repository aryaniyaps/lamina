import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { authorize } from '../permissions';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// Create an alert – primary_budgeter only (enforced by permission map)
router.post('/', authorize('alert', 'create'), async (req: AuthRequest, res: Response) => {
  const { householdId, type, threshold, enabled } = req.body;
  if (!householdId || !type || threshold === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const alert = await prisma.alert.create({
    data: {
      householdId,
      type,
      threshold: Number(threshold),
      enabled: enabled ?? true,
    },
  });
  res.status(201).json(alert);
});

// List alerts for household
router.get('/', authorize('alert', 'read'), async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const householdId = user.householdId!;
  const alerts = await prisma.alert.findMany({ where: { householdId } });
  res.json(alerts);
});

// Update alert (enable/disable, threshold)
router.patch('/:id', authorize('alert', 'update'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { threshold, enabled } = req.body;
  const user = req.user!;
  const alert = await prisma.alert.findUnique({ where: { id } });
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  if (alert.householdId !== user.householdId) {
    return res.status(403).json({ error: 'Alert not in your household' });
  }
  const updated = await prisma.alert.update({
    where: { id },
    data: {
      threshold: threshold !== undefined ? Number(threshold) : undefined,
      enabled: enabled !== undefined ? !!enabled : undefined,
    },
  });
  res.json(updated);
});

export default router;
