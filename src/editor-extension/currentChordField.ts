import {Decoration, DecorationSet, EditorView} from "@codemirror/view";
import {StateEffect, StateField} from "@codemirror/state";

export interface CurrentChordRange {
	from: number;
	to: number;
}

/** Marks the chord being played, or clears the mark when given null. */
export const setCurrentChordEffect = StateEffect.define<CurrentChordRange | null>();

const currentChordMark = Decoration.mark({class: "chord-sheet-chord-playing"});

/**
 * Highlights the chord currently being played. Kept as its own tiny state field rather than folded into
 * the chord block parsing, so that a highlight moving several times a second never triggers a reparse.
 */
export const currentChordField = StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},

	update(decorations, transaction) {
		// Follow edits, so the highlight stays on its chord while the document changes underneath it.
		decorations = decorations.map(transaction.changes);

		for (const effect of transaction.effects) {
			if (effect.is(setCurrentChordEffect)) {
				const range = effect.value;
				decorations = range && range.to > range.from
					? Decoration.set([currentChordMark.range(range.from, range.to)])
					: Decoration.none;
			}
		}

		return decorations;
	},

	provide: field => EditorView.decorations.from(field)
});
