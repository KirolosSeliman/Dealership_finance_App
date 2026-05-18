import { runCronSourceSync } from "@/lib/market-snap/source-sync";

export function GET(request: Request) {
  return runCronSourceSync(request, "marketplace");
}
