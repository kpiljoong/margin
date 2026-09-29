#!/usr/bin/env node
'use strict';
// Create the Ed25519 key pair for signing code packages.
//
//   node build/new-update-key.js <private key file>
//
// Writes the private key (PEM, mode 600) and prints the public key to paste
// into desktop/boot.js. Store the private key as the MARGIN_UPDATE_KEY
// GitHub Actions secret and keep a backup: losing it means the next update
// needs a new app download (bump marginShell).

const crypto = require('crypto');
const fs = require('fs');

const file = process.argv[2];
if (!file) { console.error('usage: node build/new-update-key.js <private key file>'); process.exit(2); }
if (fs.existsSync(file)) { console.error(`${file} already exists`); process.exit(2); }
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
console.log(`Private key written to ${file}\n\nPublic key for desktop/boot.js:\n`);
process.stdout.write(publicKey.export({ type: 'spki', format: 'pem' }));
