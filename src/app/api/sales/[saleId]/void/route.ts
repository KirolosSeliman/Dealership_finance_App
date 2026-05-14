import { forwardDomainMutation } from "@/lib/server/mutation-route-bridge";

export function POST(request: Request, context: { params: Promise<{ saleId: string }> }) {
  return context.params.then(({ saleId }) =>
    forwardDomainMutation(request, "voidSale", {
      bucket: "sales-void",
      limit: 12,
      fields: { saleId },
    }),
  );
}
