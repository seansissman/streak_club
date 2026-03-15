export type RankableRow = {
  userId: string;
  currentStreak: number;
};

export type RankedRow<T extends RankableRow> = T & {
  rank: number;
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
