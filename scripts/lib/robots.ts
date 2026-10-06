/** Minimal robots.txt check: longest matching Allow/Disallow in the most specific user-agent group. */
export function isAllowed(robotsTxt: string, path: string, agentToken: string): boolean {
  type Group = { agents: string[]; rules: { allow: boolean; path: string }[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: field === 'allow', path: value });
    } else lastWasAgent = false;
  }

  const token = agentToken.toLowerCase();
  const group = groups.find((g) => g.agents.some((a) => a !== '*' && token.includes(a))) ?? groups.find((g) => g.agents.includes('*'));
  if (!group) return true;

  const matches = group.rules.filter((r) => {
    const pattern = r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
    return new RegExp(`^${pattern}`).test(path);
  });
  if (!matches.length) return true;
  const best = matches.reduce((a, b) => (b.path.length > a.path.length || (b.path.length === a.path.length && b.allow) ? b : a));
  return best.allow;
}
