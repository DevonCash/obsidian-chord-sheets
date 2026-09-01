---
tempo: 60
time-signature: 12/8
emphasis: X__x__x__x__
---

A dotted quarter at 60, which is how a 12/8 tempo is normally written: four
pulses to the bar, one a second, so a bar lasts 4 seconds.

No `beat-unit` property is needed — a compound meter is counted in dotted notes
by default, which is also what its emphasis clicks. Set it explicitly to count
some other note value: `beat-unit: 1/8` here would read the same music as 180
eighth notes per minute.

The emphasis pattern is what keeps this from machine-gunning: twelve beats per
bar, but only beats 1, 4, 7 and 10 sound — the four dotted-quarter pulses, with
an accent on the downbeat. Silence is `_`.

Each `| Em |` below should hold the scroll for a full 4 seconds.

```chords
[Verse]
| Em | Am |
Slow and swung, six-eight feel doubled
| C  | G  |
every bar is four in the pulse

[Bridge]
| Em % % Am |
Em takes three pulses, Am the last
| C         |
one chord for the whole bar
```
