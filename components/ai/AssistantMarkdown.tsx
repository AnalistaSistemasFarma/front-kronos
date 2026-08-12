'use client';

import { useEffect, useId, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Box, Code, Text, useMantineColorScheme } from '@mantine/core';

function MermaidBlock({ code, dark }: { code: string; dark: boolean }) {
  const id = useId().replace(/:/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? 'dark' : 'neutral',
          securityLevel: 'loose',
          fontFamily: 'inherit',
        });
        const { svg } = await mermaid.render(`mmd-${id}`, code);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'No se pudo renderizar el diagrama');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, dark, id]);

  if (error) {
    return (
      <Code block style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>
        {code}
      </Code>
    );
  }

  return (
    <Box
      ref={ref}
      my={8}
      style={{
        overflowX: 'auto',
        fontSize: 12,
        lineHeight: 1.2,
      }}
    />
  );
}

/** Render markdown del asistente (sin JSON crudo; mermaid en fences). */
export default function AssistantMarkdown({
  content,
  color,
}: {
  content: string;
  color?: string;
}) {
  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === 'dark';

  if (!content?.trim()) {
    return (
      <Text size='sm' c={color ?? 'dimmed'}>
        …
      </Text>
    );
  }

  return (
    <Box
      className='ai-md'
      c={color}
      style={{ fontSize: 13, lineHeight: 1.5 }}
    >
      <ReactMarkdown
        components={{
          p: ({ children }) => (
            <Text size='sm' mb={6} c={color} style={{ lineHeight: 1.5 }}>
              {children}
            </Text>
          ),
          strong: ({ children }) => (
            <Text span fw={700} c={color}>
              {children}
            </Text>
          ),
          ul: ({ children }) => (
            <Box component='ul' pl={18} mb={8} style={{ marginTop: 0 }}>
              {children}
            </Box>
          ),
          ol: ({ children }) => (
            <Box component='ol' pl={18} mb={8} style={{ marginTop: 0 }}>
              {children}
            </Box>
          ),
          li: ({ children }) => (
            <Text component='li' size='sm' mb={2} c={color}>
              {children}
            </Text>
          ),
          h1: ({ children }) => (
            <Text fw={800} size='md' mb={6} c={color}>
              {children}
            </Text>
          ),
          h2: ({ children }) => (
            <Text fw={700} size='sm' mb={6} mt={4} c={color}>
              {children}
            </Text>
          ),
          h3: ({ children }) => (
            <Text fw={700} size='sm' mb={4} c={color}>
              {children}
            </Text>
          ),
          table: ({ children }) => (
            <Box style={{ overflowX: 'auto', marginBottom: 8 }}>
              <table
                style={{
                  borderCollapse: 'collapse',
                  width: '100%',
                  fontSize: 12,
                }}
              >
                {children}
              </table>
            </Box>
          ),
          th: ({ children }) => (
            <th
              style={{
                borderBottom: `1px solid ${dark ? '#444' : '#ddd'}`,
                textAlign: 'left',
                padding: '4px 6px',
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              style={{
                borderBottom: `1px solid ${dark ? '#333' : '#eee'}`,
                padding: '4px 6px',
                verticalAlign: 'top',
              }}
            >
              {children}
            </td>
          ),
          code: ({ className, children }) => {
            const text = String(children).replace(/\n$/, '');
            const lang = /language-(\w+)/.exec(className || '')?.[1];
            if (lang === 'mermaid') {
              return <MermaidBlock code={text} dark={dark} />;
            }
            const inline = !className;
            if (inline) {
              return (
                <Code style={{ fontSize: 11 }}>{text}</Code>
              );
            }
            return (
              <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                {text}
              </Code>
            );
          },
          a: ({ href, children }) => (
            <Text
              component='a'
              href={href}
              size='sm'
              c='blue'
              td='underline'
              target='_blank'
              rel='noreferrer'
            >
              {children}
            </Text>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </Box>
  );
}
