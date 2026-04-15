/**
 * demuxBuffer — pure helper that splits a concatenated Docker non-TTY
 * log buffer into stdout/stderr strings by walking the 8-byte frame header.
 *
 * Frame format (Docker engine spec):
 *   byte 0       : stream type  (1 = stdout, 2 = stderr, 0 = stdin, other = skip)
 *   bytes 1..3   : padding (zero)
 *   bytes 4..7   : payload length, big-endian uint32
 *   bytes 8..    : payload (utf-8)
 *
 * This pure function is exercised by the Wave 0 fixture test. The streaming
 * server path uses `container.modem.demuxStream()` directly against the live
 * Readable — this helper exists for determinism in tests and as a fallback.
 *
 * Phase 6 Plan 02 Task 1 — WebUI Container-Logs View.
 *
 * @param {Buffer} buf
 * @returns {{ stdout: string, stderr: string }}
 */
export function demuxBuffer(buf) {
  let stdout = "";
  let stderr = "";
  let offset = 0;

  while (offset + 8 <= buf.length) {
    const type = buf[offset];
    const len = buf.readUInt32BE(offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + len;

    if (payloadEnd > buf.length) {
      // Incomplete trailing frame — drop silently.
      break;
    }

    if (type === 1) {
      stdout += buf.slice(payloadStart, payloadEnd).toString("utf8");
    } else if (type === 2) {
      stderr += buf.slice(payloadStart, payloadEnd).toString("utf8");
    }
    // Unknown type (0, 3, …) → skip payload silently.

    offset = payloadEnd;
  }

  return { stdout, stderr };
}
