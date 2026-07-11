import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';

const router = Router();

// Register a new user (primary_budgeter role assumed for first user)
router.post('/register', async (req: Request, res: Response) => {
  const { email, password, name, role, householdId } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'User already exists' });
  }
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      role,
      householdId,
      passwordHash: hash,
    },
  });
  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET as string, { expiresIn: '7d' });
  res.status(201).json({ token, userId: user.id });
});

// Login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET as string, { expiresIn: '7d' });
  res.json({ token, userId: user.id });
});

export default router;
