/** Replaced at build time so a user build drops developer-only controls. */
declare const __COMPANION_EDITION__: 'user' | 'developer';
export const APP_EDITION = typeof __COMPANION_EDITION__ === 'undefined' ? 'developer' : __COMPANION_EDITION__;
// Keep this expression on the define itself: bundlers can erase every guarded
// branch without needing to infer a value through another exported binding.
export const IS_DEVELOPER = typeof __COMPANION_EDITION__ === 'undefined' || __COMPANION_EDITION__ === 'developer';
