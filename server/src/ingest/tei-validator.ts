import {
  attrs,
  findChild,
  nodeText,
  tagName,
  type ParsedTei,
} from './tei-parser.js';

export interface ValidationOk {
  ok: true;
  warnings: string[];
}
export interface ValidationFail {
  ok: false;
  errors: string[];
  warnings: string[];
}
export type ValidationResult = ValidationOk | ValidationFail;

export function validateTei(parsed: ParsedTei): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const root = parsed.root;
  if (!root) {
    errors.push('Document has no root element');
    return { ok: false, errors, warnings };
  }
  if (tagName(root) !== 'TEI') {
    errors.push(`Root element must be <TEI>, got <${tagName(root) ?? '?'}>`);
    return { ok: false, errors, warnings };
  }

  const rootAttrs = attrs(root);
  if (!rootAttrs['@_xml:id']) {
    warnings.push('Root <TEI> has no @xml:id; document id will be derived from filename');
  }

  const teiHeader = findChild(root, 'teiHeader');
  if (!teiHeader) {
    errors.push('Missing required element: <teiHeader>');
  } else {
    const fileDesc = findChild(teiHeader, 'fileDesc');
    if (!fileDesc) {
      errors.push('Missing required element: <teiHeader>/<fileDesc>');
    } else {
      const titleStmt = findChild(fileDesc, 'titleStmt');
      if (!titleStmt) {
        errors.push('Missing required element: <fileDesc>/<titleStmt>');
      } else {
        const title = findChild(titleStmt, 'title');
        if (!title) {
          errors.push('Missing required element: <titleStmt>/<title>');
        } else if (nodeText(title).length === 0) {
          errors.push('<title> is empty');
        }
      }
      if (!findChild(fileDesc, 'publicationStmt')) {
        errors.push('Missing required element: <fileDesc>/<publicationStmt>');
      }
      if (!findChild(fileDesc, 'sourceDesc')) {
        errors.push('Missing required element: <fileDesc>/<sourceDesc>');
      }
    }
  }

  const textEl = findChild(root, 'text');
  if (!textEl) {
    errors.push('Missing required element: <text>');
  } else if (!findChild(textEl, 'body')) {
    errors.push('Missing required element: <text>/<body>');
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, warnings };
}
