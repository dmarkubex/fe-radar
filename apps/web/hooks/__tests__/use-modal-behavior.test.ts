import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// vitest 跑在 node 环境（无 jsdom），hook 的 DOM 行为无法直接执行；
// 按任务约定改为断言：Dialog 把 enabled 传给 hook，且 hook 在 enabled=false 时两个 effect 都早退。
const hookSource = readFileSync(resolve(__dirname, "../use-modal-behavior.ts"), "utf8");
const dialogSource = readFileSync(
  resolve(__dirname, "../../components/ui/dialog.tsx"),
  "utf8"
);

describe("useModalBehavior enabled 参数", () => {
  it("enabled 默认 true", () => {
    expect(hookSource).toContain("enabled = true");
  });

  it("enabled=false 时 Escape/Tab 监听与焦点/滚动锁定都早退", () => {
    const guards = hookSource.match(/if \(!open \|\| !enabled\) return;/g);
    expect(guards).not.toBeNull();
    expect(guards).toHaveLength(2);
  });

  it("Dialog 把 enabled 传给 useModalBehavior", () => {
    expect(dialogSource).toContain("enabled?: boolean");
    expect(dialogSource).toContain("useModalBehavior({ enabled, onClose, open, panelRef })");
  });

  it("Dialog 不允许 suspend 参数", () => {
    expect(dialogSource).not.toContain("suspend");
  });
});
