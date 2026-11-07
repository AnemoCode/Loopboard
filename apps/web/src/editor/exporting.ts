import { writeMdl } from '@cld/mdl';
import { byKey, type ProjectSnapshot } from '@cld/model';
import { darkTheme, lightTheme, renderDiagramSvg, type SvgOptions } from '@cld/render';
import { downloadBlob, safeFilename } from '../lib/download';

export type ExportFormat = 'png' | 'svg' | 'pdf' | 'mdl' | 'json';

export interface ExportOptions {
  format: ExportFormat;
  scope: 'diagram' | 'selection' | 'all';
  scale: number;
  background: 'white' | 'transparent' | 'theme';
  dark: boolean;
  includeHidden: boolean;
}

function svgOptions(o: ExportOptions, extra: Partial<SvgOptions> = {}): SvgOptions {
  const theme = o.dark ? darkTheme : lightTheme;
  return {
    theme,
    includeHidden: o.includeHidden,
    background:
      o.background === 'transparent'
        ? null
        : o.background === 'white' && !o.dark
          ? '#ffffff'
          : theme.background,
    ...extra,
  };
}

async function svgToPng(svg: string, width: number, height: number, scale: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const c = canvas.getContext('2d')!;
    c.scale(scale, scale);
    c.drawImage(img, 0, 0, width, height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function mdlPreflight(snap: ProjectSnapshot): string[] {
  return writeMdl(snap).warnings;
}

/** Run an export and trigger the browser download. */
export async function runExport(
  snap: ProjectSnapshot,
  projectName: string,
  diagramId: string,
  selection: string[],
  o: ExportOptions,
): Promise<void> {
  const base = safeFilename(projectName);
  const diagrams = Object.values(snap.diagrams).sort(byKey((d) => d.order));
  const current = snap.diagrams[diagramId]!;
  const name = (d: { name: string }) =>
    diagrams.length > 1 ? `${base} - ${safeFilename(d.name)}` : base;
  const only = o.scope === 'selection' && selection.length ? new Set(selection) : undefined;

  switch (o.format) {
    case 'json': {
      const data = {
        format: 'cld',
        version: 1,
        exportedAt: new Date().toISOString(),
        app: { name: 'loopwise' },
        project: { name: projectName },
        doc: snap,
      };
      downloadBlob(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        `${base}.cld.json`,
      );
      return;
    }
    case 'mdl': {
      const { text } = writeMdl(snap);
      downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${base}.mdl`);
      return;
    }
    case 'svg': {
      const targets = o.scope === 'all' ? diagrams : [current];
      for (const d of targets) {
        const { svg } = renderDiagramSvg(snap, d.id, svgOptions(o, { only, title: d.name }));
        downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name(d)}.svg`);
      }
      return;
    }
    case 'png': {
      const targets = o.scope === 'all' ? diagrams : [current];
      for (const d of targets) {
        const { svg, width, height } = renderDiagramSvg(snap, d.id, svgOptions(o, { only }));
        downloadBlob(await svgToPng(svg, width, height, o.scale), `${name(d)}.png`);
      }
      return;
    }
    case 'pdf': {
      const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
      const targets = o.scope === 'all' ? diagrams : [current];
      let pdf: InstanceType<typeof jsPDF> | null = null;
      for (const d of targets) {
        const { svg, width, height } = renderDiagramSvg(
          snap,
          d.id,
          svgOptions(o, { only, fontMode: 'pdf' }),
        );
        const orientation = width >= height ? 'landscape' : 'portrait';
        if (!pdf)
          pdf = new jsPDF({ unit: 'pt', format: [width, height], orientation, compress: true });
        else pdf.addPage([width, height], orientation);
        const el = new DOMParser().parseFromString(svg, 'image/svg+xml')
          .documentElement as unknown as SVGElement;
        // svg2pdf needs the element in the DOM to resolve styles.
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:-99999px;top:0';
        host.appendChild(el);
        document.body.appendChild(host);
        try {
          await svg2pdf(el, pdf, { x: 0, y: 0, width, height });
        } finally {
          host.remove();
        }
      }
      pdf!.setProperties({ title: projectName, creator: 'Loopwise' });
      downloadBlob(pdf!.output('blob'), `${base}.pdf`);
      return;
    }
  }
}
