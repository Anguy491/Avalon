export const RULES_VERSION = 'CLASSIC_AVALON_V1' as const;

export type RulesVersion = typeof RULES_VERSION;
export type PlayerCount = 5 | 6 | 7 | 8 | 9 | 10;
export type QuestIndex = 1 | 2 | 3 | 4 | 5;
export type ProposalAttempt = 1 | 2 | 3 | 4 | 5;

export type RoleId =
  | 'MERLIN'
  | 'LOYAL_SERVANT'
  | 'PERCIVAL'
  | 'ASSASSIN'
  | 'MINION'
  | 'MORGANA'
  | 'MORDRED'
  | 'OBERON';

export type Alignment = 'GOOD' | 'EVIL';
export type PresetId = 'CLASSIC' | 'COMMON_ROLES';
export type TeamVote = 'APPROVE' | 'REJECT';
export type QuestChoice = 'SUCCESS' | 'FAIL';
export type QuestResult = 'SUCCESS' | 'FAILURE';
export type Winner = 'GOOD' | 'EVIL' | 'NONE';

export type GamePhase =
  | 'LOBBY'
  | 'ROLE_REVEAL'
  | 'TEAM_PROPOSAL'
  | 'TEAM_VOTE'
  | 'QUEST_SUBMISSION'
  | 'QUEST_RESOLUTION'
  | 'ASSASSINATION'
  | 'GAME_OVER'
  | 'PAUSED';

export type ActiveGamePhase = Exclude<
  GamePhase,
  'LOBBY' | 'GAME_OVER' | 'PAUSED'
>;
export type PhaseStage = 'HOST_HELD' | 'COLLECTING' | 'RESOLVED';
export type PendingTransition =
  | 'NEXT_PROPOSAL'
  | 'NEXT_QUEST'
  | 'QUEST_SUBMISSION'
  | 'ASSASSINATION'
  | 'GAME_OVER';
export type PauseReason =
  | 'MANUAL'
  | 'PLAYER_DISCONNECTED'
  | 'HOST_DISCONNECTED';

export type GameOutcomeReason =
  | 'THREE_QUEST_FAILURES'
  | 'FIVE_REJECTED_TEAMS'
  | 'MERLIN_ASSASSINATED'
  | 'MERLIN_SURVIVED'
  | 'ABORTED';

export type KnowledgeLabel =
  | 'EVIL_PLAYER'
  | 'MERLIN_CANDIDATE'
  | 'KNOWN_EVIL_ALLY';

export interface Player {
  readonly playerId: string;
  readonly nickname: string;
  readonly seat: number;
  readonly isHost: boolean;
  readonly ready: boolean;
  readonly connected: boolean;
}

export interface PresetRoleSelection {
  readonly type: 'PRESET';
  readonly presetId: PresetId;
}

export interface CustomRoleSelection {
  readonly type: 'CUSTOM';
  readonly roleIds: readonly RoleId[];
}

export type RoleSelection = PresetRoleSelection | CustomRoleSelection;

export interface RoomConfigInput {
  readonly rulesVersion: RulesVersion;
  readonly playerCount: number;
  readonly roleSelection: RoleSelection;
  readonly locale: 'zh-CN';
}

export interface RoomConfig {
  readonly rulesVersion: RulesVersion;
  readonly playerCount: PlayerCount;
  readonly roleIds: readonly RoleId[];
  readonly locale: 'zh-CN';
  readonly voicePackVersion: string;
}

export type ConfigErrorCode =
  | 'INVALID_PLAYER_COUNT'
  | 'ROLE_COUNT_MISMATCH'
  | 'ALIGNMENT_COUNT_MISMATCH'
  | 'MERLIN_REQUIRED_ONCE'
  | 'ASSASSIN_REQUIRED_ONCE'
  | 'UNIQUE_ROLE_REPEATED'
  | 'MORGANA_REQUIRES_PERCIVAL'
  | 'FIVE_PLAYER_PERCIVAL_REQUIRES_DECEPTION_ROLE';

export interface ConfigValidationError {
  readonly code: ConfigErrorCode;
  readonly roleId?: RoleId;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: RoomConfig }
  | { readonly ok: false; readonly errors: readonly ConfigValidationError[] };

export interface KnownPlayer {
  readonly playerId: string;
  readonly knowledgeLabel: KnowledgeLabel;
}

export interface PrivateKnowledge {
  readonly playerId: string;
  readonly knownPlayers: readonly KnownPlayer[];
}

export interface ProposalRecord {
  readonly questIndex: QuestIndex;
  readonly proposalAttempt: ProposalAttempt;
  readonly leaderPlayerId: string;
  readonly teamPlayerIds: readonly string[];
  readonly votes: Readonly<Record<string, TeamVote>>;
  readonly approveCount: number;
  readonly rejectCount: number;
  readonly approved: boolean;
}

/** Deliberately contains counts only: no player-to-choice association can survive. */
export interface QuestRecord {
  readonly questIndex: QuestIndex;
  readonly leaderPlayerId: string;
  readonly teamPlayerIds: readonly string[];
  readonly successChoices: number;
  readonly failChoices: number;
  readonly requiredFails: 1 | 2;
  readonly result: QuestResult;
}

export interface GameOutcome {
  readonly winner: Winner;
  readonly reason: GameOutcomeReason;
  readonly assassinationTargetPlayerId?: string;
}

export type AudioCueKey =
  | 'game.role.reveal'
  | 'game.team.proposal'
  | 'game.team.vote'
  | 'game.team.approved'
  | 'game.team.rejected'
  | 'game.quest.submission'
  | 'game.quest.success'
  | 'game.quest.failure'
  | 'game.assassination'
  | 'game.good.wins'
  | 'game.evil.wins'
  | 'game.aborted';

export interface AudioCue {
  readonly audioCueId: string;
  readonly audioCueKey: AudioCueKey;
  readonly subtitleKey: AudioCueKey;
  readonly voicePackVersion: string;
  readonly phase: GamePhase;
  readonly replayOf?: string;
  readonly createdAt: string;
}

export interface AudioCueRequestedEffect {
  readonly type: 'AUDIO_CUE_REQUESTED';
  readonly cue: AudioCue;
}

/**
 * Requests that the application layer revoke the named player's session(s).
 * The engine never touches sessions, tokens, or transport concerns itself;
 * it only declares that a lobby departure/removal occurred.
 */
export interface SessionRevokeRequestedEffect {
  readonly type: 'SESSION_REVOKE_REQUESTED';
  readonly playerId: string;
}

/**
 * Requests that the application layer delete the room record, release the
 * room code, and revoke every remaining session. The engine does not model a
 * terminal "closed" phase because the persisted aggregate is deleted by the
 * application layer in the same transaction that accepts this command.
 */
export interface RoomCloseRequestedEffect {
  readonly type: 'ROOM_CLOSE_REQUESTED';
}

export type DomainEffect =
  | AudioCueRequestedEffect
  | SessionRevokeRequestedEffect
  | RoomCloseRequestedEffect;

export interface ResumePoint {
  readonly phase: ActiveGamePhase;
  readonly phaseStage: PhaseStage;
}

export interface ProcessedCommand {
  /** Opaque digest supplied by the application boundary; never the raw command. */
  readonly requestDigest: string;
  readonly acceptedStateVersion: number;
}

export interface GameState {
  readonly stateVersion: number;
  readonly config: RoomConfig;
  readonly players: readonly Player[];
  readonly hostPlayerId: string;
  readonly phase: GamePhase;
  readonly phaseStage: PhaseStage;
  readonly leaderSeatIndex: number;
  readonly questIndex: QuestIndex;
  readonly proposalAttempt: ProposalAttempt;
  readonly proposedTeam: readonly string[];
  readonly teamVotes: Readonly<Record<string, TeamVote>>;
  /** Ephemeral input map. It is destroyed in the same transition that settles a quest. */
  readonly questChoices: Readonly<Record<string, QuestChoice>>;
  readonly roleAcknowledgements: readonly string[];
  readonly proposalHistory: readonly ProposalRecord[];
  readonly questHistory: readonly QuestRecord[];
  readonly successCount: number;
  readonly failureCount: number;
  readonly roleAssignments: Readonly<Record<string, RoleId>>;
  readonly privateKnowledge: Readonly<Record<string, PrivateKnowledge>>;
  readonly pendingTransition?: PendingTransition | undefined;
  readonly gameOutcome?: GameOutcome | undefined;
  readonly resumePoint?: ResumePoint | undefined;
  readonly pauseReasons: readonly PauseReason[];
  readonly currentAudioCue?: AudioCue | undefined;
  readonly processedCommands: Readonly<Record<string, ProcessedCommand>>;
}

export interface RandomBytesPort {
  bytes(length: number): Uint8Array;
}

export interface ClockPort {
  nowIso(): string;
}

export interface IdGeneratorPort {
  nextId(): string;
}

export interface EnginePorts {
  readonly random: RandomBytesPort;
  readonly clock: ClockPort;
  readonly ids: IdGeneratorPort;
}

interface CommandEnvelope {
  readonly commandId: string;
  readonly requestDigest: string;
  readonly expectedStateVersion: number;
  readonly actorPlayerId: string;
}

export type GameCommand =
  | (CommandEnvelope & { readonly type: 'StartGame' })
  | (CommandEnvelope & { readonly type: 'ContinuePhase' })
  | (CommandEnvelope & { readonly type: 'AckRole' })
  | (CommandEnvelope & {
      readonly type: 'SubmitTeam';
      readonly teamPlayerIds: readonly string[];
    })
  | (CommandEnvelope & {
      readonly type: 'SubmitTeamVote';
      readonly vote: TeamVote;
    })
  | (CommandEnvelope & {
      readonly type: 'SubmitQuestChoice';
      readonly choice: QuestChoice;
    })
  | (CommandEnvelope & {
      readonly type: 'SelectMerlinTarget';
      readonly targetPlayerId: string;
    })
  | (CommandEnvelope & { readonly type: 'PauseGame' })
  | (CommandEnvelope & { readonly type: 'ResumeGame' })
  | (CommandEnvelope & {
      readonly type: 'ReplayAudioCue';
      readonly audioCueId: string;
    })
  | (CommandEnvelope & {
      readonly type: 'ConfigureRoom';
      readonly configInput: RoomConfigInput;
    })
  | (CommandEnvelope & {
      readonly type: 'ReorderSeats';
      readonly playerIds: readonly string[];
    })
  | (CommandEnvelope & {
      readonly type: 'SetReady';
      readonly ready: boolean;
    })
  | (CommandEnvelope & { readonly type: 'LeaveLobby' })
  | (CommandEnvelope & {
      readonly type: 'KickLobbyPlayer';
      readonly targetPlayerId: string;
    })
  | (CommandEnvelope & { readonly type: 'CloseRoom' });

export type EngineErrorCode =
  | 'STALE_VERSION'
  | 'DUPLICATE_COMMAND_CONFLICT'
  | 'NOT_HOST'
  | 'NOT_LEADER'
  | 'NOT_ASSASSIN'
  | 'INVALID_PHASE'
  | 'INVALID_PHASE_STAGE'
  | 'PLAYERS_NOT_READY'
  | 'PLAYERS_OFFLINE'
  | 'INVALID_CONFIG'
  | 'INVALID_SEAT_ORDER'
  | 'INVALID_TEAM_SIZE'
  | 'INVALID_TEAM_MEMBER'
  | 'INVALID_TARGET'
  | 'PLAYER_NOT_ON_TEAM'
  | 'GOOD_CANNOT_FAIL'
  | 'ALREADY_SUBMITTED'
  | 'HOST_CANNOT_LEAVE'
  | 'AUDIO_CUE_NOT_FOUND';

export interface AcceptedCommandResult {
  readonly accepted: true;
  readonly stateVersion: number;
  readonly idempotentReplay: boolean;
}

export interface RejectedCommandResult {
  readonly accepted: false;
  readonly errorCode: EngineErrorCode;
  readonly currentStateVersion: number;
}

export type CommandResult = AcceptedCommandResult | RejectedCommandResult;

export interface EngineTransition {
  readonly state: GameState;
  readonly result: CommandResult;
  readonly effects: readonly DomainEffect[];
}

export interface SystemTransition {
  readonly state: GameState;
  readonly effects: readonly DomainEffect[];
}

export interface RevealedAssignment {
  readonly playerId: string;
  readonly roleId: RoleId;
  readonly alignment: Alignment;
}

export interface PublicGameState {
  readonly stateVersion: number;
  readonly phase: GamePhase;
  readonly phaseStage: PhaseStage;
  readonly leaderPlayerId: string;
  readonly questIndex: QuestIndex;
  readonly proposalAttempt: ProposalAttempt;
  readonly requiredTeamSize: number;
  readonly proposedTeam: readonly string[];
  readonly submissionProgress?: {
    readonly submittedCount: number;
    readonly requiredCount: number;
  };
  readonly proposalHistory: readonly ProposalRecord[];
  readonly questHistory: readonly QuestRecord[];
  readonly successCount: number;
  readonly failureCount: number;
  readonly pauseReasons: readonly PauseReason[];
  readonly currentAudioCue?: Pick<
    AudioCue,
    'audioCueId' | 'audioCueKey' | 'subtitleKey' | 'voicePackVersion'
  >;
  readonly gameOutcome?: GameOutcome;
  readonly revealedAssignments: readonly RevealedAssignment[];
}

export interface PrivatePlayerState {
  readonly playerId: string;
  readonly selfRole?: RoleId;
  readonly selfAlignment?: Alignment;
  readonly knownPlayers: readonly KnownPlayer[];
  readonly hasSubmitted: boolean;
}
