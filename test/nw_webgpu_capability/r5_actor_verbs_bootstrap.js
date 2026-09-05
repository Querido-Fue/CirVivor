const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;

function writeResult(payload) {
    if (typeof resultPath !== 'string' || resultPath.length === 0) {
        throw new Error('CIRVIVOR_WEBGPU_RESULT_PATH missing');
    }
    require('node:fs').writeFileSync(
        resultPath,
        `${JSON.stringify(payload, null, 2)}\n`,
        'utf8'
    );
}

async function bootstrap() {
    writeResult({ status: 'running', stage: 'bootstrap' });
    await import('./r5_actor_verbs_runner.js');
}

bootstrap().catch((error) => {
    try {
        writeResult({
            status: 'fail',
            stage: 'bootstrap-or-module-import',
            error: error?.stack ?? String(error)
        });
    } catch (writeError) {
        console.error(writeError?.stack ?? writeError);
        console.error(error?.stack ?? error);
    }
    nw.App.quit();
});
