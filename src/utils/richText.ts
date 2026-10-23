/**
 * Science of Gifts - Rich Text Utilities
 * Converts plain text/paragraphs to structured semantic HTML without Markdown syntax.
 */

/**
 * Ensures text is structured semantic HTML for the visual rich-text editor.
 * If legacy Markdown or raw text is passed, converts it to clean HTML.
 */
export function ensureSemanticHtml(content: string): string {
  if (!content || !content.trim()) {
    return '<p></p>';
  }

  const trimmed = content.trim();

  // If already semantic HTML tags, return as is
  if (/^<(p|h[1-6]|blockquote|ul|ol|div|img|pre|hr|figure|table|section|article)\b/i.test(trimmed)) {
    return trimmed;
  }

  // Convert raw text or legacy lines into semantic HTML
  const lines = content.split('\n');
  const htmlParts: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    if (!line) {
      if (inList) {
        htmlParts.push('</ul>');
        inList = false;
      }
      continue;
    }

    // Convert any legacy # headings into real heading tags
    if (line.startsWith('# ')) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push(`<h1>${cleanInline(line.substring(2))}</h1>`);
    } else if (line.startsWith('## ')) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push(`<h2>${cleanInline(line.substring(3))}</h2>`);
    } else if (line.startsWith('### ')) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push(`<h3>${cleanInline(line.substring(4))}</h3>`);
    } else if (line.startsWith('#### ')) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push(`<h4>${cleanInline(line.substring(5))}</h4>`);
    } else if (line.startsWith('> ')) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push(`<blockquote><p>${cleanInline(line.substring(2))}</p></blockquote>`);
    } else if (line.startsWith('* ') || line.startsWith('- ') || line.startsWith('• ')) {
      if (!inList) {
        htmlParts.push('<ul>');
        inList = true;
      }
      const itemText = line.replace(/^[\*\-•]\s+/, '');
      htmlParts.push(`<li>${cleanInline(itemText)}</li>`);
    } else {
      if (inList) {
        htmlParts.push('</ul>');
        inList = false;
      }
      htmlParts.push(`<p>${cleanInline(line)}</p>`);
    }
  }

  if (inList) {
    htmlParts.push('</ul>');
  }

  return htmlParts.join('\n');
}

/**
 * Converts inline legacy formatting (like bold/italic/links) into semantic HTML tags
 */
function cleanInline(text: string): string {
  return text
    // Convert links [label](url) to <a href="url">label</a>
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>')
    // Convert bold **text** to <strong>text</strong>
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Convert italic *text* to <em>text</em>
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
}

/**
 * Extracts clean, unformatted plain text from an HTML string for Gemini context
 */
export function extractPlainTextFromHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Counts words in an HTML string or plain text
 */
export function countWords(content: string): number {
  if (!content) return 0;
  const plainText = extractPlainTextFromHtml(content);
  if (!plainText.trim()) return 0;
  return plainText.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Normalizes editor HTML so harmless serialization or storage normalization differences
 * (such as empty paragraph variants, non-breaking spaces, or newlines between block tags)
 * do not trigger unnecessary setContent() calls.
 */
export function normalizeEditorHtml(html: string | undefined | null): string {
  if (!html) return '<p></p>';
  const semantic = ensureSemanticHtml(html).trim();
  if (
    !semantic ||
    semantic === '<p></p>' ||
    semantic === '<p><br></p>' ||
    semantic === '<p><br class="ProseMirror-trailingBreak"></p>'
  ) {
    return '<p></p>';
  }
  return semantic
    .replace(/\u00a0/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(
      /<\/(p|h[1-6]|ul|ol|li|blockquote|div|pre)>\s+<((?:p|h[1-6]|ul|ol|li|blockquote|div|pre|hr|img)\b)/gi,
      '</$1><$2'
    )
    .trim();
}

export function isEquivalentEditorHtml(
  a: string | undefined | null,
  b: string | undefined | null
): boolean {
  if (a === b) return true;
  return normalizeEditorHtml(a) === normalizeEditorHtml(b);
}

