import { fetchPipelineFlow } from "@/lib/api/pipeline-flow-query";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(await fetchPipelineFlow());
}
