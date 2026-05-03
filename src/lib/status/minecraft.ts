import 'server-only';
import { Socket } from 'node:net';

export type MinecraftStatus = {
  status: 'online' | 'offline';
  players?: number;
  maxPlayers?: number;
  version?: string;
  latencyMs?: number;
  motd?: string;
};

function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;
  while (true) {
    if ((v & ~0x7f) === 0) {
      bytes.push(v);
      break;
    }
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return Buffer.from(bytes);
}

function readVarInt(buf: Buffer, offset: number): { value: number; size: number } {
  let value = 0;
  let size = 0;
  let shift = 0;
  while (true) {
    if (offset + size >= buf.length) throw new Error('VarInt out of bounds');
    const byte = buf[offset + size];
    size += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift >= 32) throw new Error('VarInt too long');
  }
  return { value, size };
}

function buildHandshakePacket(host: string, port: number): Buffer {
  const protocol = writeVarInt(-1);
  const hostBytes = Buffer.from(host, 'utf-8');
  const hostLen = writeVarInt(hostBytes.length);
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port, 0);
  const nextState = writeVarInt(1);
  const data = Buffer.concat([
    writeVarInt(0x00),
    protocol,
    hostLen,
    hostBytes,
    portBuf,
    nextState,
  ]);
  return Buffer.concat([writeVarInt(data.length), data]);
}

function buildStatusRequestPacket(): Buffer {
  const data = writeVarInt(0x00);
  return Buffer.concat([writeVarInt(data.length), data]);
}

export async function pingMinecraftJava(
  host: string,
  port: number,
  timeoutMs = 3000,
): Promise<MinecraftStatus> {
  return new Promise((resolve) => {
    const sock = new Socket();
    let buf = Buffer.alloc(0);
    let done = false;
    const start = Date.now();

    const finish = (value: MinecraftStatus) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(value);
    };

    sock.setTimeout(timeoutMs);
    sock.once('timeout', () => finish({ status: 'offline' }));
    sock.once('error', () => finish({ status: 'offline' }));
    sock.once('end', () => {
      if (!done) finish({ status: 'offline' });
    });

    sock.connect(port, host, () => {
      sock.write(buildHandshakePacket(host, port));
      sock.write(buildStatusRequestPacket());
    });

    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        const { value: pktLen, size: pktLenSize } = readVarInt(buf, 0);
        if (buf.length < pktLenSize + pktLen) return;
        let off = pktLenSize;
        const { value: pktId, size: idSize } = readVarInt(buf, off);
        off += idSize;
        if (pktId !== 0x00) return finish({ status: 'offline' });
        const { value: jsonLen, size: jsonLenSize } = readVarInt(buf, off);
        off += jsonLenSize;
        if (buf.length < off + jsonLen) return;
        const json = buf.subarray(off, off + jsonLen).toString('utf-8');
        const parsed = JSON.parse(json) as {
          players?: { online?: number; max?: number };
          version?: { name?: string };
          description?: unknown;
        };
        const motd =
          typeof parsed.description === 'string'
            ? parsed.description
            : (parsed.description as { text?: string } | undefined)?.text;
        finish({
          status: 'online',
          players: parsed.players?.online,
          maxPlayers: parsed.players?.max,
          version: parsed.version?.name,
          motd,
          latencyMs: Date.now() - start,
        });
      } catch {
        finish({ status: 'offline' });
      }
    });
  });
}
