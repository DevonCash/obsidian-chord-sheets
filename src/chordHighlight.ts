import {MarkdownView} from "obsidian";
import {EditorView} from "@codemirror/view";
import {setCurrentChordEffect} from "./editor-extension/currentChordField";
import {ChordOccurrence} from "./metronome/songTiming";
import {renderedBlockLines} from "./renderedChordBlocks";

const PLAYING_CLASS = "chord-sheet-chord-playing";

/**
 * Highlights the chord currently being played, in whichever mode the note is being viewed in: through a
 * decoration in the editor, and by marking the rendered chord span in reading mode.
 */
export class ChordHighlighter {
	private current: ChordOccurrence | null = null;
	private currentMode: string | null = null;
	private highlightedEl: Element | null = null;

	constructor(private view: MarkdownView) {
	}

	show(chord: ChordOccurrence | null) {
		const mode = this.view.getMode();
		if (chord === this.current && mode === this.currentMode && this.isStillApplied()) {
			return;
		}

		// Switching modes leaves a highlight behind in the mode being left.
		if (mode !== this.currentMode) {
			this.highlightRenderedChord(null);
			this.highlightEditorChord(null);
		}

		this.current = chord;
		this.currentMode = mode;

		if (mode === "preview") {
			this.highlightRenderedChord(chord);
		} else {
			this.highlightEditorChord(chord);
		}
	}

	clear() {
		if (this.current === null) {
			return;
		}
		this.current = null;
		this.currentMode = null;
		this.highlightRenderedChord(null);
		this.highlightEditorChord(null);
	}

	/**
	 * Reading mode re-renders the note on its own (after an edit, say), which silently drops the class.
	 * Detecting that lets the next frame put it back.
	 */
	private isStillApplied(): boolean {
		return this.currentMode !== "preview"
			|| this.current === null
			|| !!this.highlightedEl?.isConnected;
	}

	private highlightEditorChord(chord: ChordOccurrence | null) {
		const editorView = this.view.editor?.cm as EditorView | undefined;
		if (!editorView) {
			return;
		}
		// Guard against a stale timeline pointing past the end of a document that has since shrunk.
		const range = chord && chord.to <= editorView.state.doc.length
			? {from: chord.from, to: chord.to}
			: null;
		editorView.dispatch({effects: setCurrentChordEffect.of(range)});
	}

	private highlightRenderedChord(chord: ChordOccurrence | null) {
		this.highlightedEl?.removeClass(PLAYING_CLASS);
		this.highlightedEl = null;

		if (!chord) {
			return;
		}

		const lineEl = renderedBlockLines(this.view, chord.blockStartLine)?.[chord.lineInBlock];
		const chordEl = lineEl?.querySelectorAll(".chord-sheet-chord").item(chord.chordInLine);
		if (chordEl) {
			chordEl.addClass(PLAYING_CLASS);
			this.highlightedEl = chordEl;
		}
	}
}
