import { Link } from 'react-router-dom'
import { Collapsible, PageHeader } from '../components/ui.jsx'

const SECTIONS = [
  {
    n: '01',
    title: 'Task sourcing',
    body: [
      'Tasks are uploaded to the arena as Excel datasets. You can create a custom benchmark with Artificial Analysis or bring tasks from your own workflow; the arena does not require one fixed source dataset.',
      'Each row can carry a prompt, optional system prompt and rubric, expected deliverables, and reference material. Categories can use any label; new labels remain under Other until an admin approves them for the filters. Re-uploading a dataset updates tasks by task ID instead of silently duplicating them.',
    ],
  },
  {
    n: '02',
    title: 'The battle',
    body: [
      'You pick which harnesses enter, and every one of them receives the identical task under the identical model and provider configuration. One active config is shared arena-wide, so no harness can win by quietly using a stronger model.',
      'Each harness runs concurrently in its own isolated workspace directory. Harnesses never share a workspace, never see each other\'s output, and are never told they are being compared. When a run finishes, the arena collects whatever files landed in that workspace as the deliverables.',
    ],
  },
  {
    n: '03',
    title: 'Judging',
    body: [
      'Deliverables are presented as "Output A / B / C" in an order seeded by the task id, not by harness identity, so the same harness does not sit in the same slot across tasks. You review the files side by side and score each one from 1 to 10.',
      'Submission is gated until every shown output has a score, which prevents a partial verdict from tilting the ladder. Only after you submit are the harness identities revealed.',
    ],
  },
  {
    n: '04',
    title: 'Elo',
    body: [
      'Ratings start at 1000 and update from your scores using the standard Elo expectation and update rules:',
    ],
    code: 'E  = 1 / (1 + 10^((Rb − Ra) / 400))\n\nR′ = R + K · (S − E)',
    after: [
      'Within a task, every pair of scored harnesses is compared off a shared pre-task rating snapshot, and each pair\'s K is scaled by 1 / (number of pairs). That caps the total rating exchanged per task at K = 32 regardless of how many harnesses competed, so a two-way task and a four-way task move the board by the same amount. Equal scores count as a draw (S = 0.5).',
      'Ratings are never stored. They are recomputed from every submitted score every time the public leaderboard loads, so a cached number can never drift from the community’s judgments.',
    ],
  },
  {
    n: '05',
    title: 'Keeping it honest',
    body: ['A few properties the arena enforces structurally rather than by convention:'],
    bullets: [
      ['Blind by construction', 'harness names are withheld by the API itself until you submit your own score, not merely hidden in the interface.'],
      ['One verdict per person and task', 'the scores table is uniquely keyed on (task, harness, user), so a person cannot score the same output twice while other people can submit their own blind verdicts.'],
      ['Equal task weight', 'per-task K normalization stops a task that happened to include more harnesses from dominating the ladder.'],
      ['Identical conditions', 'one shared model/provider config, one task, one isolated workspace each.'],
      ['Derived ratings', 'no mutable rating column exists to drift, be edited, or fall out of sync with the raw history.'],
    ],
  },
]

const FAQ = [
  {
    q: "Can a harness see who it's fighting?",
    a: 'No. Each harness runs alone in its own workspace with only the task in front of it. It is never told that a comparison is happening, never sees another harness\'s output, and has no access to the arena\'s scoring.',
  },
  {
    q: 'Why Elo and not win rate?',
    a: 'Win rate ignores who you beat. Topping a weak field is not the same as beating the leader. Elo weights every result by the strength of the opposition and stays meaningful as harnesses join or leave the roster.',
  },
  {
    q: 'How do new harnesses get seeded?',
    a: 'A new harness enters at the same 1000 baseline everyone started from and moves purely on the battles it actually plays. There is no calibration phase and no provisional adjustment. Its rating simply reflects its record.',
  },
  {
    q: 'What is the "AI judge score" next to my own?',
    a: 'A planned second opinion: an automated per-deliverable score from Artificial Analysis, shown beside your blind judgment so you can see where you two diverge. It is not wired up yet and displays as "coming soon". Today only your own scores feed the leaderboard.',
  },
  {
    q: 'How do custom harnesses work?',
    a: 'Custom HTTP harness registration is coming soon. The underlying adapter is in progress, but users cannot add or run custom harnesses from Setup yet.',
  },
]

export default function Methodology() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="How it works" title="Methodology">
        <p>
          Harness Arena ranks autonomous-work harnesses. These are agents that take a real assignment end to end and ship the
          actual deliverables: workbooks, reports, decks, dashboards. Runs are blind, judged by you, and scored with
          Elo. Here is the whole pipeline, from where tasks come from to what keeps the ladder honest.
        </p>
      </PageHeader>

      <div className="space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.n} className="border-l-2 border-line-strong pl-5">
            <div className="flex items-baseline gap-3">
              <span className="font-mono-arena text-sm text-ink-3">{s.n}</span>
              <h2 className="font-display text-xl font-semibold">{s.title}</h2>
            </div>
            <div className="mt-3 space-y-3 text-ink-2">
              {s.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
              {s.code && (
                <pre className="overflow-x-auto rounded-lg border border-line bg-floating p-3 font-mono-arena text-xs text-ink">
                  {s.code}
                </pre>
              )}
              {s.after?.map((p) => (
                <p key={p}>{p}</p>
              ))}
              {s.bullets && (
                <ul className="space-y-2">
                  {s.bullets.map(([label, text]) => (
                    <li key={label}>
                      <span className="font-semibold text-ink">{label}</span>: {text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ))}
      </div>

      <div>
        <p className="eyebrow">FAQ</p>
        <h2 className="font-display mt-1 text-2xl font-semibold">Common questions</h2>
        <div className="card mt-4 px-5 py-1">
          {FAQ.map((item) => (
            <Collapsible key={item.q} label={item.q}>
              <p>{item.a}</p>
            </Collapsible>
          ))}
        </div>
      </div>

      <div className="card flex flex-col gap-3 p-6 text-center">
        <h2 className="font-display text-xl font-semibold">Ready to judge?</h2>
        <p className="text-ink-2">Run a task through the harnesses, review the deliverables, and cast your scores.</p>
        <Link to="/evaluate" className="btn-cta mx-auto inline-block text-sm">
          Start judging →
        </Link>
      </div>
    </div>
  )
}
