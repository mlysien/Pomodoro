// Timer Worker - Handles countdown logic
let timerDuration = 25 * 60; // 25 minutes in seconds
let breakDuration = 5 * 60; // 5 minutes in seconds
let longBreakDuration = 15 * 60; // 15 minutes in seconds
let timeLeft = timerDuration;
let timer: number | null = null;
let isPaused = true;
let timerStartTimestamp = 0;
let timerStartTimeLeft = 0;
let isBreak = false;
let sessionCount = 0; // Track work sessions

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function startTimer() {
  if (timer) return; // already running

  timerStartTimestamp = Date.now();
  timerStartTimeLeft = timeLeft;

  timer = setInterval(() => {
    const elapsed = (Date.now() - timerStartTimestamp) / 1000;
    timeLeft = Math.max(0, timerStartTimeLeft - elapsed);

    if (timeLeft > 0) {
      self.postMessage({
        type: 'timerUpdate',
        timeLeft: timeLeft,
        formattedTime: formatTime(timeLeft),
        percent: (getCurrentSessionDuration() - timeLeft) / getCurrentSessionDuration(),
        isBreak: isBreak,
        sessionCount: sessionCount,
        isLongBreak: isCurrentLongBreak()
      });
    } else {
      pauseTimer();
      timeLeft = 0;
      self.postMessage({
        type: 'timerComplete',
        timeLeft: 0,
        formattedTime: formatTime(0),
        percent: 1.0,
        isBreak: isBreak,
        sessionCount: sessionCount,
        isLongBreak: isCurrentLongBreak()
      });
      // Automatically switch between work and break
      setTimeout(() => {
        isBreak = !isBreak;
        if (isBreak) {
          // Switching from work to break, increment session count
          sessionCount++;
          if (sessionCount > 4) {
            sessionCount = 1; // Reset after 4 sessions
          }
        }
        timeLeft = getCurrentSessionDuration();
        self.postMessage({
          type: 'sessionSwitch',
          isBreak: isBreak,
          timeLeft: timeLeft,
          formattedTime: formatTime(timeLeft),
          percent: 0,
          sessionCount: sessionCount,
          isLongBreak: isCurrentLongBreak()
        });
        startTimer();
      }, 1000);
    }
  }, 50); // Update 20 times per second for very smooth animation
  isPaused = false;
  self.postMessage({ type: 'timerState', isPaused: false });
}

function pauseTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  isPaused = true;
  self.postMessage({ type: 'timerState', isPaused: true });
}

function stopTimer() {
  pauseTimer();
  timeLeft = timerDuration;
  self.postMessage({
    type: 'timerReset',
    timeLeft: timeLeft,
    formattedTime: formatTime(timeLeft),
    percent: 0,
    sessionCount: sessionCount,
    isLongBreak: isCurrentLongBreak()
  });
}

function setDuration(duration: number) {
  timerDuration = duration;
  timeLeft = duration;
  self.postMessage({
    type: 'timerReset',
    timeLeft: timeLeft,
    formattedTime: formatTime(timeLeft),
    percent: 0
  });
}

function getCurrentSessionDuration() {
  if (isBreak) {
    // Use long break (20 minutes) after every 4th work session
    return sessionCount % 4 === 0 ? longBreakDuration : breakDuration;
  }
  return timerDuration;
}

function isCurrentLongBreak() {
  return isBreak && (sessionCount % 4 === 0);
}

// Handle messages from main thread
self.addEventListener('message', (event) => {
  const { type, data } = event.data;

  switch (type) {
    case 'start':
      startTimer();
      break;
    case 'pause':
      pauseTimer();
      break;
    case 'stop':
      stopTimer();
      break;
    case 'setDuration':
      setDuration(data.duration);
      break;
    case 'getState':
      self.postMessage({
        type: 'currentState',
        timeLeft: timeLeft,
        formattedTime: formatTime(timeLeft),
        percent: (timerDuration - timeLeft) / timerDuration,
        isPaused: isPaused,
        sessionCount: sessionCount,
        isLongBreak: isCurrentLongBreak()
      });
      break;
    case 'skip':
      // Immediately end current session and switch
      pauseTimer();
      timeLeft = 0;
      self.postMessage({
        type: 'timerComplete',
        timeLeft: 0,
        formattedTime: formatTime(0),
        percent: 1.0,
        isBreak: isBreak,
        sessionCount: sessionCount,
        isLongBreak: isCurrentLongBreak()
      });
      setTimeout(() => {
        isBreak = !isBreak;
        if (isBreak) {
          // Switching from work to break, increment session count
          sessionCount++;
          if (sessionCount > 4) {
            sessionCount = 1; // Reset after 4 sessions
          }
        }
        timeLeft = getCurrentSessionDuration();
        self.postMessage({
          type: 'sessionSwitch',
          isBreak: isBreak,
          timeLeft: timeLeft,
          formattedTime: formatTime(timeLeft),
          percent: 0,
          sessionCount: sessionCount,
          isLongBreak: isCurrentLongBreak()
        });
        startTimer();
      }, 1000);
      break;
  }
});

// Send initial state
self.postMessage({
  type: 'currentState',
  timeLeft: timeLeft,
  formattedTime: formatTime(timeLeft),
  percent: 0,
  isPaused: isPaused,
  sessionCount: sessionCount,
  isLongBreak: isCurrentLongBreak()
}); 