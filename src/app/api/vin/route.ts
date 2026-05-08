import { NextResponse } from "next/server";
import { checkRateLimit, routeErrorResponse } from "@/lib/server/security";
import { decodeVin } from "@/lib/vin/nhtsa";

export async function GET(request: Request) {
  try {
    checkRateLimit(request, "vin", { limit: 30, windowMs: 60_000 });
    const { searchParams } = new URL(request.url);
    const vin = (searchParams.get("vin") ?? "").trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) {
      return NextResponse.json({ year: undefined, make: undefined, model: undefined, trim: undefined, color: undefined });
    }
    const decoded = await decodeVin(vin);
    return NextResponse.json(decoded);
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
