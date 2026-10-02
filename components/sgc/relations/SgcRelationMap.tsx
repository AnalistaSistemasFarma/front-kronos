'use client';

import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { Alert, Badge, Button, Card, Group, Loader, MultiSelect, Select, Stack, Switch, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconFocus2, IconSearch } from '@tabler/icons-react';
import { sgcHref } from '../useSgcCompany';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import { SGC_BASE_URL } from '../../../lib/sgc/constants';
import type { SgcRelationGraph } from '../../../lib/sgc/db/relations';
import type { SgcCompanyAccess } from '../../../lib/sgc/permissions';
import {
  SGC_RELATION_LABELS,
  SGC_RELATION_STYLES,
  SGC_RELATION_TYPES,
  filterGraph,
  findNodeByCode,
  initialLayout,
  type SgcGraphNode,
  type SgcLayout,
  type SgcRelationType,
} from '../../../lib/sgc/relations';

/**
 * MAPA DE RELACIONES tipo Obsidian (Sprint 5): la «red de nodos» de la
 * referencia vuelta funcional, con React Flow (@xyflow/react). Desplazar,
 * acercar y arrastrar; minimapa; filtros por tipo de proceso, proceso, tipo
 * documental y tipo de relación; búsqueda por código que centra el mapa; clic
 * abre la ficha. Solo aparecen los documentos que la persona puede consultar
 * (lo decide el servidor) y las posiciones se guardan por persona.
 */

type DocNodeData = { doc: SgcGraphNode; highlighted: boolean };
type DocNode = Node<DocNodeData, 'documento'>;

function DocumentNode({ data }: NodeProps<DocNode>) {
  const d = data.doc;
  return (
    <div
      data-testid='sgc-mapa-nodo'
      data-code={d.code}
      style={{
        minWidth: 220,
        maxWidth: 260,
        padding: '8px 10px',
        borderRadius: 8,
        background: 'var(--mantine-color-body)',
        border: `2px solid var(--mantine-color-${d.processTypeColor}-${data.highlighted ? 7 : 4})`,
        boxShadow: data.highlighted ? '0 0 0 4px var(--mantine-color-yellow-3)' : '0 1px 3px rgba(0,0,0,.12)',
        cursor: 'pointer',
      }}
    >
      <Handle type='target' position={Position.Left} style={{ opacity: 0 }} />
      <Group gap={6} wrap='nowrap'>
        <Text fw={700} ff='monospace' size='xs'>
          {d.code}
        </Text>
        <Badge size='xs' variant='filled' color='dark' radius='sm'>
          {d.versionNumber ? `V${d.versionNumber}` : '—'}
        </Badge>
        {d.status !== 'vigente' && (
          <Badge size='xs' color='orange' variant='light'>
            {d.status}
          </Badge>
        )}
      </Group>
      <Text size='xs' lineClamp={2} mt={2}>
        {d.title}
      </Text>
      <Text size='10px' c='dimmed' mt={2} lineClamp={1}>
        {d.processType} · {d.process}
      </Text>
      <Handle type='source' position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const NODE_TYPES = { documento: DocumentNode };

function MapCanvas({ company, graph, showObsolete, setShowObsolete }: { company: SgcCompanyAccess; graph: SgcRelationGraph; showObsolete: boolean; setShowObsolete: (v: boolean) => void }) {
  const router = useRouter();
  const flow = useReactFlow();
  const [processType, setProcessType] = useState<string | null>(null);
  const [process, setProcess] = useState<string | null>(null);
  const [docType, setDocType] = useState<string | null>(null);
  const [relTypes, setRelTypes] = useState<string[]>([]);
  const [onlyConnected, setOnlyConnected] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<number | null>(null);
  const [notFound, setNotFound] = useState(false);
  const layoutRef = useRef<SgcLayout>({ ...graph.layout });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtered = useMemo(
    () =>
      filterGraph(graph.nodes, graph.edges, {
        idProcessType: processType ? Number(processType) : null,
        idProcess: process ? Number(process) : null,
        idDocumentType: docType ? Number(docType) : null,
        relationTypes: relTypes as SgcRelationType[],
        onlyConnected,
      }),
    [graph, processType, process, docType, relTypes, onlyConnected]
  );
  const positions = useMemo(() => initialLayout(graph.nodes, graph.layout, graph.processTypeOrder), [graph]);

  const [nodes, setNodes, onNodesChange] = useNodesState<DocNode>([]);
  useEffect(() => {
    setNodes(
      filtered.nodes.map((n) => ({
        id: String(n.id),
        type: 'documento',
        position: layoutRef.current[String(n.id)] ?? positions[String(n.id)] ?? { x: 0, y: 0 },
        data: { doc: n, highlighted: highlight === n.id },
      }))
    );
  }, [filtered, positions, highlight, setNodes]);

  const edges: Edge[] = useMemo(
    () =>
      filtered.edges.map((e) => {
        const st = SGC_RELATION_STYLES[e.type];
        return {
          id: `e${e.id}`,
          source: String(e.source),
          target: String(e.target),
          label: SGC_RELATION_LABELS[e.type],
          labelStyle: { fontSize: 10, fill: st.color },
          style: { stroke: st.color, strokeWidth: 2, strokeDasharray: st.dash ?? undefined },
          markerEnd: { type: MarkerType.ArrowClosed, color: st.color },
          data: { type: e.type },
        };
      }),
    [filtered]
  );

  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      sgcSend('/api/sgc/relations/layout', 'PUT', { company: company.idCompany, layout: layoutRef.current }).catch(() => undefined);
    }, 800);
  }, [company.idCompany]);

  const search = () => {
    const hit = findNodeByCode(filtered.nodes, query);
    setNotFound(!hit);
    setHighlight(hit?.id ?? null);
    if (hit) {
      const p = layoutRef.current[String(hit.id)] ?? positions[String(hit.id)];
      if (p) flow.setCenter(p.x + 120, p.y + 40, { zoom: 1.3, duration: 400 });
    }
  };

  const processTypes = [...new Map(graph.nodes.map((n) => [n.idProcessType, n.processType])).entries()];
  const processes = [...new Map(graph.nodes.filter((n) => !processType || n.idProcessType === Number(processType)).map((n) => [n.idProcess, n.process])).entries()];
  const docTypes = [...new Map(graph.nodes.map((n) => [n.idDocumentType, n.documentTypeCode])).entries()];

  return (
    <Stack gap='sm'>
      <Card withBorder radius='md' p='sm'>
        <Group gap='sm' align='flex-end' wrap='wrap'>
          <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true'
            label='Buscar por código'
            placeholder='OLP-GC-PR-001'
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            leftSection={<IconSearch size={14} />}
            w={220}
            error={notFound ? 'Sin coincidencias en el mapa' : undefined}
            data-testid='sgc-mapa-buscar'
          />
          <Button leftSection={<IconFocus2 size={16} />} variant='light' onClick={search} data-testid='sgc-mapa-centrar'>
            Centrar
          </Button>
          <Select label='Tipo de proceso' data={processTypes.map(([v, l]) => ({ value: String(v), label: l }))} value={processType} onChange={(v) => { setProcessType(v); setProcess(null); }} clearable w={190} />
          <Select label='Proceso (área)' data={processes.map(([v, l]) => ({ value: String(v), label: l }))} value={process} onChange={setProcess} clearable searchable w={220} />
          <Select label='Tipo documental' data={docTypes.map(([v, l]) => ({ value: String(v), label: l }))} value={docType} onChange={setDocType} clearable w={150} />
          <MultiSelect label='Tipo de relación' data={SGC_RELATION_TYPES.map((t) => ({ value: t, label: SGC_RELATION_LABELS[t] }))} value={relTypes} onChange={setRelTypes} clearable w={240} />
          <Stack gap={4}>
            <Switch label='Solo relacionados' checked={onlyConnected} onChange={(e) => setOnlyConnected(e.currentTarget.checked)} />
            {company.canQuality && <Switch label='Incluir obsoletos' checked={showObsolete} onChange={(e) => setShowObsolete(e.currentTarget.checked)} data-testid='sgc-mapa-obsoletos' />}
          </Stack>
        </Group>
        <Group gap='md' mt='xs'>
          {SGC_RELATION_TYPES.map((t) => (
            <Group key={t} gap={4}>
              <svg width='28' height='8' aria-hidden>
                <line x1='0' y1='4' x2='28' y2='4' stroke={SGC_RELATION_STYLES[t].color} strokeWidth='2' strokeDasharray={SGC_RELATION_STYLES[t].dash ?? undefined} />
              </svg>
              <Text size='xs'>{SGC_RELATION_LABELS[t]}</Text>
            </Group>
          ))}
          <Text size='xs' c='dimmed' data-testid='sgc-mapa-conteo'>
            {filtered.nodes.length} documento(s) · {filtered.edges.length} relación(es)
          </Text>
        </Group>
      </Card>
      <div style={{ height: '70vh', minHeight: 480, border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }} data-testid='sgc-mapa-lienzo'>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeDragStop={(_e, node) => {
            layoutRef.current = { ...layoutRef.current, [node.id]: { x: Math.round(node.position.x), y: Math.round(node.position.y) } };
            persist();
          }}
          onNodeClick={(_e, node) => router.push(sgcHref(`${SGC_BASE_URL}/documentos/${node.id}`, company.idCompany))}
          nodesConnectable={false}
          fitView
          minZoom={0.1}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <MiniMap pannable zoomable nodeColor={(n) => `var(--mantine-color-${(n.data as DocNodeData).doc.processTypeColor}-5)`} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </Stack>
  );
}

export default function SgcRelationMap({ company }: { company: SgcCompanyAccess }) {
  const [showObsolete, setShowObsolete] = useState(false);
  const graph = useSgcFetch<SgcRelationGraph>(`/api/sgc/relations?company=${company.idCompany}${showObsolete ? '&obsoletos=1' : ''}`);
  if (graph.error) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />}>
        {graph.error}
      </Alert>
    );
  }
  if (!graph.data) {
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  }
  if (graph.data.nodes.length === 0) {
    return (
      <Alert color='blue' data-testid='sgc-mapa-vacio'>
        No hay documentos que usted pueda consultar en el mapa.
      </Alert>
    );
  }
  return (
    <ReactFlowProvider>
      <MapCanvas company={company} graph={graph.data} showObsolete={showObsolete} setShowObsolete={setShowObsolete} />
    </ReactFlowProvider>
  );
}
