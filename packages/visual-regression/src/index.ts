/**
 * @framer/visual-regression — screenshot the Framer source and the generated
 * React project at desktop/tablet/mobile, pixel-diff them, and judge each
 * breakpoint against its own tolerance.
 *
 * The reference renderer (`renderReferencePage`) is an independent
 * implementation of the extracted `FramerDocument` → HTML/CSS. The compiler
 * produces the candidate project. Both are screenshotted in the same browser
 * at identical viewports and compared pixel-by-pixel.
 */

export * from './reference';
export * from './compare';
export * from './serve';
export * from './browser/screenshot';
export * from './run';
