// Checks app.js against what the OTE spec actually publishes.
//
// The reader deliberately carries no runtime dependency on
// @opentechevents/validate (see README, "OTE spec version support"): what it
// needs is the support policy, not megabytes of compiled schemas it would
// have to judge documents with. The cost of mirroring a policy is drift, so
// this script buys the sync back without buying the dependency — it reads the
// published versions from the npm registry and the inherited fields from the
// published schema, and fails when app.js no longer agrees.
//
// Network-dependent by design, and skipped (not failed) when offline: this is
// a release-time check, not a gate on every edit.
import { readFile } from 'node:fs/promises';

const REGISTRY = 'https://registry.npmjs.org/@opentechevents/schema';
const SCHEMA_BASE = 'https://opentechevents.org/schema';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function arrayLiteral(name) {
  const match = app.match(new RegExp(`var ${name} = \\[([^\\]]*)\\]`));
  if (!match) throw new Error(`${name} not found in app.js`);
  return match[1].split(',').map((part) => part.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

const minorOf = (version) => version.split('.').slice(0, 2).join('.');
const problems = [];

let published;
try {
  published = Object.keys((await json(REGISTRY)).versions).sort((a, b) => {
    const [am, an] = a.split('.').map(Number);
    const [bm, bn] = b.split('.').map(Number);
    return am - bm || an - bn;
  });
} catch (error) {
  console.log(`skip: could not reach the registry (${error.message})`);
  process.exit(0);
}

const declaredVersions = arrayLiteral('PUBLISHED_SPEC_VERSIONS');
if (declaredVersions.join() !== published.join()) {
  problems.push(
    `PUBLISHED_SPEC_VERSIONS is [${declaredVersions.join(', ')}] but the registry publishes ` +
    `[${published.join(', ')}]. Append the new version — the support window and the latest ` +
    `version derive from this list.`
  );
}

// The fields an event inherits from its feed are marked in the schema itself,
// so this list has a source of truth and does not need updating by eye.
const latestMinor = minorOf(published[published.length - 1]);
const eventSchema = await json(`${SCHEMA_BASE}/v${latestMinor}/event.schema.json`);
const inherits = [];
(function walk(node) {
  if (Array.isArray(node)) return node.forEach(walk);
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'x-inheritsFrom' && typeof value === 'string') {
      inherits.push(value.replace(/^feed\./, ''));
    }
    walk(value);
  }
})(eventSchema);

const declaredInherits = arrayLiteral('INHERITED_FEED_FIELDS');
const missing = inherits.filter((field) => !declaredInherits.includes(field));
const extra = declaredInherits.filter((field) => !inherits.includes(field));
if (missing.length || extra.length) {
  problems.push(
    `INHERITED_FEED_FIELDS does not match x-inheritsFrom in the v${latestMinor} event schema` +
    `${missing.length ? `; missing: ${missing.join(', ')}` : ''}` +
    `${extra.length ? `; no longer inherited: ${extra.join(', ')}` : ''}.`
  );
}

if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}

console.log(
  `✓ OTE spec ${published[published.length - 1]} — published [${published.join(', ')}], ` +
  `inherited fields [${inherits.join(', ')}]`
);
