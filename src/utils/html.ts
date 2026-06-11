// Smartlead delivers reply bodies as HTML. Convert to readable plain text for display —
// strips tags, decodes entities, and preserves line breaks from block elements.
export function htmlToText(html: string | null | undefined): string {
  if (!html) return ''
  // If there are no tags, it's already plain text — return as-is.
  if (!/[<&]/.test(html)) return html.trim()

  const doc = new DOMParser().parseFromString(html, 'text/html')
  // Turn <br> and block-level elements into newlines so paragraphs survive
  doc.querySelectorAll('br').forEach(br => br.replaceWith('\n'))
  doc.querySelectorAll('p, div, tr, li').forEach(el => el.append('\n'))

  const text = doc.body.textContent ?? ''
  return text
    .replace(/ /g, ' ')      // non-breaking spaces → normal spaces
    .replace(/[ \t]+\n/g, '\n')   // trim trailing spaces on each line
    .replace(/\n{3,}/g, '\n\n')   // collapse runs of blank lines
    .trim()
}
