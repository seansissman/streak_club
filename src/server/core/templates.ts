export type TemplateId =
  | 'custom'
  | 'habit_30'
  | 'coding_daily'
  | 'fitness_daily'
  | 'study_daily';

export type ChallengeTemplate = {
  id: TemplateId;
  label: string;
  title: string;
  description: string;
  badgeThresholds: number[];
};

export const TEMPLATES: ChallengeTemplate[] = [
  {
    id: 'custom',
    label: 'Custom',
    title: 'Streak Engine',
    description: 'Join and check in daily. Reset time is 00:00 UTC.',
    badgeThresholds: [3, 7, 14, 30],
  },
  {
    id: 'habit_30',
    label: '30-Day Habit',
    title: '30-Day Habit Challenge',
    description: 'Build consistency by checking in every day for 30 days.',
    badgeThresholds: [3, 7, 14, 30],
  },
  {
    id: 'coding_daily',
    label: 'Coding Daily',
    title: 'Code Every Day',
    description: 'Check in after a focused coding session each UTC day.',
    badgeThresholds: [5, 10, 20, 50],
  },
  {
    id: 'fitness_daily',
    label: 'Fitness Daily',
    title: 'Daily Fitness',
    description: 'Stay active with one workout check-in per UTC day.',
    badgeThresholds: [3, 7, 21, 60],
  },
  {
    id: 'study_daily',
    label: 'Study Daily',
    title: 'Study Streak',
    description: 'Check in after completing your study goal for the day.',
    badgeThresholds: [5, 15, 30, 90],
  },
];

const TEMPLATE_INDEX: Record<TemplateId, ChallengeTemplate> = TEMPLATES.reduce(
  (acc, template) => {
    acc[template.id] = template;
    return acc;
  },
  {} as Record<TemplateId, ChallengeTemplate>
);

export const isTemplateId = (value: unknown): value is TemplateId =>
  typeof value === 'string' && value in TEMPLATE_INDEX;

export const applyTemplateToConfig = (
  templateId: TemplateId,
  overrides?: Partial<
    Pick<ChallengeTemplate, 'title' | 'description' | 'badgeThresholds'>
  >
): {
  templateId: TemplateId;
  title: string;
  description: string;
  badgeThresholds: number[];
} => {
  const template = TEMPLATE_INDEX[templateId] ?? TEMPLATE_INDEX.custom;

  return {
    templateId: template.id,
    title: overrides?.title ?? template.title,
    description: overrides?.description ?? template.description,
    badgeThresholds: overrides?.badgeThresholds?.slice() ?? template.badgeThresholds.slice(),
  };
};
