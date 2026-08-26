"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import type { TimelineResult } from "@/lib/api/timeline-query";

export function useTimeline(endpoint: string, initialData: TimelineResult): ReturnType<typeof useInfiniteQuery<TimelineResult>> {
  return useInfiniteQuery<TimelineResult>({
    queryKey: ["timeline", endpoint],
    initialPageParam: null,
    initialData: { pages: [initialData], pageParams: [null] },
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
