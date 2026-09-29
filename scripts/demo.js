#!/usr/bin/env node
'use strict';
// `npm run demo`: copy the sample workspace to a scratch folder (so the
// bundled examples stay pristine) and start Margin with the offline demo agent.
const fs = require('fs');
const os = require('os');
const path = require('path');

const src = path.join(__dirname, '..', 'example-workspace');
const dst = path.join(os.tmpdir(), 'agent-notes-demo');
if (process.argv.includes('--reset') || !fs.existsSync(dst)) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
  console.log(`Copied sample notes to ${dst}`);
} else {
  console.log(`Reusing ${dst} (run "npm run demo -- --reset" for a fresh copy)`);
}
process.argv = [process.argv[0], path.join(__dirname, '..', 'server.js'), dst, '--agent', 'demo',
  ...process.argv.slice(2).filter((a) => a !== '--reset')];
require('../server.js');
