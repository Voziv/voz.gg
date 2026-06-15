import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Switch } from './switch';

describe('Switch', () => {
  it('renders a switch element with the slot marker', () => {
    const html = renderToStaticMarkup(<Switch />);
    expect(html).toContain('data-slot="switch"');
  });

  it('reflects checked state in the markup', () => {
    const on = renderToStaticMarkup(<Switch checked />);
    const off = renderToStaticMarkup(<Switch checked={false} />);
    expect(on).not.toEqual(off);
    // Base UI emits data-checked / data-unchecked (not aria-checked).
    expect(on).toContain('data-checked');
    expect(off).toContain('data-unchecked');
  });
});
