"use strict";

const net = require("node:net");

function requirePort(value, name, allowZero = false) {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 65535) {
    throw new RangeError(`${name} must be ${allowZero ? "0..65535" : "1..65535"}`);
  }
}

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function createTcpRelay(options) {
  const {
    listenHost,
    listenPort,
    upstreamHost,
    upstreamPort,
    maxConnections,
    connectTimeoutMs,
    idleTimeoutMs,
    logger = console,
  } = options;

  if (typeof listenHost !== "string" || !listenHost) throw new TypeError("listenHost is required");
  if (typeof upstreamHost !== "string" || !upstreamHost) throw new TypeError("upstreamHost is required");
  requirePort(listenPort, "listenPort", true);
  requirePort(upstreamPort, "upstreamPort");
  requirePositiveInteger(maxConnections, "maxConnections");
  requirePositiveInteger(connectTimeoutMs, "connectTimeoutMs");
  requirePositiveInteger(idleTimeoutMs, "idleTimeoutMs");

  const pairs = new Set();
  let acceptedConnections = 0;
  let rejectedConnections = 0;

  const server = net.createServer({ allowHalfOpen: false }, (client) => {
    if (pairs.size >= maxConnections) {
      rejectedConnections += 1;
      logger.warn(`[tcp-relay] rejected capacity remote=${client.remoteAddress || "unknown"}`);
      client.destroy();
      return;
    }

    const upstream = net.createConnection({
      host: upstreamHost,
      port: upstreamPort,
      allowHalfOpen: false,
    });
    const pair = { client, upstream, cleaned: false };
    pairs.add(pair);
    acceptedConnections += 1;

    client.pause();
    client.setNoDelay(true);
    client.setKeepAlive(true, 30000);
    client.setTimeout(idleTimeoutMs);
    upstream.setNoDelay(true);
    upstream.setKeepAlive(true, 30000);
    upstream.setTimeout(connectTimeoutMs);

    function cleanup(reason) {
      if (pair.cleaned) return;
      pair.cleaned = true;
      pairs.delete(pair);
      client.destroy();
      upstream.destroy();
      logger.info(`[tcp-relay] closed reason=${reason} active=${pairs.size}`);
    }

    client.on("error", (error) => cleanup(`client-error:${error.code || error.message}`));
    upstream.on("error", (error) => cleanup(`upstream-error:${error.code || error.message}`));
    client.on("timeout", () => cleanup("client-idle-timeout"));
    upstream.on("timeout", () => cleanup("upstream-timeout"));
    client.on("close", () => cleanup("client-close"));
    upstream.on("close", () => cleanup("upstream-close"));

    upstream.once("connect", () => {
      upstream.setTimeout(idleTimeoutMs);
      client.pipe(upstream);
      upstream.pipe(client);
      client.resume();
      logger.info(
        `[tcp-relay] connected remote=${client.remoteAddress || "unknown"}:${client.remotePort || 0}` +
          ` upstream=${upstreamHost}:${upstreamPort} active=${pairs.size}`,
      );
    });
  });

  server.on("error", (error) => logger.error(`[tcp-relay] listener-error ${error.stack || error}`));

  return {
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (error) => {
          server.removeListener("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.removeListener("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(listenPort, listenHost);
      });
    },
    address() {
      return server.address();
    },
    stats() {
      return {
        activeConnections: pairs.size,
        acceptedConnections,
        rejectedConnections,
      };
    },
    close() {
      for (const pair of Array.from(pairs)) {
        pair.client.destroy();
        pair.upstream.destroy();
      }
      if (!server.listening) return Promise.resolve();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function integerFromEnvironment(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

async function run() {
  const relay = createTcpRelay({
    listenHost: process.env.TCP_RELAY_LISTEN_HOST || "0.0.0.0",
    listenPort: integerFromEnvironment("TCP_RELAY_LISTEN_PORT", 5055),
    upstreamHost: process.env.TCP_RELAY_UPSTREAM_HOST || "3.76.0.237",
    upstreamPort: integerFromEnvironment("TCP_RELAY_UPSTREAM_PORT", 5055),
    maxConnections: integerFromEnvironment("TCP_RELAY_MAX_CONNECTIONS", 512),
    connectTimeoutMs: integerFromEnvironment("TCP_RELAY_CONNECT_TIMEOUT_MS", 10000),
    idleTimeoutMs: integerFromEnvironment("TCP_RELAY_IDLE_TIMEOUT_MS", 120000),
  });
  await relay.listen();
  const address = relay.address();
  console.log(
    `[tcp-relay] listening ${address.address}:${address.port}` +
      ` -> ${process.env.TCP_RELAY_UPSTREAM_HOST || "3.76.0.237"}:` +
      `${integerFromEnvironment("TCP_RELAY_UPSTREAM_PORT", 5055)}`,
  );

  let stopping = false;
  async function stop(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`[tcp-relay] stopping signal=${signal}`);
    await relay.close();
    process.exit(0);
  }
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`[tcp-relay] fatal ${error.stack || error}`);
    process.exitCode = 1;
  });
}

module.exports = { createTcpRelay };
