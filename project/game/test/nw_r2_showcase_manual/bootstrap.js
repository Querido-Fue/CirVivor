import {
    installR2ShowcaseManualLauncher
} from '../support/r2_showcase_manual_launcher.js';

installR2ShowcaseManualLauncher().catch((error) => {
    console.error('Post-R2 manual showcase bootstrap failed:', error);
    const failure = document.createElement('pre');
    failure.id = 'r2-manual-bootstrap-failure';
    failure.textContent = `SHOWCASE BOOTSTRAP FAILED\n${error?.stack ?? error}`;
    document.body.appendChild(failure);
});
