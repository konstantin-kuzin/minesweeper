'use strict';

const ROWS = 10;
const COLS = 10;
const MINES = 10;
const TIME_LIMIT = 150;

const formatTime = seconds => {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

const Sound = {
  _audioCtx: null,

  _ctx() {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._audioCtx.state === 'suspended') this._audioCtx.resume();
    return this._audioCtx;
  },

  _tone(freq, duration, type = 'square', vol = 0.12, when = 0) {
    const ctx = this._ctx();
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.01);
  },

  playReveal() {
    this._tone(900, 0.04, 'square', 0.07);
  },

  playRotate() {
    const ctx = this._ctx();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.45);
    gain.gain.setValueAtTime(0.09, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.5);
  },

  playExplode() {
    const ctx = this._ctx();
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.45);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.8);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(80, t + 0.35);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
    this._tone(90, 0.25, 'sawtooth', 0.18);
  },

  playWin() {
    [523, 659, 784, 1047].forEach((freq, i) => {
      this._tone(freq, 0.22, 'square', 0.1, i * 0.12);
    });
  }
};

class Game {
  constructor() {
    this.rows = ROWS;
    this.cols = COLS;
    this.totalMines = MINES;
    this.timeLimit = TIME_LIMIT;
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

    this.timerInterval = setInterval(() => {
      remaining--;
      timeEl.textContent = formatTime(remaining);

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
    this.newGame();
  },

  newGame() {
    if (typeof Confetti !== 'undefined') Confetti.stop();
    if (this.game) this.game._stopTimer();
    this.game = new Game();
    this.game.onTimeout = () => this._handleTimeout();
    this._renderBoard();
    this._updateMineCounter();
    // Show initial countdown time
    document.getElementById('time').textContent = formatTime(this.game.timeLimit);
    document.getElementById('new-game-btn').textContent = '🙂';
    document.getElementById('timer').classList.remove('warning');
    document.getElementById('message').textContent = '';
    document.getElementById('message').className = '';
    if (typeof Kostya !== 'undefined') Kostya.reset();
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
    const left = this.game.totalMines - this.game.flagCount;
    let text;
    if (left < 0) {
      text = '-' + String(Math.min(99, Math.abs(left))).padStart(2, '0');
    } else {
      text = String(Math.min(999, left)).padStart(3, '0');
    }
    document.getElementById('mines-left').textContent = text;
  },

  _setFace(face) {
    const faces = { idle: '🙂', win: '😎', lose: '😵' };
    document.getElementById('new-game-btn').textContent = faces[face] || '🙂';
  },

  _handleReveal(row, col) {
    const result = this.game.reveal(row, col);
    if (result.type === 'none') return;
    this._refreshAllCells();
    this._updateMineCounter();
    if (result.shifted) this._applyBoardShift();
    if (result.type === 'mine') {
      Sound.playWin();
      this._showGameOver(result.row, result.col);
    } else if (result.type === 'win') {
      Sound.playExplode();
      this._showWin();
    } else if (result.type === 'reveal') {
      Sound.playReveal();
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
    Sound.playRotate();
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
      Kostya.reset();
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
    this._setFace('win');
    Kostya.animateLose();
    Confetti.start();
    setTimeout(() => Confetti.stop(), 3500);
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
    this._setFace('win');
    Kostya.animateTimeout();
    Confetti.start();
    setTimeout(() => Confetti.stop(), 3500);
  },

  _showWin() {
    const msg = document.getElementById('message');
    msg.textContent = 'YOU WIN!';
    msg.className = 'win';
    this._setFace('lose');
    Kostya.animateWin();
  }
};

const Kostya = {
  BUBBLE_MS: 5000,
  imgEl: null,
  bubbleEl: null,
  containerEl: null,
  _wanderInterval: null,
  _bubbleTimer: null,

  init() {
    this.imgEl       = document.getElementById('kostya-img');
    this.bubbleEl    = document.getElementById('speech-bubble');
    this.containerEl = document.getElementById('kostya-container');
  },

  reset() {
    this.imgEl.src = 'pixel_character_stomp_v2.gif';
    this.bubbleEl.className = 'hidden';
    this.bubbleEl.textContent = 'Византично!';
    this._stopWander();
    const track = document.getElementById('kostya-track');
    const trackWidth = track ? track.clientWidth : 0;
    const charWidth = this.containerEl.offsetWidth || 110;
    this._maxLeft = Math.max(0, trackWidth - charWidth);
    this._moveTo(0);
    this._startWander();
  },

  _moveTo(leftPx) {
    this.containerEl.style.left = Math.min(this._maxLeft, leftPx) + 'px';
  },

  _startWander() {
    this._wanderInterval = setInterval(() => {
      this._moveTo(Math.floor(Math.random() * (this._maxLeft + 1)));
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
    this.imgEl.src = 'panic_scream.gif';
    this._showBubble('Как макеты рисуешь, так и играешь!', true);
  },

  animateWin() {
    this._stopWander();
    this.imgEl.src = 'happy_jump.gif';
    this._showBubble('Сапёр из тебя никудышный.<br>Это было вакханально', true);
  },

  animateTimeout() {
    this.animateLose();
  },

  _showBubble(text, persistent, onHide) {
    if (this._bubbleTimer) {
      clearTimeout(this._bubbleTimer);
      this._bubbleTimer = null;
    }
    this.bubbleEl.innerHTML = text;
    this.bubbleEl.className = persistent ? 'visible timeout' : 'visible';
    if (!persistent) {
      this._bubbleTimer = setTimeout(() => {
        this._bubbleTimer = null;
        this.bubbleEl.className = 'hidden';
        if (onHide) onHide();
      }, this.BUBBLE_MS);
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
