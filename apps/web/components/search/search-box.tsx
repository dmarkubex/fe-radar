"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SearchBox({ initialQuery }: { initialQuery: string }): React.JSX.Element {
  const [query, setQuery] = useState(initialQuery);
  const router = useRouter();

  return (
    <form
      className="flex gap-2 rounded-lg border border-zinc-200 bg-white p-3"
      onSubmit={(event) => {
        event.preventDefault();
        router.replace(query.trim() ? `/search?q=${encodeURIComponent(query.trim())}` : "/search");
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-zinc-200 px-3">
        <Search className="h-4 w-4 shrink-0 text-zinc-400" />
        <input
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
          placeholder="远东、GB/T 12706、储能、招标"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <Button type="submit">搜索</Button>
    </form>
  );
}
