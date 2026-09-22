"use strict";

const TCP_FRAME_MAGIC = 0xfb;
const TCP_PING_MAGIC = 0xf0;
const TCP_FRAME_HEADER_BYTES = 7;
const TCP_MIN_FRAME_BYTES = 9;
const TCP_PING_REQUEST_BYTES = 5;

function assertBuffer(value, name) {
  if (!Buffer.isBuffer(value)) {
    throw new TypeError(`${name} must be a Buffer`);
  }
}

function encodeFrame(payload, channel, reliable) {
  assertBuffer(payload, "payload");
  if (!Number.isInteger(channel) || channel < 0 || channel > 0xff) {
    throw new RangeError("channel must be an unsigned byte");
  }

  const totalLength = TCP_FRAME_HEADER_BYTES + payload.length;
  if (totalLength < TCP_MIN_FRAME_BYTES) {
    throw new RangeError("Photon TCP payload must contain message magic and type");
  }

  const frame = Buffer.allocUnsafe(totalLength);
  frame[0] = TCP_FRAME_MAGIC;
  frame.writeUInt32BE(totalLength, 1);
  frame[5] = channel;
  frame[6] = reliable ? 1 : 0;
  payload.copy(frame, TCP_FRAME_HEADER_BYTES);
  return frame;
}

function encodePingResponse(request, serverTimestamp) {
  assertBuffer(request, "request");
  if (request.length !== TCP_PING_REQUEST_BYTES || request[0] !== TCP_PING_MAGIC) {
    throw new RangeError("Photon TCP ping request must be exactly five bytes");
  }
  if (!Number.isInteger(serverTimestamp)) {
    throw new TypeError("serverTimestamp must be an integer");
  }

  const response = Buffer.allocUnsafe(9);
  response[0] = TCP_PING_MAGIC;
  response.writeUInt32BE(serverTimestamp >>> 0, 1);
  request.copy(response, 5, 1);
  return response;
}

function createParser({ maxFrameBytes, onFrame, onPing }) {
  if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < TCP_MIN_FRAME_BYTES) {
    throw new RangeError(`maxFrameBytes must be at least ${TCP_MIN_FRAME_BYTES}`);
  }
  if (typeof onFrame !== "function" || typeof onPing !== "function") {
    throw new TypeError("onFrame and onPing callbacks are required");
  }

  let buffered = Buffer.alloc(0);

  function push(chunk) {
    assertBuffer(chunk, "chunk");
    if (chunk.length === 0) {
      return;
    }

    buffered = buffered.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffered, chunk]);

    while (buffered.length > 0) {
      const magic = buffered[0];

      if (magic === TCP_PING_MAGIC) {
        if (buffered.length < TCP_PING_REQUEST_BYTES) {
          break;
        }
        const ping = Buffer.from(buffered.subarray(0, TCP_PING_REQUEST_BYTES));
        buffered = buffered.subarray(TCP_PING_REQUEST_BYTES);
        onPing(ping);
        continue;
      }

      if (magic !== TCP_FRAME_MAGIC) {
        throw new Error(`Invalid Photon TCP magic 0x${magic.toString(16)}`);
      }
      if (buffered.length < 5) {
        break;
      }

      const declaredLength = buffered.readUInt32BE(1);
      if (declaredLength < TCP_MIN_FRAME_BYTES) {
        throw new Error(`Invalid Photon TCP frame length ${declaredLength}`);
      }
      if (declaredLength > maxFrameBytes) {
        throw new Error(
          `Photon TCP frame length ${declaredLength} exceeds maximum ${maxFrameBytes}`,
        );
      }
      if (buffered.length < declaredLength) {
        break;
      }

      const frame = buffered.subarray(0, declaredLength);
      buffered = buffered.subarray(declaredLength);
      onFrame({
        channel: frame[5],
        reliable: frame[6] !== 0,
        payload: Buffer.from(frame.subarray(TCP_FRAME_HEADER_BYTES)),
      });
    }

    if (buffered.length > maxFrameBytes) {
      throw new Error(`Photon TCP buffer exceeds maximum ${maxFrameBytes}`);
    }
  }

  return {
    push,
    bufferedBytes() {
      return buffered.length;
    },
  };
}

module.exports = {
  createParser,
  encodeFrame,
  encodePingResponse,
};
