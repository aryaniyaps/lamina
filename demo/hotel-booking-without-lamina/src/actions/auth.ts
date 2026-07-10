"use server";

import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";
import { z } from "zod";
import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";

const signUpSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["GUEST", "HOTEL_OWNER"]).default("GUEST"),
});

export async function signUpAction(formData: FormData): Promise<void> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role") ?? "GUEST",
  });

  if (!parsed.success) {
    redirect("/sign-up?error=invalid");
  }

  const { name, email, password, role } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) redirect("/sign-up?error=exists");

  const passwordHash = await bcrypt.hash(password, 12);

  await db.user.create({
    data: { name, email, passwordHash, role: role as UserRole },
  });

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: role === "HOTEL_OWNER" ? "/partner" : "/",
    });
  } catch (e) {
    if (e instanceof AuthError && e.type === "CallbackRouteError") {
      throw e;
    }
    throw e;
  }
}

export async function signInAction(formData: FormData): Promise<void> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const redirectTo = (formData.get("redirectTo") as string) || "/";

  try {
    await signIn("credentials", { email, password, redirectTo });
  } catch (e) {
    if (e instanceof AuthError) {
      redirect(`/sign-in?error=invalid&redirect=${encodeURIComponent(redirectTo)}`);
    }
    throw e;
  }
}

const updateProfileSchema = z.object({
  name: z.string().min(2),
  phone: z.string().optional(),
});

export async function updateProfileAction(formData: FormData): Promise<void> {
  const { requireAuth } = await import("@/lib/session");
  const session = await requireAuth();

  const parsed = updateProfileSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone") || undefined,
  });

  if (!parsed.success) return;

  await db.user.update({
    where: { id: session.user.id },
    data: parsed.data,
  });
}
