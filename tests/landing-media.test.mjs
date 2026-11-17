// The landing's images are the reviewed bytes. This is the media check scripts/build-landing.mjs
// ran when it copied the review into public/landing, pointed at where the app now serves them from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(import.meta.dirname, '..');
/* The review record is kept with the design review, outside the public repo; without it there is nothing to compare. */
const recipeFile = path.join(repo, 'process/reviews/aircheck-landing-red-20261106/recipe.json');
const skip = !fs.existsSync(recipeFile) && 'the design review record is not in this checkout';
const media = skip ? {} : JSON.parse(fs.readFileSync(recipeFile, 'utf8')).process.steps[0].options.media;

test('every reviewed landing image is served byte for byte from public/landing-assets', { skip }, () => {
  assert.ok(Object.keys(media).length >= 13);
  for (const [reviewed, sha] of Object.entries(media)) {
    const served = path.join(repo, 'public/landing-assets', reviewed.replace(/^landing-2026-11-06\//, ''));
    const h = createHash('sha256').update(fs.readFileSync(served)).digest('hex');
    assert.equal(h, sha, `${served} does not match the reviewed ${reviewed}`);
  }
});
