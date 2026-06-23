export function formatUpdateDiscordMessage(input: {
  serverName: string;
  current: string | null;
  available: string;
  sourceLabel: string;
}): { content: string } {
  const current = input.current ?? 'unknown';
  return {
    content: `**${input.serverName}** — ${input.sourceLabel} update available: \`${current}\` → \`${input.available}\``,
  };
}
