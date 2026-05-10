import type {
  AnnotationSelector,
  AnnotationTarget,
  TextPositionSelector,
  TextQuoteSelector,
} from '@tr/shared';

const QUOTE_CONTEXT_CHARS = 48;

function offsetWithin(root: Node, node: Node, offset: number): number {
  if (node === root && node.nodeType === Node.ELEMENT_NODE) {
    let total = 0;
    const children = root.childNodes;
    for (let i = 0; i < offset && i < children.length; i++) {
      total += children[i]?.textContent?.length ?? 0;
    }
    return total;
  }
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  const text = range.toString();
  range.detach?.();
  return text.length;
}

export interface CapturedSelection {
  startOffset: number;
  endOffset: number;
  exact: string;
  prefix: string;
  suffix: string;
}

export function captureSelectionWithin(
  selection: Selection,
  root: HTMLElement,
): CapturedSelection | null {
  if (selection.rangeCount === 0) return null;
  if (selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (!range || range.collapsed) return null;
  if (!root.contains(range.commonAncestorContainer)) return null;

  const exact = range.toString();
  const trimmed = exact.replace(/\s+$/g, '');
  if (trimmed.length === 0) return null;

  const startOffset = offsetWithin(root, range.startContainer, range.startOffset);
  const endOffset = startOffset + exact.length;

  const fullText = root.textContent ?? '';
  const prefix = fullText.slice(Math.max(0, startOffset - QUOTE_CONTEXT_CHARS), startOffset);
  const suffix = fullText.slice(endOffset, endOffset + QUOTE_CONTEXT_CHARS);

  return { startOffset, endOffset, exact, prefix, suffix };
}

export function captureSelectionToTarget(
  documentId: string,
  sectionId: string | null,
  capture: CapturedSelection,
): AnnotationTarget {
  const textQuote: TextQuoteSelector = {
    type: 'TextQuoteSelector',
    exact: capture.exact,
    prefix: capture.prefix || undefined,
    suffix: capture.suffix || undefined,
  };
  const textPosition: TextPositionSelector = {
    type: 'TextPositionSelector',
    start: capture.startOffset,
    end: capture.endOffset,
  };
  return {
    source: `urn:tr-digital-library:document:${documentId}`,
    selector: sectionId
      ? [
          {
            type: 'FragmentSelector',
            value: `section=${sectionId}`,
            refinedBy: [textQuote, textPosition],
          },
          textQuote,
          textPosition,
        ]
      : [textQuote, textPosition],
  };
}

export interface AnnotationRange {
  start: number;
  end: number;
}

function findInnerSelectors(
  selector: AnnotationSelector | AnnotationSelector[] | undefined,
): { quote?: TextQuoteSelector; position?: TextPositionSelector } {
  const out: { quote?: TextQuoteSelector; position?: TextPositionSelector } = {};
  if (!selector) return out;
  const flat = Array.isArray(selector) ? selector : [selector];
  for (const s of flat) {
    if (s.type === 'TextQuoteSelector' && !out.quote) out.quote = s;
    if (s.type === 'TextPositionSelector' && !out.position) out.position = s;
    if (s.type === 'FragmentSelector' && s.refinedBy) {
      const inner = findInnerSelectors(s.refinedBy);
      if (inner.quote && !out.quote) out.quote = inner.quote;
      if (inner.position && !out.position) out.position = inner.position;
    }
  }
  return out;
}

export function locateAnnotationRange(
  selector: AnnotationSelector | AnnotationSelector[],
  fullText: string,
): AnnotationRange | null {
  const { quote, position } = findInnerSelectors(selector);

  if (quote) {
    const candidate = position && position.start >= 0 ? position.start : 0;
    const exact = quote.exact;
    const prefix = quote.prefix ?? '';
    const suffix = quote.suffix ?? '';

    let cursor = 0;
    let best: number | null = null;
    let bestDistance = Infinity;
    while (cursor <= fullText.length) {
      const idx = fullText.indexOf(exact, cursor);
      if (idx === -1) break;
      const before = fullText.slice(Math.max(0, idx - prefix.length), idx);
      const after = fullText.slice(idx + exact.length, idx + exact.length + suffix.length);
      const prefixOk = prefix.length === 0 || before.endsWith(prefix);
      const suffixOk = suffix.length === 0 || after.startsWith(suffix);
      if (prefixOk && suffixOk) {
        const d = Math.abs(idx - candidate);
        if (d < bestDistance) {
          best = idx;
          bestDistance = d;
        }
      }
      cursor = idx + 1;
    }
    if (best !== null) {
      return { start: best, end: best + exact.length };
    }
  }

  if (position) {
    if (
      position.start >= 0 &&
      position.end <= fullText.length &&
      position.end > position.start
    ) {
      return { start: position.start, end: position.end };
    }
  }

  return null;
}
