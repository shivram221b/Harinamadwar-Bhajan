# Harinamadwar Bhajan – app content

The Harinamadwar Guru app reads its songs from this repository.

| File | What it holds |
|---|---|
| songs.txt | English lyrics (master list) |
| songs_ta.txt / songs_kn.txt / songs_sa.txt | Tamil, Kannada, Sanskrit lyrics |
| meanings_ta.txt | Tamil meanings, one block per song (`@@ 2.6.5 | title |`) |
| audio.txt | Song number → recording, e.g. `2.1|Audio/2.1-BhajareManasa.m4a` |
| Audio/ | The recordings |

## To publish a change
1. Edit or upload the files here.
2. Open `manifest.txt` and raise `version=` by one (1 → 2 → 3 …).
3. Commit. Phones pick up the change the next time the app is opened with internet.

Recordings are streamed, so adding a song to `Audio/` plus one line in `audio.txt` is enough.

## Ashtapathy (Śrī Gīta Govindam)
The second book lives in the `ashtapathy/` folder, with the same kinds of files:
`songs.txt`, `songs_ta.txt`, `songs_kn.txt`, `songs_sa.txt`, `meanings_ta.txt`, `meanings_en.txt`,
`meanings_kn.txt`, `audio.txt` and its own `manifest.txt`. Song numbers are `N.1` (opening ślokam),
`N.2` (aṣṭapadi) and `N.3` (closing ślokam). To publish a change there, raise `version=` in
`ashtapathy/manifest.txt`. Recordings go in `ashtapathy/Audio/`, listed in `ashtapathy/audio.txt`
as `1.2|Audio/1.2-PralayaPayodhijale.m4a`.
