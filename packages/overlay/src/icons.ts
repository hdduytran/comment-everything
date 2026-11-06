const NS = 'http://www.w3.org/2000/svg';

/** One icon family: 16px grid, 1.5 stroke, round caps. Paths are authored here, not user input. */
const PATHS = {
  element: ['M3 3h7v7H3z', 'M9.5 9.5l4 1.6-1.7.9-.9 1.7z'],
  text: ['M3.5 4V3h9v1', 'M8 3v10', 'M6.5 13h3'],
  region: ['M3 3h2M7 3h2M11 3h2M13 5v2M13 9v2M13 13h-2M9 13H7M5 13H3M3 11V9M3 7V5'],
  close: ['M4 4l8 8M12 4l-8 8'],
  chevronRight: ['M6 3.5L10.5 8 6 12.5'],
  chat: ['M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z'],
  send: ['M2.5 8l11-5-4 11-2-4.5z'],
  copy: ['M5.5 5.5h7v8h-7z', 'M3.5 10.5v-8h7'],
  trash: ['M3 4.5h10', 'M6.5 4.5V3h3v1.5', 'M4.5 4.5l.5 8.5h6l.5-8.5'],
  help: ['M6.2 6.2a1.9 1.9 0 113 1.5c-.7.5-1.2.9-1.2 1.6', 'M8 11.8v.1'],
  check: ['M3.5 8.5l3 3 6-6.5'],
} as const;

export type IconName = keyof typeof PATHS;

export function icon(doc: Document, name: IconName): SVGSVGElement {
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of PATHS[name]) {
    const p = doc.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
