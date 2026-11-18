import type { Question, Source } from '../../pack/schema';
import type { PackIndex } from '../../engine/packIndex';

const LEVEL_LABEL = { recall: 'Recall', application: 'Application', clinical: 'Clinical scenario' } as const;

/** "source/<set>/<unit>/reading-2/notes-part-3.txt" → "<Unit> · Reading 2 · Notes part 3" (the first folder is dropped). */
export function sourceLabel(s: Source): string {
  const parts = s.file.replace(/^source\//, '').split('/').slice(1);
  const pretty = parts.map((p) => {
    const words = p.replace(/\.(pdf|txt|png)$/i, '').replace(/-/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  });
  return `${pretty.join(' · ')} — ${s.locator}`;
}

export function QuestionMeta({ q, ix, extra }: { q: Question; ix: PackIndex; extra?: React.ReactNode }) {
  const topic = ix.topic.get(q.topicIds[0]);
  const module = topic ? ix.module.get(topic.moduleId) : undefined;
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="chip accent">
        {module?.name} · {topic?.name}
      </span>
      <span className="chip">{LEVEL_LABEL[q.level]}</span>
      {q.origin === 'course-practice' && <span className="chip practice">Course practice</span>}
      <span className="grow" />
      {extra}
    </div>
  );
}

export function Stem({ q, ix }: { q: Question; ix: PackIndex }) {
  const scenario = q.scenarioId ? ix.scenario.get(q.scenarioId) : undefined;
  return (
    <>
      {q.status === 'unconfirmed' && q.preflag && (
        <div className="banner warn" role="note" data-testid="unconfirmed">
          <strong>Unconfirmed — check with your notes or instructor.</strong> {q.preflag.note}
        </div>
      )}
      {scenario && (
        <div className="scenario" data-testid="scenario">
          <div className="label">Scenario</div>
          {scenario.text}
          {scenario.figure && <Figure file={scenario.figure.file} caption={scenario.figure.caption} />}
        </div>
      )}
      <p className="stem" data-testid="stem">
        {q.stem}
      </p>
      {q.figure && <Figure file={q.figure.file} caption={q.figure.caption} />}
    </>
  );
}

function Figure({ file, caption }: { file: string; caption: string }) {
  // Packs carry figures embedded as data: URIs. The hosted app has no folder of
  // figure files to load from, so any other path shows a placeholder instead of a broken image.
  if (!file.startsWith('data:')) {
    return (
      <figure className="figure missing" data-testid="figure-missing">
        <div className="muted small">Figure not included in this pack.</div>
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    );
  }
  return (
    <figure className="figure">
      <img src={file} alt={caption || 'Question figure'} />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

/** Answer options before feedback (drill) or during a mock. Pack order, never shuffled. */
export function OptionPicker({ q, selected, onPick }: { q: Question; selected: string | null; onPick: (key: string) => void }) {
  return (
    <div className="options" role="radiogroup" aria-label="Answer choices">
      {q.options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={selected === o.key}
          className={`option${selected === o.key ? ' selected' : ''}`}
          onClick={() => onPick(o.key)}
        >
          <span className="key">{o.key}</span>
          <span className="body">
            <span className="text">{o.text}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Options after answering: every option with its explanation, key and her choice marked. */
export function OptionFeedback({ q, chosen }: { q: Question; chosen: readonly string[] }) {
  return (
    <div className="options" data-testid="feedback">
      {q.options.map((o) => {
        const picked = chosen.includes(o.key);
        const cls = o.correct ? 'correct' : picked ? 'picked-wrong' : 'plain';
        return (
          <div key={o.key} className={`option ${cls}`}>
            <span className="key">{o.key}</span>
            <div className="body">
              <span className="text">{o.text}</span>
              {o.correct && <span className="tag ok">{picked ? 'Your answer · Correct' : 'Correct answer'}</span>}
              {!o.correct && picked && <span className="tag bad">Your answer · Incorrect</span>}
              <p className="why">{o.explanation}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function KeyIdea({ q }: { q: Question }) {
  return (
    <section className="card stack" style={{ padding: '18px 20px', gap: 10 }}>
      {q.summary && (
        <>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Key idea</div>
          <p>{q.summary}</p>
        </>
      )}
      <div className="sources">
        <span className="head">Sources</span>
        {q.sources.map((s, i) => (
          <span key={i}>{sourceLabel(s)}</span>
        ))}
      </div>
    </section>
  );
}

export function FlagButton({ onClick, flagged }: { onClick: () => void; flagged: boolean }) {
  return (
    <button type="button" className="btn small" onClick={onClick} aria-label="Flag this question">
      <svg width="16" height="16" viewBox="0 0 24 24" fill={flagged ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 22V4" />
        <path d="M4 4h12l-2 4 2 4H4" />
      </svg>
      {flagged ? 'Flagged' : 'Flag'}
    </button>
  );
}
