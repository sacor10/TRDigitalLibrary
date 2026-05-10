import { ANNOTATION_JSONLD_CONTEXT, type Annotation } from '@tr/shared';

export function annotationToJsonLd(annotation: Annotation): Record<string, unknown> {
  const { documentId: _doc, sectionId: _sec, ...rest } = annotation;
  return { '@context': ANNOTATION_JSONLD_CONTEXT, ...rest };
}

export function annotationToJsonLdString(annotation: Annotation): string {
  return JSON.stringify(annotationToJsonLd(annotation), null, 2);
}
