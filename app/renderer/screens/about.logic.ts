// The Markdown of the owner's pages, parsed for the About me previews: the same text a worker's brief carries,
// structured into blocks and inline spans. Pure and tested; the rendering lives in AboutMe.tsx.

/** Inline Markdown as styled spans: bold, italics, code and links, with everything else as plain text. */
export type Span =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

/** A body's blocks: headings, bullets (nested by indent), tables, quotes and paragraphs. */
export type Block =
  | { kind: 'heading'; level: number; spans: Span[] }
  | { kind: 'item'; depth: number; number: number | null; spans: Span[] }
  | { kind: 'table'; head: Span[][]; rows: Span[][][] }
  | { kind: 'quote'; spans: Span[] }
  | { kind: 'text'; spans: Span[] };

const isWord = (character: string | undefined): boolean => character !== undefined && /[A-Za-z0-9]/.test(character);

const textSpan = (text: string): Span[] => (text ? [{ kind: 'text', text }] : []);

/** One inline pass: the first code span, link, autolink, bold or italic run, and where it sits. */
const nextSpan = (text: string, from: number): { start: number; end: number; span: Span } | null => {
  const rest = text.slice(from);
  const code = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/.exec(rest);
  const link = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
  const autolink = /<((?:https?|mailto):[^>\s]+)>/.exec(rest);
  const bold = /(\*\*|__)([\s\S]+?)\1/.exec(rest);
  // Italics need a non-word on the far side of each delimiter, so `snake_case` and `a * b` stay plain.
  const italic = /(\*|_)(\S(?:[\s\S]*?\S)?)\1/.exec(rest);
  if (italic) {
    const before = text[from + italic.index - 1];
    const after = text[from + italic.index + italic[0].length];
    if (isWord(before) || isWord(after)) italic.index = rest.length;
  }
  const found: { start: number; end: number; span: Span }[] = [];
  if (code) found.push({ start: code.index, end: code.index + code[0].length, span: { kind: 'code', text: code[2]! } });
  if (link) found.push({ start: link.index, end: link.index + link[0].length, span: { kind: 'link', text: link[1]!, href: link[2]! } });
  if (autolink) found.push({ start: autolink.index, end: autolink.index + autolink[0].length, span: { kind: 'link', text: autolink[1]!, href: autolink[1]! } });
  if (bold) found.push({ start: bold.index, end: bold.index + bold[0].length, span: { kind: 'bold', text: bold[2]! } });
  if (italic && italic.index < rest.length) found.push({ start: italic.index, end: italic.index + italic[0].length, span: { kind: 'italic', text: italic[2]! } });
  if (found.length === 0) return null;
  found.sort((first, second) => first.start - second.start || second.end - first.end);
  return found[0]!;
};

/** Inline Markdown of one line as spans: `**bold**`, `*italics*`, `_italics_`, `` `code` ``, `[text](url)` and `<url>`. */
export const inlineSpans = (text: string): Span[] => {
  const out: Span[] = [];
  let from = 0;
  for (;;) {
    const found = nextSpan(text, from);
    if (!found) break;
    if (found.start > 0) out.push({ kind: 'text', text: text.slice(from, from + found.start) });
    out.push(found.span);
    from += found.end;
  }
  return [...out, ...textSpan(text.slice(from))];
};

/** A table row's cells: the `|`s split, the outer ones dropped, the rest trimmed. */
const cells = (line: string): string[] =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

/** Whether a row is a table's rule of dashes, as in `| --- | --- |`. */
const isRule = (row: string[]): boolean => row.length > 0 && row.every((cell) => /^:?-+:?$/.test(cell));

/** A body as blocks. Consecutive plain lines join into one paragraph, as Markdown reads them; rules are quiet. */
export const pageBlocks = (markdown: string): Block[] => {
  const blocks: Block[] = [];
  const lines = markdown.split('\n');
  let paragraph: string[] = [];
  let quote: string[] = [];
  const endParagraph = (): void => {
    if (paragraph.length) blocks.push({ kind: 'text', spans: inlineSpans(paragraph.join(' ')) });
    paragraph = [];
  };
  const endQuote = (): void => {
    if (quote.length) blocks.push({ kind: 'quote', spans: inlineSpans(quote.join(' ')) });
    quote = [];
  };
  const endLoose = (): void => { endParagraph(); endQuote(); };
  for (let at = 0; at < lines.length; at++) {
    const trimmed = lines[at]!.trim();
    if (!trimmed) { endLoose(); continue; }
    // A rule only splits pages visually; the sections already carry their own borders.
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) { endLoose(); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      endLoose();
      blocks.push({ kind: 'heading', level: heading[1]!.length, spans: inlineSpans(heading[2]!) });
      continue;
    }
    if (trimmed.startsWith('|')) {
      endLoose();
      const rows = [cells(trimmed)];
      while (at + 1 < lines.length && lines[at + 1]!.trim().startsWith('|')) rows.push(cells(lines[++at]!.trim()));
      const rule = rows.length > 1 && isRule(rows[1]!);
      blocks.push({
        kind: 'table',
        head: rule ? rows[0]!.map(inlineSpans) : [],
        rows: (rule ? rows.slice(2) : rows).map((row) => row.map(inlineSpans)),
      });
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(lines[at]!);
    if (bullet) {
      endLoose();
      blocks.push({ kind: 'item', depth: Math.min(2, Math.floor(bullet[1]!.length / 2)), number: null, spans: inlineSpans(bullet[2]!) });
      continue;
    }
    const ordered = /^(\s*)(\d{1,3})[.)]\s+(.*)$/.exec(lines[at]!);
    if (ordered) {
      endLoose();
      blocks.push({ kind: 'item', depth: Math.min(2, Math.floor(ordered[1]!.length / 2)), number: Number(ordered[2]), spans: inlineSpans(ordered[3]!) });
      continue;
    }
    const said = /^>\s?(.*)$/.exec(trimmed);
    if (said) { endParagraph(); quote.push(said[1]!); continue; }
    paragraph.push(trimmed);
  }
  endLoose();
  return blocks;
};
