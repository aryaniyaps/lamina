import bcrypt from "bcryptjs";
import { UserRole, UserStatus } from "@prisma/client";
import { db } from "./db";
import { createSession, type SessionUser } from "./session";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
  verifyEmail?: boolean;
}) {
  const existing = await db.user.findUnique({ where: { email: input.email } });
  if (existing) throw new Error("Email already registered");

  const user = await db.user.create({
    data: {
      email: input.email.toLowerCase(),
      passwordHash: await hashPassword(input.password),
      name: input.name,
      role: input.role ?? UserRole.TRAVELER,
      status: input.verifyEmail ? UserStatus.ACTIVE : UserStatus.UNVERIFIED_EMAIL,
      emailVerifiedAt: input.verifyEmail ? new Date() : null,
    },
  });

  return user;
}

export async function loginUser(email: string, password: string): Promise<SessionUser> {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user?.passwordHash) throw new Error("Invalid email or password");
  if (user.status === UserStatus.SUSPENDED) throw new Error("Account suspended");

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw new Error("Invalid email or password");

  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
  await createSession(sessionUser);
  return sessionUser;
}

export async function verifyUserEmail(userId: string) {
  await db.user.update({
    where: { id: userId },
    data: { status: UserStatus.ACTIVE, emailVerifiedAt: new Date() },
  });
}

export async function getUserById(id: string) {
  return db.user.findUnique({ where: { id } });
}
