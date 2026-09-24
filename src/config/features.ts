/**
 * Build-time feature switches (see scripts/lib/bundle.ts). The normal app has everything on;
 * the hosted demo build turns off what its host can't support. Written as constant
 * expressions so the bundler removes disabled code entirely.
 */

/*
 * File downloads (entry export, original image) are switched with the __DOWNLOADS_ENABLED__
 * constant written inline at each use site, so the bundler can remove the code when it's off.
 */

/** Load the sample journal on a first visit (demo builds only). */
export const AUTOLOAD_SAMPLE: boolean = typeof __AUTOLOAD_SAMPLE__ === 'boolean' && __AUTOLOAD_SAMPLE__;
