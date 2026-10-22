export interface ScheduledSeedPair {
  roundNumber: number;
  waveNumber: number;
  courtNumber: number;
  scheduledAt: string;
  seeds: [number, number];
}

export interface ChallengeScheduleSummary {
  fixtures: ScheduledSeedPair[];
  rounds: number;
  totalFixtures: number;
  estimatedFinish: string;
  appearancesPerPlayer: number;
}

function localDateTime(date: string, time: string) {
  return new Date(`${date}T${time.length === 5 ? `${time}:00` : time}`);
}

export function generateSeededChallengeSchedule(
  rosterSize: number,
  courtCount: number,
  fixtureMinutes: number,
  date: string,
  startTime: string,
): ChallengeScheduleSummary {
  if (rosterSize < 2) throw new Error('Each group needs at least two seeded players.');
  if (courtCount < 1 || fixtureMinutes < 1) throw new Error('Court count and fixture duration must be positive.');

  const rotation: Array<number | null> = Array.from({ length: rosterSize }, (_, index) => index + 1);
  if (rotation.length % 2 === 1) rotation.push(null);

  const rounds: Array<Array<[number, number]>> = [];
  for (let round = 0; round < rotation.length - 1; round++) {
    const pairs: Array<[number, number]> = [];
    for (let index = 0; index < rotation.length / 2; index++) {
      const first = rotation[index];
      const second = rotation[rotation.length - 1 - index];
      if (first !== null && second !== null) pairs.push(first < second ? [first, second] : [second, first]);
    }
    rounds.push(pairs);
    rotation.splice(1, 0, rotation.pop()!);
  }

  const start = localDateTime(date, startTime);
  const fixtures: ScheduledSeedPair[] = [];
  let elapsedWaves = 0;
  rounds.forEach((pairs, roundIndex) => {
    pairs.forEach((seeds, fixtureIndex) => {
      const waveIndex = Math.floor(fixtureIndex / courtCount);
      fixtures.push({
        roundNumber: roundIndex + 1,
        waveNumber: waveIndex + 1,
        courtNumber: (fixtureIndex % courtCount) + 1,
        scheduledAt: new Date(start.getTime() + (elapsedWaves + waveIndex) * fixtureMinutes * 60_000).toISOString(),
        seeds,
      });
    });
    elapsedWaves += Math.ceil(pairs.length / courtCount);
  });

  return {
    fixtures,
    rounds: rounds.length,
    totalFixtures: fixtures.length,
    estimatedFinish: new Date(start.getTime() + elapsedWaves * fixtureMinutes * 60_000).toISOString(),
    appearancesPerPlayer: rosterSize - 1,
  };
}
