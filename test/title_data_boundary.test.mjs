import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import test from 'node:test';

const TITLE_DATA_DIRECTORY = new URL(
    '../project/game/script/data/scene/title/',
    import.meta.url
);

test('title data 폴더는 link와 metadata만 소유한다', async () => {
    const entries = await readdir(TITLE_DATA_DIRECTORY, {
        withFileTypes: true
    });
    const entryNames = entries
        .map((entry) => entry.name)
        .sort();

    assert.ok(entries.every((entry) => entry.isFile()));
    assert.deepEqual(entryNames, [
        'title_link_data.js',
        'title_metadata.js'
    ]);
});
