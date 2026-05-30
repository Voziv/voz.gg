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
    return Response.json({ error: 'not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
