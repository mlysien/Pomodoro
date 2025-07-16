import { invoke } from '@tauri-apps/api/core';

let playBtn: HTMLElement | null;
let stopBtn: HTMLElement | null;
let playIcon: HTMLElement | null;

let meshItems: HTMLElement[] = [];
let totalCells = 0;

// Web Workers
let timerWorker: Worker | null = null;
let meshWorker: Worker | null = null;

let isPausedLocal = true;
let sessionNumber = 1;

let tickAudio: HTMLAudioElement | null = null;
let breakAudio: HTMLAudioElement | null = null;
let longBreakAudio: HTMLAudioElement | null = null;
let isSoundMuted = false;

function updateTimerDisplay(formattedTime: string) {
  const timerLabel = document.getElementById("timer-label");
  if (timerLabel) {
    timerLabel.innerHTML = `
      <span id="timer-value" class="timer-value">${formattedTime}</span>
      <span id="session-label" class="session-label">#${sessionNumber.toString().padStart(2, '0')}</span>
    `;
  }
}

function updatePlayPauseIcon(isPaused: boolean) {
  if (!playIcon) return;
  playIcon.className = isPaused ? "fa-solid fa-play" : "fa-solid fa-pause";
}

function updateMeshCell(index: number, color: string) {
  if (meshItems[index]) {
    meshItems[index].style.background = color;
    meshItems[index].style.borderColor = color;
  }
}

function clearAllMeshCells() {
  meshItems.forEach(item => {
    item.style.background = "rgba(168, 216, 234, 0.3)";
    item.style.borderColor = "rgba(168, 216, 234, 0.6)";
  });
}

function setBreakMode(isBreak: boolean) {
  if (isBreak) {
    document.body.classList.add('break-mode');
  } else {
    document.body.classList.remove('break-mode');
  }
}

function updateSessionLabel() {
  updateTimerDisplay(document.getElementById("timer-value")?.textContent || "00:00");
}

function updateSessionTypeLabel(timeLeft: number, isBreak: boolean, sessionCount?: number, isLongBreak?: boolean) {
  const label = document.getElementById("session-type-label");
  if (!label) return;
  let text = "";
  if (!isBreak) {
    text = "Focus Session";
  } else if (isLongBreak) {
    text = "Long Break";
  } else {
    text = "Short Break";
  }
  label.textContent = text.toUpperCase();
}

// Throttle function for resize events
function throttle(func: Function, limit: number) {
  let inThrottle: boolean;
  return function(this: any) {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
}

// Initialize Web Workers
function initializeWorkers() {
  // Timer Worker
  timerWorker = new Worker(new URL('./timer-worker.ts', import.meta.url), { type: 'module' });
  let lastUpdateTime = 0;
  let lastPercent = 0;
  
  tickAudio = document.getElementById('tick-audio') as HTMLAudioElement;
  breakAudio = document.getElementById('break-audio') as HTMLAudioElement;
  longBreakAudio = document.getElementById('long-break-audio') as HTMLAudioElement;

  timerWorker.onmessage = (event) => {
    const { type, ...data } = event.data;
    
    switch (type) {
      case 'timerUpdate':
        updateTimerDisplay(data.formattedTime);
        // Play tick sound every full second
        if (tickAudio && data.timeLeft !== undefined) {
          const currentSecond = Math.ceil(data.timeLeft);
          if (typeof (window as any).lastTickSecond === 'undefined') {
            (window as any).lastTickSecond = currentSecond;
          }
          if ((window as any).lastTickSecond !== currentSecond) {
            (window as any).lastTickSecond = currentSecond;
            tickAudio.currentTime = 0;
            tickAudio.play();
          }
        }
        // Throttle mesh updates to prevent too frequent updates
        const currentTime = Date.now();
        if (currentTime - lastUpdateTime > 100 || Math.abs(data.percent - lastPercent) > 0.005) {
          lastUpdateTime = currentTime;
          lastPercent = data.percent;
          // Send percent and isBreak to mesh worker
          if (meshWorker) {
            meshWorker.postMessage({
              type: 'updateMesh',
              data: { percent: data.percent, isBreak: data.isBreak }
            });
          }
        }
        // Call updateSessionTypeLabel on timerUpdate
        updateSessionTypeLabel(data.timeLeft, data.isBreak, data.sessionCount, data.isLongBreak);
        break;
      case 'timerComplete':
        updateTimerDisplay(data.formattedTime);
        // Play break sound at the end of a short break
        if (breakAudio && data.isBreak && data.timeLeft === 0) {
          // Short break is 5 minutes (300 seconds)
          if (data.formattedTime === '00:00' && data.percent === 1.0) {
            breakAudio.currentTime = 0;
            breakAudio.play();
          }
        }
        // Play break sound at the end of a long break
        if (breakAudio && data.isBreak && data.timeLeft === 0) {
          // Long break is 20 minutes (1200 seconds)
          if (data.formattedTime === '00:00' && data.percent === 1.0 && (window as any).lastBreakWasLong) {
            breakAudio.currentTime = 0;
            breakAudio.play();
            (window as any).lastBreakWasLong = false;
          }
        }
        // Call updateSessionTypeLabel on timerComplete
        updateSessionTypeLabel(data.timeLeft, data.isBreak, data.sessionCount, data.isLongBreak);
        break;
      case 'timerReset':
        updateTimerDisplay(data.formattedTime);
        lastPercent = 0;
        if (meshWorker) {
          meshWorker.postMessage({ type: 'clearMesh' });
        }
        // Call updateSessionTypeLabel on timerReset
        updateSessionTypeLabel(data.timeLeft, data.isBreak, data.sessionCount, data.isLongBreak);
        break;
      case 'timerState':
        updatePlayPauseIcon(data.isPaused);
        isPausedLocal = data.isPaused;
        break;
      case 'currentState':
        updateTimerDisplay(data.formattedTime);
        updatePlayPauseIcon(data.isPaused);
        // Handle play button toggle
        if (data.isPaused) {
          startTimer();
        } else {
          pauseTimer();
        }
        // Call updateSessionTypeLabel on currentState
        updateSessionTypeLabel(data.timeLeft, data.isBreak, data.sessionCount, data.isLongBreak);
        break;
      case 'sessionSwitch':
        // Only increment session number when switching from work to break
        if (!data.isBreak) {
          sessionNumber++;
        }
        setBreakMode(data.isBreak);
        updateTimerDisplay(data.formattedTime);
        updateSessionLabel();
        // Play break sound only for short breaks at the start
        if (breakAudio && data.isBreak) {
          // Short break is when timeLeft equals 5*60 (300 seconds)
          if (data.timeLeft === 300) {
            breakAudio.currentTime = 0;
            breakAudio.play();
            (window as any).lastBreakWasLong = false;
          }
        }
        // Play long break sound at the start of a long break
        if (longBreakAudio && data.isBreak) {
          // Long break is when timeLeft equals 20*60 (1200 seconds)
          if (data.timeLeft === 1200) {
            longBreakAudio.currentTime = 0;
            longBreakAudio.play();
            (window as any).lastBreakWasLong = true;
          }
        }
        // Reset timing variables to ensure mesh updates start properly
        lastUpdateTime = 0;
        lastPercent = 0;
        // Clear mesh and start new session
        if (meshWorker) {
          meshWorker.postMessage({ type: 'clearMesh' });
          meshWorker.postMessage({
            type: 'updateMesh',
            data: { percent: 0, isBreak: data.isBreak }
          });
        }
        // Call updateSessionTypeLabel on sessionSwitch
        updateSessionTypeLabel(data.timeLeft, data.isBreak, data.sessionCount, data.isLongBreak);
        break;
    }
  };

  // Mesh Worker
  meshWorker = new Worker(new URL('./mesh-worker.ts', import.meta.url), { type: 'module' });
  meshWorker.onmessage = (event) => {
    const { type, ...data } = event.data;
    
    switch (type) {
      case 'meshUpdates':
        // Apply mesh updates
        data.updates.forEach((update: {index: number, color: string}) => {
          updateMeshCell(update.index, update.color);
        });
        break;
      case 'meshClear':
        clearAllMeshCells();
        break;
      case 'meshSizeSet':
        break;
      case 'meshReady':
        totalCells = data.totalCells;
        break;
    }
  };
}

function startTimer() {
  if (timerWorker) {
    timerWorker.postMessage({ type: 'start' });
  }
}

function pauseTimer() {
  if (timerWorker) {
    timerWorker.postMessage({ type: 'pause' });
  }
}

function stopTimer() {
  if (timerWorker) {
    timerWorker.postMessage({ type: 'stop' });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  playBtn = document.getElementById("play-btn");
  stopBtn = document.getElementById("stop-btn");
  playIcon = (playBtn?.querySelector("i") as HTMLElement) || null;

  // Initialize workers
  initializeWorkers();

  playBtn?.addEventListener("click", () => {
    if (timerWorker) {
      if (isPausedLocal) {
        timerWorker.postMessage({ type: 'start' });
        isPausedLocal = false;
        updatePlayPauseIcon(false);
      } else {
        timerWorker.postMessage({ type: 'pause' });
        isPausedLocal = true;
        updatePlayPauseIcon(true);
      }
    }
  });
  
  stopBtn?.addEventListener("click", () => {
    stopTimer();
  });

  const closeBtn = document.getElementById("close-btn");
  closeBtn?.addEventListener("click", () => {
    try {
      invoke('exit_app');
    } catch (error) {
      console.error("Failed to close window:", error);
    }
  });

  const skipBtn = document.getElementById("skip-btn");
  skipBtn?.addEventListener("click", () => {
    if (timerWorker) {
      timerWorker.postMessage({ type: 'skip' });
    }
  });

  const soundToggleBtn = document.getElementById("sound-toggle-btn") as HTMLButtonElement;
  const soundToggleIcon = soundToggleBtn?.querySelector("i");
  function updateSoundIcon() {
    if (soundToggleIcon) {
      soundToggleIcon.className = isSoundMuted ? "fa-solid fa-volume-mute" : "fa-solid fa-volume-up";
    }
  }
  function setAllAudioMuted(muted: boolean) {
    if (tickAudio) tickAudio.muted = muted;
    if (breakAudio) breakAudio.muted = muted;
    if (longBreakAudio) longBreakAudio.muted = muted;
  }
  soundToggleBtn?.addEventListener("click", () => {
    isSoundMuted = !isSoundMuted;
    setAllAudioMuted(isSoundMuted);
    updateSoundIcon();
  });
  // Set initial state
  setAllAudioMuted(isSoundMuted);
  updateSoundIcon();

  // Mesh grid population
  const meshGrid = document.getElementById("mesh-grid");
  if (meshGrid) {
    function fitMesh() {
      if (!meshGrid) return;
      
      const meshSection = meshGrid.parentElement;
      let availableWidth = meshSection ? meshSection.clientWidth : window.innerWidth;
      let availableHeight = meshSection ? meshSection.clientHeight : window.innerHeight;
      if (availableWidth <= 0 || availableHeight <= 0) return;
      
      const cellSize = 16; // Cell size set to 16px (was 8px)
      const cols = Math.floor(availableWidth / cellSize);
      const rows = Math.floor(availableHeight / cellSize);
      totalCells = cols * rows;
      
      meshGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      meshGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
      meshGrid.innerHTML = "";
      
      // Create cells efficiently
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < totalCells; i++) {
        const div = document.createElement("div");
        div.className = "mesh-item";
        fragment.appendChild(div);
      }
      meshGrid.appendChild(fragment);
      
      // Cache mesh items
      meshItems = Array.from(meshGrid.querySelectorAll<HTMLElement>(".mesh-item"));
      
      // Update mesh worker with new size
      if (meshWorker) {
        meshWorker.postMessage({
          type: 'setMeshSize',
          data: { totalCells: totalCells }
        });
      }
    }
    fitMesh();
    window.addEventListener("resize", throttle(() => { if (meshGrid) fitMesh(); }, 200));
  }

  updateSessionLabel();
  
  // Add keyboard shortcuts
  document.addEventListener('keydown', (event) => {
    switch (event.key.toLowerCase()) {
      case 'escape':
        invoke('exit_app');
        break;
      case ' ':
        event.preventDefault(); // Prevent page scroll
        if (playBtn) {
          playBtn.click();
        }
        break;
      case 'r':
        if (stopBtn) {
          stopBtn.click();
        }
        break;
      case 's':
        if (skipBtn) {
          skipBtn.click();
        }
        break;
    }
  });
});
