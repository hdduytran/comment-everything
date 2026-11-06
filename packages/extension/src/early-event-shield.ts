import { installEventShield } from '@comment-everything/overlay';

// Runs at document_start on origins the user opted into (see early-shield-registration.ts). It
// only installs capture-phase listeners; it reads nothing from the page.
installEventShield(window);
