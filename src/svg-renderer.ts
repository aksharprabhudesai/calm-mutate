import type { CalmArchitecture, CalmNode, Mutant } from './types.js';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

export function renderCounterexampleSvg(mutant: Mutant): string {
  const arch: CalmArchitecture = mutant.architecture;
  const nodes = arch.nodes ?? [];
  const rels = arch.relationships ?? [];

  const addedNodes = new Set(mutant.highlight.addedNodeIds ?? []);
  const modifiedNodes = new Set(mutant.highlight.modifiedNodeIds ?? []);
  const addedRels = new Set(mutant.highlight.addedRelIds ?? []);
  const modifiedRels = new Set(mutant.highlight.modifiedRelIds ?? []);

  const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(nodes.length))));
  const nodeW = 190;
  const nodeH = 74;
  const gapX = 70;
  const gapY = 80;
  const padX = 48;
  const headerH = 76;
  const padY = headerH + 36;

  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((n: CalmNode, idx: number) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    positions.set(n['unique-id'], {
      x: padX + col * (nodeW + gapX),
      y: padY + row * (nodeH + gapY),
    });
  });

  const rows = Math.max(1, Math.ceil(nodes.length / cols));
  const width = Math.max(720, padX * 2 + cols * nodeW + (cols - 1) * gapX);
  const height = Math.max(320, padY + rows * nodeH + (rows - 1) * gapY + 54);

  const edgeLines: string[] = [];
  for (const rel of rels) {
    const c = rel['relationship-type'].connects;
    if (!c) continue;
    const p1 = positions.get(c.source.node);
    const p2 = positions.get(c.destination.node);
    if (!p1 || !p2) continue;

    const x1 = p1.x + nodeW / 2;
    const y1 = p1.y + nodeH / 2;
    const x2 = p2.x + nodeW / 2;
    const y2 = p2.y + nodeH / 2;

    const id = rel['unique-id'];
    const isAdded = addedRels.has(id);
    const isMod = modifiedRels.has(id);
    const stroke = isAdded ? '#ef4444' : isMod ? '#f59e0b' : '#64748b';
    const dash = isAdded ? ' stroke-dasharray="7 4"' : '';
    const strokeW = isAdded || isMod ? 2.5 : 1.5;
    const marker = isAdded
      ? 'url(#arrow-red)'
      : isMod
        ? 'url(#arrow-amber)'
        : 'url(#arrow-slate)';

    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - 8;
    const label = rel.protocol ? `${truncate(id, 20)} [${rel.protocol}]` : truncate(id, 24);

    edgeLines.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeW}"${dash} marker-end="${marker}" />` +
        `<rect x="${mx - 68}" y="${my - 10}" width="136" height="18" rx="4" fill="#0f172a" fill-opacity="0.88" stroke="${stroke}" stroke-width="0.8"/>` +
        `<text x="${mx}" y="${my + 3}" text-anchor="middle" font-size="10" fill="${isAdded ? '#fca5a5' : isMod ? '#fcd34d' : '#cbd5e1'}" font-family="ui-monospace, monospace">${escapeXml(label)}</text>`
    );
  }

  const nodeBoxes: string[] = [];
  for (const node of nodes) {
    const id = node['unique-id'];
    const pos = positions.get(id);
    if (!pos) continue;

    const isAdded = addedNodes.has(id);
    const isMod = modifiedNodes.has(id);
    const border = isAdded ? '#ef4444' : isMod ? '#f59e0b' : '#334155';
    const fill = isAdded ? '#450a0a' : isMod ? '#451a03' : '#1e293b';
    const badge = isAdded ? 'ROGUE NODE' : isMod ? 'MUTATED' : node['node-type'];

    nodeBoxes.push(
      `<g>` +
        `<rect x="${pos.x}" y="${pos.y}" width="${nodeW}" height="${nodeH}" rx="10" fill="${fill}" stroke="${border}" stroke-width="${isAdded || isMod ? 2.5 : 1.5}"/>` +
        `<text x="${pos.x + 12}" y="${pos.y + 24}" font-size="12" font-weight="700" fill="#f8fafc" font-family="system-ui, sans-serif">${escapeXml(truncate(node.name ?? id, 22))}</text>` +
        `<text x="${pos.x + 12}" y="${pos.y + 42}" font-size="10" fill="#94a3b8" font-family="ui-monospace, monospace">${escapeXml(truncate(id, 26))}</text>` +
        `<text x="${pos.x + 12}" y="${pos.y + 60}" font-size="10" font-weight="600" fill="${isAdded ? '#fca5a5' : isMod ? '#fcd34d' : '#38bdf8'}" font-family="ui-monospace, monospace">${escapeXml(truncate(badge, 26))}</text>` +
        `</g>`
    );
  }

  const title = `SURVIVED (calm validate PASSED) — ${mutant.operator}`;
  const subtitle = truncate(mutant.description, 95);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="arrow-slate" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b"/>
    </marker>
    <marker id="arrow-amber" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b"/>
    </marker>
    <marker id="arrow-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444"/>
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="#0f172a"/>
  <rect x="0" y="0" width="${width}" height="${headerH}" fill="#7f1d1d" fill-opacity="0.55"/>
  <line x1="0" y1="${headerH}" x2="${width}" y2="${headerH}" stroke="#ef4444" stroke-width="1.5"/>
  <text x="24" y="30" font-size="15" font-weight="700" fill="#fecaca" font-family="system-ui, sans-serif">${escapeXml(title)}</text>
  <text x="24" y="54" font-size="12" fill="#e2e8f0" font-family="ui-monospace, monospace">${escapeXml(subtitle)}</text>
  ${edgeLines.join('\n  ')}
  ${nodeBoxes.join('\n  ')}
</svg>
`;
}
