import { readFile, writeFile, mkdir } from 'node:fs/promises';
import vm from 'node:vm';
const source = (await Promise.all(['client-core.js', 'client-sessions.js', 'client-sidebar.js', 'client.js'].map(file => readFile(new URL('../src/' + file, import.meta.url), 'utf8')))).join('\n');
const bundled = `window.__ModuleLoader__.load({\n  id: 'dsh-wait-minute',\n  factory: (require) => {\n    const module = { exports: {} };\n    const exports = module.exports;\n${source}\n    return module.exports;\n  }\n});\n`;
new vm.Script(bundled, { filename: 'client.js' });
await mkdir(new URL('../lib/', import.meta.url), { recursive: true });
await writeFile(new URL('../lib/client.js', import.meta.url), bundled);
console.log('Built lib/client.js (DSH ModuleLoader artifact, no third-party build scripts).');
