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
