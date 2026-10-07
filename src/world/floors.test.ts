import { describe, expect, it } from "vitest";
import { addFloor, allShelves, currentFloor, floorsOf, isGroundFloor, removeFloor, renameFloor, switchFloor } from "./floors";
import { defaultLayout, parseLayout, type Layout } from "./layout";

const files = [{ path: "读书/a.md" }, { path: "工作/b.md" }] as never[];

function withFloors(): Layout {
  const l = defaultLayout(files);
  const r = addFloor(l, "二楼");
  if ("error" in r) throw new Error(r.error);
  return r.layout;
}

describe("楼层", () => {
  it("加一层：两层都有楼梯，位置相同；仍停在一楼", () => {
    const l = withFloors();
    const all = floorsOf(l);
    expect(all.length).toBe(2);
    expect(all[1].name).toBe("二楼");
    const s0 = all[0].furniture.find((f) => f.type === "stairs")!;
    const s1 = all[1].furniture.find((f) => f.type === "stairs")!;
    expect([s1.x, s1.z, s1.rot]).toEqual([s0.x, s0.z, s0.rot]);
    expect(isGroundFloor(l)).toBe(true);
  });

  it("上楼再下楼：每层的家具各管各的，回来时原样", () => {
    const l = withFloors();
    const shelves0 = l.furniture.filter((f) => f.type === "bookshelf").length;
    const up = switchFloor(l, floorsOf(l)[1].id);
    expect(isGroundFloor(up)).toBe(false);
    expect(up.furniture.filter((f) => f.type === "bookshelf").length).toBe(0);
    expect(currentFloor(up).name).toBe("二楼");
    // 二楼放个书架
    up.furniture.push({ id: "s2", type: "bookshelf", x: 4, z: 0, rot: 0, shelf: { name: "论文", mode: "folder", refs: [], folder: "论文" } });
    const down = switchFloor(up, floorsOf(up)[0].id);
    expect(down.furniture.filter((f) => f.type === "bookshelf").length).toBe(shelves0);
    expect(allShelves(down).some((s) => s.floorName === "二楼" && s.f.shelf?.name === "论文")).toBe(true);
    // 从楼梯出来站在楼梯前面
    const st = down.furniture.find((f) => f.type === "stairs")!;
    expect(Math.hypot(down.player.x - st.x - 0.5, down.player.z - st.z - 1)).toBeLessThan(3);
  });

  it("保存再读回来，楼层还在", () => {
    const l = withFloors();
    const up = switchFloor(l, floorsOf(l)[1].id);
    const saved = JSON.parse(JSON.stringify({ ...up, floors: floorsOf(up) }));
    const back = parseLayout(saved)!;
    expect(floorsOf(back).length).toBe(2);
    expect(back.floor).toBe(up.floor);
    expect(renameFloor(back, back.floor!, "阁楼").floors!.find((f) => f.id === back.floor)!.name).toBe("阁楼");
  });

  it("拆楼层：一楼、当前层、有书架的层都不能拆", () => {
    const l = withFloors();
    const [g, two] = floorsOf(l);
    expect("error" in (removeFloor(l, g.id) as object)).toBe(true);
    const ok = removeFloor(l, two.id) as Layout;
    expect(floorsOf(ok).length).toBe(1);
    const up = switchFloor(l, two.id);
    expect("error" in (removeFloor(up, two.id) as object)).toBe(true);
  });
});
