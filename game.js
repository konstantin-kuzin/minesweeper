'use strict';

const LEVELS = {
  easy:   { rows:  9, cols:  9, mines:  10, timeLimit: 150 },
  medium: { rows: 16, cols: 16, mines:  40, timeLimit: 300 },
  hard:   { rows: 16, cols: 30, mines:  99, timeLimit: 600 },
  expert: { rows: 24, cols: 30, mines: 160, timeLimit: 900 }
};

const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

class Game {
  constructor(level = 'easy') {
    this.level = level;
    const { rows, cols, mines, timeLimit } = LEVELS[level];
    this.rows = rows;
    this.cols = cols;
    this.totalMines = mines;
    this.timeLimit = timeLimit;
    this.cells = [];
    this.flagCount = 0;
    this.revealedCount = 0;
    this.moveCount = 0;
    this.firstClick = true;
    this.gameOver = false;
    this.won = false;
    this.onTimeout = null;
    this.timerInterval = null;
    this._initBoard();
  }

  _initBoard() {
    this.cells = Array.from({ length: this.rows }, () =>
      Array.from({ length: this.cols }, () => ({
        mine: false, flagged: false, revealed: false, count: 0
      }))
    );
  }

  _placeMines(safeRow, safeCol) {
    const candidates = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (Math.abs(r - safeRow) > 1 || Math.abs(c - safeCol) > 1)
          candidates.push([r, c]);

    for (let i = 0; i < this.totalMines; i++) {
      const j = i + Math.floor(Math.random() * (candidates.length - i));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      const [r, c] = candidates[i];
      this.cells[r][c].mine = true;
    }
    this._calcCounts();
  }

  _calcCounts() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].mine) continue;
        let count = 0;
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols && this.cells[nr][nc].mine)
            count++;
        }
        this.cells[r][c].count = count;
      }
    }
  }

  _rotateBoard90CW() {
    const oldRows = this.rows;
    const oldCols = this.cols;
    const newCells = Array.from({ length: oldCols }, () =>
      Array.from({ length: oldRows }, () => null)
    );
    for (let r = 0; r < oldRows; r++) {
      for (let c = 0; c < oldCols; c++) {
        newCells[c][oldRows - 1 - r] = { ...this.cells[r][c] };
      }
    }
    this.rows = oldCols;
    this.cols = oldRows;
    this.cells = newCells;
  }

  _incrementMoveAndMaybeShift() {
    this.moveCount++;
    return true;
  }

  applyShift() {
    this._rotateBoard90CW();
    this._calcCounts();
  }

  reveal(row, col) {
    if (this.gameOver || this.won) return { type: 'none' };
    const cell = this.cells[row][col];
    if (cell.revealed || cell.flagged) return { type: 'none' };

    if (this.firstClick) {
      this.firstClick = false;
      this._placeMines(row, col);
      this._startTimer();
    }

    if (cell.mine) {
      cell.revealed = true;
      this.gameOver = true;
      this.moveCount++;
      this._stopTimer();
      return { type: 'mine', row, col };
    }

    const newlyRevealed = this._floodFill(row, col);
    this.revealedCount += newlyRevealed;

    if (this.revealedCount >= this.rows * this.cols - this.totalMines) {
      this.won = true;
      this.moveCount++;
      this._stopTimer();
      return { type: 'win' };
    }

    const shifted = this._incrementMoveAndMaybeShift();
    return { type: 'reveal', shifted };
  }

  _floodFill(row, col) {
    const stack = [[row, col]];
    let count = 0;
    while (stack.length) {
      const [r, c] = stack.pop();
      const cell = this.cells[r][c];
      if (cell.revealed || cell.flagged || cell.mine) continue;
      cell.revealed = true;
      count++;
      if (cell.count === 0) {
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols)
            stack.push([nr, nc]);
        }
      }
    }
    return count;
  }

  // Returns { placed: bool, shifted: bool } or null (not allowed)
  toggleFlag(row, col) {
    if (this.gameOver || this.won || this.firstClick) return null;
    const cell = this.cells[row][col];
    if (cell.revealed) return null;
    cell.flagged = !cell.flagged;
    this.flagCount += cell.flagged ? 1 : -1;
    const shifted = this._incrementMoveAndMaybeShift();
    return { placed: cell.flagged, shifted };
  }

  getAllMines() {
    const result = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.cells[r][c].mine) result.push([r, c]);
    return result;
  }

  _startTimer() {
    let remaining = this.timeLimit;
    const timeEl  = document.getElementById('time');
    const timerEl = document.getElementById('timer');

    const fmt = s => {
      const m = String(Math.floor(s / 60)).padStart(2, '0');
      const sec = String(s % 60).padStart(2, '0');
      return `${m}:${sec}`;
    };

    this.timerInterval = setInterval(() => {
      remaining--;
      timeEl.textContent = fmt(remaining);

      if (remaining <= 30) timerEl.classList.add('warning');

      if (remaining <= 0) {
        this._stopTimer();
        this.gameOver = true;
        if (this.onTimeout) this.onTimeout();
      }
    }, 1000);
  }

  _stopTimer() {
    clearInterval(this.timerInterval);
    this.timerInterval = null;
  }
}

const UI = {
  game: null,

  init() {
    document.getElementById('new-game-btn')
      .addEventListener('click', () => this.newGame());
    document.querySelectorAll('.diff-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.newGame(btn.dataset.level);
      })
    );
    this.newGame('easy');
  },

  newGame(level) {
    if (typeof Confetti !== 'undefined') Confetti.stop();
    if (this.game) this.game._stopTimer();
    const activeLevel = level ||
      document.querySelector('.diff-btn.active').dataset.level;
    this.game = new Game(activeLevel);
    this.game.onTimeout = () => this._handleTimeout();
    this._renderBoard();
    this._updateMineCounter();
    // Show initial countdown time
    const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    document.getElementById('time').textContent = fmt(this.game.timeLimit);
    document.getElementById('timer').classList.remove('warning');
    document.getElementById('message').textContent = '';
    document.getElementById('message').className = '';
    if (typeof Kostya !== 'undefined') Kostya.reset(this.game.rows);
  },

  _renderBoard() {
    const boardEl = document.getElementById('board');
    const { rows, cols } = this.game;
    boardEl.style.gridTemplateColumns = `repeat(${cols}, 32px)`;
    boardEl.innerHTML = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const el = document.createElement('div');
        el.className = 'cell';
        el.dataset.row = r;
        el.dataset.col = c;
        el.addEventListener('click', () => this._handleReveal(r, c));
        el.addEventListener('contextmenu', e => {
          e.preventDefault();
          this._handleFlag(r, c);
        });
        boardEl.appendChild(el);
      }
    }
  },

  _getCellEl(row, col) {
    return document.querySelector(`#board [data-row="${row}"][data-col="${col}"]`);
  },

  _updateCellEl(row, col) {
    const el = this._getCellEl(row, col);
    const cell = this.game.cells[row][col];
    el.className = 'cell';
    delete el.dataset.num;
    el.textContent = '';
    if (cell.revealed) {
      el.classList.add('revealed');
      if (cell.count > 0) {
        const num = document.createElement('span');
        num.className = 'cell-num';
        num.textContent = cell.count;
        el.appendChild(num);
        el.dataset.num = cell.count;
      }
    } else if (cell.flagged) {
      el.classList.add('flagged');
      el.textContent = '🚩';
    }
  },

  _refreshAllCells() {
    for (let r = 0; r < this.game.rows; r++)
      for (let c = 0; c < this.game.cols; c++)
        this._updateCellEl(r, c);
  },

  _updateMineCounter() {
    document.getElementById('mines-left').textContent =
      this.game.totalMines - this.game.flagCount;
  },

  _handleReveal(row, col) {
    const result = this.game.reveal(row, col);
    if (result.type === 'none') return;
    this._refreshAllCells();
    this._updateMineCounter();
    if (result.shifted) this._applyBoardShift();
    if (result.type === 'mine') {
      this._showGameOver(result.row, result.col);
    } else if (result.type === 'win') {
      this._showWin();
    }
  },

  _handleFlag(row, col) {
    const result = this.game.toggleFlag(row, col);
    if (result === null) return;
    this._updateCellEl(row, col);
    this._updateMineCounter();
    if (result.shifted) this._applyBoardShift();
  },

  _applyBoardShift() {
    const boardEl = document.getElementById('board');
    boardEl.classList.add('rotating');
    Kostya.animateShift();
    setTimeout(() => {
      this.game.applyShift();
      boardEl.classList.remove('rotating');
      boardEl.style.transform = '';
      this._renderBoard();
      this._refreshAllCells();
      this._animateNumsUpright();
      this._updateMineCounter();
      Kostya.reset(this.game.rows);
    }, 520);
  },

  _animateNumsUpright() {
    document.querySelectorAll('#board .cell-num').forEach(num => {
      num.style.transform = 'rotate(90deg)';
      num.style.transition = 'none';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        num.style.transition = 'transform 0.35s ease-out';
        num.style.transform = 'rotate(0deg)';
      }));
    });
  },

  _showGameOver(hitRow, hitCol) {
    this.game.getAllMines().forEach(([r, c]) => {
      const el = this._getCellEl(r, c);
      el.classList.add('revealed', 'mine');
      el.textContent = '💣';
    });
    this._getCellEl(hitRow, hitCol).classList.add('mine-hit');
    const msg = document.getElementById('message');
    msg.textContent = 'GAME OVER';
    msg.className = 'lose';
    Kostya.animateLose();
  },

  _handleTimeout() {
    this._refreshAllCells();
    this.game.getAllMines().forEach(([r, c]) => {
      const el = this._getCellEl(r, c);
      el.classList.add('revealed', 'mine');
      el.textContent = '💣';
    });
    const msg = document.getElementById('message');
    msg.textContent = 'ВРЕМЯ ВЫШЛО!';
    msg.className = 'lose';
    Kostya.animateTimeout();
  },

  _showWin() {
    const msg = document.getElementById('message');
    msg.textContent = 'YOU WIN!';
    msg.className = 'win';
    Kostya.animateWin();
    Confetti.start();
    setTimeout(() => Confetti.stop(), 3500);
  }
};

const Kostya = {
  imgEl: null,
  bubbleEl: null,
  containerEl: null,
  _wanderInterval: null,

  init() {
    this.imgEl       = document.getElementById('kostya-img');
    this.bubbleEl    = document.getElementById('speech-bubble');
    this.containerEl = document.getElementById('kostya-container');
  },

  reset(totalRows) {
    this.imgEl.src = 'pixel_character_stomp_v2.gif';
    this.bubbleEl.className = 'hidden';
    this.bubbleEl.textContent = 'Византично!';
    this._stopWander();
    this._moveTo(0);
    this._startWander(totalRows);
  },

  _rowToPx(row) {
    return 4 + row * 34;
  },

  _moveTo(topPx) {
    this.containerEl.style.top = topPx + 'px';
  },

  _startWander(totalRows) {
    const maxTop = Math.max(0, totalRows * 34 - 110);
    this._wanderInterval = setInterval(() => {
      this._moveTo(Math.floor(Math.random() * (maxTop + 1)));
    }, 2500);
  },

  _stopWander() {
    clearInterval(this._wanderInterval);
    this._wanderInterval = null;
  },

  animateShift() {
    this.imgEl.src = 'pointing.gif';
    this._showBubble('Византично!', false, () => {
      this.imgEl.src = 'pixel_character_stomp_v2.gif';
    });
  },

  animateLose() {
    this._stopWander();
    this.imgEl.src = 'happy_jump.gif';
    this._showBubble('Сапёр из тебя никудышный.<br>Это было вакханально', true);
  },

  animateWin() {
    this._stopWander();
    this.imgEl.src = 'panic_scream.gif';
    this.bubbleEl.className = 'hidden';
  },

  animateTimeout() {
    this._stopWander();
    this.imgEl.src = 'happy_jump.gif';
    this._showBubble('Сапёр из тебя никудышный.<br>Это было вакханально', true);
  },

  _showBubble(text, persistent, onHide) {
    this.bubbleEl.innerHTML = text;
    this.bubbleEl.className = persistent ? 'visible timeout' : 'visible';
    if (!persistent) {
      setTimeout(() => {
        this.bubbleEl.className = 'hidden';
        if (onHide) onHide();
      }, 2200);
    }
  }
};

const Confetti = {
  canvas: null,
  ctx: null,
  particles: [],
  animId: null,

  start() {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999;';
      document.body.appendChild(this.canvas);
    }
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.ctx = this.canvas.getContext('2d');
    this.particles = Array.from({ length: 80 }, () => ({
      x:    Math.random() * this.canvas.width,
      y:    -(Math.random() * this.canvas.height * 0.5),
      w:    6 + Math.random() * 10,
      h:    3 + Math.random() * 6,
      color: `hsl(${Math.random() * 360},80%,60%)`,
      vy:   2 + Math.random() * 3,
      vx:   (Math.random() - 0.5) * 2,
      rot:  Math.random() * Math.PI * 2,
      drot: (Math.random() - 0.5) * 0.15
    }));
    if (this.animId) cancelAnimationFrame(this.animId);
    this._draw();
  },

  _draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    let alive = false;
    this.particles.forEach(p => {
      p.y += p.vy; p.x += p.vx; p.rot += p.drot;
      if (p.y < this.canvas.height + 20) alive = true;
      this.ctx.save();
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate(p.rot);
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      this.ctx.restore();
    });
    this.animId = alive
      ? requestAnimationFrame(() => this._draw())
      : (this.stop(), null);
  },

  stop() {
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
    if (this.canvas) { this.canvas.remove(); this.canvas = null; }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Kostya.init();
  UI.init();
});
