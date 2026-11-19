import { useMemo, useState } from 'react';
import { buildQueue, deckCounts, localDay, newCardsRatedToday, type QueueMode } from '../../engine/leitner';
import { mulberry32, randomSeed } from '../../engine/rng';
import { CARD_TYPES, cardsOf, type CardType } from '../../pack/schema';
import { packReviews, schedulerStates } from '../../storage/cards';
import { useApp } from '../../state/AppProvider';
import { CARD_TYPE_LABEL } from '../components/CardFace';
import { TopicTree } from '../components/TopicTree';
import { navigate, type Route } from '../router';
import { ancestorsOf, buildTree, type TreeNode } from '../topicTree';
import { useExpanded } from '../useExpanded';
import { Welcome } from './Welcome';

const MODES: { id: QueueMode; label: string; help: string }[] = [
  { id: 'due-new', label: 'Due + new', help: 'Cards due today first, then new cards up to your daily limit.' },
  { id: 'due', label: 'Due only', help: 'Only the cards due today.' },
  { id: 'cram', label: 'Cram', help: 'Every card in the selection, shuffled. Practice only: the schedule does not change.' },
];

/** FR-11: choose topics (with due / new / learned counts), a mode and optional card types, then start. */
export function CardSetup({ route }: { route: Route }) {
  const { ix, cards, progress, setCardRun, now } = useApp();
  const deck = useMemo(() => (ix ? cardsOf(ix.pack) : []), [ix]);
  const presetIds = route.query.get('ids')?.split(',').filter(Boolean) ?? null;
  const presetTopics = route.query.get('topics')?.split(',').filter(Boolean);
  const topicsWithCards = useMemo(() => new Set(deck.flatMap((c) => c.topicIds)), [deck]);
  const [topics, setTopics] = useState<Set<string>>(() => new Set(presetTopics?.length ? presetTopics : topicsWithCards));
  const [mode, setMode] = useState<QueueMode>(presetIds ? 'cram' : 'due-new');
  const [types, setTypes] = useState<Set<CardType>>(() => new Set(CARD_TYPES));
  const tree = useMemo(() => (ix ? buildTree(ix, (t) => topicsWithCards.has(t)) : []), [ix, topicsWithCards]);
  const presetOpen = useMemo(() => (presetTopics?.length ? ancestorsOf(tree, new Set(presetTopics)) : []), [tree, presetTopics?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const expanded = useExpanded('cards', ix?.pack.packId ?? '', presetOpen);

  if (!ix) return <Welcome />;
  const packId = ix.pack.packId;
  if (!deck.length) {
    return (
      <main className="page narrow">
        <h1>Flashcards</h1>
        <div className="card empty">This pack has no flashcards yet. When a pack with cards is imported, they show up here.</div>
      </main>
    );
  }

  const today = localDay(now());
  const states = schedulerStates(cards, packId, deck);
  const newLeft = Math.max(0, progress.settings.newCardsPerDay - newCardsRatedToday(packReviews(cards, packId), today));
  const presetSet = presetIds ? new Set(presetIds) : null;
  const selected = deck.filter((c) => (presetSet ? presetSet.has(c.id) : c.topicIds.some((t) => topics.has(t)) && types.has(c.type)));
  const ids = selected.map((c) => c.id);
  const counts = deckCounts(ids, states, today);
  const queue = buildQueue({ cardKeys: ids, states, mode, today, newLeft, rand: mulberry32(randomSeed()) });
  const newInQueue = mode === 'due-new' ? Math.min(counts.new, newLeft) : 0;
  const dueInQueue = mode === 'cram' ? 0 : counts.due;
  const startLabel =
    mode === 'cram' ? `Start · ${queue.length} card${queue.length === 1 ? '' : 's'} (practice)` : mode === 'due' ? `Start · ${dueInQueue} due` : `Start · ${dueInQueue} due + ${newInQueue} new`;
  const emptyReason =
    queue.length > 0
      ? null
      : !selected.length
        ? 'No cards in this selection.'
        : mode === 'due'
          ? 'Nothing is due today. Try Due + new, or Cram to practise anyway.'
          : newLeft === 0 && counts.new > 0
            ? "Nothing is due and you've reached today's new-card limit. Use Cram to practise anyway, or raise the limit on the History & data page."
            : 'Nothing is due today. Use Cram to practise anyway.';

  const countsFor = (node: TreeNode) => {
    const ids = new Set(node.topicIds);
    return deckCounts(deck.filter((c) => c.topicIds.some((t) => ids.has(t))).map((c) => c.id), states, today);
  };
  const toggleType = (t: CardType) =>
    setTypes((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });

  const start = () => {
    if (!queue.length) return;
    setCardRun({ packId, mode, queue, pos: 0, flipped: false, rated: [], undo: null, startedAt: now().toISOString(), topicIds: [...new Set(selected.flatMap((c) => c.topicIds))] });
    navigate('/cards/run');
  };

  return (
    <main className="page">
      <div className="grid-aside">
        <section className="stack-lg">
          <div>
            <h1>Flashcards</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              {presetSet ? `Reviewing ${selected.length} card${selected.length === 1 ? '' : 's'} linked to a question.` : 'Choose topics. Each shows cards due today, new cards, and cards learned.'}
            </p>
          </div>
          {!presetSet && (
            <TopicTree
              stackTopicMeta
              label="Topics"
              nodes={tree}
              expanded={expanded}
              selection={{ selected: topics, onChange: setTopics }}
              meta={(n) => {
                const c = countsFor(n);
                return (
                  <span aria-label={`${c.due} due, ${c.new} new, ${c.learned} learned`}>
                    <span className={c.due ? 'due-n' : ''}>{c.due} due</span> · {c.new} new{n.kind === 'topic' && ` · ${c.learned}/${c.total} learned`}
                  </span>
                );
              }}
            />
          )}
        </section>

        <aside className="card stack-lg" style={{ position: 'sticky', top: 16 }}>
          <div className="stack" style={{ gap: 0 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Session</div>
            {MODES.map((m) => (
              <label key={m.id} className="check" style={{ alignItems: 'flex-start' }}>
                <input type="radio" name="card-mode" checked={mode === m.id} onChange={() => setMode(m.id)} style={{ marginTop: 3 }} />
                <span>
                  {m.label}
                  <br />
                  <span className="small muted">{m.help}</span>
                </span>
              </label>
            ))}
          </div>
          {!presetSet && (
            <div className="stack" style={{ gap: 8 }}>
              <div style={{ fontWeight: 600 }}>Card types</div>
              <div className="row" style={{ gap: 8 }}>
                {CARD_TYPES.map((t) => (
                  <button key={t} type="button" className="btn seg" aria-pressed={types.has(t)} onClick={() => toggleType(t)}>
                    {CARD_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button type="button" className="btn primary big" disabled={!queue.length} onClick={start} data-testid="start-cards">
            {startLabel}
          </button>
          {emptyReason && (
            <p className="small" data-testid="cards-empty-reason">
              {emptyReason}
            </p>
          )}
          <p className="small muted">
            New cards today: {Math.min(newLeft, progress.settings.newCardsPerDay)} of {progress.settings.newCardsPerDay} left
          </p>
        </aside>
      </div>
    </main>
  );
}
