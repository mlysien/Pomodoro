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
let isWorkSoundEnabled = true;
let isBreakSoundEnabled = true;

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

function updateSessionTypeLabel(isBreak: boolean, isLongBreak?: boolean) {
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
   
   // Debug audio elements
   console.log('Audio elements loaded:', {
     tickAudio: !!tickAudio,
     breakAudio: !!breakAudio,
     longBreakAudio: !!longBreakAudio
   });
   
   // Test audio loading
   if (breakAudio) {
     breakAudio.addEventListener('canplaythrough', () => {
       console.log('Break audio loaded successfully');
     });
     breakAudio.addEventListener('error', (e) => {
       console.error('Break audio failed to load:', e);
     });
   }

  timerWorker.onmessage = (event) => {
    const { type, ...data } = event.data;
    
    switch (type) {
      case 'timerUpdate':
        updateTimerDisplay(data.formattedTime);
                 // Play tick sound every full second (during work sessions when work sounds enabled, or during breaks when break sounds enabled)
         if (tickAudio && data.timeLeft !== undefined && 
             ((!data.isBreak && isWorkSoundEnabled) || (data.isBreak && isBreakSoundEnabled))) {
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
        updateSessionTypeLabel(data.isBreak, data.isLongBreak);
        break;
      case 'timerComplete':
        updateTimerDisplay(data.formattedTime);
        // Play break sound at the end of a short break
        if (breakAudio && data.isBreak && data.timeLeft === 0 && isBreakSoundEnabled) {
          // Short break is 5 minutes (300 seconds)
          if (data.formattedTime === '00:00' && data.percent === 1.0) {
            breakAudio.currentTime = 0;
            breakAudio.play();
          }
        }
        // Play break sound at the end of a long break
        if (breakAudio && data.isBreak && data.timeLeft === 0 && isBreakSoundEnabled) {
          // Long break is 20 minutes (1200 seconds)
          if (data.formattedTime === '00:00' && data.percent === 1.0 && (window as any).lastBreakWasLong) {
            breakAudio.currentTime = 0;
            breakAudio.play();
            (window as any).lastBreakWasLong = false;
          }
        }
        // Call updateSessionTypeLabel on timerComplete
        updateSessionTypeLabel(data.isBreak, data.isLongBreak);
        break;
      case 'timerReset':
        updateTimerDisplay(data.formattedTime);
        lastPercent = 0;
        if (meshWorker) {
          meshWorker.postMessage({ type: 'clearMesh' });
        }
        // Call updateSessionTypeLabel on timerReset
        updateSessionTypeLabel(data.isBreak, data.isLongBreak);
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
        updateSessionTypeLabel(data.isBreak, data.isLongBreak);
        break;
                                         case 'sessionSwitch':
         console.log('Session switch:', { 
           isBreak: data.isBreak, 
           isLongBreak: data.isLongBreak, 
           isBreakSoundEnabled, 
           breakAudio: !!breakAudio 
         });
         // Only increment session number when switching from work to break
         if (!data.isBreak) {
           sessionNumber++;
         }
         setBreakMode(data.isBreak);
         updateTimerDisplay(data.formattedTime);
         updateSessionLabel();
         // Play break sound at the start of breaks
         if (breakAudio && data.isBreak && isBreakSoundEnabled) {
           console.log('Break sound conditions met:', {
             breakAudio: !!breakAudio,
             isBreak: data.isBreak,
             isBreakSoundEnabled,
             isLongBreak: data.isLongBreak
           });
           
           // Play short break sound for short breaks
           if (!data.isLongBreak) {
             console.log('Playing short break sound');
             breakAudio.currentTime = 0;
             
             // Force audio to play with user interaction
             const playPromise = breakAudio.play();
             if (playPromise !== undefined) {
               playPromise
                 .then(() => {
                   console.log('Break sound played successfully');
                 })
                 .catch(e => {
                   console.error('Error playing break sound:', e);
                   // Try to play again after a short delay
                   setTimeout(() => {
                     breakAudio.currentTime = 0;
                     breakAudio.play().catch(e2 => console.error('Retry failed:', e2));
                   }, 100);
                 });
             }
             
             (window as any).lastBreakWasLong = false;
           }
         }
         // Play long break sound at the start of a long break
         if (longBreakAudio && data.isBreak && isBreakSoundEnabled) {
           // Play long break sound for long breaks
           if (data.isLongBreak) {
             console.log('Playing long break sound');
             longBreakAudio.currentTime = 0;
             longBreakAudio.play().catch(e => console.error('Error playing long break sound:', e));
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
         updateSessionTypeLabel(data.isBreak, data.isLongBreak);
         break;
       case 'durations':
         // Load current durations into settings form
         workDurationInput.value = data.workDuration.toString();
         breakDurationInput.value = data.breakDuration.toString();
         longBreakDurationInput.value = data.longBreakDuration.toString();
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

  const settingsBtn = document.getElementById("settings-btn");
  const settingsMenu = document.getElementById("settings-menu");
  const closeSettingsBtn = document.getElementById("close-settings-btn");
  const saveSettingsBtn = document.getElementById("save-settings-btn");
  const cancelSettingsBtn = document.getElementById("cancel-settings-btn");

  // Settings form elements
  const workDurationInput = document.getElementById("work-duration") as HTMLInputElement;
  const breakDurationInput = document.getElementById("break-duration") as HTMLInputElement;
  const longBreakDurationInput = document.getElementById("long-break-duration") as HTMLInputElement;
  const workSoundEnabledInput = document.getElementById("work-sound-enabled") as HTMLInputElement;
  const breakSoundEnabledInput = document.getElementById("break-sound-enabled") as HTMLInputElement;

  function showSettingsMenu() {
    if (settingsMenu) {
      // Get current settings from timer worker
      if (timerWorker) {
        timerWorker.postMessage({ type: 'getDurations' });
      }
      
      // Load current sound settings
      workSoundEnabledInput.checked = isWorkSoundEnabled;
      breakSoundEnabledInput.checked = isBreakSoundEnabled;
      
      settingsMenu.classList.add("active");
      document.body.style.overflow = "hidden";
    }
  }

  function hideSettingsMenu() {
    if (settingsMenu) {
      settingsMenu.classList.remove("active");
      document.body.style.overflow = "";
    }
  }

  function saveSettings() {
    const workDuration = parseInt(workDurationInput.value) * 60; // Convert to seconds
    const breakDuration = parseInt(breakDurationInput.value) * 60;
    const longBreakDuration = parseInt(longBreakDurationInput.value) * 60;
    const workSoundEnabled = workSoundEnabledInput.checked;
    const breakSoundEnabled = breakSoundEnabledInput.checked;

    // Update timer worker with new durations
    if (timerWorker) {
      timerWorker.postMessage({ 
        type: 'setDurations', 
        data: { 
          workDuration, 
          breakDuration, 
          longBreakDuration 
        } 
      });
    }

    // Update sound settings
    isWorkSoundEnabled = workSoundEnabled;
    isBreakSoundEnabled = breakSoundEnabled;

    hideSettingsMenu();
  }

  settingsBtn?.addEventListener("click", showSettingsMenu);
  closeSettingsBtn?.addEventListener("click", hideSettingsMenu);
  saveSettingsBtn?.addEventListener("click", saveSettings);
  cancelSettingsBtn?.addEventListener("click", hideSettingsMenu);

  // Close settings menu when clicking outside
  settingsMenu?.addEventListener("click", (event) => {
    if (event.target === settingsMenu) {
      hideSettingsMenu();
    }
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
      const hasAnySoundEnabled = isWorkSoundEnabled || isBreakSoundEnabled;
      soundToggleIcon.className = hasAnySoundEnabled ? "fa-solid fa-volume-up" : "fa-solid fa-volume-mute";
    }
  }
  
  soundToggleBtn?.addEventListener("click", () => {
    // Toggle both work and break sounds together
    isWorkSoundEnabled = !isWorkSoundEnabled;
    isBreakSoundEnabled = !isBreakSoundEnabled;
    updateSoundIcon();
  });
  
     // Set initial state
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

