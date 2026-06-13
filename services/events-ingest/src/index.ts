import {
  createDb,
  serverIdForAgentToken,
  createPresenceDao,
  handlePresenceBatch,
  parsePresenceBody,
} from '@voz/shared';

interface Env {
  DB: D1Database;
}

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
      return Response.json(result);
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
