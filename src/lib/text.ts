/** 文件使用 CRLF 时，编辑器按 CRLF 分行并原样写回，避免保存时改写换行符。 */
export function detectLineSeparator(content: string): "\n" | "\r\n" {
  const crlf = content.indexOf("\r\n");
  if (crlf === -1) return "\n";
  // 以第一个换行为准：第一个 \n 前面是 \r 就视为 CRLF 文件
  const lf = content.indexOf("\n");
  return lf === crlf + 1 ? "\r\n" : "\n";
}

export interface MinimalChange {
  from: number;
  to: number;
  /** 新文本中替换部分的区间 */
  insertFrom: number;
  insertTo: number;
}

/**
 * 公共前缀 + 公共后缀得到单个替换区间。外部修改刷新时只替换真正变化的部分，
 * 光标在变化区域之外时位置保持不变。
 */
export function minimalChange(a: string, b: string): MinimalChange | null {
  if (a === b) return null;
  const max = Math.min(a.length, b.length);
  let start = 0;
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  // 不要把 UTF-16 代理对切开
  if (start > 0 && isHighSurrogate(a.charCodeAt(start - 1))) start--;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  if (endA < a.length && isLowSurrogate(a.charCodeAt(endA))) {
    endA++;
    endB++;
  }
  return { from: start, to: endA, insertFrom: start, insertTo: endB };
}

function isHighSurrogate(c: number) {
  return c >= 0xd800 && c <= 0xdbff;
}
function isLowSurrogate(c: number) {
  return c >= 0xdc00 && c <= 0xdfff;
}

/** 字数：中日韩字符每字计 1，其余按空白分隔的词计数。 */
export function countWords(text: string): number {
  const cjk = text.match(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g)?.length ?? 0;
  const rest = text.replace(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g, " ");
  const words = rest.match(/[A-Za-z0-9À-ɏ]+(?:['’-][A-Za-z0-9À-ɏ]+)*/g)?.length ?? 0;
  return cjk + words;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
