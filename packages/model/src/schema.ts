import { z } from 'zod';

/** Runtime validation for snapshots coming from untrusted input (imports, API). */

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const num = z.number().finite();
const point = z.object({ x: num, y: num });

export const styleSchema = z
  .object({
    fill: color.nullable(),
    stroke: color.nullable(),
    strokeWidth: z.number().min(0).max(12),
    dash: z.enum(['solid', 'dashed', 'dotted']),
    textColor: color,
    fontFamily: z.enum(['sans', 'serif', 'mono']),
    fontSize: z.number().min(6).max(96),
    bold: z.boolean(),
    italic: z.boolean(),
    align: z.enum(['left', 'center', 'right']),
    color,
    width: z.number().min(0).max(12),
    head: z.enum(['arrow', 'open', 'none']),
    polaritySide: z.enum(['outside', 'inside']),
  })
  .partial();

const mdlElement = z
  .object({
    sketchId: z.number().int().optional(),
    fields: z.array(z.string().max(2000)).max(64).optional(),
    text: z.string().max(10000).optional(),
    rawName: z.string().max(1000).optional(),
  })
  .optional();

const base = {
  id: z.string().min(1).max(64),
  layerId: z.string().min(1).max(64),
  z: z.string().min(1).max(200),
  locked: z.boolean().optional(),
  style: styleSchema.optional(),
  mdl: mdlElement,
};

const text = z.string().max(10000);

export const elementSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('variable'),
    variableId: z.string().min(1).max(64),
    x: num,
    y: num,
    w: num,
    h: num,
    form: z.enum(['none', 'rect', 'rounded', 'ellipse']),
    isShadow: z.boolean().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('link'),
    from: z.string(),
    to: z.string(),
    control: point.nullable(),
    polarity: z.enum(['+', '-', '?']).nullable(),
    delay: z.boolean().optional(),
    label: z.string().max(500).optional(),
  }),
  z.object({
    ...base,
    type: z.literal('loop'),
    x: num,
    y: num,
    r: num,
    kind: z.enum(['R', 'B', 'custom']),
    label: z.string().max(200),
    name: z.string().max(500).optional(),
    direction: z.enum(['cw', 'ccw']),
    loopKey: z.string().max(10_000).optional(),
  }),
  z.object({
    ...base,
    type: z.literal('shape'),
    shape: z.enum(['rect', 'rounded', 'ellipse', 'diamond']),
    x: num,
    y: num,
    w: num,
    h: num,
    text: text.optional(),
  }),
  z.object({ ...base, type: z.literal('text'), x: num, y: num, w: num, h: num, text }),
]);

export const layerSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  order: z.string().min(1).max(200),
  visible: z.boolean(),
  locked: z.boolean(),
});

export const diagramSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  order: z.string().min(1).max(200),
  layers: z.record(z.string(), layerSchema),
  elements: z.record(z.string(), elementSchema),
  mdl: z
    .object({
      viewLine: z.string().max(2000).optional(),
      headerLine: z.string().max(5000).optional(),
      unknown: z
        .array(
          z.object({ sketchId: z.number().int(), lines: z.array(z.string().max(10000)).max(100) }),
        )
        .max(10000)
        .optional(),
    })
    .optional(),
});

export const variableSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(1000),
  units: z.string().max(1000).optional(),
  notes: z.string().max(10000).optional(),
  mdl: z
    .object({
      equation: z.string().max(100000).optional(),
      name: z.string().max(1000).optional(),
      causesKey: z.string().max(100000).optional(),
      order: z.number().optional(),
      unplaced: z.boolean().optional(),
    })
    .optional(),
});

export const threadSchema = z.object({
  id: z.string().min(1).max(64),
  diagramId: z.string(),
  elementId: z.string().optional(),
  x: num,
  y: num,
  resolved: z.boolean(),
  createdBy: z.string(),
  createdAt: z.number(),
  messages: z.array(
    z.object({
      id: z.string(),
      authorId: z.string(),
      authorName: z.string().max(200),
      body: z.string().max(10000),
      createdAt: z.number(),
      editedAt: z.number().optional(),
    }),
  ),
});

export const snapshotSchema = z.object({
  meta: z.object({
    schemaVersion: z.number().int(),
    vensim: z
      .object({
        preamble: z.string().max(1_000_000).optional(),
        controlSection: z.string().max(1_000_000).optional(),
        sketchHeader: z.string().max(10000).optional(),
        settings: z.string().max(1_000_000).optional(),
        lineEnding: z.enum(['\n', '\r\n']).optional(),
      })
      .optional(),
  }),
  variables: z.record(z.string(), variableSchema),
  diagrams: z.record(z.string(), diagramSchema),
  comments: z.record(z.string(), threadSchema),
});
