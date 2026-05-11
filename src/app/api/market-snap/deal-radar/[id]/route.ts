import { deleteDealRadarListing } from "@/lib/server/market-snap-api";

export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then(({ id }) => deleteDealRadarListing(request, id));
}
