/**
 * Data contracts and game models for The Great Date Glitch
 */

export type PlayerRole = 'host' | 'guest';

export type CharacterExpression =
  | 'neutral'
  | 'delighted'
  | 'embarrassed'
  | 'determined'
  | 'shocked'
  | 'laughing'
  | 'panicked';

export type CharacterGender = 'male' | 'female';

export type HairStyle =
  | 'fade'
  | 'short_casual'
  | 'messy_waves'
  | 'man_bun'
  | 'beanie'
  | 'long_wavy'
  | 'bob'
  | 'ponytail'
  | 'curly_afro'
  | 'bangs'
  | 'curly'
  | 'messy'
  | 'bun'
  | 'slick';

export type BodyStyle = 'casual_hoodie' | 'sweater' | 'collared' | 'tee';
export type RoomTheme = 'cozy_plants' | 'neon_gamer' | 'warm_books' | 'city_glow';

export interface CharacterCustomization {
  name: string;
  gender: CharacterGender;
  hairStyle: HairStyle;
  hairColor: string;
  skinTone: string;
  outfitColor: string;
  bodyStyle: BodyStyle;
  glasses: boolean;
  facialHair?: boolean;
  roomTheme: RoomTheme;
  expression?: CharacterExpression;
}

export interface ChoiceOption {
  id: string;
  label: string;
  description: string;
  foreseenRisk?: string;
  flavorText?: string;
}

export interface DialogueLine {
  id: string;
  speaker: 'host' | 'guest' | 'narrator' | 'courier' | 'announcer' | 'neighbor' | 'glitch_bot';
  speakerName?: string;
  text: string;
  hostExpression?: CharacterExpression;
  guestExpression?: CharacterExpression;
  /** Asymmetric information or inner thought visible only to host */
  hostPrivateThought?: string;
  /** Asymmetric information or inner thought visible only to guest */
  guestPrivateThought?: string;
}

export interface SituationFact {
  id: string;
  label: string;
  value: string;
  status?: 'neutral' | 'warning' | 'critical' | 'success';
}

export interface TonightSituationState {
  timeRemaining?: string;
  helperStatus?: string;
  deliveryStatus?: string;
  activeComplication?: string;
  customFacts?: SituationFact[];
  recentUpdateReason?: string;
}

export interface SituationStateDelta {
  field: string;
  change: string;
  reason: string;
}

export interface CombinedConsequence {
  title: string;
  description: string;
  hostActionTaken?: string;
  guestActionTaken?: string;
  immediateResult: string;
  tangibleChanges?: string[];
  stateChanges?: SituationStateDelta[];
  hostReaction: CharacterExpression;
  guestReaction: CharacterExpression;
  agreementType: 'harmony' | 'comic_mismatch' | 'wild_synergy' | 'backfired_agreement' | 'accidental_harmony';
  comicBonus?: string;
}

export interface SceneData {
  id: string;
  chapterNumber: number;
  chapterTitle: string;
  sceneNumber: number;
  totalScenesInChapter: number;
  title: string;
  settingName: string;
  backgroundVariant: 'split_date' | 'webinar_chaos' | 'street_swap' | 'room_alarm' | 'rooftop_glow';
  continuity?: string;
  immediateGoal?: string;
  stakes?: string;
  decisionPrompt?: string;
  dialogue: DialogueLine[];
  choices: {
    host: ChoiceOption[];
    guest: ChoiceOption[];
  };
}

export interface StoryLogItem {
  sceneId: string;
  sceneTitle: string;
  chapterNumber: number;
  hostChoiceLabel: string;
  guestChoiceLabel: string;
  outcomeTitle: string;
  immediateResult: string;
  tangibleChanges?: string[];
}

export interface ChapterRecap {
  chapterNumber: number;
  chapterTitle: string;
  bulletPoints: string[];
  funnyHighlight: string;
}

export interface StoryEnding {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  narrative: string;
  chaosLevel: string;
  signatureMoment: string;
  runningJokes: string[];
}

export interface SessionPlayer {
  id: string;
  role: PlayerRole;
  name: string;
  character: CharacterCustomization;
  isReady: boolean;
  hasSubmittedChoice: boolean;
  submittedChoiceId?: string;
  readyToAdvance: boolean;
}

export type SessionGameStatus =
  | 'lobby'
  | 'in_story'
  | 'choice_pending'
  | 'outcome_revealed'
  | 'chapter_recap'
  | 'ended'
  | 'ending_reached';

export interface CurrentOutcomeData {
  hostChoice: { id: string; label: string; description?: string };
  guestChoice: { id: string; label: string; description?: string };
  consequence: CombinedConsequence;
  hostReadyToAdvance: boolean;
  guestReadyToAdvance: boolean;
}

export interface SessionResponse {
  sessionId: string;
  joinCode: string;
  status: SessionGameStatus;
  host: SessionPlayer;
  guest?: SessionPlayer;
  currentChapter: number;
  currentScene?: SceneData;
  submissionStatus: {
    hostSubmitted: boolean;
    guestSubmitted: boolean;
  };
  currentOutcome?: CurrentOutcomeData;
  tonightSituation?: TonightSituationState;
  previousOutcomeSummary?: string;
  storyLog?: StoryLogItem[];
  chapterRecap?: ChapterRecap;
  ending?: StoryEnding;
}

/* API Request / Response Types */

export interface CreateSessionResponse {
  sessionId: string;
  joinCode: string;
  playerToken: string;
  playerRole: 'host';
}

export interface JoinSessionRequest {
  joinCode: string;
}

export interface JoinSessionResponse {
  sessionId: string;
  playerToken: string;
  playerRole: 'guest';
}

export interface CharacterUpdateRequest {
  name: string;
  gender: CharacterGender;
  hairStyle: HairStyle;
  hairColor: string;
  skinTone: string;
  outfitColor: string;
  bodyStyle: BodyStyle;
  glasses: boolean;
  facialHair?: boolean;
  roomTheme: RoomTheme;
}

export interface SubmitChoiceRequest {
  sceneId: string;
  choiceId: string;
}

export interface AdvanceRequest {
  ready: boolean;
  phaseId: string;
}

export interface HealthCheckResponse {
  status: 'ok';
  version?: string;
  timestamp: string;
}
