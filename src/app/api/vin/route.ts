import { NextResponse } from "next/server";
import { decodeVin } from "@/lib/vin/nhtsa";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const vin = searchParams.get("vin") ?? "";
  const decoded = await decodeVin(vin);
  return NextResponse.json(decoded);
}
