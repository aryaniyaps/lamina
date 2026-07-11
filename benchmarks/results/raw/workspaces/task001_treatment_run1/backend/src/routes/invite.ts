import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Accept an invite token – creates a partner user and links to household
router.post('/accept', async (req: Request, res: Response) => {
  const { token, email, password, name } = req.body;
  if (!token || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const invite = await prisma.inviteToken.findUnique({ where: { token } });
  if (!invite) return res.status(404).json({ error: 'Invalid invite token' });
  if (invite.expiresAt < new Date()) {
    return res.status(410).json({ error: 'Invite token expired' });
  }
  // Ensure email not already used
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'User already exists' });
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      role: 'partner',
      householdId: invite.householdId,
      passwordHash: hash,
    },
  });
  // Delete the token after use
  await prisma.inviteToken.delete({ where: { token } });
  const jwtToken = jwt.sign({ sub: user.id }, process.env.JWT_SECRET as string, { expiresIn: '7d' });
  res.status(201).json({ token: jwtToken, userId: user.id });
});

export default router;
