import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import StatusBadge from './StatusBadge';

describe('StatusBadge', () => {
  it('renders Online with N/M when online with counts', () => {
    const html = renderToStaticMarkup(<StatusBadge status="online" players={12} maxPlayers={50} />);
    expect(html).toContain('Online');
    expect(html).toContain('12');
    expect(html).toContain('50');
  });

  it('renders just Online when player counts are absent', () => {
    const html = renderToStaticMarkup(<StatusBadge status="online" />);
    expect(html).toContain('Online');
    // The count format is `Online · N/M`; with no counts the `· ` separator is absent.
    expect(html).not.toContain('·');
  });

  it('renders Offline', () => {
    const html = renderToStaticMarkup(<StatusBadge status="offline" />);
    expect(html).toContain('Offline');
  });

  it('renders Unknown', () => {
    const html = renderToStaticMarkup(<StatusBadge status="unknown" />);
    expect(html).toContain('Unknown');
  });
});
