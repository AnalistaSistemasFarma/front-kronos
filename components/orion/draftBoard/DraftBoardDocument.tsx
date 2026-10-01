'use client';

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Paper, Text } from '@mantine/core';
import { IconHighlight } from '@tabler/icons-react';
import {
  alignBlocks,
  diffText,
  findAnchor,
  tokenize,
  type DiffOp,
  type DraftAnchor,
  type DraftBlock,
} from '../../../lib/orion/draftDiff';
import type { DraftMark } from '../../../lib/orion/draftBoardDb';

export type DraftSelection = { blockIndex: number; quote: string };

type Props = {
  blocks: DraftBlock[];
  /** Subversión anterior (null = primera o vista limpia). */
  previousBlocks: DraftBlock[] | null;
  versionLabel: string;
  /** Marcas visibles en esta subversión. */
  marks: DraftMark[];
  activeMarkId: number | null;
  onMarkClick: (id: number) => void;
  /** null = no se puede marcar en esta vista. */
  onSelect: ((sel: DraftSelection) => void) | null;
  /** Párrafo → quién está escribiendo ahí. */
  typing: Record<number, string>;
};

type PlacedMark = { mark: DraftMark; anchor: DraftAnchor; fixed: boolean };

const INS_STYLE = {
  color: 'var(--mantine-color-green-light-color)',
  background: 'var(--mantine-color-green-light)',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
} as const;
const DEL_STYLE = {
  color: 'var(--mantine-color-red-light-color)',
  background: 'var(--mantine-color-red-light)',
  textDecoration: 'line-through',
  userSelect: 'none',
} as const;

function placeMarks(marks: DraftMark[], blocks: DraftBlock[], versionLabel: string, versionOrder: (v: string) => number): PlacedMark[] {
  const current = versionOrder(versionLabel);
  const placed: PlacedMark[] = [];
  for (const mark of marks) {
    if (versionOrder(mark.createdVersion) > current) continue;
    const fixedHere = mark.fixedIn && mark.fixedQuote && versionOrder(mark.fixedIn) <= current;
    if (fixedHere) {
      const anchor = findAnchor(blocks, mark.fixedQuote!, mark.blockIndex);
      if (anchor) {
        placed.push({ mark, anchor, fixed: true });
        continue;
      }
    }
    const anchor = findAnchor(blocks, mark.quote, mark.blockIndex);
    if (anchor) placed.push({ mark, anchor, fixed: Boolean(mark.fixedIn && versionOrder(mark.fixedIn) <= current) });
  }
  return placed;
}

type Segment = {
  t: DiffOp['t'];
  v: string;
  bold: boolean;
  hit: PlacedMark | null;
  badges: PlacedMark[];
};

/**
 * Une los tokens seguidos con el mismo formato en un solo tramo: así una marca o un texto
 * agregado se pinta como un bloque continuo y no palabra por palabra.
 */
function buildSegments(ops: DiffOp[], block: DraftBlock, placed: PlacedMark[]): Segment[] {
  const leadLength = block.lead && block.text.startsWith(block.lead) ? block.lead.length : 0;
  const shown = new Set<number>();
  const segments: Segment[] = [];
  let pos = 0;
  for (const op of ops) {
    let item: Segment;
    if (op.t === 'del') {
      item = { t: 'del', v: op.v, bold: false, hit: null, badges: [] };
    } else {
      const start = pos;
      const end = pos + op.v.length;
      pos = end;
      const badges = placed.filter((p) => !shown.has(p.mark.id) && end >= p.anchor.end);
      badges.forEach((p) => shown.add(p.mark.id));
      item = {
        t: op.t,
        v: op.v,
        bold: start < leadLength,
        hit: placed.find((p) => start < p.anchor.end && end > p.anchor.start) ?? null,
        badges,
      };
    }
    const last = segments[segments.length - 1];
    if (last && last.badges.length === 0 && last.t === item.t && last.bold === item.bold && last.hit === item.hit) {
      last.v += item.v;
      last.badges = item.badges;
    } else {
      segments.push(item);
    }
  }
  return segments;
}

function BlockText({
  ops,
  block,
  placed,
  activeMarkId,
  onMarkClick,
}: {
  ops: DiffOp[];
  block: DraftBlock;
  placed: PlacedMark[];
  activeMarkId: number | null;
  onMarkClick: (id: number) => void;
}) {
  const nodes: ReactNode[] = [];
  buildSegments(ops, block, placed).forEach((seg, k) => {
    if (seg.t === 'del') {
      nodes.push(
        <del key={k} style={DEL_STYLE}>
          {seg.v}
        </del>
      );
      return;
    }
    let node: ReactNode = seg.bold ? <strong>{seg.v}</strong> : seg.v;
    if (seg.t === 'ins') node = <ins style={INS_STYLE}>{node}</ins>;
    if (seg.hit) {
      const { mark, fixed } = seg.hit;
      const color = fixed ? 'teal' : 'yellow';
      node = (
        <mark
          data-mark={mark.id}
          onClick={() => onMarkClick(mark.id)}
          style={{
            background: `var(--mantine-color-${color}-light)`,
            color: 'inherit',
            borderBottom: `2px solid var(--mantine-color-${color}-6)`,
            borderRadius: 2,
            padding: '0 1px',
            boxDecorationBreak: 'clone',
            WebkitBoxDecorationBreak: 'clone',
            outline: activeMarkId === mark.id ? '2px solid var(--mantine-color-blue-5)' : undefined,
            outlineOffset: 1,
            cursor: 'pointer',
          }}
        >
          {node}
        </mark>
      );
    }
    nodes.push(<span key={k}>{node}</span>);
    for (const p of seg.badges) {
      nodes.push(
        <button
          key={`b${p.mark.id}`}
          type='button'
          data-mark={p.mark.id}
          onClick={() => onMarkClick(p.mark.id)}
          aria-label={`Ver marca ${p.mark.number}`}
          style={{
            userSelect: 'none',
            border: 0,
            cursor: 'pointer',
            verticalAlign: 'super',
            fontFamily: 'var(--mantine-font-family)',
            fontSize: 10,
            fontWeight: 700,
            lineHeight: '16px',
            minWidth: 16,
            padding: '0 4px',
            marginLeft: 2,
            borderRadius: 8,
            color: 'var(--mantine-color-white)',
            background: `var(--mantine-color-${p.fixed ? 'teal' : 'yellow'}-7)`,
          }}
        >
          {p.mark.number}
        </button>
      );
    }
  });
  return <>{nodes}</>;
}

/** Documento del tablero: párrafos del Word con control de cambios y marcas. */
export default function DraftBoardDocument({
  blocks,
  previousBlocks,
  versionLabel,
  marks,
  activeMarkId,
  onMarkClick,
  onSelect,
  typing,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<(DraftSelection & { top: number; left: number }) | null>(null);

  const versionOrder = useCallback((label: string) => {
    const m = /^v?0\.(\d+)$/i.exec(label);
    return m ? Number(m[1]) : 0;
  }, []);

  const placed = useMemo(
    () => placeMarks(marks, blocks, versionLabel, versionOrder),
    [marks, blocks, versionLabel, versionOrder]
  );

  const rows = useMemo(() => {
    if (!previousBlocks) {
      return blocks.map((block, index) => ({
        key: `n${index}`,
        index,
        block,
        ops: tokenize(block.text).map((v) => ({ t: 'eq' as const, v })),
        kind: 'eq' as const,
      }));
    }
    return alignBlocks(previousBlocks, blocks).map((row, k) => {
      if (row.type === 'del') {
        const block = previousBlocks[row.oldIndex];
        return { key: `d${k}`, index: -1, block, ops: [{ t: 'del' as const, v: block.text }], kind: 'del' as const };
      }
      const block = blocks[row.newIndex];
      const ops: DiffOp[] =
        row.type === 'ins'
          ? tokenize(block.text).map((v) => ({ t: 'ins', v }))
          : row.type === 'mod'
            ? diffText(previousBlocks[row.oldIndex].text, block.text)
            : tokenize(block.text).map((v) => ({ t: 'eq', v }));
      return { key: `r${k}`, index: row.newIndex, block, ops, kind: row.type };
    });
  }, [blocks, previousBlocks]);

  const handleMouseUp = () => {
    if (!onSelect) return;
    const sel = window.getSelection();
    const wrap = wrapRef.current;
    if (!sel || sel.isCollapsed || !sel.rangeCount || !wrap) {
      setPending(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const blockOf = (node: Node | null) =>
      (node?.nodeType === 1 ? (node as Element) : node?.parentElement)?.closest<HTMLElement>('[data-block]') ?? null;
    const startBlock = blockOf(range.startContainer);
    const endBlock = blockOf(range.endContainer);
    const quote = sel.toString().replace(/\s+/g, ' ').trim();
    if (!startBlock || startBlock !== endBlock || quote.length < 2) {
      setPending(null);
      return;
    }
    const index = Number(startBlock.dataset.block);
    if (!(index >= 0) || !blocks[index]?.text.includes(quote)) {
      setPending(null);
      return;
    }
    const box = wrap.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    setPending({
      blockIndex: index,
      quote,
      top: rect.bottom - box.top + 6,
      left: Math.max(8, Math.min(rect.left - box.left, box.width - 170)),
    });
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onMouseUp={handleMouseUp}>
      <Paper
        withBorder
        shadow='sm'
        radius='sm'
        maw={780}
        mx='auto'
        px={{ base: 'md', sm: 48 }}
        py={{ base: 'md', sm: 40 }}
        style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 15.5,
          lineHeight: 1.75,
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
          minHeight: 320,
        }}
      >
        {rows.length === 0 ? (
          <Text c='dimmed' ta='center'>
            Esta subversión no tiene texto para mostrar.
          </Text>
        ) : (
          rows.map((row) => {
            const inBlock = row.index >= 0 ? placed.filter((p) => p.anchor.index === row.index) : [];
            const isHeading = row.block.kind === 'h';
            const who = row.index >= 0 ? typing[row.index] : undefined;
            return (
              <div
                key={row.key}
                data-block={row.index >= 0 ? row.index : undefined}
                style={{
                  position: 'relative',
                  margin: '0 0 12px',
                  textAlign: isHeading ? 'center' : 'justify',
                  fontWeight: isHeading ? 700 : undefined,
                  paddingLeft: row.block.kind === 'li' ? 20 : row.block.kind === 'cell' ? 12 : 0,
                  borderLeft: row.block.kind === 'cell' ? '2px solid var(--mantine-color-default-border)' : undefined,
                }}
              >
                {who ? (
                  <>
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        left: -14,
                        top: 4,
                        bottom: 4,
                        width: 3,
                        borderRadius: 2,
                        background: 'var(--mantine-color-cyan-5)',
                      }}
                    />
                    <Text
                      size='xs'
                      fw={600}
                      c='cyan.7'
                      ta='left'
                      lh={1.4}
                      mb={2}
                      style={{ fontFamily: 'var(--mantine-font-family)', fontWeight: 600 }}
                    >
                      {who} está escribiendo…
                    </Text>
                  </>
                ) : null}
                {row.block.kind === 'li' ? <span aria-hidden style={{ position: 'absolute', left: 4 }}>•</span> : null}
                <BlockText
                  ops={row.ops}
                  block={row.block}
                  placed={inBlock}
                  activeMarkId={activeMarkId}
                  onMarkClick={onMarkClick}
                />
              </div>
            );
          })
        )}
      </Paper>
      {pending && onSelect ? (
        <Button
          size='xs'
          leftSection={<IconHighlight size={14} />}
          style={{ position: 'absolute', top: pending.top, left: pending.left, zIndex: 5 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onSelect({ blockIndex: pending.blockIndex, quote: pending.quote });
            setPending(null);
            window.getSelection()?.removeAllRanges();
          }}
        >
          Marcar selección
        </Button>
      ) : null}
    </div>
  );
}
