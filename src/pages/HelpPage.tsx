import { Calendar, CheckCircle, HelpCircle, Monitor, PlayCircle, Shield, Swords, Trophy, Users } from 'lucide-react';

export default function HelpPage({ publicView = false, onBack }: { publicView?: boolean; onBack?: () => void }) {
  return (
    <div className={`${publicView ? 'min-h-screen bg-gray-50 p-4 sm:p-6' : 'p-4 sm:p-6'} text-gray-900`}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-emerald-600 font-semibold text-sm mb-2">
              <HelpCircle className="w-5 h-5" />
              Help & Features
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">How Rally Master works</h1>
            <p className="text-gray-500 mt-2 max-w-2xl">
              A quick guide for session organisers and players.
            </p>
          </div>
          {publicView && onBack && (
            <button
              onClick={onBack}
              className="bg-white border border-gray-200 text-gray-700 hover:text-gray-900 px-4 py-2 rounded-xl text-sm font-semibold"
            >
              Back to sign in
            </button>
          )}
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <GuideCard
            icon={<Shield className="w-5 h-5" />}
            title="For Admin / Group Owner"
            steps={[
              'Go to Admin Panel > Groups and create/select your group.',
              'Go to Admin Panel > Sessions & Courts and create a session.',
              'Add session date, time, venue, group, and courts.',
              'Select players or invite them to the session.',
              'Go to Dashboard to approve Request to play.',
              'On session day, go to Match Management.',
              'Use Smart Assign or Manual Match to start games.',
              'Record results after each match.',
              'Rally Master rotates players and creates the next match.',
              'When finished, mark the session as completed.',
            ]}
          />

          <GuideCard
            icon={<Users className="w-5 h-5" />}
            title="For Players"
            steps={[
              'Go to Dashboard to see upcoming sessions.',
              'Use Request to play if you want to join.',
              'Accept or decline invites from Dashboard.',
              'Go to Sessions to view selected players.',
              'On session day, go to Live Courts to see where you play next.',
              'After games, check My History and Leaderboard.',
            ]}
          />
        </div>

        <section className="bg-white border border-gray-200 rounded-2xl p-5">
          <h2 className="text-lg font-bold mb-4">Main Features</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Feature icon={<Users className="w-5 h-5" />} title="Groups" text="Create groups, assign owners, and let players belong to multiple groups." />
            <Feature icon={<Calendar className="w-5 h-5" />} title="Sessions" text="Create sessions, invite players, approve requests, and manage availability." />
            <Feature icon={<Monitor className="w-5 h-5" />} title="Live Courts" text="Show active courts, teams, waiting players, and who is up next." />
            <Feature icon={<PlayCircle className="w-5 h-5" />} title="Match Management" text="Smart Assign, manual matches, edit teams, record results, and rotate fairly." />
            <Feature icon={<Trophy className="w-5 h-5" />} title="Leaderboards" text="Track players and pairs by wins, win rate, games played, and point difference." />
            <Feature icon={<CheckCircle className="w-5 h-5" />} title="Session Recap" text="Share a compact recap with the session MVP, best pair, streaks, close matches, and standout performances." />
            <Feature icon={<Swords className="w-5 h-5" />} title="Group Challenges" text="Seed two equal group rosters, generate every mirrored doubles fixture, and follow live group standings." />
          </div>
        </section>
      </div>
    </div>
  );
}

function GuideCard({ icon, title, steps }: { icon: React.ReactNode; title: string; steps: string[] }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold mb-4">
        <span className="text-emerald-600">{icon}</span>
        {title}
      </h2>
      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm text-gray-600">
            <span className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
              {index + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
      <div className="text-emerald-600 mb-2">{icon}</div>
      <p className="font-semibold text-gray-900">{title}</p>
      <p className="text-gray-500 text-sm mt-1 leading-relaxed">{text}</p>
    </div>
  );
}
