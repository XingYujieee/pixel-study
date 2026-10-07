import { describe, expect, it } from "vitest";
import { canPlant, gardenOf, growWeeds, nearest, plant, removeAt, spotNear, weed } from "./gardenEdit";
import { parseGarden } from "./garden";
import { Ground, gardenBlocks } from "./yard";

describe("花园编辑", () => {
  it("默认花园里有杂草，除草后一棵不剩", () => {
    const g = gardenOf(undefined, 0);
    expect(g.items.filter((b) => b.kind === "weed").length).toBeGreaterThan(5);
    const r = weed(g.items);
    expect(r.count).toBeGreaterThan(5);
    expect(r.items.some((b) => b.kind === "weed")).toBe(false);
  });

  it("种树：不能种在路上、屋子里、围栏外、别的树旁边；种上后挡路", () => {
    const items = gardenOf(undefined).items;
    expect(canPlant(items, "tree", 6, 20).ok).toBe(false);
    expect(canPlant(items, "tree", 5, 5).ok).toBe(false);
    expect(canPlant(items, "tree", 30, 20).ok).toBe(false);
    expect(canPlant(items, "tree", -3, 18).ok).toBe(false);
    const spot = spotNear(items, "tree", 0, 24)!;
    const r = plant(items, "tree", spot.x, spot.z);
    expect("items" in r).toBe(true);
    const next = (r as { items: typeof items }).items;
    const g = new Ground({ furniture: [] }, gardenBlocks({ items: next }), true);
    expect(g.top(spot.x, spot.z)).toBeGreaterThan(10);
  });

  it("草垛可以一层层堆高，也一层层拿掉；拔掉最近的树", () => {
    let items = gardenOf(undefined).items.filter((b) => !(b.x === 18 && b.z === 22));
    for (let i = 0; i < 3; i++) items = (plant(items, "hay", 18, 22) as { items: typeof items }).items;
    expect(items.find((b) => b.x === 18 && b.z === 22)!.h).toBe(3);
    items = removeAt(items, 18, 22)!.items;
    expect(items.find((b) => b.x === 18 && b.z === 22)!.h).toBe(2);
    const tree = nearest(items, ["trunk"], -2, 17)!;
    expect(tree).toMatchObject({ x: -3, z: 16 });
    expect(removeAt(items, tree.x, tree.z)!.items.some((b) => b.x === -3 && b.z === 16)).toBe(false);
  });

  it("杂草每天长几棵，有上限；读档校验", () => {
    const g = { items: [], grownAt: 0 };
    const later = growWeeds(g, 5 * 86400000 + 10);
    const n = later.items.length;
    expect(n).toBe(15);
    expect(growWeeds(later, 5 * 86400000 + 20).items.length).toBe(n);
    expect(growWeeds(g, 400 * 86400000).items.length).toBe(40);
    expect(parseGarden({ items: [{ kind: "trunk", x: 1, z: 20, h: 99 }, { kind: "nope", x: 0, z: 0 }], grownAt: 5 })!.items.length).toBe(1);
  });
});
