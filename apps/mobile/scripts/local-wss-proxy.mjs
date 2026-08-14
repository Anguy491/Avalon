import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const [certificatePath, keyPath] = process.argv.slice(2);
if (certificatePath === undefined || keyPath === undefined) {
  throw new Error('Usage: local-wss-proxy.mjs <certificate> <private-key>');
}

const upstreamHost = '127.0.0.1';
const upstreamPort = 3000;
const listenPort = 3443;

const server = https.createServer(
  {
    cert: readFileSync(certificatePath),
    key: readFileSync(keyPath),
  },
  (request, response) => {
    const upstream = http.request(
      {
        hostname: upstreamHost,
        port: upstreamPort,
        path: request.url,
        method: request.method,
        headers: {
          ...request.headers,
          host: `${upstreamHost}:${upstreamPort}`,
        },
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  },
);

server.on('upgrade', (request, client, head) => {
  const upstream = net.connect(upstreamPort, upstreamHost, () => {
    const headers = Object.entries(request.headers)
      .flatMap(([name, value]) =>
        Array.isArray(value)
          ? value.map((item) => `${name}: ${item}`)
          : value === undefined
            ? []
            : [`${name}: ${value}`],
      )
      .filter((header) => !header.toLowerCase().startsWith('host:'));
    upstream.write(
      `${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/${request.httpVersion}\r\n` +
        `host: ${upstreamHost}:${upstreamPort}\r\n${headers.join('\r\n')}\r\n\r\n`,
    );
    if (head.length > 0) upstream.write(head);
    client.pipe(upstream).pipe(client);
  });
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
});

server.listen(listenPort, '127.0.0.1', () => {
  process.stdout.write(
    `LOCAL_WSS_READY=wss://localhost:${String(listenPort)}/game-v1\n`,
  );
});

const close = () => server.close(() => process.exit(0));
process.once('SIGINT', close);
process.once('SIGTERM', close);
