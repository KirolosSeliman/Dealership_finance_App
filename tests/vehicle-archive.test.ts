import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { mutationEndpoint } from "../src/features/app/mutations";
import * as repository from "../src/lib/supabase/repository";
import { archiveVehicleSchema } from "../src/lib/validation";

const repoRoot = process.cwd();

function source(relativePath: string) {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

test("normal vehicle removal uses the archive endpoint", () => {
  const formData = new FormData();
  formData.set("vehicleId", "9a2f9c7f-6d2d-4af4-bf6c-54f0c0a3f8b2");

  assert.deepEqual(mutationEndpoint("deleteVehicle", formData), {
    url: "/api/vehicles/9a2f9c7f-6d2d-4af4-bf6c-54f0c0a3f8b2/archive",
    method: "POST",
  });
});

test("archive route and repository call the archive RPC", () => {
  const route = source("src/app/api/vehicles/[vehicleId]/archive/route.ts");
  const repository = source("src/lib/supabase/repository.ts");
  const handler = source("src/lib/server/domain-mutation-handlers.ts");

  assert.match(route, /forwardDomainMutation[\s\S]+deleteVehicle/i);
  assert.match(repository, /export async function archiveVehicle/i);
  assert.match(repository, /rpc\("archive_vehicle"/i);
  assert.match(handler, /case "deleteVehicle"[\s\S]+archiveVehicle\(/i);
  assert.doesNotMatch(handler, /case "deleteVehicle"[\s\S]+purgeVehicle\(/i);
});

test("archive repository passes a bounded reason to the atomic RPC", async () => {
  const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(functionName: string, args: Record<string, unknown>) {
      calls.push({ functionName, args });
      return { error: null };
    },
  };

  await repository.archiveVehicle(
    client as unknown as Parameters<typeof repository.archiveVehicle>[0],
    "org-1",
    "vehicle-1",
    "  inventory cleanup  ",
  );

  assert.deepEqual(calls, [{
    functionName: "archive_vehicle",
    args: {
      p_organization_id: "org-1",
      p_vehicle_id: "vehicle-1",
      p_reason: "inventory cleanup",
    },
  }]);
});

test("archive validation rejects reasons longer than the database limit", () => {
  assert.equal(archiveVehicleSchema.safeParse({
    vehicleId: "9a2f9c7f-6d2d-4af4-bf6c-54f0c0a3f8b2",
    reason: "x".repeat(501),
  }).success, false);
});

test("normal vehicle removal is described as reversible archive and preserves history", () => {
  const ui = source("src/features/app/feature-views.tsx");
  const api = source("src/lib/server/domain-mutation-handlers.ts");

  assert.match(ui, /Archive vehicle/i);
  assert.match(ui, /hidden from active inventory/i);
  assert.match(ui, /financial|tax|cash/i);
  assert.doesNotMatch(ui, /Delete vehicle permanently/i);
  assert.doesNotMatch(api, /permanently delete this vehicle/i);
});

test("the legacy destructive purge function is not exposed to application users", () => {
  const migration = source("supabase/migrations/20260827_vehicle_archive_default.sql");
  const purgeRoute = join(repoRoot, "src/app/api/vehicles/[vehicleId]/purge/route.ts");

  assert.match(migration, /revoke all on function purge_vehicle_completely\(uuid, uuid, text\) from public/i);
  assert.match(migration, /revoke all on function purge_vehicle_completely\(uuid, uuid, text\) from authenticated/i);
  assert.match(migration, /grant execute on function archive_vehicle\(uuid, uuid, text\) to authenticated/i);
  assert.equal(existsSync(purgeRoute), false);
});
