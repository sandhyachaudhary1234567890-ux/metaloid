/**
 * Shared UI primitives.
 *
 * These exist so that a pattern which appears on more than one screen is
 * written once. If you find yourself styling a card, an empty state, or a
 * status pill inline for the third time, it belongs here.
 */
export { Artwork } from './Artwork';
export { EmptyState } from './EmptyState';
export { StatusDot, StatusPill } from './Status';
export { Activity, ToolActivity, ActivityStack } from './Activity';
export { SectionHeader } from './SectionHeader';
export { Sentinel } from './Sentinel';
export { ProviderMark, ProviderCard } from './Provider';
export {
  PresenceLine, HomeGreeting, ActiveMission, HomeSignals,
  useOpenTasks, useMissions,
  /** Legacy name for the welcome composition's proactive stack. */
  HomeSignals as Proactive,
} from './Home';
