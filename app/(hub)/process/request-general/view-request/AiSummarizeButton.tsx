'use client';

// Botón "Resumir" — genera un resumen (puntos clave) de la solicitud usando la
// API NATIVA del navegador (Summarizer API / Gemini Nano, on-device). Todo el
// procesamiento ocurre EN EL NAVEGADOR del usuario; no se envía nada a un
// servidor ni se agregan dependencias externas.
//
// Regla clave: si el equipo NO soporta la API (o el modelo está marcado como
// 'unavailable'), el componente retorna null y el botón NO se renderiza —
// invisible, sin ruido para el usuario.

import { useEffect, useState } from 'react';
import {
  Button,
  Modal,
  Text,
  Alert,
  Progress,
  Stack,
  Group,
  ThemeIcon,
  ScrollArea,
} from '@mantine/core';
import { IconSparkles, IconAlertCircle } from '@tabler/icons-react';
import {
  buildSummaryInput,
  type SummaryRequestInput,
  type SummaryNoteInput,
  type SummaryTaskInput,
} from '../../../../../lib/ai/summaryInput';

interface AiSummarizeButtonProps {
  request: SummaryRequestInput | null | undefined;
  notes?: SummaryNoteInput[];
  tasks?: SummaryTaskInput[];
}

type Support = 'checking' | 'unsupported' | 'ready';
type Phase = 'idle' | 'downloading' | 'summarizing' | 'done' | 'error';

const SHARED_CONTEXT =
  'Resumen de una solicitud interna de la plataforma SynerLink (gestión de ' +
  'procesos administrativos y financieros). Resume en español, tono formal.';

export default function AiSummarizeButton({
  request,
  notes = [],
  tasks = [],
}: AiSummarizeButtonProps) {
  const [support, setSupport] = useState<Support>('checking');
  const [opened, setOpened] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Detección de soporte al montar. No usamos el modelo aquí, solo consultamos
  // disponibilidad.
  useEffect(() => {
    let cancelled = false;

    async function detectar() {
      if (typeof Summarizer === 'undefined') {
        if (!cancelled) setSupport('unsupported');
        return;
      }
      try {
        const disponibilidad = await Summarizer.availability();
        if (cancelled) return;
        // 'available' | 'downloadable' | 'downloading' → se puede usar.
        // 'unavailable' → el equipo no soporta el modelo: ocultar el botón.
        setSupport(disponibilidad === 'unavailable' ? 'unsupported' : 'ready');
      } catch {
        if (!cancelled) setSupport('unsupported');
      }
    }

    detectar();
    return () => {
      cancelled = true;
    };
  }, []);

  const trabajando = phase === 'downloading' || phase === 'summarizing';

  async function resumir() {
    if (typeof Summarizer === 'undefined') {
      setSupport('unsupported');
      return;
    }

    const texto = buildSummaryInput(request, notes, tasks);
    if (!texto) {
      setPhase('error');
      setErrorMsg('No hay contenido suficiente en la solicitud para resumir.');
      setOpened(true);
      return;
    }

    setOpened(true);
    setSummary('');
    setErrorMsg('');
    setProgress(0);

    let summarizer: SummarizerInstance | null = null;
    try {
      const disponibilidad = await Summarizer.availability();
      const requiereDescarga =
        disponibilidad === 'downloadable' || disponibilidad === 'downloading';
      setPhase(requiereDescarga ? 'downloading' : 'summarizing');

      summarizer = await Summarizer.create({
        type: 'key-points',
        format: 'markdown',
        length: 'medium',
        sharedContext: SHARED_CONTEXT,
        expectedInputLanguages: ['es'],
        expectedContextLanguages: ['es'],
        outputLanguage: 'es',
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            setProgress(Math.round(e.loaded * 100));
          });
        },
      });

      setPhase('summarizing');
      const salida = await summarizer.summarize(texto, {
        context: 'Resume esta solicitud en puntos clave, en español.',
      });

      setSummary(salida);
      setPhase('done');
    } catch (err) {
      setPhase('error');
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Ocurrió un error al generar el resumen.',
      );
    } finally {
      summarizer?.destroy();
    }
  }

  function cerrar() {
    if (trabajando) return;
    setOpened(false);
    setPhase('idle');
    setProgress(0);
    setSummary('');
    setErrorMsg('');
  }

  // No soportado (o aún verificando): no renderizamos nada.
  if (support !== 'ready') return null;

  return (
    <>
      <Button
        variant='light'
        color='violet'
        size='sm'
        radius='md'
        leftSection={<IconSparkles size={16} />}
        loading={trabajando}
        onClick={resumir}
        title='Genera un resumen con IA local (en su navegador, sin enviar datos a ningún servidor)'
      >
        Resumir
      </Button>

      <Modal
        opened={opened}
        onClose={cerrar}
        title={
          <Group gap='xs'>
            <ThemeIcon variant='light' color='violet' radius='md' size='md'>
              <IconSparkles size={16} />
            </ThemeIcon>
            <Text fw={600}>Resumen de la solicitud (IA local)</Text>
          </Group>
        }
        size='lg'
        radius='md'
        centered
        closeOnClickOutside={!trabajando}
        closeOnEscape={!trabajando}
        withCloseButton={!trabajando}
      >
        <Stack gap='md'>
          {phase === 'downloading' && (
            <Stack gap='xs'>
              <Text size='sm' c='dimmed'>
                Descargando modelo… {progress}%
              </Text>
              <Progress value={progress} color='violet' radius='md' animated />
            </Stack>
          )}

          {phase === 'summarizing' && (
            <Text size='sm' c='dimmed'>
              Generando el resumen en su navegador…
            </Text>
          )}

          {phase === 'error' && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color='red'
              radius='md'
              title='No se pudo generar el resumen'
            >
              {errorMsg}
            </Alert>
          )}

          {phase === 'done' && (
            <ScrollArea.Autosize mah={400}>
              <Text size='sm' className='whitespace-pre-line text-gray-700'>
                {summary}
              </Text>
            </ScrollArea.Autosize>
          )}

          <Text size='xs' c='dimmed'>
            El resumen se genera localmente en su navegador con IA on-device; el
            contenido de la solicitud no se envía a ningún servidor.
          </Text>
        </Stack>
      </Modal>
    </>
  );
}
