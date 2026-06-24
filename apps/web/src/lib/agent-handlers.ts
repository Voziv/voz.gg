import { z } from 'zod';
import type { AgentDao, ServerRow } from './agent-dao';
import { buildAgentConfig, configHash } from './agent-config';
import { generateToken, hashToken } from './agent-auth';
import { buildProvisioning } from './agent-provisioning';

export interface HandlerResult {
  status: number;
  body: unknown;
}

const VALID_STATUSES = ['online', 'offline', 'unknown'] as const;

const statusBodySchema = z.object({
  status: z.enum(VALID_STATUSES),
  players: z.number().int().nonnegative().nullish(),
  maxPlayers: z.number().int().nonnegative().nullish(),
  version: z.string().max(200).nullish(),
  latencyMs: z.number().int().nonnegative().nullish(),
  configHash: z.string(),
});

async function configResponse(server: ServerRow) {
  const config = buildAgentConfig(server);
  return { config, configHash: await configHash(config) };
}

// ingestBaseUrl is the host agents POST presence to. It is a separate worker on
// its own domain (ingest.voz.gg), distinct from this web Worker, so it is sent to
// the agent at enroll/config time rather than derived from the install URL.
export async function handleEnroll(
  dao: AgentDao,
  body: unknown,
  ingestBaseUrl: string,
): Promise<HandlerResult> {
  const parsed = z.object({ enrollmentToken: z.string().min(1) }).safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: 'Missing enrollment token.' } };

  const enrollmentHash = await hashToken(parsed.data.enrollmentToken);
  const server = await dao.findServerByEnrollmentTokenHash(enrollmentHash);
  if (!server) return { status: 401, body: { error: 'Invalid or used enrollment token.' } };

  const agentToken = generateToken();
  await dao.completeEnrollment(server.id, await hashToken(agentToken), new Date());

  const { config, configHash: hash } = await configResponse(server);
  return {
    status: 200,
    body: { agentToken, ingestBaseUrl, config, configHash: hash, provisioning: buildProvisioning(server) },
  };
}

export async function handleConfig(
  dao: AgentDao,
  serverId: string | null,
  ingestBaseUrl: string,
): Promise<HandlerResult> {
  if (!serverId) return { status: 401, body: { error: 'Unauthorized.' } };
  const server = await dao.serverById(serverId);
  if (!server) return { status: 401, body: { error: 'Unauthorized.' } };
  return {
    status: 200,
    body: { ...(await configResponse(server)), ingestBaseUrl, provisioning: buildProvisioning(server) },
  };
}

export async function handleStatus(
  dao: AgentDao,
  serverId: string | null,
  body: unknown,
  now: Date,
): Promise<HandlerResult> {
  if (!serverId) return { status: 401, body: { error: 'Unauthorized.' } };
  const server = await dao.serverById(serverId);
  if (!server) return { status: 401, body: { error: 'Unauthorized.' } };

  const parsed = statusBodySchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: 'Invalid status body.' } };

  await dao.upsertStatus({
    serverId,
    status: parsed.data.status,
    players: parsed.data.players ?? null,
    maxPlayers: parsed.data.maxPlayers ?? null,
    version: parsed.data.version ?? null,
    latencyMs: parsed.data.latencyMs ?? null,
    checkedAt: now,
  });
  await dao.touchLastSeen(serverId, now);

  return { status: 200, body: { configHash: (await configResponse(server)).configHash } };
}
