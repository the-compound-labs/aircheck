import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decision, keepReview, reviewFromMeta, needsReview } from '../src/server/review.ts';

describe('the review gate', () => {
  const r = { state: 'approved', at: '2026-11-14T10:00:00Z' };
  it('keeps the account decision when a machine re-pushes without one', () => {
    const out = keepReview({ lane: 'x', meta: { a: 1 } }, { lane: 'x', meta: { review: r } });
    assert.deepEqual(out.meta, { a: 1, review: r });
  });
  it('lets an incoming decision win, and passes through when nothing was stored', () => {
    const mine = { state: 'held', at: '2026-11-14T11:00:00Z' };
    assert.deepEqual(keepReview({ lane: 'x', meta: { review: mine } }, { lane: 'x', meta: { review: r } }).meta.review, mine);
    assert.deepEqual(keepReview({ lane: 'x' }, undefined), { lane: 'x' });
  });
  it('ignores a malformed decision', () => {
    assert.equal(reviewFromMeta({ review: { state: 'maybe', at: 'x' } }), undefined);
  });
  it('sends per policy', () => {
    assert.equal(decision(undefined, 'auto').send, true);
    assert.equal(decision(undefined, 'review').send, false);
    assert.equal(decision(r, 'review').send, true);
    assert.equal(decision({ state: 'held', at: 'x' }, 'auto').send, false);
  });
  it('only a queued, undecided post needs review', () => {
    const base = { id: '1', lane: 'x', kind: 'image', media: [], source: 's', status: 'queued', day: '2026-11-14' };
    assert.equal(needsReview(base), true);
    assert.equal(needsReview({ ...base, status: 'sent' }), false);
    assert.equal(needsReview({ ...base, review: r }), false);
  });
});
