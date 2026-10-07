import { describe, expect, it } from "vitest";
import { floorsOf } from "./floors";
import { applyLibraryPlan, planShelves, shelfFor } from "./library";
import { defaultLayout, type Layout } from "./layout";

function paths(): string[] {
  const out: string[] = ["根.md", "Inbox/灵感.md", ".obsidian/x.json"];
  for (let i = 0; i < 12; i++) out.push(`读书/书${i}.md`);
  for (let i = 0; i < 30; i++) out.push(`论文/散${i}.md`);
  for (const sub of ["能耗", "碳排放", "训练成本"]) for (let i = 0; i < 25; i++) out.push(`论文/${sub}/p${i}.md`);
  for (let d = 0; d < 26; d++) out.push(`杂项${d}/a.md`);
  return out;
}

describe("整理书架", () => {
  it("一个文件夹一个书架，大文件夹拆开；跳过隐藏、Inbox", () => {
    const plan = planShelves(paths(), 40);
    const names = plan.map((p) => p.name);
    expect(names).toContain("读书");
    expect(names).toContain("论文 · 散页");
    expect(names).toContain("能耗");
    expect(plan.find((p) => p.name === "论文 · 散页")!.flat).toBe(true);
    expect(names.some((n) => n.includes("Inbox") || n.includes("obsidian"))).toBe(false);
    expect(plan[0]).toMatchObject({ folder: "", flat: true });
  });

  it("一层放不下就加楼层；其他家具不动；找得到每本书", () => {
    const l = defaultLayout(paths().map((p) => ({ path: p })) as never[]);
    const desk = l.furniture.find((f) => f.type === "desk")!;
    const plan = planShelves(paths(), 40);
    const r = applyLibraryPlan(l, plan);
    expect(r.unplaced).toBe(0);
    expect(r.shelves).toBe(plan.length);
    expect(r.floorsAdded).toBeGreaterThanOrEqual(1);
    const floors = floorsOf(r.layout);
    expect(floors.length).toBe(1 + r.floorsAdded);
    // 每层都有楼梯
    for (const fl of floors) expect(fl.furniture.some((f) => f.type === "stairs")).toBe(true);
    // 还在一楼，书桌还在原地
    expect(r.layout.floor).toBe(floors[0].id);
    expect(r.layout.furniture.find((f) => f.id === desk.id)).toMatchObject({ x: desk.x, z: desk.z });
    const hit = shelfFor(r.layout, "论文/能耗/p3.md")!;
    expect(hit.f.shelf!.name).toBe("能耗");
    expect(shelfFor(r.layout, "论文/散1.md")!.f.shelf!.flat).toBe(true);
    expect(shelfFor(r.layout, "杂项25/a.md")).not.toBeNull();
  });

  it("文件少时只用一楼，收藏书架保留", () => {
    const l: Layout = defaultLayout([{ path: "读书/a.md" }] as never[]);
    const r = applyLibraryPlan(l, planShelves(["读书/a.md", "工作/b.md"]));
    expect(r.floorsAdded).toBe(0);
    expect(r.layout.furniture.some((f) => f.shelf?.mode === "virtual")).toBe(true);
    expect(r.layout.furniture.filter((f) => f.shelf?.mode === "folder").length).toBe(2);
  });
});
