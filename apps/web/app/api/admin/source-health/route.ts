import { fetchSourceHealth } from "@/lib/api/source-health-query";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(await fetchSourceHealth());
}
