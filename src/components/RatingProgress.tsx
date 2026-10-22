import type { Profile } from '../lib/supabase';
import { buildRatingSummary } from '../lib/rating';
import { skillLevelColor, skillLevelLabel } from '../lib/skillLevels';

export default function RatingProgress({
  profile,
  totalMatches,
  rating,
  showReview = false,
}: {
  profile: Profile;
  totalMatches: number;
  rating?: number;
  showReview?: boolean;
}) {
  const summary = buildRatingSummary(profile, totalMatches, rating);

  return (
    <div className="mt-2 max-w-xs">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
        <span className="font-semibold text-gray-500">Rating {summary.rating}</span>
        {summary.nextLevel && <span>{summary.progressPercent}% to {skillLevelLabel(summary.nextLevel)}</span>}
        {showReview && summary.reviewLabel && (
          <span className={`px-2 py-0.5 rounded-full border font-semibold ${skillLevelColor(summary.reviewLevel)}`}>
            {summary.reviewLabel}
          </span>
        )}
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${summary.progressPercent}%` }} />
      </div>
    </div>
  );
}
