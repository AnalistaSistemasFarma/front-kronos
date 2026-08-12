'use client';

// Botón "Resumir" — genera un resumen HUMANO de la solicitud usando la IA
// NATIVA del navegador (Gemini Nano, on-device). Todo el procesamiento ocurre
// EN EL NAVEGADOR del usuario; no se envía nada a un servidor ni se agregan
// dependencias externas.
//
// Motor preferido: Prompt API (LanguageModel) — acepta un prompt con tono, por
// lo que el resumen es cálido y cercano (no una copia extractiva del texto).
// Si la Prompt API no está disponible, cae a la Summarizer API (extractiva).
// Si NINGUNA existe (o el modelo está 'unavailable'), el componente retorna
// null y el botón NO se renderiza — invisible, sin ruido para el usuario.

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
  buildSummaryPrompt,
  SUMMARY_SYSTEM_PROMPT,
  type SummaryRequestInput,
  type SummaryNoteInput,
  type SummaryTaskInput,
} from '../../../../../lib/ai/summaryInput';

interface AiSummarizeButtonProps {
  request: SummaryRequestInput | null | undefined;
  notes?: SummaryNoteInput[];
  tasks?: SummaryTaskInput[];
}

// Motor de IA a usar: Prompt API (preferido) o Summarizer API (fallback).
type Engine = 'prompt' | 'summarizer';
type Support = 'checking' | 'unsupported' | 'ready';
type Phase = 'idle' | 'downloading' | 'summarizing' | 'done' | 'error';

// Contexto compartido para el fallback extractivo (Summarizer API).
const SHARED_CONTEXT =
  'Resumen de una solicitud interna de la plataforma SynerLink (gestión de ' +
  'procesos administrativos y financieros). Resume en español, tono formal.';

export default function AiSummarizeButton({
  request,
  notes = [],
  tasks = [],
}: AiSummarizeButtonProps) {
  const [support, setSupport] = useState<Support>('checking');
  const [engine, setEngine] = useState<Engine | null>(null);
  const [opened, setOpened] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Detección de soporte al montar. Prioriza la Prompt API; si no, Summarizer.
  useEffect(() => {
    let cancelled = false;

    async function detectar() {
      // 1) Prompt API (LanguageModel) — motor preferido.
      if (typeof LanguageModel !== 'undefined') {
        try {
          const disp = await LanguageModel.availability();
          if (cancelled) return;
          if (disp !== 'unavailable') {
            setEngine('prompt');
            setSupport('ready');
            return;
          }
        } catch {
          // Sigue a evaluar el fallback.
        }
        if (cancelled) return;
      }

      // 2) Summarizer API — fallback extractivo.
      if (typeof Summarizer !== 'undefined') {
        try {
          const disp = await Summarizer.availability();
          if (cancelled) return;
          if (disp !== 'unavailable') {
            setEngine('summarizer');
            setSupport('ready');
            return;
          }
        } catch {
          // Cae a 'unsupported'.
        }
      }

      // 3) Ninguna API disponible → ocultar el botón.
      if (!cancelled) {
        setEngine(null);
        setSupport('unsupported');
      }
    }

    detectar();
    return () => {
      cancelled = true;
    };
  }, []);

  const trabajando = phase === 'downloading' || phase === 'summarizing';

  // Marca la fase inicial según haga falta descargar el modelo.
  function faseInicial(disp: SummarizerAvailability) {
    const requiereDescarga = disp === 'downloadable' || disp === 'downloading';
    setPhase(requiereDescarga ? 'downloading' : 'summarizing');
  }

  // Motor preferido: Prompt API (resumen humano con tono).
  async function resumirConPrompt(texto: string): Promise<string> {
    if (typeof LanguageModel === 'undefined') {
      throw new Error('La Prompt API no está disponible en este navegador.');
    }
    const disp = await LanguageModel.availability();
    faseInicial(disp);

    const session = await LanguageModel.create({
      initialPrompts: [{ role: 'system', content: SUMMARY_SYSTEM_PROMPT }],
      expectedInputs: [{ type: 'text', languages: ['es'] }],
      expectedOutputs: [{ type: 'text', languages: ['es'] }],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          setProgress(Math.round(e.loaded * 100));
        });
      },
    });

    try {
      setPhase('summarizing');
      return await session.prompt(buildSummaryPrompt(texto));
    } finally {
      session.destroy();
    }
  }

  // Fallback: Summarizer API (extractiva).
  async function resumirConSummarizer(texto: string): Promise<string> {
    if (typeof Summarizer === 'undefined') {
      throw new Error('La Summarizer API no está disponible en este navegador.');
    }
    const disp = await Summarizer.availability();
    faseInicial(disp);

    const summarizer = await Summarizer.create({
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

    try {
      setPhase('summarizing');
      return await summarizer.summarize(texto, {
        context: 'Resume esta solicitud en puntos clave, en español.',
      });
    } finally {
      summarizer.destroy();
    }
  }

  async function resumir() {
    if (!engine) {
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

    try {
      const salida =
        engine === 'prompt'
          ? await resumirConPrompt(texto)
          : await resumirConSummarizer(texto);
      setSummary(salida.trim());
      setPhase('done');
    } catch (err) {
      setPhase('error');
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Ocurrió un error al generar el resumen.',
      );
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
