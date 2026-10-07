import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

describe("管家听得懂的说法", () => {
  it("找东西与带路", () => {
    expect(parseIntent("三体在哪")).toEqual({ tool: "search_notes", input: { query: "三体" } });
    expect(parseIntent("帮我找一下周报")).toEqual({ tool: "search_notes", input: { query: "周报" } });
    expect(parseIntent("我那篇关于能耗的笔记放哪了？")).toEqual({ tool: "search_notes", input: { query: "能耗" } });
    expect(parseIntent("带我去《活着》")).toEqual({ tool: "guide_to", input: { query: "活着" } });
  });

  it("书架、楼层", () => {
    expect(parseIntent("整理一下书架")?.tool).toBe("organize_shelves");
    expect(parseIntent("再加一层")).toEqual({ tool: "floors", input: { action: "add" } });
    expect(parseIntent("去二楼")).toEqual({ tool: "floors", input: { action: "go", floor: "二楼" } });
    expect(parseIntent("书房里有多少本书")?.tool).toBe("library_overview");
  });

  it("花园", () => {
    expect(parseIntent("除草")).toEqual({ tool: "garden", input: { action: "weed" } });
    expect(parseIntent("帮我种三棵树")).toEqual({ tool: "garden", input: { action: "plant", kind: "tree", count: 3, where: "near_me" } });
    expect(parseIntent("在这种点花")).toMatchObject({ tool: "garden", input: { action: "plant", kind: "flower", where: "looking" } });
    expect(parseIntent("把这棵树砍掉")).toMatchObject({ tool: "garden", input: { action: "remove", kind: "tree", where: "looking" } });
    expect(parseIntent("砍掉这棵树")).toMatchObject({ tool: "garden", input: { action: "remove", kind: "tree", where: "looking" } });
    expect(parseIntent("移走那个草垛")).toMatchObject({ input: { action: "remove", kind: "hay" } });
  });

  it("随手记、音乐、天气、帮助", () => {
    expect(parseIntent("记一下：明天交周报")).toEqual({ tool: "capture_idea", input: { text: "明天交周报" } });
    expect(parseIntent("放首音乐")?.tool).toBe("music");
    expect(parseIntent("停掉音乐")).toEqual({ tool: "music", input: { action: "stop" } });
    expect(parseIntent("下雨吧")).toEqual({ tool: "scene", input: { weather: "rain" } });
    expect(parseIntent("你能做什么")?.tool).toBe("help");
    expect(parseIntent("今天心情不错")).toBeNull();
  });
});
