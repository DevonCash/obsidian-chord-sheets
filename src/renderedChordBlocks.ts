import {MarkdownView} from "obsidian";

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
