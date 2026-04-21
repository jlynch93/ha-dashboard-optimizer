// Minimal, dependency-free YAML syntax highlighter. Returns an array of
// pre-styled <span>s, one per line. The goal is legibility in the output
// pane — not a full YAML grammar. Handles comments, keys, quoted strings,
// numbers, booleans/nulls and list bullets.
//
// Using a tiny hand-rolled tokenizer avoids pulling in shiki/prism which
// would be overkill for the single code block this app renders.

import type { ReactNode } from "react";

const PUNCT = /[:{}[\],]/;

export function highlightYaml(source: string): ReactNode[] {
  const lines = source.split("\n");
  return lines.map((line, i) => (
    <span key={i} className="block">
      {renderLine(line)}
      {"\n"}
    </span>
  ));
}

function renderLine(line: string): ReactNode[] {
  // Fast-path: pure comment or blank.
  if (/^\s*#/.test(line)) {
    return [
      <span key="c" className="text-slate-500 italic">
        {line}
      </span>,
    ];
  }
  if (line.trim() === "") return [line];

  const tokens: ReactNode[] = [];
  let i = 0;
  const push = (node: ReactNode) => tokens.push(node);

  // Leading whitespace.
  const leading = line.match(/^\s*/)?.[0] ?? "";
  if (leading) push(leading);
  i = leading.length;

  // List bullet `- ` (but not `---`).
  if (line[i] === "-" && line[i + 1] !== "-" && (line[i + 1] === " " || line[i + 1] === undefined)) {
    push(
      <span key={`d${i}`} className="text-cyan-400">
        -
      </span>,
    );
    i += 1;
    if (line[i] === " ") {
      push(" ");
      i += 1;
    }
  }

  // Try to match `key:` at the start of the logical content.
  const rest = line.slice(i);
  const keyMatch = rest.match(/^([A-Za-z_][\w.-]*)(\s*)(:)(\s|$)/);
  if (keyMatch) {
    const [, key, gap, colon, trail] = keyMatch;
    push(
      <span key={`k${i}`} className="text-sky-300">
        {key}
      </span>,
    );
    if (gap) push(gap);
    push(
      <span key={`:${i}`} className="text-slate-500">
        {colon}
      </span>,
    );
    i += key.length + gap.length + colon.length;
    if (trail === " ") {
      push(" ");
      i += 1;
    }
  }

  // Remaining value portion.
  while (i < line.length) {
    const ch = line[i];

    if (ch === "#") {
      push(
        <span key={`cm${i}`} className="text-slate-500 italic">
          {line.slice(i)}
        </span>,
      );
      i = line.length;
      break;
    }

    if (ch === '"' || ch === "'") {
      const end = findStringEnd(line, i, ch);
      push(
        <span key={`s${i}`} className="text-emerald-300">
          {line.slice(i, end + 1)}
        </span>,
      );
      i = end + 1;
      continue;
    }

    // Numbers.
    const numMatch = line.slice(i).match(/^-?\d+(\.\d+)?(?=\s|$|[,}\]])/);
    if (numMatch) {
      push(
        <span key={`n${i}`} className="text-amber-300">
          {numMatch[0]}
        </span>,
      );
      i += numMatch[0].length;
      continue;
    }

    // Booleans / null / YAML keywords.
    const wordMatch = line.slice(i).match(/^(true|false|null|yes|no|on|off|~)(?=\s|$|[,}\]])/i);
    if (wordMatch) {
      push(
        <span key={`b${i}`} className="text-fuchsia-300">
          {wordMatch[0]}
        </span>,
      );
      i += wordMatch[0].length;
      continue;
    }

    if (PUNCT.test(ch)) {
      push(
        <span key={`p${i}`} className="text-slate-500">
          {ch}
        </span>,
      );
      i += 1;
      continue;
    }

    // Bare scalar — consume until punctuation/comment/end.
    let j = i;
    while (j < line.length && !PUNCT.test(line[j]) && line[j] !== "#") j += 1;
    push(
      <span key={`v${i}`} className="text-slate-200">
        {line.slice(i, j)}
      </span>,
    );
    i = j;
  }

  return tokens;
}

function findStringEnd(line: string, start: number, quote: string): number {
  for (let j = start + 1; j < line.length; j += 1) {
    if (line[j] === "\\") {
      j += 1;
      continue;
    }
    if (line[j] === quote) return j;
  }
  return line.length - 1;
}
