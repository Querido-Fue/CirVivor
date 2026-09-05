import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL(
    '../project/game/script/module/save/_save_file_writer.js', import.meta.url
), 'utf8');

async function createWriter(overrides = {}) {
    const context = vm.createContext({ Uint8Array });
    const bridge = new vm.SyntheticModule(['fsPromises', 'randomUUID'], function () {
        this.setExport('fsPromises', { ...fs, ...overrides });
        this.setExport('randomUUID', randomUUID);
    }, { context });
    const module = new vm.SourceTextModule(source, { context });
    await module.link(() => bridge);
    await module.evaluate();
    return module.namespace.writeSaveFile;
}

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cirvivor-save-writer-'));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('cirvivor-save-writer-'));
        return fs.rm(directory, { recursive: true, force: true });
    });
    return { directory, target: path.join(directory, 'progress.dat') };
}

test('overlapping saves commit in order and copy binary data before asynchronous work', async (t) => {
    const { directory, target } = await fixture(t);
    const commits = [];
    const write = await createWriter({
        async rename(from, to) {
            commits.push((await fs.readFile(from))[0]);
            await fs.rename(from, to);
        }
    });
    const writes = [];
    for (let index = 0; index < 20; index++) {
        const bytes = new Uint8Array([index]);
        writes.push(write(target, bytes));
        bytes[0] = 255;
    }
    await Promise.all(writes);
    assert.deepEqual(commits, Array.from({ length: 20 }, (_, i) => i));
    assert.equal((await fs.readFile(target))[0], 19);
    assert.deepEqual(await fs.readdir(directory), ['progress.dat']);
});

test('partial temporary writes preserve the original file and a later save still succeeds', async (t) => {
    const { directory, target } = await fixture(t);
    await fs.writeFile(target, 'previous');
    const failure = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    let failNext = true;
    const write = await createWriter({
        async writeFile(destination, data, options) {
            if (!failNext) return fs.writeFile(destination, data, options);
            failNext = false;
            await fs.writeFile(destination, 'partial', options);
            throw failure;
        }
    });
    await assert.rejects(write(target, 'bad'), error => error === failure);
    assert.equal(await fs.readFile(target, 'utf8'), 'previous');
    assert.deepEqual(await fs.readdir(directory), ['progress.dat']);
    await write(target, 'recovered');
    assert.equal(await fs.readFile(target, 'utf8'), 'recovered');
});

test('replacement failures preserve the existing target and remove temporary files', async (t) => {
    const { directory, target } = await fixture(t);
    await fs.writeFile(target, 'previous');
    const failure = Object.assign(new Error('denied'), { code: 'EACCES' });
    const write = await createWriter({ rename: async () => { throw failure; } });
    await assert.rejects(write(target, 'new'), error => error === failure);
    assert.equal(await fs.readFile(target, 'utf8'), 'previous');
    assert.deepEqual(await fs.readdir(directory), ['progress.dat']);
});
