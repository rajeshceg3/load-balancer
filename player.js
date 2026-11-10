// Timeline player distilled from knots-made-easy.pages.dev.
// Simulation-agnostic: you supply steps and an onFrame hook; this class owns
// the clock, scrubbing, speeds, loop, keyboard access and aria state.
//
// steps: [{ t: secondsWhenStepStarts, label: "Sentence shown while it plays" }, ...]
// The last step's label is the finished state; duration is total seconds.
//
// onFrame(timeSeconds, stepIndex): render your scene for this exact time.
// Called every animation frame while playing and after every scrub/jump.
// Because time is scrub-able, your scene must be a pure function of time
// (simulate up to t, or interpolate keyframes) — never accumulate state
// only during forward playback.

export class TimelinePlayer {
  constructor({ steps, duration, onFrame, root = document }) {
    this.steps = steps;
    this.duration = duration;
    this.onFrame = onFrame;
    this.time = 0;
    this.playing = false;
    this.speed = 1;
    this.loop = false;
    this.raf = null;
    this.lastTs = null;

    this.$ = (id) => root.getElementById(id);
    this.playBtn = this.$("playBtn");
    this.playGlyph = this.playBtn.querySelector(".play-glyph");
    this.playedFill = this.$("playedFill");
    this.scrub = this.$("scrub");
    this.clock = this.$("clock");
    this.stepNum = this.$("stepNum");
    this.stepLabel = this.$("stepLabel");
    this.ticks = this.$("ticks");

    // One tick button per step, positioned along the rail.
    this.tickButtons = steps.map((s, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.style.left = `${(s.t / duration) * 100}%`;
      b.setAttribute("aria-label", `Step ${i + 1}: ${s.label}`);
      b.addEventListener("click", () => this.jumpTo(s.t));
      li.appendChild(b);
      this.ticks.appendChild(li);
      return b;
    });

    // The article's step list jumps the same timeline.
    const list = root.getElementById("stepList");
    if (list) {
      steps.forEach((s, i) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = `<span class="n">${i + 1}</span><span></span>`;
        b.lastElementChild.textContent = s.label;
        b.addEventListener("click", () => this.jumpTo(s.t));
        li.appendChild(b);
        list.appendChild(li);
      });
    }

    this.playBtn.addEventListener("click", () => (this.playing ? this.pause() : this.play()));
    this.scrub.addEventListener("input", () => {
      this.pause();
      this.jumpTo((this.scrub.value / 1000) * duration);
    });
    this.$("speeds").addEventListener("change", (e) => {
      this.speed = parseFloat(e.target.value);
    });
    const loopBtn = this.$("loopBtn");
    loopBtn.addEventListener("click", () => {
      this.loop = !this.loop;
      loopBtn.setAttribute("aria-pressed", String(this.loop));
    });
    this.$("resetBtn").addEventListener("click", () => {
      this.jumpTo(0);
      if (this.onReset) this.onReset();
    });

    this.render();
  }

  get stepIndex() {
    let idx = 0;
    for (let i = 0; i < this.steps.length; i++) if (this.time >= this.steps[i].t) idx = i;
    return idx;
  }

  play() {
    this.playing = true;
    this.lastTs = null;
    this.playBtn.setAttribute("aria-label", "Pause");
    this.playGlyph.setAttribute("d", "M7 5h4v14H7zM13 5h4v14h-4z");
    const tick = (ts) => {
      if (!this.playing) return;
      if (this.lastTs != null) {
        this.time += ((ts - this.lastTs) / 1000) * this.speed;
        if (this.time >= this.duration) {
          if (this.loop) this.time = 0;
          else { this.time = this.duration; this.pause(); }
        }
        this.render();
      }
      this.lastTs = ts;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.playBtn.setAttribute("aria-label", "Play");
    this.playGlyph.setAttribute("d", "M8 5.5v13l11-6.5Z");
  }

  jumpTo(t) {
    this.time = Math.max(0, Math.min(this.duration, t));
    this.render();
  }

  render() {
    const idx = this.stepIndex;
    this.stepNum.textContent = `${idx + 1}/${this.steps.length}`;
    this.stepLabel.textContent = this.steps[idx].label;
    this.playedFill.style.width = `${(this.time / this.duration) * 100}%`;
    if (document.activeElement !== this.scrub) this.scrub.value = Math.round((this.time / this.duration) * 1000);
    this.clock.textContent = `${(Math.round(this.time * 10) / 10).toFixed(1)}s`;
    this.tickButtons.forEach((b, i) => {
      if (i === idx) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    });
    this.onFrame(this.time, idx);
  }
}

// Theme toggle with no-flash persistence (head script reads the same key).
export function wireThemeToggle(root = document) {
  const btn = root.querySelector(".theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) {}
  });
}

// Hide the poster once your renderer has drawn its first real frame.
export function revealScene(root = document) {
  const poster = root.querySelector(".poster");
  if (poster) poster.dataset.hidden = "true";
}
