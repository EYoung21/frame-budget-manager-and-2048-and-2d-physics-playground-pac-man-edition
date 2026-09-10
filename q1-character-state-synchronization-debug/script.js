document.addEventListener('DOMContentLoaded', () => {
  const SIZE = 4;
  const gridCellsEl = document.getElementById('grid-cells');
  const tileLayerEl = document.getElementById('tile-layer');
  const scoreEl = document.getElementById('score');
  const bestScoreEl = document.getElementById('best-score');
  const overlayEl = document.getElementById('overlay');
  const overlayMessageEl = document.getElementById('overlay-message');
  const overlayBtn = document.getElementById('overlay-btn');
  const newGameBtn = document.getElementById('new-game-btn');

  let grid = [];
  let score = 0;
  let bestScore = 0;
  let gameOver = false;
  let won = false;
  let inputLocked = false; // prevents double-processing rapid key repeats mid-render

  // ---- board background cells (static) ----
  function buildGridCells() {
    gridCellsEl.innerHTML = '';
    for (let i = 0; i < SIZE * SIZE; i++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      gridCellsEl.appendChild(cell);
    }
  }

  // ---- state helpers ----
  function createEmptyGrid() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  }

  function getEmptyCells() {
    const cells = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c] === 0) cells.push({ r, c });
      }
    }
    return cells;
  }

  function addRandomTile() {
    const empty = getEmptyCells();
    if (empty.length === 0) return;
    const { r, c } = empty[Math.floor(Math.random() * empty.length)];
    grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  }

  // ---- core slide/merge logic ----
  // Operates on a single line (row or column) left-to-right.
  // Returns { line, moved, gained } where line is the new SIZE-length array.
  function slideAndMergeLine(line) {
    const nonZero = line.filter((v) => v !== 0);
    const merged = [];
    let gained = 0;
    let i = 0;
    while (i < nonZero.length) {
      if (i + 1 < nonZero.length && nonZero[i] === nonZero[i + 1]) {
        const value = nonZero[i] * 2;
        merged.push(value);
        gained += value;
        i += 2; // skip both merged tiles - no chain merging in same move
      } else {
        merged.push(nonZero[i]);
        i += 1;
      }
    }
    while (merged.length < SIZE) merged.push(0);

    let moved = false;
    for (let k = 0; k < SIZE; k++) {
      if (merged[k] !== line[k]) { moved = true; break; }
    }
    return { line: merged, moved, gained };
  }

  function getLine(direction, index) {
    const line = [];
    for (let k = 0; k < SIZE; k++) {
      if (direction === 'left' || direction === 'right') line.push(grid[index][k]);
      else line.push(grid[k][index]);
    }
    if (direction === 'right' || direction === 'down') line.reverse();
    return line;
  }

  function setLine(direction, index, line) {
    const oriented = (direction === 'right' || direction === 'down') ? [...line].reverse() : line;
    for (let k = 0; k < SIZE; k++) {
      if (direction === 'left' || direction === 'right') grid[index][k] = oriented[k];
      else grid[k][index] = oriented[k];
    }
  }

  // Runs one full move as a single atomic state transition:
  // compute all lines from the current snapshot, then commit grid + score + spawn together.
  function move(direction) {
    if (gameOver || inputLocked) return;

    let anyMoved = false;
    let totalGained = 0;
    const newLines = [];

    for (let index = 0; index < SIZE; index++) {
      const line = getLine(direction, index);
      const result = slideAndMergeLine(line);
      newLines.push(result.line);
      if (result.moved) anyMoved = true;
      totalGained += result.gained;
    }

    if (!anyMoved) return; // no-op move: don't spawn a tile or re-render

    // Commit the whole move atomically: grid, score, and spawn happen together
    // before any render, so animation and position can never disagree.
    for (let index = 0; index < SIZE; index++) {
      setLine(direction, index, newLines[index]);
    }
    score += totalGained;
    addRandomTile();

    inputLocked = true;
    render();
    checkGameState();
    // release the lock after the render/transition settles
    window.setTimeout(() => { inputLocked = false; }, 130);
  }

  // ---- rendering ----
  function render() {
    tileLayerEl.innerHTML = '';
    const cellSize = tileLayerEl.clientWidth ? (tileLayerEl.clientWidth - (SIZE - 1) * 10) / SIZE : 0;
    const gap = 10;

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const value = grid[r][c];
        if (value === 0) continue;
        const tile = document.createElement('div');
        const cls = value <= 2048 ? `tile-${value}` : 'tile-super';
        tile.className = `tile ${cls}`;
        tile.textContent = value;
        const size = (100 / SIZE);
        tile.style.width = `calc(${size}% - ${gap * (SIZE - 1) / SIZE}px)`;
        tile.style.height = tile.style.width;
        tile.style.left = `calc(${c} * (100% - ${gap * (SIZE - 1)}px) / ${SIZE} + ${c * gap}px)`;
        tile.style.top = `calc(${r} * (100% - ${gap * (SIZE - 1)}px) / ${SIZE} + ${r * gap}px)`;
        tileLayerEl.appendChild(tile);
      }
    }

    scoreEl.textContent = String(score);
    if (score > bestScore) bestScore = score;
    bestScoreEl.textContent = String(bestScore);
  }

  function hasAdjacentMergeable() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = grid[r][c];
        if (v === 0) continue;
        if (c + 1 < SIZE && grid[r][c + 1] === v) return true;
        if (r + 1 < SIZE && grid[r + 1][c] === v) return true;
      }
    }
    return false;
  }

  function checkGameState() {
    if (!won) {
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (grid[r][c] === 2048) {
            won = true;
            showOverlay('You win! \u{1F389}');
            return;
          }
        }
      }
    }

    const noEmpty = getEmptyCells().length === 0;
    if (noEmpty && !hasAdjacentMergeable()) {
      gameOver = true;
      showOverlay('Game Over');
    }
  }

  function showOverlay(message) {
    overlayMessageEl.textContent = message;
    overlayEl.classList.remove('hidden');
  }

  function hideOverlay() {
    overlayEl.classList.add('hidden');
  }

  // ---- reset / init ----
  function resetGame() {
    grid = createEmptyGrid();
    score = 0;
    gameOver = false;
    won = false;
    inputLocked = false;
    hideOverlay();
    addRandomTile();
    addRandomTile();
    render();
  }

  // ---- input handling ----
  const KEY_MAP = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
  };

  document.addEventListener('keydown', (e) => {
    const direction = KEY_MAP[e.key];
    if (!direction) return;
    e.preventDefault();
    move(direction);
  });

  newGameBtn.addEventListener('click', resetGame);
  overlayBtn.addEventListener('click', resetGame);

  buildGridCells();
  resetGame();
});

