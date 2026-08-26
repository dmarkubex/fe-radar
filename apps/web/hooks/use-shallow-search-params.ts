"use client";

import { useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";

const SHALLOW_SEARCH_EVENT = "fe-radar:shallow-search";

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener(SHALLOW_SEARCH_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener(SHALLOW_SEARCH_EVENT, onStoreChange);
  };
}

function getClientSearch(): string {
  const search = window.location.search;
  return search.startsWith("?") ? search.slice(1) : search;
}

export function useShallowSearchParams(): URLSearchParams {
  const serverParams = useSearchParams();
  const search = useSyncExternalStore(
    subscribe,
    getClientSearch,
    () => serverParams.toString()
  );
  return new URLSearchParams(search);
}

export function replaceShallowSearch(pathname: string, params: URLSearchParams): void {
  const qs = params.toString();
  const href = qs ? `${pathname}?${qs}` : pathname;
  window.history.replaceState(window.history.state, "", href);
  window.dispatchEvent(new Event(SHALLOW_SEARCH_EVENT));
}
