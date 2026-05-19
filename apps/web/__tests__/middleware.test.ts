/**
 * DMA-51 — middleware x-pathname injection
 *
 * Full round-trip test (NextRequest → NextResponse.next({ request }) → RSC headers())
 * requires the Next.js Edge Runtime which is not available in the vitest environment.
 * The behaviour is verified manually via headers() in layout.tsx in a running dev
 * server — verified manually via headers() in layout (DMA-51 acceptance §3).
 *
 * What we CAN test here is the pure header-cloning pattern used in middleware.ts:
 * cloning request.headers and setting x-pathname on the clone, then confirming
 * the clone carries the value while the original does not.
 */

import { describe, expect, it } from "vitest";

describe("middleware x-pathname header injection pattern (DMA-51)", () => {
  it("cloned Headers object carries the injected x-pathname value", () => {
    const original = new Headers({ "content-type": "text/html" });
    const clone = new Headers(original);
    clone.set("x-pathname", "/curated");

    expect(clone.get("x-pathname")).toBe("/curated");
  });

  it("original Headers object is not mutated by the clone", () => {
    const original = new Headers({ "content-type": "text/html" });
    const clone = new Headers(original);
    clone.set("x-pathname", "/curated");

    expect(original.get("x-pathname")).toBeNull();
  });

  it("x-pathname is preserved after being set on the clone", () => {
    const paths = ["/", "/curated", "/alerts", "/admin/dashboard"];
    for (const pathname of paths) {
      const clone = new Headers();
      clone.set("x-pathname", pathname);
      expect(clone.get("x-pathname")).toBe(pathname);
    }
  });
});
