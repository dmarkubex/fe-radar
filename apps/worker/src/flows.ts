import type { FlowJob, FlowProducer } from "bullmq";
import { QUEUES } from "@fe-radar/shared";
import type { PipelineJob } from "./queues";

export function buildItemPipelineFlow(itemId: number, correlationId?: string): FlowJob {
  const payload: PipelineJob = { itemId, correlationId };
  return {
    name: "curator",
    queueName: QUEUES.curator,
    data: payload,
    children: [{
      name: "cluster",
      queueName: QUEUES.cluster,
      data: payload,
      children: [{
        name: "embedder",
        queueName: QUEUES.embedder,
        data: payload,
        children: [{
          name: "scorer",
          queueName: QUEUES.scorer,
          data: payload,
          children: [{
            name: "ner",
            queueName: QUEUES.ner,
            data: payload,
            children: [{
              name: "prefilter",
              queueName: QUEUES.prefilter,
              data: payload
            }]
          }]
        }]
      }]
    }]
  };
}

export async function enqueueItemPipeline(flowProducer: FlowProducer, itemId: number, correlationId?: string): Promise<void> {
  await flowProducer.add(buildItemPipelineFlow(itemId, correlationId));
}
