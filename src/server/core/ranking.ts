export type RankableRow = {
  userId: string;
  currentStreak: number;
};

export type RankedRow<T extends RankableRow> = T & {
  rank: number;
};

export type PrivacyScopedRow = RankableRow & {
  privacy: 'public' | 'private';
};

export const addCompetitionRanks = <T extends RankableRow>(
  rows: T[]
): RankedRow<T>[] => {
  let previousStreak: number | null = null;
  let previousRank = 1;

  return rows.map((row, index) => {
    let rank = index + 1;
    if (previousStreak !== null && row.currentStreak === previousStreak) {
      rank = previousRank;
    }

    previousStreak = row.currentStreak;
    previousRank = rank;

    return {
      ...row,
      rank,
    };
  });
};

export const filterPublicRankRows = <T extends PrivacyScopedRow>(rows: T[]): T[] =>
  rows.filter((row) => row.privacy === 'public');

export const getCompetitionRankForUser = <T extends RankableRow>(
  rows: T[],
  userId: string
): number | null => {
  const rankedRows = addCompetitionRanks(rows);
  const row = rankedRows.find((entry) => entry.userId === userId);
  return row ? row.rank : null;
};
