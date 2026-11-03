import { memo } from 'react';
import { dashArray, FONT_STACKS, type ElementLayout, type Prim } from '@cld/render';

/** React rendering of render primitives — the same primitives the SVG/PNG/PDF exporter serialises. */
export function PrimView({ p }: { p: Prim }) {
  if (p.t === 'text') {
    return (
      <text
        fontFamily={FONT_STACKS[p.font.family]}
        fontSize={p.font.size}
        fontWeight={p.font.bold ? 'bold' : undefined}
        fontStyle={p.font.italic ? 'italic' : undefined}
        textDecoration={
          p.font.underline || p.font.strike
            ? [p.font.underline && 'underline', p.font.strike && 'line-through']
                .filter(Boolean)
                .join(' ')
            : undefined
        }
        fill={p.fill}
        textAnchor={p.anchor}
        xmlSpace="preserve"
      >
        {p.lines.map((l, i) => (
          <tspan key={i} x={p.x} y={l.y}>
            {l.text}
          </tspan>
        ))}
      </text>
    );
  }
  const w = p.width ?? 1;
  const paint = {
    fill: p.fill ?? 'none',
    stroke: p.stroke,
    strokeWidth: p.stroke ? w : undefined,
    strokeDasharray: p.stroke ? dashArray(p.dash, w) : undefined,
  };
  if (p.t === 'path')
    return (
      <path d={p.d} {...paint} strokeLinecap={p.cap} strokeLinejoin={p.cap ? 'round' : undefined} />
    );
  if (p.t === 'rect') return <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.rx} {...paint} />;
  return <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} {...paint} />;
}

/** One diagram element with an invisible hit area for pointer interaction. */
export const ElementView = memo(function ElementView({
  layout,
  hideText,
  dimmed,
}: {
  layout: ElementLayout;
  hideText: boolean;
  dimmed: boolean;
}) {
  const b = layout.bbox;
  return (
    <g data-id={layout.id} data-type={layout.type} opacity={dimmed ? 0.35 : undefined}>
      {layout.link ? (
        <path
          d={layout.link.d}
          stroke="transparent"
          strokeWidth={14}
          fill="none"
          pointerEvents="stroke"
        />
      ) : (
        <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="transparent" pointerEvents="all" />
      )}
      {layout.prims.map((p, i) => (hideText && p.t === 'text' ? null : <PrimView key={i} p={p} />))}
    </g>
  );
});
