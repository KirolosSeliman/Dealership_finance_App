import { forwardDomainMutation } from "@/lib/server/mutation-route-bridge";

export function POST(request: Request, context: { params: Promise<{ saleId: string }> }) {
  return context.params.then(({ saleId }) =>
    forwardDomainMutation(request, "correctSale", {
      bucket: "sales-correct",
      limit: 12,
      fields: { saleId },
    }),
  );
}
