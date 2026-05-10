import type { DocumentSectionType } from '@tr/shared';
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';


export type ParsedNode = Record<string, unknown>;

export interface ParsedTei {
  tree: ParsedNode[];
  root: ParsedNode | null;
}

export interface TeiMetadata {
  xmlId: string | null;
  title: string;
  publicationStmt: string;
  sourceDesc: string;
  date: string | null;
  recipient: string | null;
  author: string | null;
  genre: string | null;
}

export interface SectionNode {
  id: string;
  parentId: string | null;
  order: number;
  level: number;
  type: DocumentSectionType;
  n: string | null;
  heading: string | null;
  text: string;
  xmlFragment: string;
}

const PARSER_OPTIONS = {
  preserveOrder: true as const,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: false,
  textNodeName: '#text',
};

const parser = new XMLParser(PARSER_OPTIONS);
const builder = new XMLBuilder(PARSER_OPTIONS);

const SECTION_TAGS = new Set<DocumentSectionType>([
  'div',
  'head',
  'p',
  'lg',
  'l',
  'quote',
  'list',
  'item',
  'note',
]);

const RECURSE_TAGS = new Set<DocumentSectionType>(['div', 'lg', 'list', 'quote', 'p', 'item']);

export function tagName(node: ParsedNode | null | undefined): string | null {
  if (!node) return null;
  for (const k of Object.keys(node)) {
    if (k !== ':@') return k;
  }
  return null;
}

export function attrs(node: ParsedNode): Record<string, string> {
  const a = node[':@'];
  if (a && typeof a === 'object') return a as Record<string, string>;
  return {};
}

export function children(node: ParsedNode): ParsedNode[] {
  const tn = tagName(node);
  if (!tn) return [];
  const value = node[tn];
  return Array.isArray(value) ? (value as ParsedNode[]) : [];
}

export function findChild(node: ParsedNode, name: string): ParsedNode | undefined {
  return children(node).find((c) => tagName(c) === name);
}

export function findAllChildren(node: ParsedNode, name: string): ParsedNode[] {
  return children(node).filter((c) => tagName(c) === name);
}

function collectText(node: ParsedNode): string {
  const parts: string[] = [];
  const walk = (n: ParsedNode): void => {
    const tn = tagName(n);
    if (tn === '#text') {
      const v = n['#text'];
      if (v != null) parts.push(String(v));
      return;
    }
    if (tn) {
      for (const c of children(n)) walk(c);
    }
  };
  walk(node);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

export function nodeText(node: ParsedNode): string {
  return collectText(node);
}

export function parseTei(xml: string): ParsedTei {
  const result = XMLValidator.validate(xml, { allowBooleanAttributes: true });
  if (result !== true) {
    const err = result.err;
    throw new Error(`Malformed XML at line ${err.line}: ${err.msg}`);
  }
  const tree = parser.parse(xml) as ParsedNode[];
  const root =
    tree.find((n) => {
      const t = tagName(n);
      return t !== null && t !== '?xml' && t !== '#text';
    }) ?? null;
  return { tree, root };
}

export function extractMetadata(parsed: ParsedTei): TeiMetadata {
  const root = parsed.root;
  if (!root || tagName(root) !== 'TEI') {
    return {
      xmlId: null,
      title: '',
      publicationStmt: '',
      sourceDesc: '',
      date: null,
      recipient: null,
      author: null,
      genre: null,
    };
  }

  const rootAttrs = attrs(root);
  const xmlId = rootAttrs['@_xml:id'] ?? null;

  const teiHeader = findChild(root, 'teiHeader');
  const fileDesc = teiHeader ? findChild(teiHeader, 'fileDesc') : undefined;
  const titleStmt = fileDesc ? findChild(fileDesc, 'titleStmt') : undefined;
  const titleNode = titleStmt ? findChild(titleStmt, 'title') : undefined;
  const authorNode = titleStmt ? findChild(titleStmt, 'author') : undefined;
  const publicationStmtNode = fileDesc ? findChild(fileDesc, 'publicationStmt') : undefined;
  const sourceDescNode = fileDesc ? findChild(fileDesc, 'sourceDesc') : undefined;

  const profileDesc = teiHeader ? findChild(teiHeader, 'profileDesc') : undefined;
  const creation = profileDesc ? findChild(profileDesc, 'creation') : undefined;
  const dateNode = creation ? findChild(creation, 'date') : undefined;
  let date: string | null = null;
  if (dateNode) {
    const dAttrs = attrs(dateNode);
    date = dAttrs['@_when'] ?? (collectText(dateNode) || null);
  }

  let recipient: string | null = null;
  const correspDesc = profileDesc ? findChild(profileDesc, 'correspDesc') : undefined;
  if (correspDesc) {
    const actions = findAllChildren(correspDesc, 'correspAction');
    const received = actions.find((a) => attrs(a)['@_type'] === 'received');
    if (received) {
      const persName = findChild(received, 'persName');
      if (persName) recipient = collectText(persName) || null;
    }
  }

  const textBody = findChild(root, 'text');
  let genre: string | null = null;
  const textDesc = profileDesc ? findChild(profileDesc, 'textDesc') : undefined;
  if (textDesc) {
    const channel = findChild(textDesc, 'channel');
    if (channel) genre = collectText(channel) || null;
  }
  if (!genre && textBody) {
    const front = findChild(textBody, 'front');
    if (front) {
      const noteGenre = findAllChildren(front, 'note').find(
        (n) => attrs(n)['@_type'] === 'genre',
      );
      if (noteGenre) genre = collectText(noteGenre) || null;
    }
  }

  return {
    xmlId,
    title: titleNode ? collectText(titleNode) : '',
    publicationStmt: publicationStmtNode ? collectText(publicationStmtNode) : '',
    sourceDesc: sourceDescNode ? collectText(sourceDescNode) : '',
    date,
    recipient,
    author: authorNode ? collectText(authorNode) || null : null,
    genre,
  };
}

export function extractPlainText(parsed: ParsedTei): string {
  const root = parsed.root;
  if (!root) return '';
  const textEl = findChild(root, 'text');
  if (!textEl) return '';
  const body = findChild(textEl, 'body');
  if (!body) return '';
  return collectText(body);
}

export function extractSections(parsed: ParsedTei, documentId: string): SectionNode[] {
  const root = parsed.root;
  if (!root) return [];
  const textEl = findChild(root, 'text');
  if (!textEl) return [];
  const body = findChild(textEl, 'body');
  if (!body) return [];

  const sections: SectionNode[] = [];
  let counter = 0;

  const walk = (node: ParsedNode, level: number, parentId: string | null): void => {
    const tn = tagName(node);
    if (!tn || !SECTION_TAGS.has(tn as DocumentSectionType)) return;
    const sectionType = tn as DocumentSectionType;

    const order = counter++;
    const id = `${documentId}:s${order}`;
    const a = attrs(node);
    const headChild = children(node).find((c) => tagName(c) === 'head');
    const heading = headChild ? collectText(headChild) || null : null;

    sections.push({
      id,
      parentId,
      order,
      level,
      type: sectionType,
      n: a['@_n'] ?? null,
      heading,
      text: collectText(node),
      xmlFragment: builder.build([node]) as string,
    });

    if (RECURSE_TAGS.has(sectionType)) {
      for (const child of children(node)) {
        const childTag = tagName(child);
        if (childTag === 'head') continue;
        walk(child, level + 1, id);
      }
    }
  };

  for (const child of children(body)) {
    walk(child, 0, null);
  }

  return sections;
}
