// jsdom 没有实现布局相关 API，CodeMirror 测量时需要
const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} };
const list = Object.assign([], { item: () => null }) as unknown as DOMRectList;
if (typeof Range !== "undefined") {
  Range.prototype.getClientRects = () => list;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
}
