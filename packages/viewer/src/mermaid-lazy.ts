/**
 * Render ```mermaid blocks into SVG. The (large) mermaid library is only fetched when a
 * document actually contains a diagram; on a render error the source stays visible.
 */
export async function renderMermaidBlocks(container: Element): Promise<void> {
  const blocks = [...container.querySelectorAll<HTMLElement>('pre.mermaid')];
  if (blocks.length === 0) return;
  const { default: mermaid } = await import('mermaid');
  // `strict` makes mermaid sanitize labels and disables click handlers/HTML in diagrams.
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
  let n = 0;
  for (const block of blocks) {
    const source = block.textContent ?? '';
    try {
      const { svg } = await mermaid.render(`ce-mermaid-${Date.now()}-${n++}`, source);
      block.innerHTML = svg;
      block.classList.add('rendered');
    } catch (err) {
      block.classList.add('mermaid-error');
      block.title = err instanceof Error ? err.message : 'Could not render diagram';
    }
  }
}
