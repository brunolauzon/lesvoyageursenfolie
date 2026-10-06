/** Small, dependency-free HTML helpers for official hotel sites. */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decodeEntities = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Every JSON-LD node on the page, with @graph flattened. */
export function jsonLdNodes(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(visit);
    else if (x && typeof x === 'object') {
      out.push(x as Record<string, unknown>);
      const graph = (x as Record<string, unknown>)['@graph'];
      if (graph) visit(graph);
    }
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1]!.trim()));
    } catch {
      /* malformed JSON-LD is common; skip it */
    }
  }
  return out;
}

export function metaContent(html: string, property: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/\b(?:property|name)=["']([^"']+)["']/i)?.[1];
    if (key?.toLowerCase() !== property.toLowerCase()) continue;
    const content = tag.match(/\bcontent=["']([^"']*)["']/i)?.[1];
    if (content) return decodeEntities(content);
  }
  return null;
}

/** Visible text: scripts, styles and tags removed, whitespace collapsed. */
export function visibleText(html: string, max = 20_000): string {
  const text = html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, max);
}

export function links(html: string, base: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      out.push({ href: new URL(decodeEntities(m[1]!), base).href, text: visibleText(m[2]!, 120) });
    } catch {
      /* bad href */
    }
  }
  return out;
}
