// Adds the 2P Crew site to the shared edge nginx's compose override, so a future recreate of that nginx
// keeps it: one read-only conf mount on the nginx service and the external crew network. Comments and
// layout of the file are preserved. Runs inside the crew-api image (it reuses the API's `yaml` package):
//
//   node nginx-override.mjs --file <override.yml> --service <svc> --volume <host:container:ro>
//        --network-key <key> --network-name <docker network> [--write]
//
// Exit codes: 0 already up to date, 10 a change is needed (and was written with --write),
// 2 bad arguments or unparseable YAML, 3 a shape this tool will not edit safely.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const require = createRequire('/app/apps/api/package.json');
const YAML = require('yaml');

function fail(code, message) {
  console.error(`nginx-override: ${message}`);
  process.exit(code);
}

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    service: { type: 'string' },
    volume: { type: 'string' },
    'network-key': { type: 'string' },
    'network-name': { type: 'string' },
    write: { type: 'boolean', default: false },
  },
});
const { file, service, volume } = values;
const networkKey = values['network-key'];
const networkName = values['network-name'];
if (!file || !service || !volume || !networkKey || !networkName) fail(2, 'missing arguments');
const target = volume.split(':')[1];
if (!target) fail(2, `--volume must be host:container[:ro], got ${volume}`);

let text;
try {
  text = readFileSync(file, 'utf8');
} catch (error) {
  fail(2, `cannot read ${file}: ${error.message}`);
}
const doc = YAML.parseDocument(text);
if (doc.errors.length > 0) fail(2, `invalid YAML in ${file}: ${doc.errors[0].message}`);
if (!YAML.isMap(doc.contents)) fail(3, `${file} is not a mapping`);

let changed = false;

const services = doc.get('services');
if (!YAML.isMap(services)) fail(3, 'the override has no services mapping');
const svc = services.get(service);
if (!YAML.isMap(svc)) fail(3, `service ${service} is not in the override; add the mount and network by hand`);

// 1. The conf mount, unless something is already mounted at the same container path.
let volumes = svc.get('volumes');
if (volumes === undefined) {
  svc.set('volumes', doc.createNode([]));
  volumes = svc.get('volumes');
}
if (!YAML.isSeq(volumes)) fail(3, `services.${service}.volumes is not a list`);
const mounted = volumes.items.some((item) => {
  const value = YAML.isScalar(item) ? String(item.value) : YAML.isMap(item) ? String(item.get('target')) : '';
  return value === target || value.split(':')[1] === target;
});
if (!mounted) {
  volumes.add(doc.createNode(volume));
  changed = true;
}

// 2. The service joins the crew network. Without an existing networks key the service would lose its
// default network on the next recreate, so that shape is left to a human.
const svcNetworks = svc.get('networks');
if (YAML.isSeq(svcNetworks)) {
  if (!svcNetworks.items.some((item) => YAML.isScalar(item) && item.value === networkKey)) {
    svcNetworks.add(doc.createNode(networkKey));
    changed = true;
  }
} else if (YAML.isMap(svcNetworks)) {
  if (!svcNetworks.has(networkKey)) {
    svcNetworks.set(networkKey, null);
    changed = true;
  }
} else {
  fail(3, `services.${service} has no networks key; add "${networkKey}" (and its current networks) by hand`);
}

// 3. The top-level external network.
let networks = doc.get('networks');
if (networks === undefined) {
  doc.set('networks', doc.createNode({}));
  networks = doc.get('networks');
}
if (!YAML.isMap(networks)) fail(3, 'top-level networks is not a mapping');
const existing = networks.get(networkKey);
if (existing === undefined || existing === null) {
  networks.set(networkKey, doc.createNode({ external: true, name: networkName }));
  changed = true;
} else if (
  !YAML.isMap(existing) ||
  existing.get('name') !== networkName ||
  existing.get('external') !== true
) {
  fail(3, `networks.${networkKey} exists but is not the external network ${networkName}`);
}

if (changed && values.write) writeFileSync(file, String(doc));
process.exit(changed ? 10 : 0);
