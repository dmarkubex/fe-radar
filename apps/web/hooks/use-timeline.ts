"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useRef } from "react";

import { canFetchTimeline } from "@/lib/api/timeline-endpoint";
import type { TimelineResult } from "@/lib/api/timeline-query";

export function useTimeline(
  endpoint: string,
  initialData: TimelineResult,
  ssrEndpoint: string = endpoint
): ReturnType<typeof useInfiniteQuery<TimelineResult>> {
  const ssrEndpointRef = useRef(ssrEndpoint);
  return useInfiniteQuery<TimelineResult>({
    queryKey: ["timeline", endpoint],
    initialPageParam: null,
    initialData:
      endpoint === ssrEndpointRef.current
        ? { pages: [initialData], pageParams: [null] }
        : undefined,
    placeholderData: (previousData) => previousData,
    enabled: canFetchTimeline(endpoint),
    staleTime: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    queryFn: async ({ pageParam }) => {
      const url = new URL(endpoint, window.location.origin);
      if (pageParam) {
        url.searchParams.set("cursor", String(pageParam));
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("timeline request failed");
      }
      return (await response.json()) as TimelineResult;
    }
  });
}
