import { parseMdl, MAX_MDL_BYTES } from '@cld/mdl';
import { snapshotSchema, type ProjectSnapshot } from '@cld/model';

export interface LoadedFile {
  name: string;
  snapshot: ProjectSnapshot;
  warnings: string[];
}

export const ACCEPTED_FILES = '.mdl,.json';

/** Read a Vensim .mdl or Loopboard .cld.json file into a project snapshot. */
export async function readDiagramFile(file: File): Promise<LoadedFile> {
  if (file.size > MAX_MDL_BYTES) throw new Error('This file is too large (max 5 MB).');
  const lower = file.name.toLowerCase();
  const base = file.name.replace(/\.(cld\.json|json|mdl)$/i, '').trim() || 'Imported diagram';
  const text = await file.text();
  if (lower.endsWith('.mdl')) {
    const { snapshot, warnings } = parseMdl(text);
    return { name: base, snapshot, warnings };
  }
  if (lower.endsWith('.json')) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('This file is not valid JSON.');
    }
    const wrapper = data as { format?: string; project?: { name?: string }; doc?: unknown };
    if (wrapper.format !== 'cld') throw new Error('This JSON file is not a Loopboard diagram.');
    const parsed = snapshotSchema.safeParse(wrapper.doc);
    if (!parsed.success)
      throw new Error('This diagram file is damaged or from an incompatible version.');
    return {
      name: wrapper.project?.name || base,
      snapshot: parsed.data as ProjectSnapshot,
      warnings: [],
    };
  }
  throw new Error('Unsupported file type. Choose a Vensim .mdl or a Loopboard .cld.json file.');
}
