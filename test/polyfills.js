// Polyfill crypto.DigestStream for Node.js testing
// This mimics the Cloudflare Workers DigestStream API

import nodeCrypto from 'node:crypto';

class DigestStream extends WritableStream {
  constructor(algorithm) {
    const normalizedAlg = algorithm.replace('-', '').toLowerCase(); // SHA-256 -> sha256
    const hash = nodeCrypto.createHash(normalizedAlg);

    let digestPromiseResolve;
    const digestPromise = new Promise((resolve) => {
      digestPromiseResolve = resolve;
    });

    super({
      write(chunk) {
        hash.update(chunk);
      },
      close() {
        const digest = hash.digest();
        digestPromiseResolve(digest.buffer);
      }
    });

    this.digest = digestPromise;
  }
}

// Install polyfill into global crypto object
if (typeof crypto !== 'undefined' && !('DigestStream' in crypto)) {
  crypto.DigestStream = DigestStream;
} else if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = { DigestStream };
} else {
  globalThis.crypto.DigestStream = DigestStream;
}
