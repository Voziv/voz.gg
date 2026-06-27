import {
  chunk,
  createDb,
  serverIdForAgentToken,
  createPresenceDao,
  createNotificationDao,
  handlePresenceBatch,
  handleNotificationMessage,
  parsePresenceBody,
  createUpdateDetectionDao,
  resolverFor,
  detectAndNotify,
  applyAutoDesired,
  artifactResolverFor,
  type NotifyMessage,
  type DiscordPayload,
} from '@voz/shared';

const QUEUE_BATCH_LIMIT = 100;

interface Env {
  DB: D1Database;
  NOTIFY_QUEUE: Queue<NotifyMessage>;
  SITE_URL: string;
  CURSEFORGE_API_KEY?: string;
}

const postDiscord = async (url: string, payload: DiscordPayload): Promise<{ status: number }> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      let database: string;
      try {
        await env.DB.prepare('SELECT 1').first();
        database = 'connected';
      } catch {
        database = 'error';
      }
      return Response.json({ service: 'events-ingest', status: 'ok', database });
    }

    if (url.pathname === '/presence' && request.method === 'POST') {
      const db = createDb(env.DB);
      const serverId = await serverIdForAgentToken(db, request.headers.get('authorization'));
      if (!serverId) return Response.json({ error: 'Unauthorized.' }, { status: 401 });

      const parsed = parsePresenceBody(await request.json().catch(() => null));
      if (!parsed.ok) return Response.json({ error: 'Invalid presence body.' }, { status: 400 });

      const result = await handlePresenceBatch(createPresenceDao(db), serverId, parsed.events, new Date());
      if (result.notable.length > 0) {
        try {
          for (const group of chunk(result.notable, QUEUE_BATCH_LIMIT)) {
            await env.NOTIFY_QUEUE.sendBatch(group.map((body) => ({ body })));
          }
        } catch (err) {
          console.error('failed to enqueue notifications; ingest unaffected', err);
        }
      }
      return Response.json({ accepted: result.accepted, deduped: result.deduped, rejected: parsed.rejected });
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  },

  async queue(batch: MessageBatch<NotifyMessage>, env: Env): Promise<void> {
    const dao = createNotificationDao(createDb(env.DB));
    for (const message of batch.messages) {
      try {
        await handleNotificationMessage(dao, postDiscord, message.body, env.SITE_URL);
        message.ack();
      } catch (err) {
        console.error('notification delivery failed; retrying', err);
        message.retry();
      }
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const dao = createUpdateDetectionDao(createDb(env.DB));
    ctx.waitUntil(
      (async () => {
        await detectAndNotify({
          dao,
          resolverFor,
          postDiscord,
          apiKey: env.CURSEFORGE_API_KEY ?? null,
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          gapMs: 5000,
          now: () => new Date(),
        });
        await applyAutoDesired({
          dao,
          artifactResolverFor,
          onError: (id, err) => console.error(`auto-desired failed for ${id}`, err),
        });
      })(),
    );
  },
} satisfies ExportedHandler<Env, NotifyMessage>;
