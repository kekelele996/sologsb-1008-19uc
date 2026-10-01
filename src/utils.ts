import type { DiffToken, SignItem } from "./types";
import type { ResolvedTerm } from "./glossary";

export function estimatedLines(text: string, width: number, fontSize: number, lineHeight = 1.25) {
  if (!text.trim()) return [];
  const usable = Math.max(120, width - 48);
  const lines: string[] = [];
  for (const hardLine of text.split("\n")) {
    if (!hardLine) {
      lines.push("");
      continue;
    }
    let current = "";
    let currentWidth = 0;
    for (const char of hardLine) {
      const charWidth = /[⺀-鿿぀-ヿ가-힯]/.test(char)
        ? fontSize
        : char === " "
          ? fontSize * 0.34
          : fontSize * 0.58;
      if (current && currentWidth + charWidth > usable) {
        lines.push(current.trimEnd());
        current = char.trimStart();
        currentWidth = charWidth;
      } else {
        current += char;
        currentWidth += charWidth;
      }
    }
    if (current) lines.push(current.trimEnd());
  }
  return lines;
}

export interface SignAnalysis {
  lines: string[];
  visible: string[];
  overflow: boolean;
  tooLong: boolean;
  missingTerms: ResolvedTerm[];
  risk: "high" | "medium" | "low";
}

/**
 * 必选术语命中检查以总表权威译法（canonicalTarget）为准；
 * 已停用或缺语种的引用无法核对，算作未命中。
 */
export function analyzeSign(
  sign: SignItem,
  width: number,
  fontSize: number,
  resolvedTerms: ResolvedTerm[],
): SignAnalysis {
  const lines = estimatedLines(sign.targetText, width, fontSize);
  const lineCapacity = Math.max(1, Math.floor((width * 0.62) / (fontSize * 1.25)));
  const visible = lines.slice(0, lineCapacity);
  const overflow = lines.length > lineCapacity;
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  void longest;
  const estimatedCharacterLimit = Math.max(12, Math.floor((width - 48) / (fontSize * 0.55)) * lineCapacity);
  const tooLong = sign.targetText.replace(/\s/g, "").length > estimatedCharacterLimit;
  const haystack = sign.targetText.toLocaleLowerCase();
  const missingTerms = resolvedTerms.filter(
    (item) => item.ref.required && item.canonicalTarget !== null && !haystack.includes(item.canonicalTarget.toLocaleLowerCase()),
  );
  return {
    lines,
    visible,
    overflow,
    tooLong,
    missingTerms,
    risk: overflow || tooLong || missingTerms.length ? "high" : lines.length >= lineCapacity - 1 ? "medium" : "low",
  };
}

function tokenize(value: string) {
  return value.match(/[\u3400-\u9fff]|[A-Za-zÀ-ÿ0-9'\u2019\-]+|\s+|./gu) ?? [];
}

function lcsTable(left: string[], right: string[]) {
  const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

export function diffText(oldText: string, newText: string): DiffToken[] {
  const left = tokenize(oldText);
  const right = tokenize(newText);
  if (left.length * right.length > 180000) {
    return [{ type: "remove", value: oldText }, { type: "add", value: newText }];
  }
  const table = lcsTable(left, right);
  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  const push = (type: DiffToken["type"], value: string) => {
    const previous = tokens.at(-1);
    if (previous?.type === type) previous.value += value;
    else tokens.push({ type, value });
  };
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      push("same", left[i]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push("remove", left[i]);
      i += 1;
    } else {
      push("add", right[j]);
      j += 1;
    }
  }
  while (i < left.length) push("remove", left[i++]);
  while (j < right.length) push("add", right[j++]);
  return tokens;
}
