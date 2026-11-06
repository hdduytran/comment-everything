/** Clipboard write with a fallback for pages where the async clipboard API is unavailable. */
export async function defaultCopyText(doc: Document, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // fall through to the legacy path
  }
  const area = doc.createElement('textarea');
  area.value = text;
  area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  doc.body.append(area);
  area.select();
  const ok = doc.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('Clipboard is not available');
}
