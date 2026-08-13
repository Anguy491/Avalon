import { alignmentForRole } from './rules.js';
import type { Player, PrivateKnowledge, RoleId } from './types.js';

function playerWithRole(
  players: readonly Player[],
  assignments: Readonly<Record<string, RoleId>>,
  roleId: RoleId,
): Player | undefined {
  return players.find((player) => assignments[player.playerId] === roleId);
}

export function calculatePrivateKnowledge(
  players: readonly Player[],
  assignments: Readonly<Record<string, RoleId>>,
): Readonly<Record<string, PrivateKnowledge>> {
  const result: Record<string, PrivateKnowledge> = {};
  const merlin = playerWithRole(players, assignments, 'MERLIN');
  const morgana = playerWithRole(players, assignments, 'MORGANA');

  for (const viewer of players) {
    const roleId = assignments[viewer.playerId];
    if (roleId === undefined) {
      throw new RangeError('Every player must have an assigned role');
    }

    const knownPlayers: PrivateKnowledge['knownPlayers'] =
      roleId === 'MERLIN'
        ? players
            .filter((player) => {
              const viewedRole = assignments[player.playerId];
              return (
                viewedRole !== undefined &&
                alignmentForRole(viewedRole) === 'EVIL' &&
                viewedRole !== 'MORDRED'
              );
            })
            .map((player) => ({
              playerId: player.playerId,
              knowledgeLabel: 'EVIL_PLAYER' as const,
            }))
        : roleId === 'PERCIVAL'
          ? [merlin, morgana]
              .filter((player): player is Player => player !== undefined)
              .map((player) => ({
                playerId: player.playerId,
                knowledgeLabel: 'MERLIN_CANDIDATE' as const,
              }))
          : alignmentForRole(roleId) === 'EVIL' && roleId !== 'OBERON'
            ? players
                .filter((player) => {
                  if (player.playerId === viewer.playerId) return false;
                  const viewedRole = assignments[player.playerId];
                  return (
                    viewedRole !== undefined &&
                    alignmentForRole(viewedRole) === 'EVIL' &&
                    viewedRole !== 'OBERON'
                  );
                })
                .map((player) => ({
                  playerId: player.playerId,
                  knowledgeLabel: 'KNOWN_EVIL_ALLY' as const,
                }))
            : [];

    result[viewer.playerId] = {
      playerId: viewer.playerId,
      knownPlayers,
    };
  }
  return result;
}
