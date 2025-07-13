// Mesh Worker - Handles mesh rendering calculations
let totalCells = 0;
let filledCount = 0;
let meshFilledIndices: Set<number> = new Set();
let meshFilledColors: Map<number, string> = new Map();

const chillPalette = [
  '#b2dfdb', // teal
  '#b3c6e7', // soft blue
  '#c5cae9', // lavender
  '#ffe0b2', // peach
  '#b2ebf2', // aqua
  '#d1c4e9', // light purple
  '#c8e6c9', // mint
  '#f8bbd0', // pink
  '#e1bee7', // lilac
];

function getChillColor(idx: number) {
  return chillPalette[idx % chillPalette.length];
}

function calculateMeshUpdate(percent: number, isBreak: boolean) {
  if (totalCells === 0) return { updates: [], filledCount: 0 };
  
  const newFillCount = Math.round(percent * totalCells);
  const updates: Array<{index: number, color: string}> = [];
  
  // Only update if fill count changed
  if (newFillCount !== filledCount) {
    // Find unfilled indices for random selection
    const unfilled: number[] = [];
    for (let i = 0; i < totalCells; i++) {
      if (!meshFilledIndices.has(i)) unfilled.push(i);
    }
    
    // Fill new cells randomly
    const cellsToFill = newFillCount - filledCount;
    for (let i = 0; i < cellsToFill && unfilled.length > 0; i++) {
      // Pick a random unfilled index
      const randomIndex = Math.floor(Math.random() * unfilled.length);
      const idx = unfilled[randomIndex];
      unfilled.splice(randomIndex, 1); // Remove from unfilled list
      
      let color;
      if (isBreak) {
        color = getChillColor(idx);
      } else {
        color = `hsl(${Math.floor(Math.random() * 360)}, 80%, 60%)`;
      }
      meshFilledIndices.add(idx);
      meshFilledColors.set(idx, color);
      updates.push({ index: idx, color: color });
    }
    filledCount = newFillCount;
  }
  
  return { updates, filledCount };
}

function clearMesh() {
  meshFilledIndices.clear();
  meshFilledColors.clear();
  filledCount = 0;
  
  // Send clear message to main thread
  self.postMessage({
    type: 'meshClear',
    totalCells: totalCells
  });
}

function setMeshSize(cells: number) {
  totalCells = cells;
  filledCount = 0;
  meshFilledIndices.clear();
  meshFilledColors.clear();
  
  self.postMessage({
    type: 'meshSizeSet',
    totalCells: totalCells
  });
}

// Handle messages from main thread
self.addEventListener('message', (event) => {
  const { type, data } = event.data;
  
  switch (type) {
    case 'updateMesh':
      const result = calculateMeshUpdate(data.percent, data.isBreak);
      if (result.updates.length > 0) {
        self.postMessage({
          type: 'meshUpdates',
          updates: result.updates,
          filledCount: result.filledCount
        });
      }
      break;
    case 'clearMesh':
      clearMesh();
      break;
    case 'setMeshSize':
      setMeshSize(data.totalCells);
      break;
    case 'getMeshState':
      self.postMessage({
        type: 'meshState',
        totalCells: totalCells,
        filledCount: filledCount,
        filledIndices: Array.from(meshFilledIndices),
        filledColors: Object.fromEntries(meshFilledColors)
      });
      break;
  }
});

// Send initial state
self.postMessage({
  type: 'meshReady',
  totalCells: totalCells,
  filledCount: filledCount
}); 