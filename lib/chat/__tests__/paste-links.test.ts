import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it } from 'vitest';
import { clipboardHtmlToMarkdown, sanitizePastedHref } from '../paste-links';
import { toPlainPreview } from '../client';
import ChatMarkdown from '../../../components/chat/ChatMarkdown';

/*
 * Rich links pasted into the chat composer (prod msg 40971, 2026-11-26): links
 * copied from Teams/GitHub reached the chat as their title only, because the
 * textarea pasted text/plain. The converter keeps the href as a Markdown link.
 */
const PR_URL = 'https://github.com/AnalistaSistemasFarma/sapsend/pull/262';

describe('clipboardHtmlToMarkdown', () => {
  it('turns an anchor into a Markdown link', () => {
    const html = `<html><body><!--StartFragment--><a href="${PR_URL}">Pull Request #262</a><!--EndFragment--></body></html>`;
    expect(clipboardHtmlToMarkdown(html)).toBe(`[Pull Request #262](${PR_URL})`);
  });

  it('keeps surrounding text and line breaks (Teams message)', () => {
    const html =
      '<div><p>PR Sapsend: <a href="https://github.com/gss/sapsend/pull/262" title="x">fixed (mass authorization filters only pending) · Pull Request #262 · gss…</a></p>' +
      '<p>&nbsp;</p><p>PR a main Kronos_ <a href="https://github.com/AnalistaSistemasFarma/front-kronos/pull/1178">https://github.com/AnalistaSistemasFarma/front-kronos/pull/1178</a></p></div>';
    expect(clipboardHtmlToMarkdown(html)).toBe(
      'PR Sapsend: [fixed (mass authorization filters only pending) · Pull Request #262 · gss…](https://github.com/gss/sapsend/pull/262)\n\n' +
        'PR a main Kronos_ https://github.com/AnalistaSistemasFarma/front-kronos/pull/1178'
    );
  });

  it('flattens a link-unfurl card (title + truncated description) into one link', () => {
    const html =
      `<a href="${PR_URL}" class="card"><div><img src="https://avatars.githubusercontent.com/x.png" alt=""><div class="title">feat(reassignment): automatic return by cron</div>` +
      '<div class="desc">new tasks in other flows + request search and localhos…</div></div></a>';
    expect(clipboardHtmlToMarkdown(html)).toBe(
      `[feat(reassignment): automatic return by cron new tasks in other flows + request search and localhos…](${PR_URL})`
    );
  });

  it('returns null when there is nothing to keep (plain text paste wins)', () => {
    expect(clipboardHtmlToMarkdown('')).toBeNull();
    expect(clipboardHtmlToMarkdown(undefined)).toBeNull();
    expect(clipboardHtmlToMarkdown('<table><tr><td>1</td><td>2</td></tr></table>')).toBeNull();
    expect(clipboardHtmlToMarkdown(`<a href="${PR_URL}">${PR_URL}</a>`)).toBeNull();
  });

  it('drops unsafe hrefs and keeps only the visible text', () => {
    const html =
      '<p><a href="javascript:alert(1)">click</a> and <a href="data:text/html,x">data</a> ' +
      `and <a href="/relative">rel</a> plus <a href="${PR_URL}">PR</a></p>`;
    expect(clipboardHtmlToMarkdown(html)).toBe(`click and data and rel plus [PR](${PR_URL})`);
  });

  it('never outputs HTML from scripts or styles and escapes Markdown in labels and URLs', () => {
    const html =
      '<style>a{color:red}</style><script>alert(1)</script>' +
      '<a href="https://example.com/a b(c)">see [this] &amp; that</a>';
    expect(clipboardHtmlToMarkdown(html)).toBe('[see \\[this\\] & that](https://example.com/ab%28c%29)');
  });

  it('decodes entities in the href and supports mailto', () => {
    expect(clipboardHtmlToMarkdown('<a href="https://x.com/?a=1&amp;b=2">q</a>')).toBe('[q](https://x.com/?a=1&b=2)');
    expect(clipboardHtmlToMarkdown('<a href="mailto:ana@gsslatam.com">Ana</a>')).toBe('[Ana](mailto:ana@gsslatam.com)');
  });

  it('keeps list items as Markdown bullets', () => {
    const html = `<ul><li><a href="${PR_URL}">PR 262</a></li><li>second</li></ul>`;
    expect(clipboardHtmlToMarkdown(html)).toBe(`- [PR 262](${PR_URL})\n- second`);
  });
});

describe('sanitizePastedHref', () => {
  it('accepts only absolute http, https and mailto', () => {
    expect(sanitizePastedHref('https://a.com')).toBe('https://a.com');
    expect(sanitizePastedHref('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(sanitizePastedHref('tel:123')).toBe('');
    expect(sanitizePastedHref('java\nscript:alert(1)')).toBe('');
    expect(sanitizePastedHref('/x')).toBe('');
  });
});

describe('render of a pasted link', () => {
  const render = (body: string) =>
    renderToStaticMarkup(createElement(MantineProvider, null, createElement(ChatMarkdown, { content: body })));

  it('renders the Markdown link and bare URLs as clickable, new tab, noopener', () => {
    const md = clipboardHtmlToMarkdown(`<p>PR: <a href="${PR_URL}">Pull Request #262</a></p>`)!;
    const html = render(`${md}\n\nmain: https://github.com/AnalistaSistemasFarma/front-kronos/pull/1178`);
    expect(html).toContain(`<a href="${PR_URL}" target="_blank" rel="noreferrer noopener" class="chat-md__link">Pull Request #262</a>`);
    expect(html).toContain('href="https://github.com/AnalistaSistemasFarma/front-kronos/pull/1178"');
  });

  it('renders links inside a forwarded message block', () => {
    const md = clipboardHtmlToMarkdown(`<a href="${PR_URL}">Pull Request #262</a>`)!;
    const html = render(`Pasemos esto\n\n↪️ **Reenviado · mensaje de Nicolas Rojas**\n\n${md}`);
    expect(html).toContain(`href="${PR_URL}"`);
  });

  it('shows only the link text in plain previews', () => {
    expect(toPlainPreview(`PR: [Pull Request #262](${PR_URL})`)).toBe('PR: Pull Request #262');
  });
});
