import {MarkdownView} from "obsidian";

/**
 * Chords and rhythm markers both render as one element each, in the order they were tokenized. Together
 * they are every place the song can be at, so this is what both seeking and highlighting look for.
 */
export const SLOT_SELECTOR = ".chord-sheet-chord, .chord-sheet-rhythm-marker";

/**
 * Finds the rendered lines of a chord block in reading mode. Blocks are located by the document line of
 * their opening fence rather than by their position among the rendered blocks, because reading mode
 * unloads sections that are far off-screen.
 */
export function renderedBlockLines(view: MarkdownView, blockStartLine: number): HTMLCollection | null {
	const blockEl = view.previewMode?.containerEl
		.querySelector(`[data-chord-sheet-block-line="${blockStartLine}"] .chord-sheet-chord-block-preview`);
	return blockEl?.children ?? null;
}
