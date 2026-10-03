// Which scheme will the gateway actually serve on?
//
// The gateway enables TLS when (and only when) a generated certificate pair
// exists — see the `tlsOn` condition in src/index.js. These matrices used to
// hardcode `https://`, which meant they only passed on a machine that had run
// certs-gen.mjs and failed everywhere else with an opaque
// ERR_SSL_WRONG_VERSION_NUMBER. One condition, one place: this mirrors it so a
// scheme change cannot leave the tests testing a server that is not there.
const fs = require('node:fs');
const path = require('node:path');

const CERT_DIR = path.join(__dirname, '..', '..', 'certs');
const TLS = fs.existsSync(path.join(CERT_DIR, 'key.pem')) && fs.existsSync(path.join(CERT_DIR, 'cert.pem'));

module.exports = {
  TLS,
  scheme: TLS ? 'https' : 'http',
  /** Base URL for a gateway bound to `port` on loopback. */
  base: (port) => `${TLS ? 'https' : 'http'}://127.0.0.1:${port}`,
};
