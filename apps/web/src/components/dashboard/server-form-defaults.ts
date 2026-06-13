import { GAME_TYPE_DEFAULTS, type GameType } from '@voz/shared';

export interface AgentHostValues {
  gameServerUser: string;
  logPath: string;
}

function defaultsFor(gameType: GameType) {
  return GAME_TYPE_DEFAULTS[gameType] ?? {};
}

export function initialAgentHostValues(
  gameType: GameType,
  stored?: { gameServerUser?: string | null; logPath?: string | null },
): AgentHostValues {
  const d = defaultsFor(gameType);
  return {
    gameServerUser: stored?.gameServerUser ?? d.gameServerUser ?? '',
    logPath: stored?.logPath ?? d.logPath ?? '',
  };
}

// When the game type changes, refresh a field's default only if the user has not
// customized it (it is empty or still equals the previous game type's default).
export function nextAgentHostValues(
  prev: GameType,
  next: GameType,
  current: AgentHostValues,
): AgentHostValues {
  const prevDef = defaultsFor(prev);
  const nextDef = defaultsFor(next);
  const refresh = (value: string, prevDefault?: string, nextDefault?: string) =>
    value === '' || value === (prevDefault ?? '') ? nextDefault ?? '' : value;
  return {
    gameServerUser: refresh(current.gameServerUser, prevDef.gameServerUser, nextDef.gameServerUser),
    logPath: refresh(current.logPath, prevDef.logPath, nextDef.logPath),
  };
}
