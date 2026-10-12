export interface WrappedStats {
    totalWeightLifted: number;
    totalMeets: number;
    makePercentage: number;
    bestSnatch: number;
    bestCleanJerk: number;
    bestTotal: number;
    averageTotal: number;
    topMeet: string;
    /**
     * Last minus first total among the year's meets with a total, or `null`
     * when fewer than two meets have one (bomb-outs do not count).
     */
    improvementFromFirst: number | null;
    consecutiveMakes: number;
    favoriteAttempt: string;
    yearRank: string;
  }