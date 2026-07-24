"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SearchBox({ initialQuery }: { initialQuery: string }): React.JSX.Element {
  const [query, setQuery] = useState(initialQuery);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <form
      className="flex gap-2 border border-border bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const next = new URLSearchParams(searchParams);
        const value = query.trim();
        if (value) next.set("q", value);
        else next.delete("q");
        next.delete("cursor");
        const suffix = next.toString();
        router.replace(`${pathname}${suffix ? `?${suffix}` : ""}`);
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 border border-border-strong px-3">
        <Search className="h-4 w-4 shrink-0 text-fg-soft" />
        <input
          className="h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-soft"
          placeholder="远东、GB/T 12706、储能、招标"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <Button type="submit">搜索</Button>
    </form>
  );
}
