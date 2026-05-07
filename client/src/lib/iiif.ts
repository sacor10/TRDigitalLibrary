import { z } from 'zod';

const ImageServiceSchema = z
  .object({
    id: z.string().url().optional(),
    '@id': z.string().url().optional(),
  })
  .passthrough();

const LabelSchema = z.union([z.string(), z.record(z.array(z.string()))]).optional();

const AnnotationBodySchema = z
  .object({
    id: z.string().url().optional(),
    type: z.union([z.string(), z.array(z.string())]).optional(),
    service: z.array(ImageServiceSchema).optional(),
  })
  .passthrough();

const AnnotationSchema = z
  .object({
    body: z.union([AnnotationBodySchema, z.array(AnnotationBodySchema)]).optional(),
  })
  .passthrough();

const AnnotationPageSchema = z
  .object({
    items: z.array(AnnotationSchema).optional(),
  })
  .passthrough();

const CanvasSchema = z
  .object({
    id: z.string().url(),
    label: LabelSchema,
    items: z.array(AnnotationPageSchema).optional(),
  })
  .passthrough();

const ManifestSchema = z
  .object({
    id: z.string().url().optional(),
    '@id': z.string().url().optional(),
    label: LabelSchema,
    items: z.array(CanvasSchema).optional(),
  })
  .passthrough();

export type IIIFManifest = z.infer<typeof ManifestSchema>;
export type IIIFCanvas = z.infer<typeof CanvasSchema>;

export async function fetchManifest(url: string): Promise<IIIFManifest> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Failed to fetch IIIF manifest: ${res.status} ${res.statusText}`);
  }
  const raw: unknown = await res.json();
  return ManifestSchema.parse(raw);
}

export function extractCanvases(manifest: IIIFManifest): IIIFCanvas[] {
  return manifest.items ?? [];
}

export function canvasToInfoJson(canvas: IIIFCanvas): string | null {
  const annotation = canvas.items?.[0]?.items?.[0];
  if (!annotation) return null;
  const bodies = Array.isArray(annotation.body)
    ? annotation.body
    : annotation.body
      ? [annotation.body]
      : [];
  for (const body of bodies) {
    const service = body.service?.[0];
    const serviceId = service?.id ?? service?.['@id'];
    if (serviceId) {
      return serviceId.replace(/\/+$/, '') + '/info.json';
    }
  }
  return null;
}

export function canvasLabel(canvas: IIIFCanvas, index: number): string {
  const label = canvas.label;
  if (!label) return `Page ${index + 1}`;
  if (typeof label === 'string') return label;
  const firstLang = Object.values(label)[0];
  if (firstLang && firstLang.length > 0 && firstLang[0]) return firstLang[0];
  return `Page ${index + 1}`;
}
