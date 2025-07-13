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

function animateMeshClear() {
  const total = meshItems.length;
  if (total === 0) return;
  let idx = 0;
  const minDelay = 6; // ms
  const ticks = Math.ceil(300 / minDelay);
  const cellsPerTick = Math.ceil(total / ticks);

  function clearNext() {
    let cleared = 0;
    while (idx < total && cleared < cellsPerTick) {
      meshItems[idx].style.background = "rgba(168, 216, 234, 0.3)";
      meshItems[idx].style.borderColor = "rgba(168, 216, 234, 0.6)";
      idx++;
      cleared++;
    }
    if (idx < total) {
      setTimeout(clearNext, minDelay);
    }
  }
  clearNext();
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
  
  timerWorker.onmessage = (event) => {
    const { type, ...data } = event.data;
    
    switch (type) {
      case 'timerUpdate':
        updateTimerDisplay(data.formattedTime);
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
        break;
      case 'timerComplete':
        updateTimerDisplay(data.formattedTime);
        break;
      case 'timerReset':
        updateTimerDisplay(data.formattedTime);
        lastPercent = 0;
        if (meshWorker) {
          meshWorker.postMessage({ type: 'clearMesh' });
        }
        animateMeshClear();
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
        break;
      case 'sessionSwitch':
        // Only increment session number when switching from work to break
        if (!data.isBreak) {
          sessionNumber++;
        }
        setBreakMode(data.isBreak);
        updateTimerDisplay(data.formattedTime);
        updateSessionLabel();
        animateMeshClear();
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

  // Mesh grid population
  const meshGrid = document.getElementById("mesh-grid");
  if (meshGrid) {
    function fitMesh() {
      if (!meshGrid) return;
      
      const meshSection = meshGrid.parentElement;
      let availableWidth = meshSection ? meshSection.clientWidth : window.innerWidth;
      let availableHeight = meshSection ? meshSection.clientHeight : window.innerHeight;
      if (availableWidth <= 0 || availableHeight <= 0) return;
      
      const cellSize = 8; // Cell size set to 8px
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
