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

export function formatMajorUpdateDiscordMessage(input: {
  serverName: string;
  current: string | null;
  availableMc: string;
  sourceLabel: string;
}): { content: string } {
  const current = input.current ?? 'unknown';
  return {
    content: `**${input.serverName}** — ${input.sourceLabel} **major** update available: \`${current}\` → Minecraft \`${input.availableMc}\`. Approve it in the dashboard to upgrade.`,
  };
}
