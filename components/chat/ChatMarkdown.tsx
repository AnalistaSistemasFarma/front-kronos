'use client';

import { memo, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Box, Text } from '@mantine/core';
import {
  ALLOWED_MARKDOWN_ELEMENTS,
  prepareChatMarkdown,
  sanitizeChatUrl,
} from '../../lib/chat/markdown';

/**
 * Render del Markdown de un mensaje del chat de agentes.
 *
 * La política de seguridad completa (y por qué) está en lib/chat/markdown.ts.
 * En resumen, aquí se cumple:
 *
 *   - `remarkGfm` para tablas, tachado y listas — nada más.
 *   - SIN `rehype-raw`: el HTML embebido en el Markdown queda como TEXTO.
 *   - SIN Mermaid: un fence ```mermaid se pinta como bloque de código. La
 *     versión anterior lo renderizaba con `securityLevel: 'loose'` + innerHTML,
 *     que en un chat alimentado por un modelo es ejecución de código en el
 *     navegador de quien lee.
 *   - `allowedElements` cerrado + `urlTransform` con lista blanca de esquemas.
 *   - Enlaces siempre con `rel='noreferrer noopener'`.
 *
 * Los estilos salen de los tokens --app-* (app/globals.css), así que el mismo
 * componente se ve bien en claro y en oscuro sin colores en duro.
 */

/** Enlace saneado. Sin href admisible se degrada a texto plano. */
function MarkdownLink({
  href,
  children,
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  const safe = sanitizeChatUrl(href);
  if (!safe) return <span>{children}</span>;
  return (
    <a
      href={safe}
      target='_blank'
      rel='noreferrer noopener'
      className='chat-md__link'
    >
      {children}
    </a>
  );
}

const components: Components = {
  a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  p: ({ children }) => <p className='chat-md__p'>{children}</p>,
  ul: ({ children }) => <ul className='chat-md__ul'>{children}</ul>,
  ol: ({ children }) => <ol className='chat-md__ol'>{children}</ol>,
  li: ({ children }) => <li className='chat-md__li'>{children}</li>,
  blockquote: ({ children }) => <blockquote className='chat-md__quote'>{children}</blockquote>,
  h1: ({ children }) => <h1 className='chat-md__h chat-md__h1'>{children}</h1>,
  h2: ({ children }) => <h2 className='chat-md__h chat-md__h2'>{children}</h2>,
  h3: ({ children }) => <h3 className='chat-md__h chat-md__h3'>{children}</h3>,
  hr: () => <hr className='chat-md__hr' />,
  pre: ({ children }) => <pre className='chat-md__pre'>{children}</pre>,
  code: ({ className, children }) => {
    // react-markdown pasa `className='language-xxx'` solo en los bloques
    // cercados; sin clase es código en línea.
    const isBlock = Boolean(className);
    return (
      <code className={isBlock ? 'chat-md__code-block' : 'chat-md__code-inline'}>
        {children}
      </code>
    );
  },
  // Una tabla ancha desplaza toda la burbuja: se encierra en su propio
  // contenedor con scroll horizontal.
  table: ({ children }) => (
    <div className='chat-md__table-wrap'>
      <table className='chat-md__table'>{children}</table>
    </div>
  ),
  th: ({ children }) => <th className='chat-md__th'>{children}</th>,
  td: ({ children }) => <td className='chat-md__td'>{children}</td>,
};

function ChatMarkdownInner({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const { text, truncated } = useMemo(() => prepareChatMarkdown(content), [content]);

  if (!text) {
    return (
      <Text size='sm' c='dimmed'>
        …
      </Text>
    );
  }

  return (
    <Box className={['chat-md', className].filter(Boolean).join(' ')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Lista blanca CERRADA. `unwrapDisallowed` conserva el texto de un
        // elemento no permitido en vez de borrarlo: se pierde el formato, no
        // el contenido.
        allowedElements={[...ALLOWED_MARKDOWN_ELEMENTS]}
        unwrapDisallowed
        urlTransform={(url) => sanitizeChatUrl(url)}
        components={components}
      >
        {text}
      </ReactMarkdown>
      {truncated && (
        <Text size='xs' c='dimmed' mt={4}>
          El mensaje era muy largo y se muestra recortado.
        </Text>
      )}
    </Box>
  );
}

const ChatMarkdown = memo(ChatMarkdownInner);
export default ChatMarkdown;
