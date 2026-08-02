import { EXP } from "./constants.js";
import type { MatchStats } from "./types.js";

/** Pure EXP calculation. Failure still banks a fraction — deaths must pay out. */
export function calculateExp(stats: MatchStats): number {
  let exp =
    stats.roomsVisited * EXP.roomFirstVisit +
    stats.objectivesCleared * EXP.objectiveCleared +
    stats.mobKills * EXP.mobKill +
    stats.hazardRoomsClearedNoDeath * EXP.hazardNoDeathBonus;
  if (stats.reachedExit) {
    exp += EXP.exitReached;
    if (stats.finishedAlive) exp = Math.round(exp * EXP.finishAliveMult);
  } else {
    exp = Math.round(exp * EXP.failureBankFraction);
  }
  return Math.max(0, exp);
}
