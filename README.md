# Sky Hop — meme bird game

A responsive, browser-based Flappy Bird-style game. Customize the bird with a friend's photo, choose meme sounds, and set a game-over meme image with adjustable transparency.

## Features

- Upload a face photo (JPG, PNG, WEBP, or GIF) to use as the flying character.
- Choose one of three built-in bird presets instead.
- Pick a meme sound pack: random, Vine-boom style, bruh, bonk, goofy whistle, or airhorn.
- Upload your own audio file for the selected meme sound.
- Upload a separate game-over image and adjust its transparency from 10% to 100%.
- Choose the game-over sound independently, reuse the selected meme sound, or mute it.
- Keyboard, mouse, and touch controls; pause/resume; score and locally saved best score.

Uploaded photos and audio are used locally in the browser. They are not uploaded to a server. The browser may ask for interaction before it allows audio playback.

## Play locally

No package installation or build step is required.

```bash
cd flapbird-game
python3 -m http.server 8000
```

Open <http://localhost:8000>.

## Controls

- **Space**, **Arrow Up**, click, or tap: flap / start
- **P** or **Escape**: pause / resume
- Configure the character, sounds, and game-over image in the starting menu.

## Deploy on Render

This is a static site and does not require a backend.

1. Push the contents of this folder to a GitHub repository.
2. In Render, create **New → Static Site** and connect the repository.
3. Leave the build command empty.
4. Set the publish directory to `.` (the repository root).
5. Deploy. Render will provide a public `onrender.com` URL.

## Audio and game-over display notes

- The flap sound plays only when the player flaps.
- The independently selected hit sound plays only when the bird hits a pipe or the ground.
- Uploaded flap and hit audio are separate browser audio players. The global sound button mutes both.
- The game-over image is layered over the game canvas only; the score / best-score toolbar is outside that image layer.
