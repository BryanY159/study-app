import { CLOZE_BLANK, type CardType, type Flashcard } from '../../pack/schema';

export const CARD_TYPE_LABEL: Record<CardType, string> = { term: 'Term', concept: 'Concept', cloze: 'Fill in the blank', diagram: 'Diagram' };

/** A cloze front with its blank drawn as a gap (or filled with the answer once flipped). */
function ClozeText({ text, answer }: { text: string; answer?: string }) {
  const [before, after] = text.split(CLOZE_BLANK);
  return (
    <>
      {before}
      {answer ? (
        <mark className="cloze-answer">{answer}</mark>
      ) : (
        <span className="cloze-gap" aria-label="blank">
          {' '.repeat(10)}
        </span>
      )}
      {after}
    </>
  );
}

/** The card image with its labels as markers; on a diagram card the asked-about label is highlighted. */
function CardImage({ card }: { card: Flashcard }) {
  if (!card.image) return null;
  return (
    <figure className="card-figure">
      <div className="card-image-wrap">
        {/* Only data: URIs pass pack validation, so this never loads anything from the network. */}
        <img src={card.image.data} alt={card.image.alt} />
        {card.image.labels.map((l) => (
          <span
            key={l.key}
            className={`card-label${l.key === card.label ? ' asked' : ''}`}
            style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%` }}
            aria-label={`Label ${l.key}`}
          >
            {l.key}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** One side of a flashcard: front (question side) or, when flipped, the answer with its source. */
export function CardFace({ card, topicName, flipped }: { card: Flashcard; topicName: string; flipped: boolean }) {
  return (
    <div className="card-face stack" data-testid={flipped ? 'card-back' : 'card-front'}>
      <div className="row" style={{ gap: 8 }}>
        <span className="chip accent" data-testid="card-type">
          {CARD_TYPE_LABEL[card.type]}
        </span>
        <span className="small muted">{topicName}</span>
        {card.status === 'unconfirmed' && <span className="chip warn">Unconfirmed</span>}
      </div>
      <CardImage card={card} />
      <p className="card-front-text">{card.type === 'cloze' ? <ClozeText text={card.front} answer={flipped ? card.back : undefined} /> : card.front}</p>
      {flipped && (
        <div className="stack card-answer">
          {card.type !== 'cloze' && <p className="card-back-text">{card.back}</p>}
          {card.status === 'unconfirmed' && card.preflag && <p className="small">Unconfirmed: {card.preflag.note}</p>}
          <p className="small muted">Source: {card.sources.map((s) => `${s.file} · ${s.locator}`).join('; ')}</p>
        </div>
      )}
    </div>
  );
}
