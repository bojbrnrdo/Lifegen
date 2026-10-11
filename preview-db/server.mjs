// PGlite wire gateway — exposes an in-process PGlite database over the PostgreSQL
// wire protocol so standard drivers (node-postgres) can connect on :5433.
//
// Design (hard-won, do not regress):
//  * Fake handshake: SSLRequest/GSSAPIRequest refused with 'N'; CancelRequest
//    closes the socket; StartupMessage gets immediate AuthenticationOk (any
//    credentials), PG 16.4 parameter status, BackendKeyData, ReadyForQuery 'I'.
//  * Every other message is fed ONE AT A TIME to db.execProtocolRaw().
//  * PGlite appends ReadyForQuery (Z) to EVERY reply — during extended-protocol
//    rounds we strip Z and only deliver it after Sync (or after simple Query).
//  * ErrorResponse during an extended round => gateway discards further
//    messages until Sync, then lets Sync's Z through (skip-until-Sync).
//  * PGlite is SINGLE-SESSION: a global mutex serializes all clients. A client
//    inside a transaction (or mid extended round) keeps the lock until it
//    returns to idle — never await a client blocked behind an open transaction.
//  * 'A' (NotificationResponse) and 'N' (NoticeResponse) bytes are passed
//    through wherever PGlite emits them (LISTEN client falls back to polling).
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const DATA = process.env.PGW_DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const PORT = Number(process.env.PGW_PORT || 5433);

const db = new PGlite(DATA);
await db.waitReady;

// ---- global engine lock -------------------------------------------------
let tail = Promise.resolve();
function lockEngine() {
  let release;
  const hold = new Promise((r) => { release = r; });
  const wait = tail;
  tail = wait.then(() => hold);
  return wait.then(() => release);
}

// ---- protocol helpers ---------------------------------------------------
const msg = (type, payload) => {
  const b = Buffer.allocUnsafe(5 + payload.length);
  b.write(type, 0, 'latin1');
  b.writeUInt32BE(payload.length + 4, 1);
  payload.copy(b, 5);
  return b;
};
const cstr = (s) => Buffer.from(s + '\0', 'utf8');

function errorResponse(code, message, severity = 'ERROR') {
  const parts = [];
  const field = (k, v) => { parts.push(Buffer.from(k, 'latin1')); parts.push(cstr(v)); };
  field('S', severity); field('V', severity); field('C', code); field('M', message);
  parts.push(Buffer.from([0]));
  return msg('E', Buffer.concat(parts));
}

function splitMessages(buf) {
  const out = [];
  let off = 0;
  while (off + 5 <= buf.length) {
    const type = String.fromCharCode(buf[off]);
    const len = buf.readUInt32BE(off + 1);
    if (len < 4 || off + 1 + len > buf.length) break;
    out.push({ type, payload: buf.subarray(off + 5, off + 1 + len) });
    off += 1 + len;
  }
  return { messages: out, consumed: off };
}

// Split a response stream; optionally drop the trailing ReadyForQuery.
function peelResponse(resp) {
  const { messages } = splitMessages(resp);
  let z = null, hadError = false, lastIdx = messages.length;
  if (messages.length && messages[messages.length - 1].type === 'Z') {
    z = String.fromCharCode(messages[messages.length - 1].payload[0]);
    lastIdx = messages.length - 1;
  }
  for (const m of messages) if (m.type === 'E') hadError = true;
  const stripped = Buffer.concat(messages.slice(0, lastIdx).map((m) => msg(m.type, m.payload)));
  return { stripped, z, hadError };
}

function frame(m) {
  return Buffer.concat([Buffer.from(m.type, 'latin1'), (() => { const l = Buffer.allocUnsafe(4); l.writeUInt32BE(m.payload.length + 4, 0); return l; })(), m.payload]);
}

function startupOk() {
  const parts = [msg('R', Buffer.alloc(4))]; // AuthenticationOk
  const params = [
    ['server_version', '16.4'], ['server_encoding', 'UTF8'], ['client_encoding', 'UTF8'],
    ['DateStyle', 'ISO, MDY'], ['integer_datetimes', 'on'], ['IntervalStyle', 'postgres'],
    ['TimeZone', 'UTC'], ['standard_conforming_strings', 'on'], ['application_name', ''],
  ];
  for (const [k, v] of params) parts.push(msg('S', Buffer.concat([cstr(k), cstr(v)])));
  const key = Buffer.allocUnsafe(8);
  key.writeUInt32BE((Math.random() * 0x7fffffff) | 0, 0);
  key.writeUInt32BE((Math.random() * 0x7fffffff) | 0, 4);
  parts.push(msg('K', key));
  parts.push(msg('Z', Buffer.from('I', 'latin1')));
  return Buffer.concat(parts);
}

// ---- server -------------------------------------------------------------
const server = net.createServer((sock) => {
  if (process.env.PGW_DEBUG) console.error('[dbg] connection from', sock.remoteAddress + ':' + sock.remotePort);
  let buf = Buffer.alloc(0);
  let phase = 'startup';
  let release = null;      // engine-lock release fn while held
  let txStatus = 'I';      // last ReadyForQuery status we delivered
  let errSkip = false;     // extended round errored; discard until Sync
  let extHeld = false;     // inside an extended-protocol round
  let busy = false;

  const send = (b) => { if (!sock.destroyed) sock.write(b); };
  const dropLock = () => { if (release) { release(); release = null; } };
  const maybeRelease = () => { if (release && !extHeld && !errSkip && txStatus === 'I') dropLock(); };

  async function safeExec(bytes) {
    try {
      if (process.env.PGW_DEBUG) console.error('[dbg] exec', String.fromCharCode(bytes[0]), bytes.length);
      const out = await db.execProtocolRaw(bytes);
      if (process.env.PGW_DEBUG) console.error('[dbg] exec reply', out && out.length);
      return Buffer.from(out);
    } catch (e) {
      console.error('[gateway] exec error:', e && e.message);
      dropLock(); extHeld = false; errSkip = false; txStatus = 'I';
      return Buffer.concat([errorResponse('XX000', String(e?.message || e)), msg('Z', Buffer.from('I', 'latin1'))]);
    }
  }

  async function handleReady(m) {
    if (m.type === 'X') { dropLock(); sock.destroy(); return; }
    if (errSkip) {
      if (m.type !== 'S') return; // discard until Sync
      errSkip = false;
      const resp = await safeExec(frame(m));
      const { z } = peelResponse(resp);
      if (z) { send(resp); txStatus = z; } else {
        const code = txStatus === 'T' ? 'T' : txStatus === 'E' ? 'E' : 'I';
        send(msg('Z', Buffer.from(code, 'latin1')));
      }
      extHeld = false; maybeRelease();
      return;
    }
    if (!release) release = await lockEngine();
    if (m.type === 'Q') {
      const resp = await safeExec(frame(m));
      send(resp);
      const { z } = peelResponse(resp);
      if (z) txStatus = z;
      maybeRelease();
      return;
    }
    if (m.type === 'S') {
      const resp = await safeExec(frame(m));
      send(resp);
      const { z } = peelResponse(resp);
      if (z) txStatus = z;
      extHeld = false; maybeRelease();
      return;
    }
    // extended-protocol messages: Parse/Bind/Describe/Execute/Close/Flush
    extHeld = true;
    const resp = await safeExec(frame(m));
    const { stripped, z, hadError } = peelResponse(resp);
    if (stripped.length) send(stripped);
    if (hadError) { errSkip = true; if (z) txStatus = z; }
    // keep the engine lock until Sync (or Terminate)
  }

  async function handleStartup() {
    if (process.env.PGW_DEBUG) console.error('[dbg] handleStartup buf', buf.length, buf.length >= 8 ? 'len=' + buf.readUInt32BE(0) + ' code=' + buf.readInt32BE(4) : '');
    if (buf.length < 8) return;
    const len = buf.readUInt32BE(0);
    if (len < 8 || len > 65536) { sock.destroy(); return; } // not a Postgres client (e.g. HTTP health probe)
    if (buf.length < len) return;
    const code = buf.readInt32BE(4);
    const packet = buf.subarray(0, len);
    buf = buf.subarray(len);
    if (code === 80877103 || code === 80877104) { send(Buffer.from('N', 'latin1')); return; } // no SSL/GSS
    if (code === 80877102) { sock.destroy(); return; } // CancelRequest
    if (code === 196608) { phase = 'ready'; if (process.env.PGW_DEBUG) console.error('[dbg] startup ok, sending', 'auth reply'); send(startupOk()); return; } // protocol 3.0
    send(errorResponse('0A000', 'Unsupported protocol version'));
    sock.destroy();
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      for (;;) {
        if (phase === 'startup') {
          const before = buf.length;
          await handleStartup();
          if (sock.destroyed) return;
          if (buf.length === before) break; // incomplete packet; wait for more data
          if (buf.length === 0) break;
          continue; // more buffered packets to parse
        }
        const { messages, consumed } = splitMessages(buf);
        if (!messages.length) break;
        buf = buf.subarray(consumed);
        for (const m of messages) {
          await handleReady(m);
          if (sock.destroyed) return;
        }
      }
    } finally {
      busy = false;
    }
  }

  sock.on('data', (chunk) => {
    if (process.env.PGW_DEBUG) console.error('[dbg] data', chunk.length, 'phase', phase);
    buf = Buffer.concat([buf, chunk]);
    pump().catch((e) => {
      console.error('[gateway] pump error:', e && e.stack || e);
      try { send(Buffer.concat([errorResponse('XX000', String(e?.message || e)), msg('Z', Buffer.from('I', 'latin1'))])); } catch {}
      dropLock();
    });
  });
  // If a client dies mid-transaction (or mid-error-skip), the shared PGlite
  // session stays wedged in an aborted transaction; roll it back so the next
  // client gets a clean session.
  const cleanup = () => {
    if (!release) return;
    const rel = release; release = null;
    if (txStatus !== 'I' || errSkip) {
      const body = Buffer.from('ROLLBACK\0', 'utf8');
      const lenB = Buffer.allocUnsafe(4); lenB.writeUInt32BE(body.length + 4, 0);
      db.execProtocolRaw(Buffer.concat([Buffer.from('Q', 'latin1'), lenB, body]))
        .catch(() => {})
        .finally(() => rel());
    } else rel();
    extHeld = false; errSkip = false; txStatus = 'I';
  };
  sock.on('close', cleanup);
  sock.on('error', () => { cleanup(); sock.destroy(); });
});

server.listen(PORT, '0.0.0.0', () => console.log(`PGlite wire gateway listening on 0.0.0.0:${PORT}`));
