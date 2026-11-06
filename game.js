(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("gameOverlay");
  const overlayCard = document.getElementById("overlayCard");
  const stageWrap = document.querySelector(".stage-wrap");
  const overlayKicker = document.getElementById("overlayKicker");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const startButton = document.getElementById("startButton");
  const scoreValue = document.getElementById("scoreValue");
  const bestValue = document.getElementById("bestValue");
  const soundButton = document.getElementById("soundButton");
  const soundIcon = document.getElementById("soundIcon");
  const pauseNote = document.getElementById("pauseNote");
  const previewBird = document.getElementById("previewBird");
  const customPhotoPreview = document.getElementById("customPhotoPreview");
  const currentBirdLabel = document.getElementById("currentBirdLabel");
  const lossImageBackdrop = document.getElementById("lossImageBackdrop");

  let defaultAssets = {};
  let avatarImage = null;
  let gameOverOpacity = 65;
  let flapAudio = null;
  let hitAudio = null;
  let flapAudioBuffer = null;
  let hitAudioBuffer = null;
  const activeUploadedSources = new Set();
  let resultRevealTimer = null;
  let selectedFlapPack = "random";
  let selectedHitPack = "random";
  let lossImageUrl = null;

  const W = canvas.width;
  const H = canvas.height;
  const FLOOR = 654;
  const GRAVITY = 1500;
  const FLAP_VELOCITY = -440;
  const CHARACTER_RADIUS = 44;
  const PIPE_WIDTH = 76;
  const PIPE_GAP = 190;
  const PIPE_SPEED = 178;
  let state = "ready";
  let bird;
  let pipes = [];
  let particles = [];
  let score = 0;
  let best = readBest();
  let lastTime = 0;
  let elapsed = 0;
  let pipeTimer = 0;
  let groundOffset = 0;
  let soundEnabled = readSoundPreference();
  let audioContext = null;
  let lastFlapTime = 0;
  let shake = 0;

  function readBest() {
    try { return Number.parseInt(localStorage.getItem("skyhop-best") || "0", 10) || 0; }
    catch { return 0; }
  }

  function readSoundPreference() {
    try { return localStorage.getItem("skyhop-sound") !== "off"; }
    catch { return true; }
  }

  function saveBest() {
    try { localStorage.setItem("skyhop-best", String(best)); } catch { /* Private browsing can block storage. */ }
  }

  function updateHud() {
    scoreValue.textContent = String(score).padStart(2, "0");
    bestValue.textContent = String(best).padStart(2, "0");
  }

  function setOverlay(mode) {
    overlay.classList.remove("hidden");
    if (mode === "ready") {
      clearResultRevealTimer();
      stageWrap.classList.remove("show-loss-image");
      lossImageBackdrop.classList.add("hidden");
      overlayCard.classList.remove("result-mode");
      overlayKicker.textContent = "WELCOME TO THE SKY";
      overlayTitle.innerHTML = "Ready,<br>little bird?";
      overlayText.textContent = "Find your wings and slip through the gaps.";
      startButton.innerHTML = "LET'S FLY <span>↗</span>";
    } else if (mode === "over") {
      overlayCard.classList.add("result-mode");
      overlayKicker.textContent = "FLIGHT COMPLETE";
      overlayTitle.innerHTML = score > 0 ? `YOU SCORED<br><span style="color:var(--yellow)">${score}</span>` : "SO CLOSE!";
      overlayText.textContent = score > 0 ? "Not bad, sky traveller. Fancy another go?" : "The pipes won this round. Give it another shot.";
      startButton.innerHTML = "TRY AGAIN <span>↗</span>";
    }
  }

  function ensureAudioContext() {
    if (!audioContext) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      audioContext = new AudioCtor();
    }
    if (soundEnabled && audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  }

  function getAudio() {
    if (!soundEnabled) return null;
    return ensureAudioContext();
  }

  function clearResultRevealTimer() {
    if (resultRevealTimer !== null) window.clearTimeout(resultRevealTimer);
    resultRevealTimer = null;
  }

  function tone(frequency, duration, type = "sine", volume = .06, slide = 0) {
    const audio = getAudio();
    if (!audio) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(35, frequency + slide), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(now);
    osc.stop(now + duration + .01);
  }

  function playTonePack(pack) {
    switch (pack) {
      case "vine":
        tone(115, .24, "sine", .22, -70);
        tone(58, .20, "triangle", .14, -18);
        break;
      case "bruh":
        tone(95, .42, "sawtooth", .12, -48);
        break;
      case "bonk":
        tone(520, .09, "triangle", .12, -300);
        tone(180, .16, "sine", .08, -80);
        break;
      case "goofy":
        tone(620, .10, "sine", .09, 350);
        window.setTimeout(() => tone(980, .16, "sine", .07, -500), 75);
        break;
      case "airhorn":
        tone(440, .32, "sawtooth", .07, 15);
        tone(554, .32, "sawtooth", .06, 15);
        break;
      case "sad":
        tone(330, .24, "triangle", .12, -80);
        window.setTimeout(() => tone(260, .34, "triangle", .10, -100), 180);
        break;
      default:
        tone(390 + Math.random() * 250, .10, "triangle", .09, 170);
    }
  }

  function playUploadedSound(player, buffer) {
    if (!soundEnabled) return;

    // Decoded buffers are more reliable for collision events than restarting an HTMLAudioElement.
    const audio = getAudio();
    if (audio && audio.state === "running" && buffer) {
      try {
        const source = audio.createBufferSource();
        const gain = audio.createGain();
        source.buffer = buffer;
        gain.gain.value = 0.9;
        source.connect(gain);
        gain.connect(audio.destination);
        activeUploadedSources.add(source);
        source.addEventListener("ended", () => activeUploadedSources.delete(source), { once: true });
        source.start(0);
        return;
      } catch (error) {
        console.warn("Decoded uploaded sound could not play; trying media fallback.", error);
      }
    }

    if (!player) {
      console.warn("No uploaded audio player is available for this sound.");
      return;
    }
    try {
      // Use a fresh media element so a previous play/pause or ended state cannot block the hit.
      const playbackPlayer = player.cloneNode(true);
      playbackPlayer.volume = 0.95;
      playbackPlayer.muted = false;
      playbackPlayer.currentTime = 0;
      const playback = playbackPlayer.play();
      if (playback && typeof playback.catch === "function") {
        playback.catch(error => console.warn("Uploaded sound playback was blocked.", error));
      }
      playbackPlayer.addEventListener("ended", () => {
        playbackPlayer.removeAttribute("src");
        playbackPlayer.load();
      }, { once: true });
    } catch (error) {
      console.warn("Uploaded sound playback failed.", error);
    }
  }

  function stopUploadedSounds() {
    for (const source of activeUploadedSources) {
      try { source.stop(); } catch { /* A source may already have ended. */ }
    }
    activeUploadedSources.clear();
    for (const player of [flapAudio, hitAudio]) {
      if (!player) continue;
      player.pause();
      player.currentTime = 0;
    }
  }

  function flapSound() {
    if (!soundEnabled) return;
    const now = performance.now();
    if (now - lastFlapTime < 85) return;
    lastFlapTime = now;

    if (selectedFlapPack === "uploaded") {
      playUploadedSound(flapAudio, flapAudioBuffer);
      return;
    }

    const pack = selectedFlapPack === "random"
      ? ["vine", "bruh", "bonk", "goofy", "airhorn"][Math.floor(Math.random() * 5)]
      : selectedFlapPack;
    playTonePack(pack);
  }

  function hitSound() {
    if (!soundEnabled || selectedHitPack === "none") return;

    if (selectedHitPack === "uploaded") {
      playUploadedSound(hitAudio, hitAudioBuffer);
      return;
    }

    if (selectedHitPack === "selected") {
      if (selectedFlapPack === "uploaded") playUploadedSound(flapAudio, flapAudioBuffer);
      else playTonePack(selectedFlapPack === "random" ? "vine" : selectedFlapPack);
      return;
    }

    const pack = selectedHitPack === "random"
      ? ["vine", "bruh", "bonk", "sad", "goofy"][Math.floor(Math.random() * 5)]
      : selectedHitPack;
    playTonePack(pack);
  }

  function scoreSound() {
    if (!soundEnabled) return;
    tone(660, .09, "sine", .055, 170);
    window.setTimeout(() => tone(880, .12, "sine", .045, 120), 65);
  }

  function updateSoundButton() {
    soundIcon.innerHTML = soundEnabled
      ? '<path d="M4 10v4h3l5 4V6l-5 4H4Z"/><path d="M16 9a5 5 0 0 1 0 6M18.5 6.5a9 9 0 0 1 0 11"/>'
      : '<path d="M4 10v4h3l5 4V6l-5 4H4Z"/><path d="m17 9 5 6m0-6-5 6"/>';
    soundButton.setAttribute("aria-label", soundEnabled ? "Turn sound off" : "Turn sound on");
  }

  function resetGame() {
    score = 0;
    elapsed = 0;
    pipeTimer = .9;
    shake = 0;
    pipes = [];
    particles = [];
    bird = { x: 145, y: 330, vy: 0, rotation: 0, wing: 0 };
    updateHud();
  }

  function startGame() {
    clearResultRevealTimer();
    getAudio();
    stageWrap.classList.remove("show-loss-image");
    lossImageBackdrop.classList.add("hidden");
    lossImageBackdrop.removeAttribute("src");
    resetGame();
    state = "playing";
    overlay.classList.add("hidden");
    pauseNote.classList.remove("visible");
    flap();
  }

  function flap() {
    if (state !== "playing") return;
    bird.vy = FLAP_VELOCITY;
    flapSound();
    for (let i = 0; i < 4; i++) {
      particles.push({ x: bird.x - 12, y: bird.y + 8, vx: -35 - Math.random() * 65, vy: 30 + Math.random() * 60, life: .28, maxLife: .28, size: 2 + Math.random() * 3, color: "#fff4cf" });
    }
  }

  function pauseGame() {
    if (state !== "playing") return;
    state = "paused";
    pauseNote.classList.add("visible");
  }

  function resumeGame() {
    if (state !== "paused") return;
    state = "playing";
    pauseNote.classList.remove("visible");
    flap();
  }

  function gameOver() {
    if (state !== "playing") return;
    state = "over";
    shake = 10;
    hitSound();
    if (score > best) {
      best = score;
      saveBest();
    }
    updateHud();
    clearResultRevealTimer();

    if (lossImageUrl) {
      // Show the uploaded image by itself first. The result card appears after 8 seconds.
      lossImageBackdrop.src = lossImageUrl;
      lossImageBackdrop.style.opacity = String(gameOverOpacity / 100);
      lossImageBackdrop.classList.remove("hidden");
      stageWrap.classList.add("show-loss-image");
      overlay.classList.add("hidden");
      resultRevealTimer = window.setTimeout(() => {
        resultRevealTimer = null;
        if (state !== "over") return;
        lossImageBackdrop.classList.add("hidden");
        lossImageBackdrop.removeAttribute("src");
        stageWrap.classList.remove("show-loss-image");
        setOverlay("over");
      }, 8000);
    } else {
      stageWrap.classList.remove("show-loss-image");
      lossImageBackdrop.classList.add("hidden");
      lossImageBackdrop.removeAttribute("src");
      setOverlay("over");
    }
  }

  function makePipe() {
    const minTop = 110;
    const maxTop = FLOOR - PIPE_GAP - 105;
    const topHeight = minTop + Math.random() * (maxTop - minTop);
    pipes.push({ x: W + 8, top: topHeight, scored: false, wobble: Math.random() * Math.PI * 2 });
  }

  function addBurst(x, y, color) {
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 45 + Math.random() * 145;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: .48, maxLife: .48, size: 2 + Math.random() * 3, color });
    }
  }

  function update(dt) {
    elapsed += dt;
    groundOffset = (groundOffset + PIPE_SPEED * dt) % 48;
    if (state === "ready") {
      bird.y = 330 + Math.sin(elapsed * 2.2) * 9;
      bird.wing = Math.sin(elapsed * 9) * .35;
      return;
    }
    if (state !== "playing") return;

    bird.vy += GRAVITY * dt;
    bird.y += bird.vy * dt;
    bird.rotation = Math.min(.95, Math.max(-.55, bird.vy / 650));
    bird.wing = Math.sin(elapsed * 24) * .55;

    pipeTimer -= dt;
    if (pipeTimer <= 0) {
      makePipe();
      pipeTimer = 1.55;
    }

    for (const pipe of pipes) {
      pipe.x -= PIPE_SPEED * dt;
      if (!pipe.scored && pipe.x + PIPE_WIDTH < bird.x - 15) {
        pipe.scored = true;
        score++;
        updateHud();
        scoreSound();
        addBurst(bird.x + 10, bird.y, "#fff0ad");
      }
      if (collidesWithPipe(pipe)) {
        gameOver();
        break;
      }
    }
    pipes = pipes.filter(pipe => pipe.x + PIPE_WIDTH + 8 > 0);

    const extent = avatarImage ? CHARACTER_RADIUS : 29;
    if (bird.y - extent < 0 || bird.y + extent > FLOOR) gameOver();

    for (const particle of particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 180 * dt;
      particle.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);
    if (shake > 0) shake = Math.max(0, shake - 32 * dt);
  }

  function collidesWithPipe(pipe) {
    const extent = avatarImage ? CHARACTER_RADIUS : 29;
    const birdLeft = bird.x - extent;
    const birdRight = bird.x + extent;
    const birdTop = bird.y - extent;
    const birdBottom = bird.y + extent;
    const overlapsX = birdRight > pipe.x && birdLeft < pipe.x + PIPE_WIDTH;
    if (!overlapsX) return false;
    return birdTop < pipe.top || birdBottom > pipe.top + PIPE_GAP;
  }

  function roundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, "#8bd8d1");
    gradient.addColorStop(.58, "#b8ead8");
    gradient.addColorStop(1, "#f5e4b7");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    // Soft sun and distant cloud bands.
    ctx.fillStyle = "rgba(255, 244, 207, .73)";
    ctx.beginPath(); ctx.arc(354, 145, 48, 0, Math.PI * 2); ctx.fill();
    drawCloud(78 - (elapsed * 7 % 560), 150, .85, .53);
    drawCloud(420 - (elapsed * 4 % 620), 250, .62, .38);
    drawCloud(255 - (elapsed * 5 % 680), 85, .48, .28);

    // Layered hills.
    ctx.fillStyle = "#87cdbb";
    ctx.beginPath(); ctx.moveTo(0, 480);
    for (let x = 0; x <= W; x += 30) ctx.lineTo(x, 455 + Math.sin((x + elapsed * 10) / 80) * 18 + Math.cos(x / 44) * 6);
    ctx.lineTo(W, FLOOR); ctx.lineTo(0, FLOOR); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#6fbaa5";
    ctx.beginPath(); ctx.moveTo(0, 535);
    for (let x = 0; x <= W; x += 28) ctx.lineTo(x, 510 + Math.sin((x + elapsed * 17) / 72) * 13 + Math.cos(x / 52) * 5);
    ctx.lineTo(W, FLOOR); ctx.lineTo(0, FLOOR); ctx.closePath(); ctx.fill();
  }

  function drawCloud(x, y, scale, alpha) {
    if (x < -110) x += 690;
    if (x > W + 80) x -= 690;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#fff9e9";
    ctx.beginPath();
    ctx.arc(0, 8, 19, 0, Math.PI * 2);
    ctx.arc(20, 0, 25, 0, Math.PI * 2);
    ctx.arc(45, 9, 18, 0, Math.PI * 2);
    ctx.roundRect(-7, 8, 61, 18, 10);
    ctx.fill();
    ctx.restore();
  }

  function drawPipe(pipe) {
    const x = pipe.x;
    const topEnd = pipe.top;
    const bottomStart = pipe.top + PIPE_GAP;
    const bottomEnd = FLOOR;
    const grad = ctx.createLinearGradient(x, 0, x + PIPE_WIDTH, 0);
    grad.addColorStop(0, "#337f78");
    grad.addColorStop(.18, "#55aa99");
    grad.addColorStop(.52, "#70c1a9");
    grad.addColorStop(1, "#367d76");

    // Top gate.
    ctx.fillStyle = grad;
    roundedRect(x + 5, -12, PIPE_WIDTH - 10, topEnd - 4, 10); ctx.fill();
    roundedRect(x - 3, topEnd - 31, PIPE_WIDTH + 6, 31, 8); ctx.fill();
    ctx.fillStyle = "rgba(224,255,224,.26)";
    roundedRect(x + 7, 0, 7, Math.max(0, topEnd - 36), 4); ctx.fill();
    roundedRect(x + 5, topEnd - 25, 5, 18, 3); ctx.fill();

    // Bottom gate.
    ctx.fillStyle = grad;
    roundedRect(x + 5, bottomStart + 4, PIPE_WIDTH - 10, bottomEnd - bottomStart, 10); ctx.fill();
    roundedRect(x - 3, bottomStart, PIPE_WIDTH + 6, 31, 8); ctx.fill();
    ctx.fillStyle = "rgba(224,255,224,.26)";
    roundedRect(x + 7, bottomStart + 34, 7, bottomEnd - bottomStart - 34, 4); ctx.fill();
    roundedRect(x + 5, bottomStart + 7, 5, 18, 3); ctx.fill();

    // Tiny leaf badge on the cap.
    ctx.save();
    ctx.translate(x + PIPE_WIDTH / 2, topEnd - 16);
    ctx.fillStyle = "#ffd56f";
    ctx.beginPath(); ctx.ellipse(0, 0, 7, 3, -.55, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawGround() {
    ctx.fillStyle = "#f3db9d";
    ctx.fillRect(0, FLOOR, W, H - FLOOR);
    ctx.fillStyle = "#5b9d83";
    ctx.fillRect(0, FLOOR, W, 9);
    ctx.fillStyle = "rgba(255,255,255,.23)";
    for (let x = -groundOffset; x < W + 48; x += 48) {
      ctx.fillRect(x, FLOOR + 28, 20, 3);
      ctx.fillRect(x + 17, FLOOR + 46, 12, 3);
    }
  }

  function drawBird() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rotation || 0);

    if (avatarImage) {
      // Use the uploaded cutout exactly as supplied. Preserve its aspect ratio and alpha channel.
      // No circular mask, cropping, border, or automatic background removal is applied.
      const naturalWidth = avatarImage.naturalWidth || avatarImage.width || 1;
      const naturalHeight = avatarImage.naturalHeight || avatarImage.height || 1;
      const maxWidth = 88;
      const maxHeight = 88;
      const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
      const drawWidth = naturalWidth * scale;
      const drawHeight = naturalHeight * scale;
      ctx.save();
      ctx.shadowColor = "rgba(16, 37, 52, .24)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 4;
      ctx.drawImage(avatarImage, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      ctx.restore();
      ctx.restore();
      return;
    }

    // Fallback only: use a bird emoji instead of the old circular cartoon body.
    // Once an admin uploads a friend cutout, that image replaces this placeholder.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '68px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.fillText("🐤", 0, 1);
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
    drawBackground();
    for (const pipe of pipes) drawPipe(pipe);
    drawParticles();
    if (bird) drawBird();
    drawGround();
    if (state === "playing") {
      ctx.textAlign = "center";
      ctx.font = "800 26px 'DM Mono', monospace";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(26,55,67,.16)";
      ctx.strokeText(String(score), W / 2, 70);
      ctx.fillStyle = "#fff9e9";
      ctx.fillText(String(score), W / 2, 70);
    }
    ctx.restore();
  }

  function frame(timestamp) {
    const dt = Math.min((timestamp - (lastTime || timestamp)) / 1000, .035);
    lastTime = timestamp;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function handleAction() {
    if (state === "ready" || (state === "over" && resultRevealTimer === null)) startGame();
    else if (state === "playing") flap();
  }

  startButton.addEventListener("click", startGame);
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handleAction();
  });
  document.addEventListener("keydown", (event) => {
    if (event.code === "Space" || event.code === "ArrowUp") {
      event.preventDefault();
      if (event.repeat) return;
      if (state === "paused") resumeGame();
      else handleAction();
    } else if (event.code === "Escape" || event.code === "KeyP") {
      if (state === "playing") pauseGame();
      else if (state === "paused") resumeGame();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") pauseGame();
  });

  soundButton.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    try { localStorage.setItem("skyhop-sound", soundEnabled ? "on" : "off"); } catch { /* Ignore storage errors. */ }
    updateSoundButton();
    if (!soundEnabled) {
      stopUploadedSounds();
      if (audioContext && audioContext.state === "running") audioContext.suspend().catch(() => {});
    } else {
      getAudio();
      tone(740, .08, "sine", .04, 100);
    }
  });

  async function loadDefaultSound(kind, asset) {
    if (!asset?.url) return;
    const player = new Audio(asset.url);
    player.preload = "auto";
    if (kind === "flap") {
      flapAudio = player;
      selectedFlapPack = "uploaded";
    } else {
      hitAudio = player;
      selectedHitPack = "uploaded";
    }
    try {
      const response = await fetch(asset.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not fetch default ${kind} sound.`);
      const bytes = await response.arrayBuffer();
      const audio = ensureAudioContext();
      if (!audio) return;
      const buffer = await audio.decodeAudioData(bytes.slice(0));
      if (kind === "flap" && flapAudio === player) flapAudioBuffer = buffer;
      if (kind === "hit" && hitAudio === player) hitAudioBuffer = buffer;
    } catch (error) {
      console.warn(`Could not decode creator ${kind} sound; audio-element playback will be used.`, error);
    }
  }

  async function loadCreatorSettings() {
    try {
      const response = await fetch("/api/public/settings", { cache: "no-store" });
      if (!response.ok) throw new Error("The creator settings could not be loaded.");
      const data = await response.json();
      defaultAssets = data.assets || {};
      gameOverOpacity = Number.isFinite(Number(data.game_over_opacity))
        ? Number(data.game_over_opacity)
        : 65;
      lossImageBackdrop.style.opacity = String(gameOverOpacity / 100);

      const character = defaultAssets.character;
      if (character?.url) {
        const image = new Image();
        image.onload = () => {
          avatarImage = image;
          customPhotoPreview.src = character.url;
          customPhotoPreview.classList.remove("hidden");
          previewBird.classList.add("hidden");
          currentBirdLabel.textContent = "YOUR FRIEND";
        };
        image.onerror = () => console.warn("Creator character image could not be loaded.");
        image.src = character.url;
      } else {
        currentBirdLabel.textContent = "PIP";
      }

      if (defaultAssets.game_over_image?.url) {
        lossImageUrl = defaultAssets.game_over_image.url;
      }
      await Promise.all([
        loadDefaultSound("flap", defaultAssets.flap_sound),
        loadDefaultSound("hit", defaultAssets.collision_sound)
      ]);
    } catch (error) {
      console.warn("Sky Hop could not load its creator defaults.", error);
    }
  }

  // Initialize the canvas and the first idle animation.
  resetGame();
  state = "ready";
  updateHud();
  setOverlay("ready");
  updateSoundButton();
  loadCreatorSettings();
  requestAnimationFrame(frame);
})();
