---
tempo: 60
time-signature: 4/4
emphasis: Xxxx
---

Slow on purpose (60 BPM, one beat per second) so the current-chord highlight is
easy to follow by eye. Every bar below should take 4 seconds.

## Bar lines, tight and spaced

Both of these are two bars — Em then Am:

```chords
| Em | Am |
|Em|Am|
```

## A chord before the first bar line

One bar of Em, then a bar split between Dm and A:

```chords
Em | Dm A |
```

## Repeats and slots

`%` holds the previous chord for another slot. First line: Em gets three beats,
Am the fourth. Second line: Em holds for three whole bars.

```chords
| Em % % Am |
| Em | % | % | Am |
```

## Slash chords and no-chord bars

The slash must stay part of the chord, not act as a bar line:

```chords
| C/G | D/F# |
| N.C. | Am |
```

## Lines that must stay lyrics

None of these should be treated as chord lines, and no word in them should be
highlighted or given a chord diagram:

```chords
| Am | C |
Verse[2] of the song
| Am | C |
A day in the life
| Am | C |
Am I wrong to want you
[G]Baby[1] come back
```
