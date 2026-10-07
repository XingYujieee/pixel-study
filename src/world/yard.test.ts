import { describe, expect, it } from "vitest";
import { fallBody, gardenBlocks, Ground, moveBody, nearestFree, WALL, YARD, type Body } from "./yard";
import type { Furniture } from "./layout";

const desk: Furniture = { id: "d", type: "desk", x: 4, z: 4, rot: 0 };
const shelf: Furniture = { id: "s", type: "bookshelf", x: 8, z: 4, rot: 0 };

function body(x: number, z: number, y = 0): Body {
  return { x, y, z, vy: 0, grounded: true };
}

function settle(g: Ground, b: Body, jump = false, frames = 60) {
  for (let i = 0; i < frames; i++) fallBody(g, b, 1 / 60, jump && i === 0);
}

describe("院子与碰撞", () => {
  it("墙和围栏不能穿过，门关着出不去、开着能出去", () => {
    const closed = new Ground({ furniture: [] }, [], false);
    expect(closed.top(-1, 5)).toBe(WALL);
    expect(closed.top(6, 12)).toBe(WALL);
    expect(closed.top(YARD.x1, 15)).toBe(WALL);
    const b = body(6.9, 11.5);
    for (let i = 0; i < 60; i++) moveBody(closed, b, 0, 0.05);
    expect(b.z).toBeLessThan(11.8);
    const open = new Ground({ furniture: [] }, [], true);
    const c = body(6.9, 11.5);
    for (let i = 0; i < 60; i++) moveBody(open, c, 0, 0.05);
    expect(c.z).toBeGreaterThan(13);
    // 院子南边有围栏
    for (let i = 0; i < 400; i++) moveBody(open, c, 0, 0.05);
    expect(c.z).toBeLessThan(YARD.z1);
  });

  it("走路迈不上一格高的桌子，跳起来可以站上去；书架太高跳不上", () => {
    const g = new Ground({ furniture: [desk, shelf] }, [], false);
    const b = body(5, 5.9);
    for (let i = 0; i < 20; i++) moveBody(g, b, 0, -0.05);
    expect(b.z).toBeGreaterThan(5.29);
    expect(b.y).toBe(0);
    // 起跳后向前
    fallBody(g, b, 1 / 60, true);
    for (let i = 0; i < 40; i++) {
      moveBody(g, b, 0, -0.03);
      fallBody(g, b, 1 / 60, false);
    }
    settle(g, b);
    expect(b.y).toBe(1);
    expect(b.z).toBeLessThan(5);
    // 书架 3 格高
    const s = body(9, 5.9);
    fallBody(g, s, 1 / 60, true);
    for (let i = 0; i < 40; i++) {
      moveBody(g, s, 0, -0.03);
      fallBody(g, s, 1 / 60, false);
    }
    settle(g, s);
    expect(s.y).toBe(0);
  });

  it("半格高的花坛直接走上去，走下来会落地", () => {
    const g = new Ground({ furniture: [] }, gardenBlocks(), true);
    const b = body(2.5, 19);
    for (let i = 0; i < 60; i++) moveBody(g, b, 0, -0.05);
    expect(b.y).toBe(0.5);
    for (let i = 0; i < 80; i++) {
      moveBody(g, b, 0, -0.05);
      b.grounded = b.y === g.heightUnder(b.x, b.z);
      fallBody(g, b, 1 / 60, false);
    }
    expect(b.y).toBe(0);
  });

  it("跳不上两格高的草垛，但能从一格的草垛跳上去", () => {
    const g = new Ground({ furniture: [] }, gardenBlocks(), true);
    expect(g.top(-2, 22)).toBe(2);
    const b = body(-1.5, 21.5, 1);
    fallBody(g, b, 1 / 60, true);
    for (let i = 0; i < 40; i++) {
      moveBody(g, b, -0.012, 0.025);
      fallBody(g, b, 1 / 60, false);
    }
    settle(g, b);
    expect(b.y).toBe(2);
  });

  it("屋里有天花板；找空位避开家具", () => {
    const g = new Ground({ furniture: [desk] }, [], false);
    expect(g.hitsCeiling(5, 5, 4.5)).toBe(true);
    expect(g.hitsCeiling(5, 20, 4.5)).toBe(false);
    const p = nearestFree(g, 5, 4.5);
    expect(g.fits(p.x, p.z)).toBe(true);
  });

  it("花园的方块都在院子里、不压着屋子", () => {
    for (const b of gardenBlocks({ fireplace: true })) {
      expect(b.x >= YARD.x0 && b.x < YARD.x1 && b.z >= YARD.z0 && b.z < YARD.z1).toBe(true);
      const inHouse = b.x >= -1 && b.x <= 14 && b.z >= -1 && b.z <= 12;
      expect(inHouse).toBe(false);
    }
  });
});
