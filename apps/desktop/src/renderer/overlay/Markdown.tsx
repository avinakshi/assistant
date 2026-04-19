import { useMemo, type ReactNode } from 'react';

/**
 * Tiny markdown renderer for the overlay. We intentionally DON'T pull in react-markdown
 * or remark because:
 *   - The overlay runs sandboxed with strict CSP; every extra dep is attack surface.
 *   - Streaming answers need to render partial markdown without reflow — our parser
 *     gracefully degrades ("**unclosed" just renders as literal asterisks).
 *   - We only need a handful of constructs: bold, inline code, fenced code blocks,
 *     bullet lists, tables, and simple headings. Anything fancier (images, links,
 *     raw HTML) isn't a thing the LLM outputs in interview answers.
 *
 * If output ever grows past this file's reach we'll swap to react-markdown; until
 * then this is ~150 lines instead of a ~60 kB bundle.
 */

type Block =
  | { readonly kind: 'p'; readonly text: string }
  | { readonly kind: 'h'; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly kind: 'ul'; readonly items: readonly string[] }
  | { readonly kind: 'ol'; readonly items: readonly string[] }
  | { readonly kind: 'code'; readonly lang: string; readonly body: string }
  | { readonly kind: 'quote'; readonly text: string }
  | { readonly kind: 'table'; readonly header: readonly string[]; readonly rows: readonly (readonly string[])[] };

/**
 * Strip LLM chain-of-thought scratchpad blocks. Some models (Gemini 2.5 Flash with
 * "thinking" enabled, DeepSeek-R1, Claude with a stray "reasoning" probe) leak their
 * internal reasoning inside <think>…</think> or <reasoning>…</reasoning> wrappers.
 * Surfacing that to the candidate is confusing + breaks the illusion of a tight answer.
 * We also run this during streaming so partial/unclosed tags don't render their
 * contents before the close arrives.
 */
function stripScratchpad(src: string): string {
  let out = src;
  // Closed blocks.
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  out = out.replace(/<scratchpad>[\s\S]*?<\/scratchpad>/gi, '');
  // Unclosed: the model emitted <think> but hasn't closed it yet (streaming). Drop
  // everything from the open tag to end-of-buffer so the candidate doesn't see the
  // reasoning flicker onscreen before the close arrives.
  out = out.replace(/<think>[\s\S]*$/gi, '');
  out = out.replace(/<reasoning>[\s\S]*$/gi, '');
  out = out.replace(/<scratchpad>[\s\S]*$/gi, '');
  return out.trim();
}

function parseBlocks(src: string): Block[] {
  const lines = stripScratchpad(src).replace(/\r\n/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block.
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? '';
      const bodyLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        bodyLines.push(lines[i]!);
        i += 1;
      }
      i += 1; // consume closing fence (if present; if missing we still render)
      out.push({ kind: 'code', lang, body: bodyLines.join('\n') });
      continue;
    }

    // Heading.
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ kind: 'h', level: h[1]!.length as 1 | 2 | 3, text: h[2]!.trim() });
      i += 1;
      continue;
    }

    // Blockquote.
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      const quoteLines: string[] = [q[1]!];
      i += 1;
      while (i < lines.length) {
        const next = /^>\s?(.*)$/.exec(lines[i]!);
        if (!next) break;
        quoteLines.push(next[1]!);
        i += 1;
      }
      out.push({ kind: 'quote', text: quoteLines.join(' ').trim() });
      continue;
    }

    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      out.push({ kind: 'ul', items });
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+\.\s+/, ''));
        i += 1;
      }
      out.push({ kind: 'ol', items });
      continue;
    }

    // Markdown table (header | header\n-----|-----\ncell | cell). Detect the divider
    // row by splitting on `|` and checking every non-empty cell is dashes + optional
    // alignment colons. Works with or without outer pipes, any amount of internal
    // whitespace, and markdown variants like `:---:` / `---:` / `:---`.
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isTableDivider(lines[i + 1]!)
    ) {
      const header = splitTableRow(line);
      i += 2; // header + divider
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim().length > 0) {
        rows.push(splitTableRow(lines[i]!));
        i += 1;
      }
      out.push({ kind: 'table', header, rows });
      continue;
    }

    // Blank line: skip; paragraphs are built below.
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Paragraph: accumulate consecutive non-special lines.
    const paraLines: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !/^```/.test(lines[i]!) &&
      !/^(#{1,3})\s+/.test(lines[i]!) &&
      !/^\s*[-*]\s+/.test(lines[i]!) &&
      !/^\s*\d+\.\s+/.test(lines[i]!) &&
      !/^>\s?/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i += 1;
    }
    out.push({ kind: 'p', text: paraLines.join(' ').trim() });
  }
  return out;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function isTableDivider(line: string): boolean {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  if (cells.length === 0) return false;
  return cells.every((c) => /^\s*:?-{3,}:?\s*$/.test(c));
}

/** Inline parser: bold (**x**), italic (*x*), inline code (`x`). Returns ReactNodes. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  // Match `code` first (highest precedence), then **bold**, then *italic*.
  while (rest.length > 0) {
    // eslint-disable-next-line no-control-regex
    const match = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/.exec(rest);
    if (!match || match.index === undefined) {
      out.push(rest);
      break;
    }
    if (match.index > 0) out.push(rest.slice(0, match.index));
    const token = match[0]!;
    const key = `${keyPrefix}:${k++}`;
    if (token.startsWith('**') && token.endsWith('**')) {
      out.push(
        <strong key={key} className="font-semibold text-overlay-accent">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      out.push(
        <code
          key={key}
          className="rounded bg-white/10 px-1 py-[1px] font-mono text-[12px] text-overlay-accent"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
      out.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      out.push(token);
    }
    rest = rest.slice(match.index + token.length);
  }
  return out;
}

export function Markdown({ src }: { readonly src: string }) {
  const blocks = useMemo(() => parseBlocks(src), [src]);
  return (
    <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-overlay-text">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h':
            return (
              <div
                key={i}
                className={`font-semibold text-overlay-text ${
                  b.level === 1 ? 'text-[15px]' : b.level === 2 ? 'text-[14px]' : 'text-[13px]'
                }`}
              >
                {renderInline(b.text, `h${i}`)}
              </div>
            );
          case 'p':
            return (
              <p key={i} className="whitespace-pre-wrap">
                {renderInline(b.text, `p${i}`)}
              </p>
            );
          case 'ul':
            return (
              <ul key={i} className="ml-4 list-disc space-y-0.5">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it, `ul${i}-${j}`)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="ml-4 list-decimal space-y-0.5">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it, `ol${i}-${j}`)}</li>
                ))}
              </ol>
            );
          case 'code':
            return (
              <pre
                key={i}
                data-selectable="true"
                className="my-1 overflow-x-auto rounded border border-overlay-border bg-black/40 p-2 font-mono text-[12px] leading-snug"
              >
                {b.lang && (
                  <div className="mb-1 text-[9px] uppercase tracking-wider text-overlay-dim">
                    {b.lang}
                  </div>
                )}
                <code>{b.body}</code>
              </pre>
            );
          case 'quote':
            return (
              <blockquote
                key={i}
                className="border-l-2 border-overlay-accent pl-2 italic text-overlay-dim"
              >
                {renderInline(b.text, `q${i}`)}
              </blockquote>
            );
          case 'table':
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-overlay-border">
                      {b.header.map((h, j) => (
                        <th
                          key={j}
                          className="py-1 pr-3 text-left font-semibold text-overlay-accent"
                        >
                          {renderInline(h, `th${i}-${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, rr) => (
                      <tr key={rr} className="border-b border-overlay-border/30">
                        {r.map((c, cc) => (
                          <td key={cc} className="py-0.5 pr-3 align-top">
                            {renderInline(c, `td${i}-${rr}-${cc}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
