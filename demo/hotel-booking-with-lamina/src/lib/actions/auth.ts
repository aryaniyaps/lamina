"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { registerUser, loginUser, verifyUserEmail } from "@/lib/auth";
import { destroySession, getSession } from "@/lib/session";
import { db } from "@/lib/db";

export async function signUpAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "");
  const role = (formData.get("role") as UserRole) || UserRole.TRAVELER;

  try {
    const user = await registerUser({ email, password, name, role });
    if (role === UserRole.TRAVELER) {
      await loginUser(email, password);
      redirect("/account?verify=1");
    }
    await loginUser(email, password);
    redirect(role === UserRole.HOTEL_STAFF ? "/hotel/onboarding" : "/admin");
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Sign up failed" };
  }
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirect") ?? "/");

  try {
    const user = await loginUser(email, password);
    if (user.role === UserRole.PLATFORM_ADMIN || user.role === UserRole.SUPPORT_AGENT) {
      redirect("/admin");
    }
    if (user.role === UserRole.HOTEL_STAFF) {
      redirect("/hotel");
    }
    redirect(redirectTo);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Sign in failed" };
  }
}

export async function signOutAction() {
  await destroySession();
  redirect("/");
}

export async function verifyEmailAction() {
  const session = await getSession();
  if (!session) return { error: "Not signed in" };
  await verifyUserEmail(session.id);
  revalidatePath("/account");
  return { success: true };
}

export async function updateProfileAction(formData: FormData) {
  const session = await getSession();
  if (!session) return { error: "Not signed in" };

  await db.user.update({
    where: { id: session.id },
    data: {
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? "") || null,
    },
  });
  revalidatePath("/account");
  return { success: true };
}
