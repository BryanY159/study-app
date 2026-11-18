import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { indexPack } from '../../engine/packIndex';
import { makePack } from '../../../test/makePack';
import { Stem } from './QuestionView';

function stemWithFigure(file: string) {
  const pack = makePack({ alpha: 1 });
  const q = { ...pack.questions[0], figure: { file, caption: 'A labelled sketch' } };
  render(<Stem q={q} ix={indexPack(pack)} />);
}

afterEach(cleanup);

describe('question figures', () => {
  it('renders an embedded data: URI figure', () => {
    stemWithFigure('data:image/svg+xml;base64,PHN2Zy8+');
    expect(screen.getByRole('img', { name: 'A labelled sketch' }).getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });

  it('shows a placeholder, not a broken image, for a file-path figure', () => {
    stemWithFigure('figures/some-figure.png');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('figure-missing').textContent).toContain('Figure not included in this pack.');
    expect(screen.getByText('A labelled sketch')).toBeTruthy();
  });
});
