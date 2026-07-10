import { NextResponse } from "next/server";
import { expireStaleHolds, completePastBookings } from "@/lib/booking";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET ?? "dev-cron"}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expiredHolds = await expireStaleHolds();
  await completePastBookings();

  return NextResponse.json({ expiredHolds });
}
