import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';

// Prepares synthetic fixtures only. Launch through the interactive desktop; no UI input is automated here.
const base = path.resolve(import.meta.dirname, '..');
if (!process.argv.includes('--prepare')) {
  console.log('Usage: node scripts/native-e2e.mjs --prepare\nFirst build with scripts/build-e2e.cmd. See docs/TESTING.md.');
} else {
  const binary = path.join(base, 'src-tauri/target/release/av-library-manager.exe');
  const bytes = await fs.readFile(binary);
  if (!bytes.includes(Buffer.from('--remote-debugging-port=19222'))) throw new Error('Build the opt-in e2e feature first; production binary has no test interface.');
  const checkPort = net.createServer();
  await new Promise((resolve, reject) => { checkPort.once('error', reject); checkPort.listen(19222, '127.0.0.1', resolve); });
  await new Promise(resolve => checkPort.close(resolve));
  const work = path.join(base, '.qa', 'native-' + Date.now());
  const media = path.join(work, '媒体 & 样本');
  const exe = path.join(work, 'AVLibraryE2E.exe');
  await fs.mkdir(media, { recursive: true });
  await fs.copyFile(binary, exe);
  await fs.copyFile(path.join(base,'tests/fixtures/system-thumbnail.mp4'),path.join(media,'www.site@JUFE-626_restored.mp4'));
  await fs.writeFile(path.join(media, 'JUFE-626.srt'), '1\n00:00:00,000 --> 00:00:30,000\nSUBTITLE INTEGRATION TEST\n');
  const config = { mode: 'synthetic-isolated', work, media, exe, port: 19222 };
  await fs.writeFile(path.join(base, '.qa/approved-config.json'), JSON.stringify(config, null, 2));
  console.log(JSON.stringify({ exe, next: 'Launch this isolated EXE in the interactive desktop, configure the desired player, then run node scripts/native-api-check.mjs. Actual player picture and subtitle still require visual observation.' }, null, 2));
}
