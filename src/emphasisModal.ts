import {App, Modal, setTooltip} from "obsidian";
import {Beat, patternToString} from "./metronome/songMeta";

/** Clicking a beat steps it through the three states. */
const NEXT_STATE: Record<Beat, Beat> = {
	accent: "normal",
	normal: "silent",
	silent: "accent"
};

const STATE_LABEL: Record<Beat, string> = {
	accent: "Accented",
	normal: "Normal",
	silent: "Silent"
};

/**
 * Edits the metronome's emphasis pattern as a row of beats rather than as a string of X, x and _.
 *
 * Changes apply as they are made: the metronome keeps running while the dialog is open, so a beat can be
 * toggled and heard straight away.
 */
export class EmphasisModal extends Modal {
	private pattern: Beat[];
	private beatButtons: HTMLElement[] = [];
	private patternEl: HTMLElement | null = null;

	constructor(
		app: App,
		private beatsPerBar: number,
		private beatUnit: number,
		pattern: Beat[],
		private onChange: (pattern: Beat[]) => void
	) {
		super(app);
		this.pattern = [...pattern];
	}

	onOpen() {
		const {contentEl, titleEl} = this;
		titleEl.setText(`Emphasis — ${this.beatsPerBar}/${this.beatUnit}`);

		contentEl.createEl("p", {
			cls: "chord-sheet-emphasis-hint",
			text: "Click a beat to step it through accented, normal and silent."
		});

		const beatsEl = contentEl.createDiv({cls: "chord-sheet-emphasis-beats"});
		this.beatButtons = this.pattern.map((_, index) => {
			const button = beatsEl.createEl("button", {
				cls: "chord-sheet-emphasis-beat",
				text: String(index + 1)
			});
			button.addEventListener("click", () => this.cycleBeat(index));
			return button;
		});

		this.patternEl = contentEl.createDiv({cls: "chord-sheet-emphasis-pattern"});

		const legendEl = contentEl.createDiv({cls: "chord-sheet-emphasis-legend"});
		for (const state of ["accent", "normal", "silent"] as Beat[]) {
			const item = legendEl.createDiv({cls: "chord-sheet-emphasis-legend-item"});
			item.createSpan({cls: ["chord-sheet-emphasis-swatch", `is-${state}`]});
			item.createSpan({text: STATE_LABEL[state]});
		}

		this.refresh();
	}

	onClose() {
		this.contentEl.empty();
	}

	private cycleBeat(index: number) {
		this.pattern[index] = NEXT_STATE[this.pattern[index]];
		this.refresh();
		this.onChange([...this.pattern]);
	}

	private refresh() {
		this.beatButtons.forEach((button, index) => {
			const state = this.pattern[index];
			for (const candidate of ["accent", "normal", "silent"] as Beat[]) {
				button.toggleClass(`is-${candidate}`, candidate === state);
			}
			setTooltip(button, `Beat ${index + 1}: ${STATE_LABEL[state]}`);
		});

		this.patternEl?.setText(patternToString({pattern: this.pattern}));
	}
}
