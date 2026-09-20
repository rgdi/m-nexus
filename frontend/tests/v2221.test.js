// v2221.test.js — v2.22.1 frontend additions:
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = (p) => join(process.cwd(), '..', p);

describe('v2.22.1 — subjects screen dynamic', () => {
  it('exports renderSubjects from subjects.js', () => {
    const src = readFileSync(SRC('frontend/src/screens/subjects.js'), 'utf-8');
    expect(src).toMatch(/export async function renderSubjects/);
  });

  it('renders the + new-subject button always visible', () => {
    const src = readFileSync(SRC('frontend/src/screens/subjects.js'), 'utf-8');
    expect(src).toMatch(/<button class="btn primary" id="new-subject"/);
  });

  it('shows empty state when list is empty', () => {
    const src = readFileSync(SRC('frontend/src/screens/subjects.js'), 'utf-8');
    expect(src).toMatch(/renderEmptyState/);
    expect(src).toMatch(/empty-state/);
    expect(src).toMatch(/empty-add/);
    expect(src).toMatch(/empty-import/);
  });

  it('supports drag & drop for reorder', () => {
    const src = readFileSync(SRC('frontend/src/screens/subjects.js'), 'utf-8');
    expect(src).toMatch(/dragstart/);
    expect(src).toMatch(/dragover/);
    expect(src).toMatch(/drop/);
    expect(src).toMatch(/dataTransfer/);
  });

  it('supports long-press for mobile', () => {
    const src = readFileSync(SRC('frontend/src/screens/subjects.js'), 'utf-8');
    expect(src).toMatch(/touchstart/);
    expect(src).toMatch(/pressTimer/);
  });

  it('has row menu with edit/up/down/color/delete actions', () => {
    const src = readFileSync(SRC('frontend/src/screens/subjects.js'), 'utf-8');
    expect(src).toMatch(/data-act="edit"/);
    expect(src).toMatch(/data-act="up"/);
    expect(src).toMatch(/data-act="down"/);
    expect(src).toMatch(/data-act="color"/);
    expect(src).toMatch(/data-act="delete"/);
  });

  it('has full editor modal with all fields', () => {
    const src = readFileSync(SRC('frontend/src/screens/subjects.js'), 'utf-8');
    expect(src).toMatch(/openEditor/);
    expect(src).toMatch(/name="name"/);
    expect(src).toMatch(/name="icon"/);
    expect(src).toMatch(/name="color"/);
    expect(src).toMatch(/name="grade"/);
    expect(src).toMatch(/name="performance"/);
    expect(src).toMatch(/name="prof"/);
    expect(src).toMatch(/name="next"/);
  });

  it('color swatches preview the icon/name letter', () => {
    const src = readFileSync(SRC('frontend/src/screens/subjects.js'), 'utf-8');
    expect(src).toMatch(/updateSwatchPreview/);
    expect(src).toMatch(/swatch-letter/);
  });

  it('has bulk-add modal', () => {
    const src = readFileSync(SRC('frontend/src/screens/subjects.js'), 'utf-8');
    expect(src).toMatch(/openBulkAdder/);
    expect(src).toMatch(/textarea.*name="list"/);
  });

  it('has reset all button with confirmation', () => {
    const src = readFileSync(SRC('frontend/src/screens/subjects.js'), 'utf-8');
    expect(src).toMatch(/reset-all/);
    expect(src).toMatch(/removeAll/);
    expect(src).toMatch(/confirm/);
  });

  it('uses --fg-on-subj-X for WCAG-AA corner text', () => {
    const src = readFileSync(SRC('frontend/src/screens/subjects.js'), 'utf-8');
    expect(src).toMatch(/--fg-on-subj-/);
    expect(src).toMatch(/COLOR_SWATCHES/);
  });
});

describe('v2.22.1 — api client has new subject endpoints', () => {
  it('has reorder, bulkReplace, removeAll methods', () => {
    const src = readFileSync(SRC('frontend/src/services/api.js'), 'utf-8');
    expect(src).toMatch(/reorder:/);
    expect(src).toMatch(/bulkReplace:/);
    expect(src).toMatch(/removeAll:/);
  });
});

describe('v2.22.1 — setup wizard adds only picked subject', () => {
  it('no auto-seed of fake subjects', () => {
    const src = readFileSync(SRC('frontend/src/widgets/setup_wizard.js'), 'utf-8');
    expect(src).not.toMatch(/Mr. Meier/);
    expect(src).not.toMatch(/Dr. Müller/);
    expect(src).not.toMatch(/Fr. Stolz/);
  });

  it('generic chip suggestions', () => {
    const src = readFileSync(SRC('frontend/src/widgets/setup_wizard.js'), 'utf-8');
    expect(src).toMatch(/Matemáticas|Lengua|Historia/);
  });
});
