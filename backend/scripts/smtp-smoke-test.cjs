#!/usr/bin/env node
/**
 * Local SMTP smoke tests in-process (no company network required).
 */
const http = require('node:http');
const net = require('node:net');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

process.chdir(path.join(__dirname, '..'));

function listenSmtp() {
  const messages = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let dataMode = false;
    socket.write('220 localhost ESMTP test\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (dataMode) {
        if (buffer.includes('\r\n.\r\n')) {
          messages.push(buffer);
          buffer = '';
          dataMode = false;
          socket.write('250 OK\r\n');
        }
        return;
      }
      const lines = buffer.split(/\r\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250-localhost\r\n250 PIPELINING\r\n');
        } else if (upper.startsWith('MAIL FROM:') || upper.startsWith('RCPT TO:') || upper === 'RSET' || upper === 'NOOP') {
          socket.write('250 OK\r\n');
        } else if (upper === 'DATA') {
          dataMode = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 Bye\r\n');
          socket.end();
        } else if (line) {
          socket.write('250 OK\r\n');
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, messages });
    });
  });
}

function listenConnectProxy() {
  const server = net.createServer((client) => {
    let buffer = Buffer.alloc(0);
    let tunneled = false;
    client.on('data', (chunk) => {
      if (tunneled) return;
      buffer = Buffer.concat([buffer, chunk]);
      const text = buffer.toString('utf8');
      if (!text.includes('\r\n\r\n')) return;
      const [header] = text.split('\r\n\r\n');
      const requestLine = header.split('\r\n')[0] || '';
      const match = /^CONNECT\s+([^:\s]+):(\d+)\s+HTTP\/1\.[01]/i.exec(requestLine);
      if (!match) {
        client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      const targetHost = match[1];
      const targetPort = Number(match[2]);
      const upstream = net.connect(targetPort, targetHost, () => {
        tunneled = true;
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        const rest = buffer.slice(buffer.indexOf('\r\n\r\n') + 4);
        if (rest.length) upstream.write(rest);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function loadEmailClientWithEnv(env) {
  Object.assign(process.env, env);
  // Clear cached env + email modules so new process.env is parsed.
  const dist = path.join(__dirname, '..', 'dist');
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(dist)) delete require.cache[key];
  }
  return require('../dist/services/emailClient.js');
}

async function main() {
  const payload = {
    to: 'sudeep@example.com',
    subject: 'SMTP smoke test',
    text: 'hello from smoke test',
    html: '<p>hello from smoke test</p>',
  };

  const direct = await listenSmtp();
  let client = loadEmailClientWithEnv({
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(direct.port),
    SMTP_SECURE: 'false',
    SMTP_FROM: 'noreply@example.com',
    MONTHLY_REPORT_TO: 'sudeep@example.com',
    SMTP_PROXY: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    NODE_ENV: 'test',
  });
  await client.sendMail(payload);
  assert.ok(direct.messages.length >= 1, 'direct SMTP expected a message');
  assert.match(direct.messages[0], /SMTP smoke test/);
  console.log(JSON.stringify({ event: 'smtp_direct_ok', messages: direct.messages.length }));
  direct.server.close();

  const proxiedSmtp = await listenSmtp();
  const proxy = await listenConnectProxy();
  client = loadEmailClientWithEnv({
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(proxiedSmtp.port),
    SMTP_SECURE: 'false',
    SMTP_FROM: 'noreply@example.com',
    MONTHLY_REPORT_TO: 'sudeep@example.com',
    SMTP_PROXY: `http://127.0.0.1:${proxy.port}`,
    SMTP_USER: '',
    SMTP_PASS: '',
    NODE_ENV: 'test',
  });
  await client.sendMail(payload);
  assert.ok(proxiedSmtp.messages.length >= 1, 'proxied SMTP expected a message');
  assert.match(proxiedSmtp.messages[0], /SMTP smoke test/);
  console.log(JSON.stringify({ event: 'smtp_proxy_ok', messages: proxiedSmtp.messages.length }));
  proxiedSmtp.server.close();
  proxy.server.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
